import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Impostos e Guias: rotas com banco de mentira. CNPJ e razão social fictícios (repositório público).
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    taxPayment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    dRECategory: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../tax-payment-import.service.js", () => ({
  buildExistingDedupKeys: vi.fn(async () => new Set()),
  previewTaxImport: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { previewTaxImport } from "../tax-payment-import.service.js";
import { taxPaymentRouter } from "../tax-payment.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/tax-payments", taxPaymentRouter);

const CATEGORIAS = [
  { id: "cat-fgts", name: "FGTS", dreGroup: "PESSOAL" },
  { id: "cat-inss", name: "INSS", dreGroup: "PESSOAL" },
  { id: "cat-simples", name: "Simples Nacional", dreGroup: "IMPOSTOS" },
  { id: "cat-irrf", name: "IRRF / DARF", dreGroup: "IMPOSTOS" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Gerente", email: "g@x", role: "GESTAO_COMPLETA", mustChangePassword: false } as never);
  db.dRECategory.findMany.mockResolvedValue(CATEGORIAS);
  db.taxPayment.create.mockImplementation(async ({ data }: { data: object }) => data);
});

describe("categorias para a tela de impostos", () => {
  test("lista as categorias ativas sem cair na rota de detalhe", async () => {
    const r = await request(app).get("/tax-payments/categorias-dre");
    expect(r.status).toBe(200);
    expect(r.body).toEqual(CATEGORIAS);
    expect(db.taxPayment.findFirst).not.toHaveBeenCalled();
  });

  test("sugere a categoria pelo tipo e pela descrição da guia", async () => {
    const r = await request(app).get("/tax-payments/categoria-sugerida")
      .query({ documentType: "RECEITA FEDERAL", description: "CONTR PREV DESCONTA SEGURADO" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ dreCategoryId: "cat-inss", nome: "INSS" });
  });

  test("tipo sem regra devolve sugestão vazia", async () => {
    const r = await request(app).get("/tax-payments/categoria-sugerida").query({ documentType: "Outros" });
    expect(r.body).toEqual({ dreCategoryId: null, nome: null });
  });
});

describe("lançamento manual", () => {
  const guia = { documentType: "FGTS", dueDate: "2026-10-20", amount: 1500, competenceDate: "2026-09-01" };

  test("sem categoria escolhida, grava a sugerida pelo tipo", async () => {
    const r = await request(app).post("/tax-payments").send(guia);
    expect(r.status).toBe(201);
    expect(db.taxPayment.create.mock.calls[0][0].data.dreCategoryId).toBe("cat-fgts");
  });

  test("categoria escolhida na tela prevalece sobre a sugestão", async () => {
    await request(app).post("/tax-payments").send({ ...guia, dreCategoryId: "cat-irrf" });
    expect(db.taxPayment.create.mock.calls[0][0].data.dreCategoryId).toBe("cat-irrf");
  });

  test("\"sem categoria\" escolhido na tela é respeitado", async () => {
    await request(app).post("/tax-payments").send({ ...guia, dreCategoryId: null });
    expect(db.taxPayment.create.mock.calls[0][0].data.dreCategoryId).toBeNull();
    expect(db.dRECategory.findMany).not.toHaveBeenCalled();
  });

  test("tipo sem regra fica sem categoria", async () => {
    await request(app).post("/tax-payments").send({ ...guia, documentType: "Outros" });
    expect(db.taxPayment.create.mock.calls[0][0].data.dreCategoryId).toBeNull();
  });
});

describe("importação da planilha", () => {
  test("a prévia mostra a categoria de cada tipo, separando o DARF pela descrição", async () => {
    const base = { valid: true, isDuplicate: false, amount: 10 };
    vi.mocked(previewTaxImport).mockResolvedValue({
      totalRows: 4,
      rows: [
        { ...base, documentType: "RECEITA FEDERAL", description: "CP SEGURADOS" },
        { ...base, documentType: "RECEITA FEDERAL", description: "IRRF - RENDIMENTO DO TRABALHO ASSALARIADO" },
        { ...base, documentType: "Outros", description: null },
        { ...base, valid: false, documentType: "FGTS", description: null },
      ],
    } as never);

    const r = await request(app).post("/tax-payments/import-xlsx/preview").attach("file", Buffer.from("x"), "guias.xlsx");
    fs.rmSync(vi.mocked(previewTaxImport).mock.calls[0][0], { force: true });

    expect(r.status).toBe(200);
    expect(r.body.categoriasPorTipo).toEqual({ "RECEITA FEDERAL": ["INSS", "IRRF / DARF"], Outros: [null] });
  });

  test("cada guia importada recebe a categoria sugerida", async () => {
    const arquivo = path.join(os.tmpdir(), `impostos-teste-${Date.now()}.xlsx`);
    fs.writeFileSync(arquivo, "x");
    const linha = {
      valid: true, isDuplicate: false, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: null,
      description: null, competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2026-10-20T00:00:00Z"),
      amount: 100, paymentDate: null, comments: null,
    };
    vi.mocked(previewTaxImport).mockResolvedValue({
      totalRows: 2,
      rows: [{ ...linha, documentType: "SIMPLES NACIONAL - DASN" }, { ...linha, documentType: "GPS" }],
    } as never);
    const criados: Array<{ dreCategoryId: string | null }> = [];
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ taxPayment: { create: async ({ data }: { data: { dreCategoryId: string | null } }) => { criados.push(data); return data; } } }));

    const r = await request(app).post("/tax-payments/import-xlsx/confirm").send({ filePath: arquivo });

    expect(r.status).toBe(200);
    expect(criados.map((c) => c.dreCategoryId)).toEqual(["cat-simples", "cat-inss"]);
  });
});
