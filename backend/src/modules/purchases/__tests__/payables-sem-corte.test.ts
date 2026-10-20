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
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));
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

// O relatório em PDF corta cada origem no limite de segurança: sem ORDER BY antes do LIMIT,
// o Postgres escolhe QUAIS linhas sobram (não determinístico).
test("PDF: impostos e Folha ordenados antes do LIMIT", async () => {
  db.$queryRaw.mockResolvedValue([]);
  const r = await request(app).get("/purchases/payables/report.pdf?includeOther=true");
  expect(r.status).toBe(200);
  const consultas = db.$queryRaw.mock.calls.map(sql) as string[];
  for (const origem of ['FROM "TaxPayment"', 'FROM "PayrollItem"']) {
    const q = consultas.find((s) => s.includes(origem));
    expect(q, origem).toBeDefined();
    expect(q!).toMatch(/ORDER BY[\s\S]*LIMIT/);
  }
});

// Guia cancelada não é dívida: aparecia como "em aberto/vencida" e, paga, voltava ao DRE.
test("impostos cancelados saem como CANCELLED, na tela e no PDF, e não entram em aberto/vencido/pago", async () => {
  db.$queryRaw.mockResolvedValue([]);
  await request(app).get("/purchases/payables?status=OPEN");
  await request(app).get("/purchases/payables?status=OVERDUE");
  await request(app).get("/purchases/payables/report.pdf?includeOther=true&status=OPEN");
  // $queryRaw`...` recebe as partes do template e os valores; os fragmentos Prisma.sql
  // (status/filtro) chegam como valores e precisam ser expandidos para ver o SQL completo.
  const montar = (c: unknown[]) => {
    const partes = c[0] as string[];
    return partes.map((parte, i) => parte + (i < c.length - 1 ? ((c[i + 1] as { sql?: string })?.sql ?? "?") : "")).join("");
  };
  const consultas = (db.$queryRaw.mock.calls.map(montar) as string[]).filter((s) => s.includes('FROM "TaxPayment"'));
  expect(consultas.length).toBeGreaterThanOrEqual(3);
  for (const q of consultas) {
    expect(q).toContain(`WHEN tp."status" = 'CANCELED' THEN 'CANCELLED'`);
    expect(q).toContain(`tp."status" <> 'CANCELED'`);
  }
});

test("o cabeçalho de corte é lido pelo navegador (CORS exposedHeaders)", async () => {
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync(new URL("../../../app.ts", import.meta.url), "utf8");
  expect(fonte).toMatch(/exposedHeaders:\s*\[[^\]]*"X-Payables-Truncado"/);
});
