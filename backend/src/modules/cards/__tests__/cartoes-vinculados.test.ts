import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Uma fatura do banco traz mais de um cartão (físico e virtual). Cada linha
// aponta para um final; classificar é trocar esse ponteiro, sem mexer em valor.

const tx = {
  creditCardStatementItem: { updateMany: vi.fn() },
  creditCardStatementFinalTotal: { upsert: vi.fn() },
  creditCardStatement: { findUnique: vi.fn(async () => null), update: vi.fn() },
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCard: { findUnique: vi.fn() },
    creditCardFinal: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(async () => 0) },
    creditCardStatement: { findUnique: vi.fn(), update: vi.fn() },
    creditCardStatementItem: { findMany: vi.fn() },
    creditCardStatementFinalTotal: { upsert: vi.fn(), deleteMany: vi.fn() },
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

const fatura = (status = "OPEN") => ({ id: "s1", creditCardId: "c1", status, generatedPurchaseId: null });

beforeEach(() => {
  vi.clearAllMocks();
  db.creditCardStatement.findUnique.mockResolvedValue(fatura());
  db.creditCardFinal.findUnique.mockResolvedValue({ id: "f1", creditCardId: "c1", isActive: true });
  db.creditCardStatementItem.findMany.mockResolvedValue([{ id: "i1" }, { id: "i2" }]);
  tx.creditCardStatementItem.updateMany.mockResolvedValue({ count: 2 });
});

describe("cadastrar cartão vinculado (final)", () => {
  test("cria o final do cartão com rótulo e tipo", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c1" });
    db.creditCardFinal.findFirst.mockResolvedValue(null);
    db.creditCardFinal.create.mockResolvedValue({ id: "f1" });
    const r = await request(app).post("/cards/c1/finais").send({ label: "Físico", last4Digits: "1111", kind: "PHYSICAL" });
    expect(r.status).toBe(201);
    expect(db.creditCardFinal.create.mock.calls[0][0].data).toMatchObject({
      creditCardId: "c1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL",
    });
  });

  test("recusa final com dígitos que não são 4 números", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c1" });
    const r = await request(app).post("/cards/c1/finais").send({ label: "Físico", last4Digits: "11" });
    expect(r.status).toBe(400);
    expect(db.creditCardFinal.create).not.toHaveBeenCalled();
  });

  test("recusa final repetido no mesmo cartão", async () => {
    db.creditCard.findUnique.mockResolvedValue({ id: "c1" });
    db.creditCardFinal.findFirst.mockResolvedValue({ id: "outro" });
    const r = await request(app).post("/cards/c1/finais").send({ label: "Virtual", last4Digits: "1111", kind: "VIRTUAL" });
    expect(r.status).toBe(409);
    expect(db.creditCardFinal.create).not.toHaveBeenCalled();
  });
});

