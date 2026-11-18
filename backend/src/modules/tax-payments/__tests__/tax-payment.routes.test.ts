import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Impostos e Guias: rotas com banco de mentira. CNPJ e razão social fictícios (repositório público).
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    taxPayment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    dRECategory: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    taxCodeCatalog: { findMany: vi.fn(), createMany: vi.fn() },
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../tax-payment-import.service.js", () => ({
  buildExistingDedupKeys: vi.fn(async () => new Set()),
  previewTaxImport: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
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
    const importFileId = "a".repeat(32);
    fs.mkdirSync(path.join("uploads", "impostos"), { recursive: true });
    fs.writeFileSync(path.join("uploads", "impostos", importFileId), "x");
    const linha = {
      valid: true, isDuplicate: false, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: null,
      description: null, competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2099-12-20T00:00:00Z"),
      amount: 100, paymentDate: null, comments: null,
    };
    vi.mocked(previewTaxImport).mockResolvedValue({
      totalRows: 2,
      rows: [{ ...linha, documentType: "SIMPLES NACIONAL - DASN" }, { ...linha, documentType: "GPS" }],
    } as never);
    const criados: Array<{ dreCategoryId: string | null }> = [];
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ taxPayment: { create: async ({ data }: { data: { dreCategoryId: string | null } }) => { criados.push(data); return data; } } }));

    const r = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });

    expect(r.status).toBe(200);
    expect(criados.map((c) => c.dreCategoryId)).toEqual(["cat-simples", "cat-inss"]);
    expect(fs.existsSync(path.join("uploads", "impostos", importFileId))).toBe(false);
  });

  test("a confirmação reserva o arquivo antes de ler: ninguém mais o encontra e a segunda confirmação não importa de novo", async () => {
    const importFileId = "b".repeat(32);
    fs.mkdirSync(path.join("uploads", "impostos"), { recursive: true });
    fs.writeFileSync(path.join("uploads", "impostos", importFileId), "x");
    vi.mocked(previewTaxImport).mockResolvedValue({ totalRows: 0, rows: [] } as never);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ taxPayment: { create: async () => ({}) } }));

    const primeira = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });
    expect(primeira.status).toBe(200);
    // o preview leu o arquivo já renomeado (reservado), e nada sobrou na pasta
    expect(String(vi.mocked(previewTaxImport).mock.calls.at(-1)?.[0])).toMatch(/\.processando$/);
    expect(fs.existsSync(path.join("uploads", "impostos", importFileId))).toBe(false);
    expect(fs.existsSync(path.join("uploads", "impostos", `${importFileId}.processando`))).toBe(false);

    const segunda = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });
    expect(segunda.status).toBe(400); // arquivo já consumido: não importa de novo
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  test("se a importação falhar depois de reservar o arquivo, ele volta ao nome original (a confirmação pode ser repetida)", async () => {
    const importFileId = "d".repeat(32);
    fs.mkdirSync(path.join("uploads", "impostos"), { recursive: true });
    fs.writeFileSync(path.join("uploads", "impostos", importFileId), "x");
    const { buildExistingDedupKeys } = await import("../tax-payment-import.service.js");
    vi.mocked(buildExistingDedupKeys).mockRejectedValueOnce(new Error("banco fora"));

    const r = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });

    expect(r.status).toBe(500);
    await vi.waitFor(() => expect(fs.existsSync(path.join("uploads", "impostos", importFileId))).toBe(true));
    expect(fs.existsSync(path.join("uploads", "impostos", `${importFileId}.processando`))).toBe(false);
    fs.rmSync(path.join("uploads", "impostos", importFileId), { force: true });
  });

  test("a transação da importação tem prazo próprio (o padrão de 5 s estourava com lotes grandes)", async () => {
    const importFileId = "c".repeat(32);
    fs.mkdirSync(path.join("uploads", "impostos"), { recursive: true });
    fs.writeFileSync(path.join("uploads", "impostos", importFileId), "x");
    vi.mocked(previewTaxImport).mockResolvedValue({ totalRows: 0, rows: [] } as never);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ taxPayment: { create: async () => ({}) } }));
    await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });
    const opcoes = db.$transaction.mock.calls.at(-1)?.[1];
    expect(opcoes).toEqual({ maxWait: 15_000, timeout: 120_000 });
  });

  test("a prévia devolve só o nome do upload, nunca o caminho do servidor", async () => {
    vi.mocked(previewTaxImport).mockResolvedValue({ totalRows: 0, rows: [], filePath: "/srv/uploads/segredo" } as never);

    const r = await request(app).post("/tax-payments/import-xlsx/preview").attach("file", Buffer.from("x"), "guias.xlsx");
    fs.rmSync(vi.mocked(previewTaxImport).mock.calls[0][0], { force: true });

    expect(r.body.filePath).toBeUndefined();
    expect(r.body.importFileId).toMatch(/^[a-f0-9]{32}$/);
  });

  test.each(["package.json", "../.env", "/etc/passwd", "C:\\Windows\\win.ini"])(
    "a confirmação recusa caminho livre (%s) e não lê nem apaga nada",
    async (caminho) => {
      const existentes = vi.spyOn(fs, "existsSync");
      const apaga = vi.spyOn(fs, "unlink");

      const r = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId: caminho, filePath: caminho });

      expect(r.status).toBe(400);
      expect(previewTaxImport).not.toHaveBeenCalled();
      expect(apaga).not.toHaveBeenCalled();
      existentes.mockRestore();
      apaga.mockRestore();
    }
  );
});

