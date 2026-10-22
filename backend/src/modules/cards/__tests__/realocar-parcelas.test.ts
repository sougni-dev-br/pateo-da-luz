import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// A compra entrou na fatura errada: as parcelas precisam andar juntas para o mês seguinte, e uma
// fatura que foi fechada e reaberta (continua com o título gerado) tem que poder receber e ceder linhas.

const tx = {
  creditCardStatementItem: { update: vi.fn() },
  creditCardStatement: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(async () => null) },
  $queryRaw: vi.fn(async () => [{ total: 0 }]),
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCardStatementItem: { findUnique: vi.fn(), findMany: vi.fn() },
    creditCardStatement: { findUnique: vi.fn(), findFirst: vi.fn() },
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
import { competenciaDepois } from "../cards.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const cartao = { id: "c1", name: "Cartão", bankName: "Banco", last4Digits: "1111", closingDay: 5, dueDay: 18 };
const fatura = (id: string, mes: number, status = "OPEN", generatedPurchaseId: string | null = null, ano = 2026) =>
  ({ id, creditCardId: "c1", competenceYear: ano, competenceMonth: mes, status, generatedPurchaseId, creditCard: cartao });
const linha = (id: string, parcela: number, statement: ReturnType<typeof fatura>) =>
  ({ id, purchaseId: "p1", statementId: statement.id, installment: parcela, totalInstallments: 3, statement });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("competenciaDepois", () => {
  test("soma meses e vira o ano", () => {
    expect(competenciaDepois(2026, 7, 1)).toEqual({ ano: 2026, mes: 8 });
    expect(competenciaDepois(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 });
    expect(competenciaDepois(2026, 11, 3)).toEqual({ ano: 2027, mes: 2 });
    expect(competenciaDepois(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 });
  });
});

describe("realocar uma linha entre faturas reabertas", () => {
  test("fatura reaberta (aberta, mas com título gerado antes) pode ceder e receber linhas", async () => {
    const origem = fatura("s9", 9, "OPEN", "titulo-antigo");
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i3", statementId: "s9", statement: origem });
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("s10", 10, "OPEN", "titulo-antigo"));
    const r = await request(app).post("/cards/statements/items/i3/reallocate").send({ targetStatementId: "s10", reason: "banco jogou a compra para o mês seguinte" });
    expect(r.status).toBe(200);
    expect(tx.creditCardStatementItem.update).toHaveBeenCalledWith({ where: { id: "i3" }, data: { statementId: "s10" } });
  });

  test("fatura fechada continua recusando", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i3", statementId: "s9", statement: fatura("s9", 9) });
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("s10", 10, "CLOSED", "titulo"));
    const r = await request(app).post("/cards/statements/items/i3/reallocate").send({ targetStatementId: "s10", reason: "motivo válido" });
    expect(r.status).toBe(400);
    expect(tx.creditCardStatementItem.update).not.toHaveBeenCalled();
  });
});

describe("mover todas as parcelas da compra para o mês seguinte", () => {
  const julho = fatura("s7", 7, "OPEN", "titulo");
  const agosto = fatura("s8", 8);
  const setembro = fatura("s9", 9);
  const outubro = fatura("s10", 10, "OPEN", "titulo");

  beforeEach(() => {
    db.creditCardStatementItem.findMany.mockResolvedValue([linha("i1", 1, julho), linha("i2", 2, agosto), linha("i3", 3, setembro)]);
    db.creditCardStatement.findFirst.mockImplementation(async ({ where }: { where: { competenceMonth: number } }) =>
      ({ 8: agosto, 9: setembro, 10: outubro } as Record<number, unknown>)[where.competenceMonth] ?? null);
  });

  test("cada parcela vai para a fatura do mês seguinte à que está", async () => {
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "banco lançou a compra só em agosto" });
    expect(r.status).toBe(200);
    expect(r.body.movidas).toBe(3);
    const chamadas = tx.creditCardStatementItem.update.mock.calls.map((c) => [c[0].where.id, c[0].data.statementId]);
    expect(chamadas).toEqual([["i1", "s8"], ["i2", "s9"], ["i3", "s10"]]);
    expect(auditLog.mock.calls[0][0]).toMatchObject({ action: "SHIFT_CREDIT_CARD_PURCHASE_INSTALLMENTS" });
  });

  test("cria a fatura de destino que ainda não existe", async () => {
    db.creditCardStatement.findFirst.mockImplementation(async ({ where }: { where: { competenceMonth: number } }) =>
      ({ 8: agosto, 9: setembro } as Record<number, unknown>)[where.competenceMonth] ?? null);
    tx.creditCardStatement.create.mockResolvedValue(fatura("novo", 10));
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "banco lançou a compra só em agosto" });
    expect(r.status).toBe(200);
    expect(tx.creditCardStatement.create.mock.calls[0][0].data).toMatchObject({ competenceYear: 2026, competenceMonth: 10, status: "OPEN" });
  });

  test("recalcula o total das faturas mexidas", async () => {
    await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "banco lançou a compra só em agosto" });
    expect(tx.creditCardStatement.update).toHaveBeenCalled();
  });

  test("recusa se alguma parcela está em fatura fechada, sem mover nada", async () => {
    db.creditCardStatementItem.findMany.mockResolvedValue([linha("i1", 1, fatura("s7", 7, "CLOSED", "t")), linha("i2", 2, agosto)]);
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "motivo válido" });
    expect(r.status).toBe(409);
    expect(tx.creditCardStatementItem.update).not.toHaveBeenCalled();
  });

  test("recusa se a fatura de destino está fechada", async () => {
    db.creditCardStatement.findFirst.mockImplementation(async ({ where }: { where: { competenceMonth: number } }) =>
      where.competenceMonth === 10 ? fatura("s10", 10, "PAID", "t") : where.competenceMonth === 8 ? agosto : setembro);
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "motivo válido" });
    expect(r.status).toBe(409);
    expect(tx.creditCardStatementItem.update).not.toHaveBeenCalled();
  });

  test("exige motivo e quantidade de meses válida", async () => {
    expect((await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "x" })).status).toBe(400);
    expect((await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 0, reason: "motivo válido" })).status).toBe(400);
    expect((await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 9, reason: "motivo válido" })).status).toBe(400);
  });

  test("compra sem linhas em fatura dá 404", async () => {
    db.creditCardStatementItem.findMany.mockResolvedValue([]);
    const r = await request(app).post("/cards/purchases/p1/shift-installments").send({ meses: 1, reason: "motivo válido" });
    expect(r.status).toBe(404);
  });
});
