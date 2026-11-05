import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Contas a Pagar: tudo que aparece na lista precisa ser filtrável. A folha (e as diárias/lotes)
// não tem fornecedor, então ganha o filtro por funcionário e a opção "Folha" no tipo.
vi.mock("../../../config/database.js", () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));

import { prisma } from "../../../config/database.js";
import { extrasParaPayables } from "../../payroll/extras-payables.js";
import { lotesParaPayables } from "../../payroll/folha-lote-payables.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/purchases", purchaseRouter);

const texto = (v: unknown): string => {
  const s = (v as { strings?: string[] } | null)?.strings;
  return Array.isArray(s) ? s.join("?") : "";
};
const sqlDas = (tabela: string): string[] => db.$queryRaw.mock.calls
  .map((c: unknown[]) => [(c[0] as string[]).join("?"), ...c.slice(1).map(texto)].join("\n"))
  .filter((s: string) => s.includes(`FROM "${tabela}"`));
// Valores ligados (parâmetros) de cada consulta, para achar o id do funcionário.
const parametros = (tabela: string): unknown[][] => db.$queryRaw.mock.calls
  .filter((c: unknown[]) => (c[0] as string[]).join("?").includes(`FROM "${tabela}"`) || c.slice(1).some((p) => texto(p).includes(`FROM "${tabela}"`)))
  .map((c: unknown[]) => c.slice(1));

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

describe("filtro por funcionário no Contas a Pagar", () => {
  test("com funcionário escolhido só a folha é consultada, filtrada pela pessoa", async () => {
    const r = await request(app).get("/purchases/payables?employeeId=emp-1");
    expect(r.status).toBe(200);
    expect(sqlDas("PaymentInstallment")).toHaveLength(0);
    expect(sqlDas("TaxPayment")).toHaveLength(0);
    const [folha] = sqlDas("PayrollItem");
    expect(folha).toContain('pit."employeeId" =');
    // O id vai como parâmetro ligado (não concatenado no texto), dentro do fragmento do filtro.
    expect(JSON.stringify(parametros("PayrollItem"))).toContain("emp-1");
    expect(folha).not.toContain("emp-1");
  });

  test("as diárias e os lotes da folha recebem o funcionário", async () => {
    await request(app).get("/purchases/payables?employeeId=emp-1");
    expect(vi.mocked(extrasParaPayables).mock.calls[0][0]).toMatchObject({ employeeId: "emp-1" });
    expect(vi.mocked(lotesParaPayables).mock.calls[0][0]).toMatchObject({ employeeId: "emp-1" });
  });

  test("sem funcionário nada muda: compras, impostos e folha entram", async () => {
    await request(app).get("/purchases/payables");
    expect(sqlDas("PaymentInstallment")).toHaveLength(1);
    expect(sqlDas("TaxPayment")).toHaveLength(1);
    expect(sqlDas("PayrollItem")).toHaveLength(1);
    expect(vi.mocked(extrasParaPayables).mock.calls[0][0].employeeId ?? null).toBeNull();
  });
});

describe("tipo Folha no Contas a Pagar", () => {
  test("origin=payroll traz folha, diárias e lotes, sem compras nem impostos", async () => {
    const r = await request(app).get("/purchases/payables?origin=payroll");
    expect(r.status).toBe(200);
    expect(sqlDas("PaymentInstallment")).toHaveLength(0);
    expect(sqlDas("TaxPayment")).toHaveLength(0);
    expect(sqlDas("PayrollItem")).toHaveLength(1);
    expect(extrasParaPayables).toHaveBeenCalledTimes(1);
    expect(lotesParaPayables).toHaveBeenCalledTimes(1);
  });

  test("origin=purchases continua sem folha", async () => {
    await request(app).get("/purchases/payables?origin=purchases");
    expect(sqlDas("PayrollItem")).toHaveLength(0);
    expect(extrasParaPayables).not.toHaveBeenCalled();
  });
});

describe("lista de funcionários do filtro", () => {
  test("devolve quem tem lançamento de folha ou diária, sem exigir ser fornecedor", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "emp-1", nome: "Rafael da Hora" }]);
    const r = await request(app).get("/purchases/payables/pessoas");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: "emp-1", nome: "Rafael da Hora" }]);
    const sql = db.$queryRaw.mock.calls.map((c: unknown[]) => (c[0] as string[]).join("?")).join("\n");
    expect(sql).toContain('"PayrollItem"');
    expect(sql).toContain('"ExtraPayment"');
  });
});