describe("lançamento repetível (idempotência pelo identificador do modal)", () => {
  const ID = "3f2b8c1e-5a47-4d9e-9b6a-1c2d3e4f5a6b";
  const guia = { documentType: "FGTS", dueDate: "2026-10-20", amount: 1500, competenceDate: "2026-09-01", clientId: ID };
  const existente = {
    id: ID, createdById: "u1", deletedAt: null, documentType: "FGTS", documentNumber: null, amount: "1500.00", items: [],
    dueDate: new Date("2026-10-20T00:00:00Z"), competenceDate: new Date("2026-09-01T00:00:00Z"),
  };

  test("o identificador do modal vira o id da guia", async () => {
    const r = await request(app).post("/tax-payments").send(guia);
    expect(r.status).toBe(201);
    expect(db.taxPayment.create.mock.calls[0][0].data.id).toBe(ID);
  });

  test("identificador inválido é ignorado: a guia recebe um id próprio", async () => {
    await request(app).post("/tax-payments").send({ ...guia, clientId: "x; DROP TABLE" });
    const id = db.taxPayment.create.mock.calls[0][0].data.id;
    expect(id).not.toBe("x; DROP TABLE");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("reenvio depois de timeout: devolve a guia já criada, sem criar outra nem registrar de novo", async () => {
    db.taxPayment.findFirst.mockResolvedValueOnce(existente);
    const r = await request(app).post("/tax-payments").send(guia);
    expect(r.status).toBe(200);
    expect(r.headers["idempotent-replayed"]).toBe("true");
    expect(r.body.id).toBe(ID);
    expect(db.taxPayment.create).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("reenvio com dados DIFERENTES (a pessoa corrigiu depois de a resposta se perder) não devolve a guia antiga: 409 manda editar", async () => {
    const criada = { ...existente, documentNumber: "A-1", dueDate: new Date("2026-10-20T00:00:00Z"), competenceDate: new Date("2026-09-01T00:00:00Z"), amount: "1500.00" };
    db.taxPayment.findFirst.mockResolvedValue(criada);
    const igual = await request(app).post("/tax-payments").send({ ...guia, documentNumber: "A-1" });
    expect(igual.status).toBe(200);
    for (const mudanca of [{ documentNumber: "B-2" }, { dueDate: "2026-11-20" }, { competenceDate: "2026-08-01" }, { documentType: "DARF" }, { items: [{ description: "FGTS Mensal", principal: "1600.00" }] }]) {
      const r = await request(app).post("/tax-payments").send({ ...guia, documentNumber: "A-1", ...mudanca });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("TAX_PAYMENT_ALREADY_CREATED");
      expect(r.body.id).toBe(ID);
    }
    // mesmos valores nas linhas: ainda é reenvio
    const mesmoTotal = await request(app).post("/tax-payments").send({ ...guia, documentNumber: "A-1", items: [{ description: "FGTS Mensal", principal: "1500.00" }] });
    expect(mesmoTotal.status).toBe(200);
    expect(db.taxPayment.create).not.toHaveBeenCalled();
    db.taxPayment.findFirst.mockReset();
  });

  test("identificador que já é de guia de outra pessoa (ou excluída) não é reaproveitado: 409", async () => {
    db.taxPayment.findFirst.mockResolvedValueOnce({ ...existente, createdById: "outro" });
    const r = await request(app).post("/tax-payments").send(guia);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CLIENT_ID_IN_USE");
    expect(db.taxPayment.create).not.toHaveBeenCalled();
  });

  test("dois envios ao mesmo tempo: o que perde a corrida na chave primária recebe a guia criada pelo outro", async () => {
    db.taxPayment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(existente);
    db.taxPayment.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["id"] } }));
    const r = await request(app).post("/tax-payments").send(guia);
    expect(r.status).toBe(200);
    expect(r.headers["idempotent-replayed"]).toBe("true");
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("número de documento repetido continua 409 de duplicada (não é reenvio)", async () => {
    db.taxPayment.findFirst.mockResolvedValue(null);
    db.$queryRawUnsafe.mockResolvedValue([]); // nenhuma guia com este número na consulta prévia
    db.taxPayment.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002", meta: { target: "TaxPayment_documentNumber_ativo_key" } }));
    const r = await request(app).post("/tax-payments").send({ ...guia, documentNumber: "A-1" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICATE_DOCUMENT");
  });

  test("sem identificador o lançamento funciona como sempre", async () => {
    db.taxPayment.findFirst.mockReset();
    const r = await request(app).post("/tax-payments").send({ ...guia, clientId: undefined });
    expect(r.status).toBe(201);
    expect(db.taxPayment.findFirst).not.toHaveBeenCalled();
  });
});

describe("tipos de guia para o filtro", () => {
  test("lista os tipos que existem de fato (inclusive os do legado importado) com a quantidade", async () => {
    db.$queryRawUnsafe.mockResolvedValueOnce([{ documentType: "FGTS", qtd: "178" }, { documentType: "RECEITA FEDERAL", qtd: 109 }]);
    const r = await request(app).get("/tax-payments/tipos");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ documentType: "FGTS", qtd: 178 }, { documentType: "RECEITA FEDERAL", qtd: 109 }]);
    expect(db.taxPayment.findFirst).not.toHaveBeenCalled(); // não caiu em /:id
  });
});

describe("lançamento manual: validações", () => {
  const guia = { documentType: "FGTS", dueDate: "2026-10-20", amount: 1500, competenceDate: "2026-09-01" };

  test.each([
    ["sem competência", { competenceDate: undefined }, /Competência obrigatória/],
    ["competência vazia", { competenceDate: "" }, /Competência obrigatória/],
    ["valor zero", { amount: 0 }, /Valor/],
    ["valor negativo", { amount: -5 }, /Valor/],
    ["valor em texto brasileiro", { amount: "1.234,56" }, /Valor/],
    ["vencimento inválido", { dueDate: "20/10/2026" }, /Vencimento/],
    ["data de pagamento inválida", { paymentDate: "ontem" }, /pagamento/],
    ["valor pago sem data de pagamento", { paidAmount: 100 }, /Valor pago/],
  ])("recusa %s com 400 e não grava", async (_nome, troca, mensagem) => {
    const r = await request(app).post("/tax-payments").send({ ...guia, ...troca });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(mensagem);
    expect(db.taxPayment.create).not.toHaveBeenCalled();
  });

  test("ignora o status do formulário: vencida sem pagamento nasce OVERDUE", async () => {
    await request(app).post("/tax-payments").send({ ...guia, dueDate: "2020-01-10", status: "CANCELED" });
    expect(db.taxPayment.create.mock.calls[0][0].data.status).toBe("OVERDUE");
  });

  test("guia já paga: valor pago assume o valor da guia e status PAID", async () => {
    await request(app).post("/tax-payments").send({ ...guia, paymentDate: "2026-10-10" });
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.status).toBe("PAID");
    expect(data.paidAmount).toBe(1500);
  });
});

