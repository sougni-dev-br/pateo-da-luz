import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Margem das bebidas (revenda): leitura, vinculo bebida<->insumo e permissoes. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    product: { findMany: vi.fn(), findFirst: vi.fn() },
    agileProdutoInsumo: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    dish: { findMany: vi.fn() },
    agileProdutoPrato: { findMany: vi.fn() },
    $queryRaw: vi.fn()
  };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { getSessionUser } from "../../../security/security-utils.js";
import { userHasPermission } from "../../../security/menu-permissions.js";
import { agileAnaliseRouter } from "../agile-analise.routes.js";
import { obterMargemBebidas } from "../agile-analise.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const QS = "?inicio=2026-09-14&fim=2026-10-13";
const dec = (n: number) => ({ toString: () => String(n) });
const produtoSql = (over: Record<string, unknown> = {}) => ({ codigo: "300", nome: "COCA", categoria: "BEBIDAS", quantidade: dec(100), valor: dec(1290), ...over });
const ligacaoDb = (over: Record<string, unknown> = {}) => ({
  productCode: "300", insumoId: "i1", quantity: dec(1), unit: "UN",
  insumo: { name: "COCA COLA 350ML", isActive: true, unit: "UN", stockUnit: "UN", inventoryStock: { averageCost: dec(4.41) }, conversions: [] }, ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.$queryRaw.mockResolvedValue([produtoSql(), produtoSql({ codigo: "9", nome: "BABY BEEF", categoria: "PRATOS", valor: dec(5000), quantidade: dec(100) })]);
  db.agileProdutoInsumo.findMany.mockResolvedValue([ligacaoDb()]);
  db.product.findMany.mockResolvedValue([{ id: "i1", name: "COCA COLA 350ML", unit: "UN", stockUnit: "UN" }]);
  db.product.findFirst.mockResolvedValue({ name: "REFRIGERANTE 350ML", unit: "UN", stockUnit: "UN", conversions: [] });
  db.agileProdutoInsumo.upsert.mockResolvedValue({});
  db.agileProdutoInsumo.deleteMany.mockResolvedValue({ count: 1 });
});

describe("GET /margem-bebidas", () => {
  test("sem sessao: 401; sem a permissao analise-salao: 403; nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/analise/margem-bebidas" + QS)).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).get("/analise/margem-bebidas" + QS)).status).toBe(403);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test("periodo invalido: 400", async () => {
    expect((await request(app).get("/analise/margem-bebidas?inicio=2026-10-13&fim=2026-09-14")).status).toBe(400);
  });

  test("margem de revenda: preco medio menos custo de compra; prato nao entra (so categorias de bebida)", async () => {
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.status).toBe(200);
    expect(r.body.linhas).toEqual([expect.objectContaining({ codigo: "300", receita: 1290, quantidade: 100, precoMedio: 12.9, custoPorVenda: 4.41, margemUnitaria: 8.49, margemTotal: 849 })]);
    expect(r.body.cobertura).toMatchObject({ receitaBebidas: 1290, pctComMargem: 1 });
  });

  test("insumo desativado depois do vinculo: custo incompleto com o motivo, sem margem", async () => {
    db.agileProdutoInsumo.findMany.mockResolvedValue([ligacaoDb({ insumo: { name: "COCA COLA 350ML", isActive: false, unit: "UN", stockUnit: "UN", inventoryStock: { averageCost: dec(4.41) }, conversions: [] } })]);
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.aFazer[0]).toMatchObject({ situacao: "custo-incompleto", problema: "O insumo foi desativado no estoque." });
  });

  test("a consulta soma a quantidade PAGA (valor > 0) junto da quantidade total", async () => {
    await request(app).get("/analise/margem-bebidas" + QS);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join(" ");
    expect(sql).toMatch(/FILTER \(WHERE i\."totalAmount" > 0\)/);
  });

  test("cortesia: o preco medio sai das unidades pagas", async () => {
    db.$queryRaw.mockResolvedValue([produtoSql({ quantidade: dec(100), quantidade_paga: dec(80), valor: dec(960) })]);
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.body.linhas[0]).toMatchObject({ precoMedio: 12, quantidadeSemCobranca: 20 });
  });

  test("lista de insumos acima do limite: corta em 3000 e avisa (insumosTruncados)", async () => {
    const muitos = Array.from({ length: 3001 }, (_, i) => ({ id: `i${i}`, name: `INSUMO ${i}`, unit: "UN", stockUnit: "UN" }));
    db.agileProdutoInsumo.findMany.mockResolvedValue([]);
    db.product.findMany.mockResolvedValue(muitos);
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(db.product.findMany.mock.calls[0][0].take).toBe(3001);
    expect(r.body.insumosTruncados).toBe(true);
    expect(r.body.insumosParaVincular).toHaveLength(3000);
  });

  test("lista de insumos dentro do limite: sem aviso", async () => {
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.body.insumosTruncados).toBe(false);
  });

  test("so insumos ATIVOS e COM custo medio vao para a escolha", async () => {
    await request(app).get("/analise/margem-bebidas" + QS);
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({ isActive: true, inventoryStock: { averageCost: { gt: 0 } } });
  });

  test("insumo sem custo medio: custo incompleto, sem margem inventada", async () => {
    db.agileProdutoInsumo.findMany.mockResolvedValue([ligacaoDb({ insumo: { name: "COCA", unit: "UN", stockUnit: "UN", inventoryStock: null, conversions: [] } })]);
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.aFazer[0]).toMatchObject({ codigo: "300", situacao: "custo-incompleto" });
  });

  test("taca: 150 ML de garrafa de 750 ML, conversao lida do nome", async () => {
    db.$queryRaw.mockResolvedValue([produtoSql({ codigo: "400", nome: "TACA", valor: dec(2400), quantidade: dec(100) })]);
    db.agileProdutoInsumo.findMany.mockResolvedValue([ligacaoDb({ productCode: "400", quantity: dec(150), unit: "ML", insumo: { name: "CATRAIO VINHO TINTO 750ML", isActive: true, unit: "UN", stockUnit: "UN", inventoryStock: { averageCost: dec(26.16) }, conversions: [] } })]);
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.body.linhas[0]).toMatchObject({ custoPorVenda: 5.23, consumo: "150 ML de CATRAIO VINHO TINTO 750ML" });
  });

  test("o dia em andamento fica de fora", async () => {
    const r = await obterMargemBebidas({ inicio: "2026-10-01", fim: "2026-10-14" }, "2026-10-14");
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.periodo.fim).toBe("2026-10-13");
  });

  test("falha do banco: 500 generico, sem vazar o erro", async () => {
    db.$queryRaw.mockRejectedValue(new Error("senha=segredo"));
    const r = await request(app).get("/analise/margem-bebidas" + QS);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});

