import express from "express";
import request from "supertest";
import { beforeEach, expect, test, vi } from "vitest";

// Contas a Pagar não pode esconder títulos em silêncio: com mais de 500 no período,
// a resposta cortava tudo o que vencia depois do 500º (ex.: rescisões de setembro com
// "Ano atual"). Se um limite de segurança for atingido, o cabeçalho avisa.
vi.mock("../../../config/database.js", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../payables-financial-pdf.js", () => ({ createPayablesFinancialPdf: vi.fn(async () => Buffer.from("%PDF")) }));

import { prisma } from "../../../config/database.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/purchases", purchaseRouter);

const sql = (c: unknown[]) => ((c[0] as { strings?: string[] }).strings ?? (c[0] as string[])).join("?");
const titulo = (i: number, origem: string) => ({ id: `${origem}${i}`, sourceType: origem, dueDate: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(), supplierName: `F${i}`, amount: "10" });

beforeEach(() => vi.clearAllMocks());

test("devolve todos os títulos, sem cortar em 500", async () => {
  db.$queryRaw.mockImplementation(async (...c: unknown[]) => {
    const s = sql(c);
    if (s.includes('FROM "PayrollItem"')) return Array.from({ length: 300 }, (_, i) => titulo(i, "PAYROLL"));
    if (s.includes('FROM "TaxPayment"')) return Array.from({ length: 300 }, (_, i) => titulo(i, "TAX_PAYMENT"));
    return [];
  });
  const r = await request(app).get("/purchases/payables");
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(600);
  expect(r.headers["x-payables-truncado"]).toBeUndefined();
});

test("limite de segurança atingido: avisa no cabeçalho em vez de esconder calado", async () => {
  db.$queryRaw.mockImplementation(async (...c: unknown[]) =>
    sql(c).includes('FROM "PayrollItem"') ? Array.from({ length: 5000 }, (_, i) => titulo(i, "PAYROLL")) : []);
  const r = await request(app).get("/purchases/payables");
  expect(r.headers["x-payables-truncado"]).toBe("1");
});