describe("edição", () => {
  const existente = {
    id: "g1", documentType: "FGTS", description: null, cnpj: null, legalName: null, tradeName: null, companyId: null,
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2099-12-20T00:00:00Z"),
    amount: 1500, paymentDate: null, paidAmount: null, status: "PENDING", comments: null, dreCategoryId: "cat-fgts",
  };

  beforeEach(() => {
    db.taxPayment.findFirst.mockResolvedValue(existente);
    db.taxPayment.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
  });

  test("não aceita alterar data de pagamento: pagar é pela ação Pagar", async () => {
    const r = await request(app).put("/tax-payments/g1").send({ paymentDate: "2026-10-10", paidAmount: 1500 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Pagar/);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });

  test("não aceita apagar o pagamento de uma guia paga: estornar é pela ação Estornar", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "PAID", paymentDate: new Date("2026-10-10T00:00:00Z"), paidAmount: 1500 });
    const r = await request(app).put("/tax-payments/g1").send({ paymentDate: null });
    expect(r.status).toBe(400);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });

  test("reenviar o mesmo pagamento (formulário que devolve o que recebeu) é aceito", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "PAID", paymentDate: new Date("2026-10-10T00:00:00Z"), paidAmount: "1500.00" });
    const r = await request(app).put("/tax-payments/g1").send({ paymentDate: "2026-10-10", paidAmount: 1500, description: "ajuste" });
    expect(r.status).toBe(200);
    expect(db.taxPayment.update.mock.calls[0][0].data.status).toBe("PAID");
  });

  test("status 'Pago' vindo do formulário é ignorado: sem pagamento a guia segue em aberto", async () => {
    const r = await request(app).put("/tax-payments/g1").send({ status: "PAID", description: "x" });
    expect(r.status).toBe(200);
    expect(db.taxPayment.update.mock.calls[0][0].data.status).toBe("PENDING");
  });

  test("cancelar é decisão explícita e reativar volta ao status pelas datas", async () => {
    await request(app).put("/tax-payments/g1").send({ status: "CANCELED" });
    expect(db.taxPayment.update.mock.calls[0][0].data.status).toBe("CANCELED");

    db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "CANCELED" });
    await request(app).put("/tax-payments/g1").send({ status: "PENDING" });
    expect(db.taxPayment.update.mock.calls[1][0].data.status).toBe("PENDING");
  });

  test("guia cancelada continua cancelada quando o status não é enviado", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "CANCELED" });
    await request(app).put("/tax-payments/g1").send({ description: "só texto" });
    expect(db.taxPayment.update.mock.calls[0][0].data.status).toBe("CANCELED");
  });

  test("cancelar e reativar pedem a permissão de excluir, não só a de editar", async () => {
    vi.mocked(userHasPermission).mockResolvedValueOnce(false);
    const r = await request(app).put("/tax-payments/g1").send({ status: "CANCELED" });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/excluir/);
    expect(db.taxPayment.update).not.toHaveBeenCalled();

    db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "CANCELED" });
    vi.mocked(userHasPermission).mockResolvedValueOnce(false);
    const r2 = await request(app).put("/tax-payments/g1").send({ status: "PENDING" });
    expect(r2.status).toBe(403);
  });

  test("editar sem mexer no cancelamento não pede a permissão de excluir", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).put("/tax-payments/g1").send({ description: "só texto" });
    expect(r.status).toBe(200);
    vi.mocked(userHasPermission).mockResolvedValue(true);
  });

  test("não deixa limpar a competência de guia ativa", async () => {
    const r = await request(app).put("/tax-payments/g1").send({ competenceDate: "" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Competência obrigatória/);
  });

  test("valor zero ou inválido é recusado", async () => {
    const r = await request(app).put("/tax-payments/g1").send({ amount: 0 });
    expect(r.status).toBe(400);
    const r2 = await request(app).put("/tax-payments/g1").send({ amount: "abc" });
    expect(r2.status).toBe(400);
  });
});