describe("PUT /margem-bebidas/vinculo", () => {
  const corpo = { codigo: "300", nome: "COCA", insumoId: "i1", quantidade: 1, unidade: "UN" };

  test("sem a permissao de editar: 403 e nada gravado", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, _m, acao) => acao === "view");
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send(corpo);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "edit");
    expect(db.agileProdutoInsumo.upsert).not.toHaveBeenCalled();
  });

  test("sem sessao: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).put("/analise/margem-bebidas/vinculo").send(corpo)).status).toBe(401);
  });

  test.each([
    ["sem codigo", { ...corpo, codigo: undefined }],
    ["sem nome", { ...corpo, nome: undefined }],
    ["insumoId numero", { ...corpo, insumoId: 5 }],
    ["quantidade zero", { ...corpo, quantidade: 0 }],
    ["quantidade abaixo do que a coluna guarda", { ...corpo, quantidade: 0.00001 }],
    ["quantidade negativa", { ...corpo, quantidade: -3 }],
    ["quantidade texto", { ...corpo, quantidade: "2" }],
    ["quantidade enorme", { ...corpo, quantidade: 1e9 }],
    ["unidade invalida", { ...corpo, unidade: "CX" }]
  ])("rejeita %s com 400 e nao grava", async (_n, body) => {
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send(body);
    expect(r.status).toBe(400);
    expect(db.agileProdutoInsumo.upsert).not.toHaveBeenCalled();
  });

  test("insumo inexistente, inativo ou sem custo: 400 e nada gravado", async () => {
    db.product.findFirst.mockResolvedValue(null);
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/insumo ativo e com custo médio/);
    expect(db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "i1", isActive: true, inventoryStock: { averageCost: { gt: 0 } } } }));
    expect(db.agileProdutoInsumo.upsert).not.toHaveBeenCalled();
  });

  test("grava pelo codigo do PDV com quantidade, unidade e usuario", async () => {
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send({ ...corpo, quantidade: 150, unidade: "ML" });
    expect(r.status).toBe(200);
    expect(db.agileProdutoInsumo.upsert).toHaveBeenCalledWith({
      where: { productCode: "300" },
      create: { productCode: "300", productName: "COCA", insumoId: "i1", quantity: 150, unit: "ML", updatedById: "u1" },
      update: { productName: "COCA", insumoId: "i1", quantity: 150, unit: "ML", updatedById: "u1" }
    });
  });

  test("unidade sem conversao para a unidade de estoque do insumo: 400 explicando, e nada gravado", async () => {
    db.product.findFirst.mockResolvedValue({ name: "SAL GROSSO", unit: "KG", stockUnit: "KG", conversions: [] });
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send({ ...corpo, quantidade: 1, unidade: "ML" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Não há conversão de ML/);
    expect(db.agileProdutoInsumo.upsert).not.toHaveBeenCalled();
  });

  test("unidade que converte pela conversao cadastrada do insumo e aceita", async () => {
    db.product.findFirst.mockResolvedValue({ name: "SAL GROSSO", unit: "KG", stockUnit: "KG", conversions: [{ fromUnit: "ML", toUnit: "KG", factor: { toString: () => "0.001", valueOf: () => 0.001 } }] });
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send({ ...corpo, quantidade: 1, unidade: "ML" });
    expect(r.status).toBe(200);
  });

  test("quantidade e unidade tem padrao 1 UN", async () => {
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send({ codigo: "300", nome: "COCA", insumoId: "i1" });
    expect(r.status).toBe(200);
    expect(db.agileProdutoInsumo.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ quantity: 1, unit: "UN" }) }));
  });

  test("insumoId null desfaz o vinculo sem consultar insumo", async () => {
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send({ ...corpo, insumoId: null });
    expect(r.status).toBe(200);
    expect(db.agileProdutoInsumo.deleteMany).toHaveBeenCalledWith({ where: { productCode: "300" } });
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(db.agileProdutoInsumo.upsert).not.toHaveBeenCalled();
  });

  test("falha ao gravar: 500 generico", async () => {
    db.agileProdutoInsumo.upsert.mockRejectedValue(new Error("conexao com senha=x"));
    const r = await request(app).put("/analise/margem-bebidas/vinculo").send(corpo);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("senha");
  });
});
