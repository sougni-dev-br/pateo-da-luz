import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O titulo que nasce ao fechar ciclo de fornecedor ou fatura de cartao repete
// compras que ja entram no DRE pelos itens. Em producao, a Parte A de jun–set/2026
// era 100% desses titulos: R$ 69.375,96 contados duas vezes. Estes testes leem o
// SQL que cada rota monta e falham se alguma consulta de titulo voltar a soma-lo.

vi.mock("../../../config/database.js", () => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), dRECategory: { findMany: vi.fn(async () => []) } },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), auditLog: vi.fn(),
}));
vi.mock("../../payroll/payroll.service.js", () => ({
  FERIAS_CATEGORY: "Férias", FOLHA_CATEGORY: "Folha de Pessoal", RESCISAO_CATEGORY: "Rescisões", VT_CATEGORY: "Vale-Transporte",
}));
vi.mock("../../cmv-real/cmv-purchase-base.service.js", () => ({
  CATEGORIAS_CMV_GERENCIAL: ["Bebidas"],
  getCmvPurchaseTotalByCompetenceMonth: vi.fn(async () => 0),
  getCmvPurchaseTotalByPurchaseDateRange: vi.fn(async () => 0),
}));
vi.mock("../dre-pdf.js", () => ({ createDrePdf: vi.fn(async () => Buffer.from("%PDF")) }));

import { prisma } from "../../../config/database.js";
import { dreRouter } from "../dre.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/dre", dreRouter);

// Remonta o SQL completo, com os fragmentos aninhados (Prisma.sql dentro de Prisma.sql).
const sqlDe = (c: unknown[]) => Prisma.sql(c[0] as TemplateStringsArray, ...(c.slice(1) as Prisma.Sql[])).sql;
const consultas = () => db.$queryRaw.mock.calls.map(sqlDe) as string[];
const deTitulo = (s: string) => s.includes('FROM "PaymentInstallment" pi');

function excluiAgregador(s: string) {
  return s.includes("SUPPLIER_CYCLE") && s.includes("CARD_STATEMENT")
    && s.includes('"SupplierBillingCycle"') && s.includes('"CreditCardStatement"');
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockImplementation(async () => []);
});

describe("DRE ignora o titulo de ciclo e de fatura", () => {
  test.each([
    ["por competencia", "/dre/summary?year=2026&month=6&comparatives=false"],
    ["por intervalo de datas", "/dre/summary?from=2026-06-01&to=2026-06-30&comparatives=false"],
  ])("Parte A da despesa, %s", async (_, url) => {
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    const parteA = consultas().filter((s) => deTitulo(s) && s.includes('NOT EXISTS (SELECT 1 FROM "PurchaseItem" px'));
    expect(parteA).toHaveLength(2); // visao contabil e gerencial
    parteA.forEach((s) => expect(excluiAgregador(s)).toBe(true));
  });

  test("Parte B (itens) e CMV seguem sem o filtro: o agregador nao tem item", async () => {
    await request(app).get("/dre/summary?year=2026&month=6&comparatives=false");
    const parteB = consultas().filter((s) => s.includes('FROM "PurchaseItem" pitem'));
    expect(parteB.length).toBeGreaterThan(0);
    // Cada consulta de despesa e um UNION: a Parte B fica depois do UNION ALL.
    parteB.forEach((s) => expect(excluiAgregador(s.split("UNION ALL")[1] ?? "")).toBe(false));
  });

  test.each([
    ["detalhamento sem categoria", "/dre/expense-drill?year=2026&month=6"],
    ["detalhamento de uma categoria", "/dre/expense-drill?year=2026&month=6&dreCategoryId=cat-1"],
    ["pendencias de classificacao", "/dre/pending?year=2026&month=6"],
  ])("%s", async (_, url) => {
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    const titulos = consultas().filter(deTitulo);
    expect(titulos.length).toBeGreaterThan(0);
    titulos.forEach((s) => expect(excluiAgregador(s)).toBe(true));
  });
});

describe("categoria em titulo de ciclo ou de fatura", () => {
  test("recusa classificar um titulo de agregador", async () => {
    db.$queryRaw.mockImplementation(async () => [{ n: 1 }]);
    const r = await request(app).patch("/dre/installment/t1/category").send({ dreCategoryId: "cat-1" });
    expect(r.status).toBe(422);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  test("classifica normalmente um titulo comum", async () => {
    db.$queryRaw.mockImplementation(async () => [{ n: 0 }]);
    const r = await request(app).patch("/dre/installment/t1/category").send({ dreCategoryId: "cat-1" });
    expect(r.status).toBe(200);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  test("recusa o lote inteiro se houver um titulo de agregador", async () => {
    db.$queryRaw.mockImplementation(async () => [{ n: 1 }]);
    const r = await request(app).patch("/dre/installments/bulk-category").send({ installmentIds: ["t1", "t2"], dreCategoryId: "cat-1" });
    expect(r.status).toBe(422);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