describe("discriminação da guia (linhas) e total somado", () => {
  const das = [
    { code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71 },
    { code: "1002", description: "CSLL - SIMPLES NACIONAL", principal: 298.9 },
    { code: "1004", description: "COFINS - SIMPLES NACIONAL", principal: 1088.03 },
    { code: "1005", description: "PIS - SIMPLES NACIONAL", principal: 235.71 },
    { code: "1006", description: "INSS - SIMPLES NACIONAL", principal: 3586.89 },
    { code: "1007", description: "ICMS - SIMPLES NACIONAL SP", principal: 2060.87 },
  ];
  const guia = { documentType: "Simples Nacional / DAS", dueDate: "2099-12-20", competenceDate: "2099-11-01", documentNumber: "07.20.26290.7165263-2" };

  // Testes anteriores deixam findFirst/$queryRawUnsafe com respostas prontas: aqui, por padrão, não existe guia repetida.
  beforeEach(() => {
    db.taxPayment.findFirst.mockReset();
    db.$queryRawUnsafe.mockReset();
    db.$queryRawUnsafe.mockResolvedValue([]);
  });

  test("quantidade de trabalhadores (FGTS) é gravada; inválida é 400 e não grava", async () => {
    const ok = await request(app).post("/tax-payments").send({ ...guia, documentType: "FGTS", items: das, workersCount: "12" });
    expect(ok.status).toBe(201);
    expect(db.taxPayment.create.mock.calls.at(-1)?.[0].data.workersCount).toBe(12);
    await request(app).post("/tax-payments").send({ ...guia, items: das, workersCount: "12" });
    expect(db.taxPayment.create.mock.calls.at(-1)?.[0].data.workersCount).toBeNull();
    const antes = db.taxPayment.create.mock.calls.length;
    const ruim = await request(app).post("/tax-payments").send({ ...guia, items: das, workersCount: "doze" });
    expect(ruim.status).toBe(400);
    expect(db.taxPayment.create.mock.calls.length).toBe(antes);
  });

  test("código novo só vai para o catálogo depois de a guia ser gravada; guia recusada não deixa lixo", async () => {
    db.taxCodeCatalog.findMany.mockResolvedValue([]);
    db.$queryRawUnsafe.mockResolvedValueOnce([{ id: "g9", documentType: "DARF", competenceDate: null }]);
    const novo = [{ code: "9999", description: "CODIGO NOVO", principal: 10 }];
    const recusada = await request(app).post("/tax-payments").send({ ...guia, documentType: "DARF", items: novo });
    expect(recusada.status).toBe(409);
    expect(db.taxCodeCatalog.createMany).not.toHaveBeenCalled();
    const ok = await request(app).post("/tax-payments").send({ ...guia, documentType: "DARF", documentNumber: "NOVO-1", items: novo });
    expect(ok.status).toBe(201);
    expect(db.taxCodeCatalog.createMany).toHaveBeenCalledTimes(1);
  });

  test("o valor da guia é a soma das linhas e as linhas são gravadas junto, na mesma operação", async () => {
    const r = await request(app).post("/tax-payments").send({ ...guia, items: das, amount: 1 });
    expect(r.status).toBe(201);
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.amount).toBe(7740.11);
    expect(data.documentNumber).toBe("07.20.26290.7165263-2");
    expect(data.items.create).toHaveLength(6);
    expect(data.items.create[0]).toEqual({ position: 0, code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71, fine: 0, interest: 0 });
    expect(data.items.create[5].position).toBe(5);
  });

  test("sem descrição digitada, a descrição vem das denominações (e a categoria é sugerida por ela)", async () => {
    await request(app).post("/tax-payments").send({ ...guia, items: das });
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.description).toBe(das.map((i) => i.description).join(" · "));
    expect(data.dreCategoryId).toBe("cat-simples");
  });

  test("DARF: as denominações separam INSS de IRRF na categoria", async () => {
    await request(app).post("/tax-payments").send({
      documentType: "DARF", dueDate: "2099-12-20", competenceDate: "2099-11-01",
      items: [
        { code: "1082", description: "CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO", principal: 3665.53 },
        { code: "1099", description: "CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL", principal: 550 },
      ],
    });
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.amount).toBe(4215.53);
    expect(data.dreCategoryId).toBe("cat-inss");
  });

  test("FGTS com linhas sem código", async () => {
    await request(app).post("/tax-payments").send({
      documentType: "FGTS", dueDate: "2099-12-20", competenceDate: "2099-11-01",
      items: [{ description: "FGTS Mensal", principal: 1383.57 }],
    });
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.amount).toBe(1383.57);
    expect(data.items.create[0].code).toBeNull();
  });

  test.each([
    ["lista vazia", []],
    ["linha sem valor", [{ description: "IRPJ", principal: 0 }]],
    ["linha sem denominação", [{ description: "", principal: 10 }]],
  ])("recusa discriminação inválida (%s) e não grava", async (_n, items) => {
    const r = await request(app).post("/tax-payments").send({ ...guia, items });
    expect(r.status).toBe(400);
    expect(db.taxPayment.create).not.toHaveBeenCalled();
  });

  test("o mesmo número de documento não entra duas vezes", async () => {
    db.$queryRawUnsafe.mockResolvedValueOnce([{ id: "g9", documentType: "Simples Nacional / DAS", competenceDate: new Date("2099-11-01T00:00:00Z") }]);
    const r = await request(app).post("/tax-payments").send({ ...guia, items: das });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICATE_DOCUMENT");
    expect(r.body.message).toContain("07.20.26290.7165263-2");
    expect(r.body.message).toContain("11/2099");
    expect(db.taxPayment.create).not.toHaveBeenCalled();
    // A comparação é pelo número só com letras e dígitos, igual ao índice único do banco.
    const [sql, chave] = db.$queryRawUnsafe.mock.calls[0];
    expect(chave).toBe("07202629071652632");
    expect(sql).toContain(`"deletedAt" IS NULL AND "status" <> 'CANCELED'`);
  });

  test("o mesmo número escrito sem pontuação ou em minúsculas é o mesmo número", async () => {
    await request(app).post("/tax-payments").send({ ...guia, items: das, documentNumber: "ab-12.3" });
    expect(db.$queryRawUnsafe.mock.calls[0][1]).toBe("AB123");
  });

  test("duas gravações ao mesmo tempo: quem perde a corrida bate no índice único e recebe 409, não 500", async () => {
    db.taxPayment.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const r = await request(app).post("/tax-payments").send({ ...guia, items: das });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICATE_DOCUMENT");
  });

  test("outros erros do banco seguem como erro, não viram 409", async () => {
    db.taxPayment.create.mockRejectedValueOnce(new Error("conexão caiu"));
    const r = await request(app).post("/tax-payments").send({ ...guia, items: das });
    expect(r.status).toBe(500);
  });

  test.each([
    ["milhar brasileiro", "1.234"],
    ["hexadecimal", "0x10"],
    ["booleano", true],
    ["lista", [5]],
  ])("recusa valor em formato ambíguo (%s) em vez de gravar um valor errado", async (_n, principal) => {
    const r = await request(app).post("/tax-payments").send({ ...guia, items: [{ description: "IRPJ", principal }] });
    expect(r.status).toBe(400);
    expect(db.taxPayment.create).not.toHaveBeenCalled();
  });

  test("a soma das linhas não pode passar do limite do banco", async () => {
    const r = await request(app).post("/tax-payments").send({
      ...guia, items: [{ description: "A", principal: 9999999999.99 }, { description: "B", principal: 9999999999.99 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/valor máximo/);
  });

  test("guia sem linhas (formato antigo) continua valendo pelo valor informado", async () => {
    await request(app).post("/tax-payments").send({ documentType: "FGTS", dueDate: "2099-12-20", competenceDate: "2099-11-01", amount: 1500 });
    const data = db.taxPayment.create.mock.calls[0][0].data;
    expect(data.amount).toBe(1500);
    expect(data.items).toBeUndefined();
  });

  test("o detalhe da guia traz as linhas na ordem", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ id: "g1" });
    await request(app).get("/tax-payments/g1");
    expect(db.taxPayment.findFirst.mock.calls[0][0].include.items).toEqual({ orderBy: { position: "asc" } });
  });

  test("o catálogo manda na denominação: código conhecido grava a do catálogo, não a que veio do cliente", async () => {
    db.taxCodeCatalog.findMany.mockResolvedValueOnce([{ code: "1001", description: "IRPJ - SIMPLES NACIONAL" }]);
    await request(app).post("/tax-payments").send({ ...guia, items: [{ code: "1001", description: "qualquer coisa", principal: 10 }] });
    expect(db.taxPayment.create.mock.calls[0][0].data.items.create[0].description).toBe("IRPJ - SIMPLES NACIONAL");
  });

  test("código novo é guardado no catálogo para as próximas guias", async () => {
    db.taxCodeCatalog.findMany.mockResolvedValueOnce([]);
    await request(app).post("/tax-payments").send({ ...guia, items: [{ code: "7777", description: "CODIGO NOVO", principal: 10 }] });
    expect(db.taxCodeCatalog.createMany).toHaveBeenCalledWith({
      data: [{ documentType: "Simples Nacional / DAS", code: "7777", description: "CODIGO NOVO" }],
      skipDuplicates: true,
    });
  });

  test("GET /codigos devolve o catálogo do tipo, sem cair no detalhe da guia", async () => {
    db.taxCodeCatalog.findMany.mockResolvedValueOnce([{ code: "1001", description: "IRPJ - SIMPLES NACIONAL" }]);
    const r = await request(app).get("/tax-payments/codigos").query({ tipo: "Simples Nacional / DAS" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ code: "1001", description: "IRPJ - SIMPLES NACIONAL" }]);
    expect(db.taxCodeCatalog.findMany.mock.calls.at(-1)?.[0].where).toEqual({ documentType: "Simples Nacional / DAS" });
    expect(db.taxPayment.findFirst).not.toHaveBeenCalled();
  });

  describe("edição das linhas", () => {
    const existente = {
      id: "g1", documentType: "Simples Nacional / DAS", description: "antiga", cnpj: null, legalName: null, tradeName: null, companyId: null,
      competenceDate: new Date("2099-11-01T00:00:00Z"), dueDate: new Date("2099-12-20T00:00:00Z"), documentNumber: "A-1",
      amount: 100, paymentDate: null, paidAmount: null, status: "PENDING", comments: null, dreCategoryId: "cat-simples",
    };
    const paga = { ...existente, status: "PAID", paymentDate: new Date("2099-12-19T00:00:00Z"), paidAmount: 100 };

    beforeEach(() => {
      db.taxPayment.findFirst.mockResolvedValue(existente);
      db.taxPayment.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
    });

    test("regrava todas as linhas e o total na mesma atualização", async () => {
      const r = await request(app).put("/tax-payments/g1").send({ items: das });
      expect(r.status).toBe(200);
      const data = db.taxPayment.update.mock.calls[0][0].data;
      expect(data.amount).toBe(7740.11);
      expect(data.items.deleteMany).toEqual({});
      expect(data.items.create).toHaveLength(6);
    });

    test("guia paga não aceita mudar linhas nem valor: estornar em Contas a Pagar primeiro", async () => {
      db.taxPayment.findFirst.mockResolvedValue(paga);
      const r = await request(app).put("/tax-payments/g1").send({ items: das });
      expect(r.status).toBe(409);
      expect(r.body.message).toContain("Contas a Pagar");
      const r2 = await request(app).put("/tax-payments/g1").send({ amount: 999 });
      expect(r2.status).toBe(409);
      expect(db.taxPayment.update).not.toHaveBeenCalled();
    });

    test("guia de FGTS ligada a quem foi readmitido continua editável (só revalida se o vínculo mudar)", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", employeeId: "e1" });
      const r = await request(app).put("/tax-payments/g1").send({ comments: "ok", employeeId: "e1" });
      expect(r.status).toBe(200);
      expect(db.taxPayment.update.mock.calls[0][0].data.employeeId).toBe("e1");
    });

    test("trocar o tipo de FGTS para outro limpa funcionário e trabalhadores", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", employeeId: "e1", workersCount: 3 });
      const r = await request(app).put("/tax-payments/g1").send({ documentType: "DARF" });
      expect(r.status).toBe(200);
      const data = db.taxPayment.update.mock.calls[0][0].data;
      expect(data.employeeId).toBeNull();
      expect(data.workersCount).toBeNull();
    });

    test("trocar o tipo sem enviar categoria: o servidor sugere pelo novo tipo, não mantém a antiga", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", dreCategoryId: "cat-fgts" });
      const r = await request(app).put("/tax-payments/g1").send({ documentType: "Simples Nacional / DAS" });
      expect(r.status).toBe(200);
      expect(db.taxPayment.update.mock.calls[0][0].data.dreCategoryId).toBe("cat-simples");
    });

    test("trocar para um tipo sem regra deixa sem categoria (a antiga não vale mais)", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", dreCategoryId: "cat-fgts" });
      await request(app).put("/tax-payments/g1").send({ documentType: "ISS" });
      expect(db.taxPayment.update.mock.calls[0][0].data.dreCategoryId).toBeNull();
    });

    test("sem trocar o tipo, a categoria da guia é mantida; com categoria enviada, vale a enviada", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", dreCategoryId: "cat-fgts" });
      await request(app).put("/tax-payments/g1").send({ comments: "x" });
      expect(db.taxPayment.update.mock.calls[0][0].data.dreCategoryId).toBe("cat-fgts");
      await request(app).put("/tax-payments/g1").send({ documentType: "ISS", dreCategoryId: "cat-irrf" });
      expect(db.taxPayment.update.mock.calls[1][0].data.dreCategoryId).toBe("cat-irrf");
    });

    test("guia sem categoria, editada sem enviar categoria, recebe a sugerida", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, documentType: "FGTS", dreCategoryId: null });
      await request(app).put("/tax-payments/g1").send({ comments: "x" });
      expect(db.taxPayment.update.mock.calls[0][0].data.dreCategoryId).toBe("cat-fgts");
    });

    test("a edição só grava se a guia não mudou desde a leitura (updatedAt no where) e devolve 409 se mudou", async () => {
      const lida = { ...existente, documentType: "FGTS", updatedAt: new Date("2026-10-01T12:00:00.000Z") };
      db.taxPayment.findFirst.mockResolvedValue(lida);
      const ok = await request(app).put("/tax-payments/g1").send({ comments: "x" });
      expect(ok.status).toBe(200);
      expect(db.taxPayment.update.mock.calls[0][0].where).toEqual({ id: "g1", deletedAt: null, updatedAt: lida.updatedAt });

      db.taxPayment.update.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
      const conflito = await request(app).put("/tax-payments/g1").send({ comments: "y" });
      expect(conflito.status).toBe(409);
      expect(conflito.body.code).toBe("TAX_PAYMENT_CHANGED");
    });

    test("guia 'sem comprovante' continua assim depois de editar (não reabre para uma segunda baixa)", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "WITHOUT_RECEIPT", paymentDate: null });
      await request(app).put("/tax-payments/g1").send({ comments: "x" });
      expect(db.taxPayment.update.mock.calls[0][0].data.status).toBe("WITHOUT_RECEIPT");
    });

    test.each([
      [{ documentType: "   " }, /Tipo de documento inválido/],
      [{ documentType: { a: 1 } }, /documentType inválido/],
      [{ comments: "x".repeat(2001) }, /comments com mais de 2000/],
      [{ legalName: 5 }, /legalName inválido/],
    ])("campo de texto inválido %j é recusado com 400", async (corpo, mensagem) => {
      const r = await request(app).put("/tax-payments/g1").send(corpo);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(mensagem);
      expect(db.taxPayment.update).not.toHaveBeenCalled();
    });

    test("restaurar com o índice único violado na corrida devolve 409, não 500", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, deletedAt: new Date("2099-12-01T00:00:00Z") });
      db.taxPayment.update.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
      const r = await request(app).patch("/tax-payments/g1/restore").send({});
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("DUPLICATE_DOCUMENT");
    });

    test("guia paga ainda aceita editar texto", async () => {
      db.taxPayment.findFirst.mockResolvedValue(paga);
      const r = await request(app).put("/tax-payments/g1").send({ comments: "conferida", paymentDate: "2099-12-19", paidAmount: 100 });
      expect(r.status).toBe(200);
    });

    test("trocar para um número de documento que já existe em outra guia é recusado", async () => {
      db.$queryRawUnsafe.mockResolvedValueOnce([{ id: "g2", documentType: "FGTS", competenceDate: null }]);
      const r = await request(app).put("/tax-payments/g1").send({ documentNumber: "B-2" });
      expect(r.status).toBe(409);
      expect(db.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(["B2", "g1"]);
    });

    test("manter o mesmo número não conta como repetido", async () => {
      const r = await request(app).put("/tax-payments/g1").send({ documentNumber: "A-1", description: "texto" });
      expect(r.status).toBe(200);
      expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    test("reativar uma guia cancelada cujo número foi lançado de novo é recusado", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, status: "CANCELED" });
      db.$queryRawUnsafe.mockResolvedValueOnce([{ id: "g2", documentType: "Simples Nacional / DAS", competenceDate: null }]);
      const r = await request(app).put("/tax-payments/g1").send({ status: "PENDING" });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("DUPLICATE_DOCUMENT");
      expect(db.taxPayment.update).not.toHaveBeenCalled();
    });

    test("perder a corrida do índice único na edição também vira 409", async () => {
      db.taxPayment.update.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
      const r = await request(app).put("/tax-payments/g1").send({ documentNumber: "C-3" });
      expect(r.status).toBe(409);
    });

    test("guia com composição não aceita mudar só o valor: o total é a soma das linhas", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, items: [{ id: "i1", position: 0, description: "IRPJ", principal: 100, fine: 0, interest: 0 }] });
      const r = await request(app).put("/tax-payments/g1").send({ amount: 999 });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/linhas/);
      expect(db.taxPayment.update).not.toHaveBeenCalled();
    });

    test("guia antiga, sem linhas, ainda aceita mudar só o valor", async () => {
      const r = await request(app).put("/tax-payments/g1").send({ amount: 999 });
      expect(r.status).toBe(200);
      expect(db.taxPayment.update.mock.calls[0][0].data.amount).toBe(999);
    });

    test("a auditoria guarda as linhas anteriores (previousValue)", async () => {
      const anteriores = [{ id: "i1", position: 0, description: "IRPJ", principal: 100, fine: 0, interest: 0 }];
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, items: anteriores });
      await request(app).put("/tax-payments/g1").send({ items: das });
      expect(db.taxPayment.findFirst.mock.calls[0][0].include.items).toEqual({ orderBy: { position: "asc" } });
      const { auditLog } = await import("../../security/security-utils.js");
      const chamadas = vi.mocked(auditLog).mock.calls;
      expect(chamadas[chamadas.length - 1][0].previousValue).toMatchObject({ items: anteriores });
    });

    test("restaurar uma guia excluída cujo número foi lançado de novo é recusado", async () => {
      db.taxPayment.findFirst.mockResolvedValue({ ...existente, deletedAt: new Date("2099-12-01T00:00:00Z") });
      db.$queryRawUnsafe.mockResolvedValueOnce([{ id: "g2", documentType: "Simples Nacional / DAS", competenceDate: null }]);
      const r = await request(app).patch("/tax-payments/g1/restore").send({});
      expect(r.status).toBe(409);
      expect(db.taxPayment.update).not.toHaveBeenCalled();
    });
  });
});

