import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// 2ª auditoria (11/11/2026): transições de status, validações dos créditos, revincular compra,
// troca de cartão da fatura e corrida na criação da fatura de destino.

const tx = {
  creditCardStatementAdjustment: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  creditCardStatementItem: { update: vi.fn() },
  creditCardStatement: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(async () => null) },
  $queryRaw: vi.fn(async () => [{ total: 0 }]),
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCard: { findUnique: vi.fn() },
    creditCardFinal: { findUnique: vi.fn() },
    creditCardStatement: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    creditCardStatementItem: { count: vi.fn(), findMany: vi.fn() },
    creditCardStatementAdjustment: { count: vi.fn(), findUnique: vi.fn() },
    creditCardStatementFinalTotal: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const detalhe = (status: string, generatedPurchaseId: string | null = null) => ({
  id: "s1", creditCardId: "c1", status, generatedPurchaseId,
  creditCard: { finais: [] }, finalTotals: [], adjustments: [], items: [],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /statements/:id/status só faz as transições que a tela faz", () => {
  const tenta = (atual: string, novo: string, titulo: string | null = null) => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe(atual, titulo));
    db.creditCardStatement.update.mockResolvedValue({ id: "s1", status: novo });
    return request(app).patch("/cards/statements/s1/status").send({ status: novo });
  };

  test.each([["OPEN", "CHECKED"], ["CHECKED", "OPEN"], ["OPEN", "CANCELLED"], ["CANCELLED", "OPEN"], ["OPEN", "OPEN"]])(
    "%s → %s é permitido", async (de, para) => {
      expect((await tenta(de, para)).status).toBe(200);
    });

  test.each([["OPEN", "CLOSED"], ["OPEN", "PAID"], ["CHECKED", "CLOSED"], ["CLOSED", "OPEN"], ["PAID", "OPEN"], ["CLOSED", "PAID"], ["PAID", "CHECKED"]])(
    "%s → %s é recusado (fechar, pagar e reabrir têm rota própria)", async (de, para) => {
      const r = await tenta(de, para);
      expect(r.status).toBe(409);
      expect(db.creditCardStatement.update).not.toHaveBeenCalled();
    });

  test("não cancela fatura que já gerou título", async () => {
    expect((await tenta("OPEN", "CANCELLED", "titulo")).status).toBe(409);
  });
});

describe("créditos e estornos: validações", () => {
  beforeEach(() => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f2", creditCardId: "c1", isActive: true });
    tx.creditCardStatementAdjustment.create.mockResolvedValue({ id: "a1" });
  });
  const lanca = (corpo: object) => request(app).post("/cards/statements/s1/adjustments").send({ tipo: "ESTORNO", description: "Estorno", valor: "10", ...corpo });

  test("valor menor que 1 centavo é recusado e o arredondamento é para centavos", async () => {
    expect((await lanca({ valor: "0,001" })).status).toBe(400);
    expect((await lanca({ valor: "10,005" })).status).toBe(201);
    expect(Number(tx.creditCardStatementAdjustment.create.mock.calls[0][0].data.amount.toString())).toBe(-10.01);
  });

  test("data inválida é recusada", async () => {
    expect((await lanca({ adjustmentDate: "abc" })).status).toBe(400);
  });

  test("cartão inativo é recusado ao lançar e ao trocar", async () => {
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f2", creditCardId: "c1", isActive: false });
    expect((await lanca({ cardFinalId: "f2" })).status).toBe(400);
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "s1", cardFinalId: null });
    expect((await request(app).patch("/cards/statements/s1/adjustments/a1").send({ cardFinalId: "f2" })).status).toBe(400);
  });

  test("trocar o cartão exige dizer o cartão (ou null) no corpo", async () => {
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "s1", cardFinalId: "f2" });
    expect((await request(app).patch("/cards/statements/s1/adjustments/a1").send({})).status).toBe(400);
    expect(tx.creditCardStatementAdjustment.update).not.toHaveBeenCalled();
  });

  test("remover duas vezes: a segunda dá 404, não 500", async () => {
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "s1", amount: "-5" });
    tx.creditCardStatementAdjustment.deleteMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete("/cards/statements/s1/adjustments/a1")).status).toBe(404);
  });
});

describe("trocar o cartão de uma fatura", () => {
  test("recusa se a fatura já tem créditos ou totais do extrato, mesmo sem compras", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c2", closingDay: 5, dueDay: 18 });
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    db.creditCardStatementItem.count.mockResolvedValue(0);
    db.creditCardStatementAdjustment.count.mockResolvedValue(1);
    db.creditCardStatementFinalTotal.count.mockResolvedValue(0);
    const r = await request(app).post("/cards/statements").send({ id: "s1", creditCardId: "c2", competenceYear: 2026, competenceMonth: 9 });
    expect(r.status).toBe(409);
    expect(db.creditCardStatement.update).not.toHaveBeenCalled();
  });
});

describe("revincular compra ao cartão", () => {
  const compra = (status: string) => [{
    id: "p1", purchaseDate: new Date(2026, 7, 3), creditCardId: "c1", totalAmount: 100, supplierName: "Loja", invoiceNumber: "1",
    purchaseNumber: "CMP-1", smallExpenseTypeId: null, smallExpenseResponsibleName: null, smallExpenseNotes: null, rawRow: null, status,
  }];

  test("compra cancelada não volta para a fatura", async () => {
    db.$queryRaw.mockResolvedValue(compra("CANCELLED"));
    db.creditCardStatementItem.findMany.mockResolvedValue([]);
    const r = await request(app).post("/cards/link-purchase").send({ purchaseId: "p1" });
    expect(r.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("não mexe em compra com parcela em fatura fechada ou paga", async () => {
    db.$queryRaw.mockResolvedValue(compra("ACTIVE"));
    db.creditCardStatementItem.findMany.mockResolvedValue([{ statement: { status: "PAID" } }]);
    const r = await request(app).post("/cards/link-purchase").send({ purchaseId: "p1" });
    expect(r.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("mover parcelas: corrida na criação da fatura de destino", () => {
  test("fatura criada por outra requisição no meio vira 409 (tente de novo), não 500", async () => {
    const origem = { id: "s8", creditCardId: "c1", competenceYear: 2026, competenceMonth: 8, status: "OPEN", creditCard: { id: "c1", name: "C", closingDay: 5, dueDay: 18 } };
    db.creditCardStatementItem.findMany.mockResolvedValue([{ id: "i1", installment: 1, statementId: "s8", statement: origem }]);
    db.creditCardStatement.findFirst.mockResolvedValue(null);
    tx.creditCardStatement.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "banco lançou depois" });
    expect(r.status).toBe(409);
  });
});
