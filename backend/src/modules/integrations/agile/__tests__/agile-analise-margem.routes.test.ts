import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Margem por prato do salao: leitura, vinculo produto<->prato e permissoes. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findMany: vi.fn(), findFirst: vi.fn() },
    agileProdutoPrato: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
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
import { obterMargem } from "../agile-analise.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const QS = "?inicio=2026-09-14&fim=2026-10-13";
const dec = (n: number) => ({ toString: () => String(n) });
const produtoSql = (over: Record<string, unknown> = {}) => ({ codigo: "100", nome: "BABY BEEF", categoria: "PRATOS", quantidade: dec(100), valor: dec(5000), ...over });
// 200 G de um insumo cotado por KG a R$ 30: custo da porcao = R$ 6.
const pratoDb = (over: Record<string, unknown> = {}) => ({
  id: "d1", name: "Baby beef", salePriceDefault: dec(50), yieldQty: dec(1), yieldUnit: "UN",
  items: [{ quantity: dec(200), unit: "G", wasteFactor: dec(0), product: { name: "CARNE", unit: "KG", stockUnit: "KG", inventoryStock: { averageCost: dec(30) }, conversions: [] } }],
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.$queryRaw.mockResolvedValue([produtoSql()]);
  db.dish.findMany.mockResolvedValue([pratoDb()]);
  db.dish.findFirst.mockResolvedValue({ id: "d1" });
  db.agileProdutoPrato.findMany.mockResolvedValue([{ productCode: "100", dishId: "d1" }]);
  db.agileProdutoPrato.upsert.mockResolvedValue({});
  db.agileProdutoPrato.deleteMany.mockResolvedValue({ count: 1 });
});

describe("GET /margem", () => {
  test("sem sessao: 401; sem a permissao analise-salao: 403; nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/analise/margem" + QS)).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).get("/analise/margem" + QS)).status).toBe(403);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.dish.findMany).not.toHaveBeenCalled();
  });

  test("periodo invalido: 400 e nada consultado", async () => {
    const r = await request(app).get("/analise/margem?inicio=2026-10-13&fim=2026-09-14");
    expect(r.status).toBe(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test("margem do prato vinculado: custo da porcao vem dos itens da ficha do salao, convertido de G para KG", async () => {
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.status).toBe(200);
    expect(r.body.linhas).toEqual([expect.objectContaining({ pratoId: "d1", prato: "Baby beef", receita: 5000, quantidade: 100, precoMedio: 50, custoPorcao: 6, margemUnitaria: 44, margemTotal: 4400 })]);
    expect(r.body.cobertura).toMatchObject({ pctComMargem: 1, pratosComMargem: 1 });
  });

  test("so le pratos ATIVOS do salao e so os itens do cardapio do salao (o delivery tem custo proprio)", async () => {
    await request(app).get("/analise/margem" + QS);
    const consulta = db.dish.findMany.mock.calls[0][0];
    expect(consulta.where).toEqual({ isActive: true, fichaDeProducao: false, OR: [{ menu: "CARDAPIO" }, { alsoMenu: "CARDAPIO" }] });
    expect(consulta.select.items.where).toEqual({ menu: "CARDAPIO" });
  });

  test("ficha sem itens no salao: sem margem, entra na lista a fazer como sem-ficha", async () => {
    db.dish.findMany.mockResolvedValue([pratoDb({ items: [] })]);
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.aFazer[0]).toMatchObject({ codigo: "100", situacao: "sem-ficha", prato: "Baby beef" });
  });

  test("insumo sem custo medio: custo incompleto, nunca margem inventada", async () => {
    db.dish.findMany.mockResolvedValue([pratoDb({ items: [{ quantity: dec(200), unit: "G", wasteFactor: dec(0), product: { name: "CARNE", unit: "KG", stockUnit: "KG", inventoryStock: null, conversions: [] } }] })]);
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.aFazer[0].situacao).toBe("custo-incompleto");
  });

  test("ficha com rendimento em KG (nao e porcao): custo incompleto, nunca custo por quilo como se fosse por prato", async () => {
    db.dish.findMany.mockResolvedValue([pratoDb({ yieldUnit: "KG", yieldQty: dec(2) })]);
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.aFazer[0].situacao).toBe("custo-incompleto");
  });

  test("a consulta de produtos agrupa pelo codigo (um produto por linha mesmo que o PDV renomeie)", async () => {
    await request(app).get("/analise/margem" + QS);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join(" ");
    expect(sql).toMatch(/GROUP BY COALESCE\(i\."productCode", i\."productName"\)/);
  });

  test("produto sem vinculo traz sugestao de prato pelo nome", async () => {
    db.agileProdutoPrato.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([produtoSql({ codigo: "200", nome: "BABY BEEF C/ ARROZ" })]);
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.body.aFazer[0]).toMatchObject({ situacao: "sem-vinculo" });
    expect(r.body.aFazer[0].sugestoes[0]).toMatchObject({ pratoId: "d1" });
    expect(r.body.pratosParaVincular).toEqual([{ id: "d1", nome: "Baby beef" }]);
  });

  test("buffet fica de fora dos pratos e aparece em receitaBuffet", async () => {
    db.$queryRaw.mockResolvedValue([produtoSql(), produtoSql({ codigo: "9", nome: "BUFFET PROMO 15", categoria: "ALIMENTOS", valor: dec(20000), quantidade: dec(800) })]);
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.body.cobertura).toMatchObject({ receitaBuffet: 20000, receitaPratos: 5000 });
  });

  test("o dia em andamento fica de fora e o aviso volta na resposta", async () => {
    const r = await obterMargem({ inicio: "2026-10-01", fim: "2026-10-14" }, "2026-10-14");
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.periodo.fim).toBe("2026-10-13");
  });

  test("falha do banco: 500 generico, sem vazar o erro", async () => {
    db.$queryRaw.mockRejectedValue(new Error("senha=segredo"));
    const r = await request(app).get("/analise/margem" + QS);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});

