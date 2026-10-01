import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Contas a Pagar: a rescisão quitada no termo (líquido zero, nada a pagar) não é título.
// Fica fora da lista e do relatório em PDF — as duas consultas da Folha.
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

const sqlDaFolha = () => db.$queryRaw.mock.calls
  .map((c: unknown[]) => (c[0] as { strings?: string[] }).strings?.join("?") ?? (c[0] as string[]).join("?"))
  .filter((s: string) => s.includes('FROM "PayrollItem"'));

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

describe("Contas a Pagar sem a rescisão quitada no termo", () => {
  test("a lista filtra a Folha marcada como quitada no termo", async () => {
    const r = await request(app).get("/purchases/payables");
    expect(r.status).toBe(200);
    const folha = sqlDaFolha();
    expect(folha).toHaveLength(1);
    expect(folha[0]).toContain("quitadaNoTermo");
  });

  test("o relatório em PDF também", async () => {
    await request(app).get("/purchases/payables/report.pdf");
    const folha = sqlDaFolha();
    expect(folha).toHaveLength(1);
    expect(folha[0]).toContain("quitadaNoTermo");
  });
});
