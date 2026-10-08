import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, expect, test, vi } from "vitest";

// Cancelar a compra apaga as linhas dela nas faturas. Numa fatura fechada ou
// paga, o titulo continuaria com o valor antigo e — como o titulo da fatura nao
// entra no DRE — o dinheiro sairia do caixa sem despesa nenhuma. Cancelamento
// recusado: a fatura precisa ser reaberta antes.

vi.mock("../../../config/database.js", () => ({
  prisma: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    creditCardStatementItem: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
  auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(), assertPeriodWritableForRange: vi.fn() }));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../payables-financial-pdf.js", () => ({ createPayablesFinancialPdf: vi.fn(async () => Buffer.from("%PDF")) }));

import { prisma } from "../../../config/database.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/purchases", purchaseRouter);

const sqlDe = (c: unknown[]) => Prisma.sql(c[0] as TemplateStringsArray, ...(c.slice(1) as Prisma.Sql[])).sql;

function faturas(lista: Array<{ status: string }>) {
  db.$queryRaw.mockImplementation(async (...c: unknown[]) => {
    const s = sqlDe(c);
    if (s.includes('"CreditCardStatementItem"')) {
      return lista.map((f) => ({ ...f, competenceYear: 2026, competenceMonth: 9, cardName: "Cartão da loja" }));
    }
    if (s.includes('FROM "Purchase" p')) return [{ id: "p1", purchaseDate: "2026-09-10", receivedAt: null, items: [] }];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockResolvedValue(undefined);
});

test("recusa cancelar compra que esta numa fatura fechada", async () => {
  faturas([{ status: "CLOSED" }]);
  const r = await request(app).patch("/purchases/p1/cancel").send({ reason: "lançada errado" });
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/[Rr]eabra a fatura/);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test("recusa cancelar compra que esta numa fatura paga", async () => {
  faturas([{ status: "PAID" }]);
  const r = await request(app).patch("/purchases/p1/cancel").send({ reason: "lançada errado" });
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/paga/);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test("compra em fatura aberta segue para o cancelamento", async () => {
  faturas([]);
  await request(app).patch("/purchases/p1/cancel").send({ reason: "lançada errado" });
  expect(db.$transaction).toHaveBeenCalled();
});
