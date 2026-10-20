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
    $queryRawUnsafe: vi.fn(),
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
    const importFileId = "a".repeat(32);
    fs.mkdirSync("uploads", { recursive: true });
    fs.writeFileSync(path.join("uploads", importFileId), "x");
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

    const r = await request(app).post("/tax-payments/import-xlsx/confirm").send({ importFileId });

    expect(r.status).toBe(200);
    expect(criados.map((c) => c.dreCategoryId)).toEqual(["cat-simples", "cat-inss"]);
    expect(fs.existsSync(path.join("uploads", importFileId))).toBe(false);
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
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2026-10-20T00:00:00Z"),
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

describe("cancelar e estornar", () => {
  const paga = {
    id: "g1", documentType: "FGTS", amount: 1500, status: "PAID", paidAmount: 1500,
    paymentDate: new Date("2026-10-10T00:00:00Z"),
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2026-10-20T00:00:00Z"),
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

  test("filtro Cancelado continua pelo status gravado", async () => {
    await request(app).get("/tax-payments").query({ status: "CANCELED" });
    const lista = consultas().find((q: string) => q.includes("ORDER BY")) as string;
    expect(lista).toContain(`tp."status" = $1`);
  });
});

describe("pagar e excluir", () => {
  const base = {
    id: "g1", amount: 1500, status: "PENDING", paymentDate: null,
    competenceDate: new Date("2026-09-01T00:00:00Z"), dueDate: new Date("2026-10-20T00:00:00Z"),
  };

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
