import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Consumo teorico de insumos do salao: leitura e permissoes. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findMany: vi.fn() },
    agileProdutoPrato: { findMany: vi.fn() },
    agileProdutoInsumo: { findMany: vi.fn() },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const QS = "?inicio=2026-09-14&fim=2026-10-13";
const dec = (n: number) => ({ toString: () => String(n), valueOf: () => n });
const produtoSql = (over: Record<string, unknown> = {}) => ({ codigo: "100", nome: "BABY BEEF", categoria: "PRATOS", quantidade: dec(100), valor: dec(5000), ...over });
const produto = { name: "CARNE", unit: "KG", stockUnit: "KG", conversions: [] };
// 200 G de carne por porcao (estoque em KG).
const pratoDb = (over: Record<string, unknown> = {}) => ({
  id: "d1", name: "Baby beef", yieldQty: dec(1), yieldUnit: "UN",
  items: [{ menu: "CARDAPIO", productId: "p-carne", componentDishId: null, quantity: dec(200), unit: "G", wasteFactor: dec(0), product: produto }],
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.$queryRaw.mockResolvedValue([produtoSql()]);
  db.dish.findMany.mockResolvedValue([pratoDb()]);
  db.agileProdutoPrato.findMany.mockResolvedValue([{ productCode: "100", dishId: "d1" }]);
  db.agileProdutoInsumo.findMany.mockResolvedValue([]);
});

describe("GET /consumo", () => {
  test("sem sessao: 401; sem a permissao analise-salao: 403; nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/analise/consumo" + QS)).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).get("/analise/consumo" + QS)).status).toBe(403);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.dish.findMany).not.toHaveBeenCalled();
  });

  test("nao exige a permissao de custos: so traz quantidades", async () => {
    await request(app).get("/analise/consumo" + QS);
    const permissoes = vi.mocked(userHasPermission).mock.calls.map((c) => c[1]);
    expect(permissoes).toContain("analise-salao");
    expect(permissoes).not.toContain("inventory-costs");
  });

  test("periodo invalido: 400 e nada consultado", async () => {
    const r = await request(app).get("/analise/consumo?inicio=2026-10-13&fim=2026-09-14");
    expect(r.status).toBe(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test("prato vendido consome a ficha do salao, convertida de G para KG", async () => {
    const r = await request(app).get("/analise/consumo" + QS);
    expect(r.status).toBe(200);
    // 100 porcoes x 200 G = 20 KG
    expect(r.body.insumos).toEqual([expect.objectContaining({ insumoId: "p-carne", insumo: "CARNE", unidade: "KG", consumo: 20 })]);
    expect(r.body.cobertura).toMatchObject({ receitaTotal: 5000, receitaCoberta: 5000, pct: 1 });
  });

  test("so le pratos ativos do salao que nao sao ficha de producao, e so os itens do cardapio do salao", async () => {
    await request(app).get("/analise/consumo" + QS);
    const consulta = db.dish.findMany.mock.calls[0][0];
    expect(consulta.where).toEqual({ isActive: true, fichaDeProducao: false, OR: [{ menu: "CARDAPIO" }, { alsoMenu: "CARDAPIO" }] });
    expect(consulta.select.items.where).toEqual({ menu: "CARDAPIO" });
  });

  test("busca a ficha de producao usada como ingrediente e expande ate o produto", async () => {
    // Nhoque leva 250 G de massa; a massa rende 10 KG e leva 6 KG de farinha.
    const nhoque = pratoDb({
      id: "nhoque", name: "Nhoque",
      items: [{ menu: "CARDAPIO", productId: null, componentDishId: "massa", quantity: dec(250), unit: "G", wasteFactor: dec(0), product: null }]
    });
    const massa = {
      id: "massa", name: "Massa de nhoque", menu: "CARDAPIO", yieldQty: dec(10), yieldUnit: "KG",
      items: [{ menu: "CARDAPIO", productId: "p-farinha", componentDishId: null, quantity: dec(6), unit: "KG", wasteFactor: dec(0), product: { name: "FARINHA", unit: "KG", stockUnit: "KG", conversions: [] } }]
    };
    db.dish.findMany.mockResolvedValueOnce([nhoque]).mockResolvedValueOnce([massa]);
    db.agileProdutoPrato.findMany.mockResolvedValue([{ productCode: "100", dishId: "nhoque" }]);

    const r = await request(app).get("/analise/consumo" + QS);
    expect(r.status).toBe(200);
    expect(db.dish.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["massa"] } });
    // 100 porcoes x 250 G = 25 KG de massa = 2,5 receitas = 15 KG de farinha
    expect(r.body.insumos).toEqual([expect.objectContaining({ insumoId: "p-farinha", consumo: 15 })]);
  });

  test("bebida de revenda vinculada consome o insumo, na unidade de estoque", async () => {
    db.$queryRaw.mockResolvedValue([produtoSql({ codigo: "C1", nome: "CHOPE", categoria: "BEBIDAS", quantidade: dec(20), valor: dec(400) })]);
    db.agileProdutoPrato.findMany.mockResolvedValue([]);
    db.agileProdutoInsumo.findMany.mockResolvedValue([
      { productCode: "C1", insumoId: "p-chope", quantity: dec(300), unit: "ML", insumo: { name: "CHOPE", isActive: true, unit: "L", stockUnit: "L", conversions: [] } }
    ]);
    const r = await request(app).get("/analise/consumo" + QS);
    expect(r.body.insumos).toEqual([expect.objectContaining({ insumoId: "p-chope", unidade: "L", consumo: 6, consumoRevenda: 6 })]);
  });

  test("insumo desativado depois do vinculo nao entra: a venda cai em sem vinculo", async () => {
    db.$queryRaw.mockResolvedValue([produtoSql({ codigo: "C1", nome: "CHOPE", categoria: "BEBIDAS", valor: dec(400) })]);
    db.agileProdutoPrato.findMany.mockResolvedValue([]);
    db.agileProdutoInsumo.findMany.mockResolvedValue([
      { productCode: "C1", insumoId: "p-chope", quantity: dec(300), unit: "ML", insumo: { name: "CHOPE", isActive: false, unit: "L", stockUnit: "L", conversions: [] } }
    ]);
    const r = await request(app).get("/analise/consumo" + QS);
    expect(r.body.insumos).toEqual([]);
    expect(r.body.semVinculo[0]).toMatchObject({ codigo: "C1", motivo: "SEM_VINCULO" });
  });

  test("falha no banco: 500 com mensagem, sem vazar detalhe", async () => {
    db.$queryRaw.mockRejectedValue(new Error("senha=segredo"));
    const r = await request(app).get("/analise/consumo" + QS);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});
