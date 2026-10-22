import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Correções da auditoria de 22/10/2026: travas de status, posse dos dados (IDOR) e o bloqueio de
// extrato valendo em todos os caminhos.

const tx = {
  creditCard: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  creditCardFinal: { create: vi.fn(), update: vi.fn() },
  creditCardStatementItem: { updateMany: vi.fn() },
  creditCardStatement: { findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(async () => [{ total: 0 }]),
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCard: { findUnique: vi.fn() },
    creditCardFinal: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    creditCardStatement: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    creditCardStatementItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    creditCardStatementFinalTotal: { upsert: vi.fn(), deleteMany: vi.fn() },
    paymentInstallment: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
const auditLog = vi.fn();
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: (...a: unknown[]) => auditLog(...a), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const finais = [{ id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true }];
const detalhe = (status: string, totais: Array<{ cardFinalId: string; statedAmount: string }> = []) => ({
  id: "s1", creditCardId: "c1", status, generatedPurchaseId: "gp",
  creditCard: { finais }, finalTotals: totais,
  items: [{ description: "Compra", value: "100.00", cardFinalId: "f1", purchaseId: "p", purchase: { status: "ACTIVE", _count: { items: 1 } } }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /cards: cartão de outra conta", () => {
  test("cadastro novo recusa qualquer id de final no corpo", async () => {
    const r = await request(app).post("/cards").send({
      name: "X", bankName: "B", closingDay: 5, dueDay: 18,
      finais: [{ id: "de-outra-conta", last4Digits: "9999", kind: "PHYSICAL" }],
    });
    expect(r.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("dia de fechamento ou vencimento que não é inteiro entre 1 e 31 é recusado", async () => {
    for (const body of [{ closingDay: "abc", dueDay: 18 }, { closingDay: 5, dueDay: 40 }, { closingDay: 0, dueDay: 18 }, { closingDay: 5.5, dueDay: 18 }]) {
      const r = await request(app).post("/cards").send({ name: "X", bankName: "B", last4Digits: "1111", ...body });
      expect(r.status).toBe(400);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /cards/:id/finais", () => {
  beforeEach(() => db.creditCard.findUnique.mockResolvedValue({ id: "c1" }));

  test("não altera o final de outra conta pelo id do corpo", async () => {
    db.creditCardFinal.findFirst.mockResolvedValue(null);
    const r = await request(app).post("/cards/c1/finais").send({ id: "alheio", label: "X", last4Digits: "9999", kind: "VIRTUAL" });
    expect(r.status).toBe(404);
    expect(db.creditCardFinal.update).not.toHaveBeenCalled();
  });

  test("segundo cartão físico ativo é recusado", async () => {
    db.creditCardFinal.findFirst.mockResolvedValue(null);
    db.creditCardFinal.count.mockResolvedValue(1);
    const r = await request(app).post("/cards/c1/finais").send({ label: "Outro", last4Digits: "2222", kind: "PHYSICAL" });
    expect(r.status).toBe(409);
  });
});

describe("travas de status da fatura", () => {
  test("total do extrato não muda em fatura fechada", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "CLOSED" });
    const r = await request(app).put("/cards/statements/s1/final-totals/f1").send({ statedAmount: "10,00" });
    expect(r.status).toBe(409);
    expect(db.creditCardStatementFinalTotal.upsert).not.toHaveBeenCalled();
  });

  test("total do extrato absurdo é recusado", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f1", creditCardId: "c1" });
    const r = await request(app).put("/cards/statements/s1/final-totals/f1").send({ statedAmount: "99999999999" });
    expect(r.status).toBe(400);
  });

  test("remover o total do extrato deixa registro no log", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f1", creditCardId: "c1" });
    const r = await request(app).put("/cards/statements/s1/final-totals/f1").send({ statedAmount: "" });
    expect(r.status).toBe(200);
    expect(auditLog).toHaveBeenCalled();
  });

  test("marcar divergência em linha de fatura fechada é recusado", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "s1", checked: false, hasDivergence: false });
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", status: "PAID" });
    const r = await request(app).patch("/cards/statements/s1/items/i1/check").send({ checked: true, hasDivergence: true });
    expect(r.status).toBe(409);
    expect(db.creditCardStatementItem.update).not.toHaveBeenCalled();
  });

  test("a linha precisa ser da fatura da URL", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "outra", checked: false, hasDivergence: false });
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", status: "OPEN" });
    const r = await request(app).patch("/cards/statements/s1/items/i1/check").send({ checked: true });
    expect(r.status).toBe(404);
    expect(db.creditCardStatementItem.update).not.toHaveBeenCalled();
  });

  test("lista de linhas grande demais é recusada", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    const ids = Array.from({ length: 1001 }, (_, i) => `i${i}`);
    expect((await request(app).post("/cards/statements/s1/items-check").send({ itemIds: ids, checked: true })).status).toBe(400);
    expect((await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ids, cardFinalId: null })).status).toBe(400);
  });
});

describe("o bloqueio por extrato vale também no pagamento e no cadastro de fatura", () => {
  test("pagar fatura cujo total deixou de bater com o extrato é recusado", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe("CLOSED", [{ cardFinalId: "f1", statedAmount: "500.00" }]));
    const r = await request(app).patch("/cards/statements/s1/pay").send({});
    expect(r.status).toBe(422);
    expect(db.paymentInstallment.findMany).not.toHaveBeenCalled();
  });

  test("só fatura fechada pode ser paga", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe("OPEN"));
    const r = await request(app).patch("/cards/statements/s1/pay").send({});
    expect(r.status).toBe(409);
  });

  test("cadastro de fatura ignora o status do corpo", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c1", closingDay: 5, dueDay: 18 });
    db.creditCardStatement.create.mockResolvedValue({ id: "novo" });
    await request(app).post("/cards/statements").send({ creditCardId: "c1", competenceYear: 2026, competenceMonth: 9, status: "CHECKED" });
    expect(db.creditCardStatement.create.mock.calls[0][0].data.status).toBe("OPEN");
  });

  test("não troca o cartão de uma fatura que já tem linhas", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c2", closingDay: 5, dueDay: 18 });
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", creditCardId: "c1", status: "OPEN" });
    db.creditCardStatementItem.count.mockResolvedValue(3);
    const r = await request(app).post("/cards/statements").send({ id: "s1", creditCardId: "c2", competenceYear: 2026, competenceMonth: 9 });
    expect(r.status).toBe(409);
    expect(db.creditCardStatement.update).not.toHaveBeenCalled();
  });
});
