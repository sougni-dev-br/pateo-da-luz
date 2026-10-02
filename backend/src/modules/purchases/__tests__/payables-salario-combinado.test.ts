import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Contas a Pagar: o salário de quem tem salário combinado mostra a composição (líquido do
// extrato + diferença do combinado) só a quem pode ver salários. Os detalhes do lançamento
// (com o combinado) nunca saem crus.
vi.mock("../../../config/database.js", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "VISUALIZACAO" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../payables-financial-pdf.js", () => ({ createPayablesFinancialPdf: vi.fn(async () => Buffer.from("%PDF")) }));

import { prisma } from "../../../config/database.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/purchases", purchaseRouter);

const linhaFolha = (details: unknown) => ({
  id: "p1", sourceType: "PAYROLL", amount: "5954.74", dueDate: "2026-10-05", supplierName: "Teodoro Fictício", payrollDetails: details,
});
const ehFolha = (q: unknown) =>
  ((q as { strings?: string[] }).strings ?? (q as string[])).join("?").includes('FROM "PayrollItem"');
const combinado = {
  liquido: 3030, liquidoExtrato: 3030, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54, complemento: 2924.74, origemValor: "SALARIO_COMBINADO",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.$queryRaw.mockImplementation(async (q: unknown) =>
    (ehFolha(q) ? [linhaFolha(combinado)] : []));
});

describe("Contas a Pagar — composição do salário combinado", () => {
  test("quem vê Funcionários recebe a composição", async () => {
    const r = await request(app).get("/purchases/payables");
    const folha = r.body.find((l: { id: string }) => l.id === "p1");
    expect(folha.salarioComposicao).toEqual({
      tipo: "SALARIO_COMBINADO", liquidoExtrato: 3030, complemento: 2924.74, total: 5954.74, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54,
    });
    expect(folha).not.toHaveProperty("payrollDetails");
    expect(userHasPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "employees", "view");
  });

  test("quem não vê Funcionários: sem composição e sem os detalhes", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).get("/purchases/payables");
    const folha = r.body.find((l: { id: string }) => l.id === "p1");
    expect(folha.salarioComposicao).toBeNull();
    expect(folha).not.toHaveProperty("payrollDetails");
  });

  test("lançamento comum da Folha: nem consulta a permissão", async () => {
    db.$queryRaw.mockImplementation(async (q: unknown) =>
      (ehFolha(q) ? [linhaFolha({ liquido: 1000 })] : []));
    const r = await request(app).get("/purchases/payables");
    expect(r.body[0].salarioComposicao).toBeNull();
    expect(userHasPermission).not.toHaveBeenCalled();
  });
});