describe("cancelar e estornar", () => {
  const paga = {
    id: "g1", documentType: "FGTS", amount: 1500, status: "PAID", paidAmount: 1500,
    paymentDate: new Date("2026-10-10T00:00:00Z"),
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2099-12-20T00:00:00Z"),
  };

  test("não deixa cancelar uma guia paga: o desembolso sumiria do DRE com o pagamento gravado", async () => {
    db.taxPayment.findFirst.mockResolvedValue(paga);
    const r = await request(app).put("/tax-payments/g1").send({ status: "CANCELED" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Estorne/);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });

  test("não estorna guia cancelada: reativaria em silêncio", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...paga, status: "CANCELED" });
    const r = await request(app).patch("/tax-payments/g1/reverse").send({ reason: "engano" });
    expect(r.status).toBe(409);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });
});

describe("lista e totais da tela de impostos", () => {
  const consultas = () => db.$queryRawUnsafe.mock.calls.map((c: unknown[]) => String(c[0]));

  beforeEach(() => {
    db.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes("COUNT(*)") ? [{ total: "0" }] : sql.includes("AS overdue") ? [{ total: "0", paid: "0", pending: "0", overdue: "0", withoutReceipt: "0" }] : []);
  });

  test("totais ignoram guia cancelada e usam o dia de hoje em Brasília, não NOW()", async () => {
    await request(app).get("/tax-payments");
    const resumo = consultas().find((q: string) => q.includes("AS overdue")) as string;
    expect(resumo).not.toContain("NOW()");
    expect(resumo).toMatch(/status <> 'CANCELED' THEN tp\.amount[^]*AS total/);
    expect(resumo).toMatch(/dueDate" < '\d{4}-\d{2}-\d{2}'::timestamp/);
  });

  test.each(["PENDING", "PAID", "OVERDUE"])("filtro %s exclui cancelada e não depende do status gravado", async (status) => {
    await request(app).get("/tax-payments").query({ status });
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toContain(`tp."status" <> 'CANCELED'`);
    expect(lista).not.toContain("NOW()");
  });

  test("filtros da lista: tipo exato, sem categoria e sem competência sem canceladas", async () => {
    await request(app).get("/tax-payments").query({ documentType: "DARF", dreCategoryId: "none", withoutCompetence: "true" });
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toContain('LOWER(tp."documentType") = LOWER($1)');
    expect(lista).not.toContain("ILIKE $1");
    expect(lista).toContain('tp."dreCategoryId" IS NULL');
    expect(lista).toContain('tp."competenceDate" IS NULL');
    expect(lista).toContain(`tp."status" <> 'CANCELED'`);
    db.$queryRawUnsafe.mockClear();
    await request(app).get("/tax-payments").query({ withoutCompetence: "true", status: "CANCELED" });
    const canceladas = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    const filtroCancel = canceladas.slice(canceladas.indexOf("WHERE"), canceladas.indexOf("ORDER BY"));
    expect(filtroCancel).toContain('tp."competenceDate" IS NULL');
    expect(filtroCancel).not.toContain(`<> 'CANCELED'`);
  });

  test("clique numa célula da grade (excludeCanceled): a lista não traz guia cancelada", async () => {
    await request(app).get("/tax-payments").query({ dreCategoryId: "cat-inss", competenceStart: "2026-08-01", excludeCanceled: "true" });
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toContain(`tp."status" <> 'CANCELED'`);
    db.$queryRawUnsafe.mockClear();
    await request(app).get("/tax-payments").query({ excludeCanceled: "true", status: "CANCELED" });
    const canceladas = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(canceladas.slice(canceladas.indexOf("WHERE"), canceladas.indexOf("ORDER BY"))).not.toContain(`<> 'CANCELED'`);
  });

  test.each([
    [{ status: "XYZ" }, /Situação inválida/],
    [{ competenceStart: "abc" }, /Data inválida em competenceStart/],
    [{ dueEnd: "2026-13-45" }, /Data inválida em dueEnd/],
    [{ paymentStart: "20/10/2026" }, /Data inválida em paymentStart/],
  ])("filtro inválido %j devolve 400, não 500", async (query, mensagem) => {
    const r = await request(app).get("/tax-payments").query(query);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(mensagem);
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  test("filtro repetido na URL e página gigante não derrubam a lista; % e _ da busca são texto", async () => {
    const r = await request(app).get("/tax-payments?companyId=a&companyId=b&page=999999999&search=50%25_x");
    expect(r.status).toBe(200);
    const chamada = db.$queryRawUnsafe.mock.calls.find((c: unknown[]) => String(c[0]).includes("ORDER BY")) as unknown[];
    expect(String(chamada[0])).not.toContain('"companyId" =');
    expect(chamada.slice(1)).toContain("%50\\%\\_x%");
    expect(String(chamada[0])).toContain("OFFSET 4999950"); // página limitada a 100.000, nunca 1e+21
  });

  test("a lista vem por urgência: o que falta pagar primeiro, pagas e canceladas depois", async () => {
    await request(app).get("/tax-payments");
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toMatch(/ORDER BY\s+\(tp\."paymentDate" IS NOT NULL OR tp\."status" = 'CANCELED'\) ASC,\s+CASE WHEN tp\."paymentDate" IS NULL AND tp\."status" <> 'CANCELED' THEN tp\."dueDate" END ASC/);
  });

  test("o painel responde pela rota /panorama, sem cair no detalhe", async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    const r = await request(app).get("/tax-payments/panorama");
    expect(r.status).toBe(200);
    expect(r.body.meses).toHaveLength(12);
    expect(db.taxPayment.findFirst).not.toHaveBeenCalled();
  });

  test("withoutCompetence=true lista só as guias sem competência; sem o parâmetro, não filtra", async () => {
    await request(app).get("/tax-payments").query({ withoutCompetence: "true" });
    const com = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(com).toContain('tp."competenceDate" IS NULL');
    db.$queryRawUnsafe.mockClear();
    await request(app).get("/tax-payments");
    const sem = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(sem).not.toContain('tp."competenceDate" IS NULL');
  });

  test("filtro Cancelado continua pelo status gravado", async () => {
    await request(app).get("/tax-payments").query({ status: "CANCELED" });
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toContain(`tp."status" = $1`);
  });
});

describe("pagar e excluir", () => {
  const base = {
    id: "g1", amount: 1500, status: "PENDING", paymentDate: null,
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2099-12-20T00:00:00Z"),
  };

  test("a baixa só grava se a guia ainda está em aberto: segunda baixa simultânea recebe 409", async () => {
    db.taxPayment.findFirst.mockResolvedValue(base);
    db.taxPayment.update.mockResolvedValueOnce({ id: "g1", status: "PAID" });
    const primeira = await request(app).patch("/tax-payments/g1/pay").send({ paymentDate: "2026-10-10", paidAmount: 1500 });
    expect(primeira.status).toBe(200);
    expect(db.taxPayment.update.mock.calls[0][0].where).toEqual({ id: "g1", deletedAt: null, paymentDate: null, status: { not: "CANCELED" } });

    // a segunda leu a guia ainda em aberto, mas a primeira já gravou: o update não encontra o registro
    db.taxPayment.update.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    const segunda = await request(app).patch("/tax-payments/g1/pay").send({ paymentDate: "2026-10-10", paidAmount: 1500 });
    expect(segunda.status).toBe(409);
    expect(segunda.body.code).toBe("TAX_PAYMENT_CHANGED");
    expect(segunda.body.message).toMatch(/mudou enquanto era baixada/);
  });

  test("o estorno só grava em guia ainda paga: segundo estorno simultâneo recebe 409", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...base, status: "PAID", paymentDate: new Date("2026-10-10T00:00:00Z"), paidAmount: 1500 });
    db.taxPayment.update.mockResolvedValueOnce({ id: "g1", status: "PENDING" });
    const primeiro = await request(app).patch("/tax-payments/g1/reverse").send({ reason: "valor errado" });
    expect(primeiro.status).toBe(200);
    expect(db.taxPayment.update.mock.calls[0][0].where).toEqual({ id: "g1", deletedAt: null, paymentDate: { not: null }, status: { not: "CANCELED" } });

    db.taxPayment.update.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    const segundo = await request(app).patch("/tax-payments/g1/reverse").send({ reason: "valor errado" });
    expect(segundo.status).toBe(409);
    expect(segundo.body.code).toBe("TAX_PAYMENT_CHANGED");
  });

  test("o histórico não devolve IP, navegador nem e-mail", async () => {
    db.$queryRaw.mockResolvedValue([]);
    const r = await request(app).get("/tax-payments/g1/history");
    expect(r.status).toBe(200);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join(" ");
    expect(sql).not.toMatch(/ipAddress|userAgent|email|a\.\*/);
    expect(sql).toContain('"userName"');
  });

  test.each([true, "1e3", "0x1F", [7], 1e12])("baixa com valor pago fora do formato (%s) é recusada", async (paidAmount) => {
    db.taxPayment.findFirst.mockResolvedValue(base);
    const r = await request(app).patch("/tax-payments/g1/pay").send({ paymentDate: "2026-10-10", paidAmount });
    expect(r.status).toBe(400);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });

  test("guia cancelada não pode ser paga", async () => {
    db.taxPayment.findFirst.mockResolvedValue({ ...base, status: "CANCELED" });
    const r = await request(app).patch("/tax-payments/g1/pay").send({ paymentDate: "2026-10-10", paidAmount: 1500 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/cancelado/);
    expect(db.taxPayment.update).not.toHaveBeenCalled();
  });

  test("guia paga só é excluída se o mês do pagamento também estiver aberto", async () => {
    const { assertPeriodWritableForDate } = await import("../../cmv-real/cmv-real.service.js");
    const { PeriodLockedError } = await import("../../cmv-real/period-locked-error.js");
    db.taxPayment.findFirst.mockResolvedValue({ ...base, status: "PAID", paymentDate: new Date("2026-08-05T00:00:00Z") });
    vi.mocked(assertPeriodWritableForDate).mockImplementation(async (data: Date) => {
      if (data.toISOString().startsWith("2026-08")) throw new PeriodLockedError("Agosto fechado");
    });

    const r = await request(app).delete("/tax-payments/g1");

    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Agosto fechado");
    expect(db.taxPayment.update).not.toHaveBeenCalled();
    vi.mocked(assertPeriodWritableForDate).mockReset();
  });
});