describe("PUT /margem/vinculo", () => {
  const corpo = { codigo: "100", nome: "BABY BEEF", pratoId: "d1" };

  test("sem a permissao de editar: 403 e nada gravado (ver nao basta)", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, _m, acao) => acao === "view");
    const r = await request(app).put("/analise/margem/vinculo").send(corpo);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "edit");
    expect(db.agileProdutoPrato.upsert).not.toHaveBeenCalled();
  });

  test("sem sessao: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).put("/analise/margem/vinculo").send(corpo)).status).toBe(401);
  });

  test.each([
    ["sem codigo", { nome: "X", pratoId: "d1" }],
    ["codigo vazio", { ...corpo, codigo: "  " }],
    ["sem nome", { codigo: "1", pratoId: "d1" }],
    ["pratoId numero", { ...corpo, pratoId: 5 }],
    ["sem pratoId", { codigo: "1", nome: "X" }],
    ["codigo enorme", { ...corpo, codigo: "x".repeat(200) }]
  ])("rejeita %s com 400 e nao grava", async (_n, body) => {
    const r = await request(app).put("/analise/margem/vinculo").send(body);
    expect(r.status).toBe(400);
    expect(db.agileProdutoPrato.upsert).not.toHaveBeenCalled();
  });

  test("prato inexistente, inativo ou fora do salao: 400 e nada gravado", async () => {
    db.dish.findFirst.mockResolvedValue(null);
    const r = await request(app).put("/analise/margem/vinculo").send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/prato ativo do cardápio do salão/);
    expect(db.dish.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1", isActive: true, fichaDeProducao: false, OR: [{ menu: "CARDAPIO" }, { alsoMenu: "CARDAPIO" }] } }));
    expect(db.agileProdutoPrato.upsert).not.toHaveBeenCalled();
  });

  test("grava pelo codigo do PDV, com o usuario", async () => {
    const r = await request(app).put("/analise/margem/vinculo").send(corpo);
    expect(r.status).toBe(200);
    expect(db.agileProdutoPrato.upsert).toHaveBeenCalledWith({
      where: { productCode: "100" },
      create: { productCode: "100", productName: "BABY BEEF", dishId: "d1", updatedById: "u1" },
      update: { productName: "BABY BEEF", dishId: "d1", updatedById: "u1" }
    });
  });

  test("pratoId null desfaz o vinculo sem consultar prato", async () => {
    const r = await request(app).put("/analise/margem/vinculo").send({ ...corpo, pratoId: null });
    expect(r.status).toBe(200);
    expect(db.agileProdutoPrato.deleteMany).toHaveBeenCalledWith({ where: { productCode: "100" } });
    expect(db.dish.findFirst).not.toHaveBeenCalled();
    expect(db.agileProdutoPrato.upsert).not.toHaveBeenCalled();
  });

  test("falha ao gravar: 500 generico", async () => {
    db.agileProdutoPrato.upsert.mockRejectedValue(new Error("conexao com senha=x"));
    const r = await request(app).put("/analise/margem/vinculo").send(corpo);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("senha");
  });
});