describe("classificar linhas da fatura", () => {
  test("passa vários itens para o final escolhido, só dessa fatura", async () => {
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1", "i2"], cardFinalId: "f1" });
    expect(r.status).toBe(200);
    expect(r.body.atualizados).toBe(2);
    expect(tx.creditCardStatementItem.updateMany).toHaveBeenCalledWith({
      where: { statementId: "s1", id: { in: ["i1", "i2"] } },
      data: { cardFinalId: "f1" },
    });
  });

  test("cardFinalId nulo devolve os itens para 'não definido'", async () => {
    db.creditCardStatementItem.findMany.mockResolvedValue([{ id: "i1" }]);
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1"], cardFinalId: null });
    expect(r.status).toBe(200);
    expect(tx.creditCardStatementItem.updateMany.mock.calls[0][0].data).toEqual({ cardFinalId: null });
  });

  test("recusa final de outro cartão", async () => {
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f9", creditCardId: "outro", isActive: true });
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1"], cardFinalId: "f9" });
    expect(r.status).toBe(400);
    expect(tx.creditCardStatementItem.updateMany).not.toHaveBeenCalled();
  });

  test("recusa final inativo", async () => {
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f1", creditCardId: "c1", isActive: false });
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1"], cardFinalId: "f1" });
    expect(r.status).toBe(400);
  });

  test("fatura fechada não recebe reclassificação", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("CLOSED"));
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1"], cardFinalId: "f1" });
    expect(r.status).toBe(409);
    expect(tx.creditCardStatementItem.updateMany).not.toHaveBeenCalled();
  });

  test("recusa lista de itens vazia", async () => {
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: [], cardFinalId: "f1" });
    expect(r.status).toBe(400);
  });

  test("recusa item que não pertence à fatura", async () => {
    db.creditCardStatementItem.findMany.mockResolvedValue([{ id: "i1" }]);
    const r = await request(app).post("/cards/statements/s1/items-final").send({ itemIds: ["i1", "alheio"], cardFinalId: "f1" });
    expect(r.status).toBe(404);
    expect(tx.creditCardStatementItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("total do extrato por final", () => {
  test("grava o total que o extrato traz para o final", async () => {
    const r = await request(app).put("/cards/statements/s1/final-totals/f1").send({ statedAmount: "1.234,56" });
    expect(r.status).toBe(200);
    const args = tx.creditCardStatementFinalTotal.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ statementId_cardFinalId: { statementId: "s1", cardFinalId: "f1" } });
    expect(Number(args.create.statedAmount)).toBe(1234.56);
  });

  test("valor vazio remove o total informado", async () => {
    const r = await request(app).put("/cards/statements/s1/final-totals/f1").send({ statedAmount: null });
    expect(r.status).toBe(200);
    expect(db.creditCardStatementFinalTotal.deleteMany).toHaveBeenCalledWith({ where: { statementId: "s1", cardFinalId: "f1" } });
  });
});

describe("conferir a fatura contra o extrato de cada final", () => {
  const detalhe = (totais: Array<{ cardFinalId: string; statedAmount: string }>) => ({
    ...fatura(),
    creditCard: { finais: [{ id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true }] },
    finalTotals: totais,
    items: [{ description: "Compra", value: "100.00", cardFinalId: "f1", purchaseId: "p", purchase: { status: "ACTIVE", _count: { items: 1 } } }],
  });

  test("não marca como conferida quando o total do extrato de um final não bate", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe([{ cardFinalId: "f1", statedAmount: "120.00" }]));
    const r = await request(app).patch("/cards/statements/s1/status").send({ status: "CHECKED" });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain("Físico");
    expect(db.creditCardStatement.update).not.toHaveBeenCalled();
  });

  test("marca como conferida quando todos os totais informados batem", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe([{ cardFinalId: "f1", statedAmount: "100.00" }]));
    db.creditCardStatement.update.mockResolvedValue({ id: "s1", status: "CHECKED" });
    const r = await request(app).patch("/cards/statements/s1/status").send({ status: "CHECKED" });
    expect(r.status).toBe(200);
  });

  test("sem total informado a conferência segue a regra de sempre", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe([]));
    db.creditCardStatement.update.mockResolvedValue({ id: "s1", status: "CHECKED" });
    const r = await request(app).patch("/cards/statements/s1/status").send({ status: "CHECKED" });
    expect(r.status).toBe(200);
  });

  test("voltar para Aberta nunca é bloqueado pela conferência por final", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(detalhe([{ cardFinalId: "f1", statedAmount: "999.00" }]));
    db.creditCardStatement.update.mockResolvedValue({ id: "s1", status: "OPEN" });
    const r = await request(app).patch("/cards/statements/s1/status").send({ status: "OPEN" });
    expect(r.status).toBe(200);
  });
});

describe("marcar várias linhas como conferidas (conciliação do extrato)", () => {
  beforeEach(() => {
    tx.creditCardStatementItem.updateMany.mockResolvedValue({ count: 2 });
  });

  test("marca as linhas da fatura como conferidas de uma vez", async () => {
    const r = await request(app).post("/cards/statements/s1/items-check").send({ itemIds: ["i1", "i2"], checked: true });
    expect(r.status).toBe(200);
    expect(r.body.atualizados).toBe(2);
    expect(tx.creditCardStatementItem.updateMany).toHaveBeenCalledWith({
      where: { statementId: "s1", id: { in: ["i1", "i2"] } },
      data: { checked: true },
    });
  });

  test("fatura fechada não aceita conferência de linhas", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("PAID"));
    const r = await request(app).post("/cards/statements/s1/items-check").send({ itemIds: ["i1"], checked: true });
    expect(r.status).toBe(409);
  });

  test("recusa linha de outra fatura", async () => {
    db.creditCardStatementItem.findMany.mockResolvedValue([{ id: "i1" }]);
    const r = await request(app).post("/cards/statements/s1/items-check").send({ itemIds: ["i1", "alheio"], checked: true });
    expect(r.status).toBe(404);
    expect(tx.creditCardStatementItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("sugerir o cartão pelo fornecedor", () => {
  test("devolve o cartão da última compra classificada do mesmo fornecedor", async () => {
    db.creditCardStatementItem.findFirst = vi.fn(async () => ({ cardFinalId: "f2" }));
    const r = await request(app).get("/cards/c1/final-sugerido").query({ supplierName: "Loja Exemplo" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cardFinalId: "f2" });
    const where = db.creditCardStatementItem.findFirst.mock.calls[0][0].where;
    expect(where.statement).toEqual({ creditCardId: "c1" });
    expect(where.supplierName.equals).toBe("Loja Exemplo");
  });

  test("sem fornecedor ou sem histórico não sugere nada", async () => {
    db.creditCardStatementItem.findFirst = vi.fn(async () => null);
    expect((await request(app).get("/cards/c1/final-sugerido")).body).toEqual({ cardFinalId: null });
    expect((await request(app).get("/cards/c1/final-sugerido").query({ supplierName: "Nova" })).body).toEqual({ cardFinalId: null });
  });
});
