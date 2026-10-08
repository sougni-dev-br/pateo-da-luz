import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O titulo da fatura nao entra no DRE; a despesa chega pelos itens das compras.
// Por isso a fatura nao aceita mais linha sem compra, e a linha avulsa que ja
// existir precisa poder ser apagada — senao a fatura nunca mais fecha.

const tx = {
  creditCardStatementItem: { delete: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  creditCardStatement: { update: vi.fn() },
  $queryRaw: vi.fn(async () => [{ total: 0 }]),
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCardStatement: { findUnique: vi.fn() },
    creditCardStatementItem: { findUnique: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", status: "OPEN" });
});

describe("incluir linha na fatura", () => {
  test("recusa linha sem compra", async () => {
    const r = await request(app).post("/cards/statements/s1/items").send({ description: "Anuidade", value: 33.33 });
    expect(r.status).toBe(422);
    expect(tx.creditCardStatementItem.create).not.toHaveBeenCalled();
  });
});

describe("excluir linha avulsa", () => {
  test("apaga a linha sem compra e recalcula o total", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "s1", purchaseId: null, description: "Anuidade", value: 33.33 });
    const r = await request(app).delete("/cards/statements/s1/items/i1");
    expect(r.status).toBe(200);
    expect(tx.creditCardStatementItem.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(tx.creditCardStatement.update).toHaveBeenCalled();
  });

  test("nao apaga linha que veio de compra: ela sai cancelando ou editando a compra", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "s1", purchaseId: "p1", description: "Mercado", value: 10 });
    const r = await request(app).delete("/cards/statements/s1/items/i1");
    expect(r.status).toBe(422);
    expect(tx.creditCardStatementItem.delete).not.toHaveBeenCalled();
  });

  test("nao mexe em fatura fechada", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ id: "s1", status: "CLOSED" });
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "s1", purchaseId: null, description: "Anuidade", value: 33.33 });
    const r = await request(app).delete("/cards/statements/s1/items/i1");
    expect(r.status).toBe(409);
    expect(tx.creditCardStatementItem.delete).not.toHaveBeenCalled();
  });

  test("linha de outra fatura nao e encontrada", async () => {
    db.creditCardStatementItem.findUnique.mockResolvedValue({ id: "i1", statementId: "s2", purchaseId: null, description: "x", value: 1 });
    const r = await request(app).delete("/cards/statements/s1/items/i1");
    expect(r.status).toBe(404);
  });
});
