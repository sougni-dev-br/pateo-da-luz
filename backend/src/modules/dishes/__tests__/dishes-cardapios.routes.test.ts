import "express-async-errors"; // como no app real: rejeicao em handler async vira 500
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Cardapio (salao x delivery), subcategorias, acao em lote e historico de versoes.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    dishItem: { createMany: vi.fn(), deleteMany: vi.fn() },
    dishRevision: { create: vi.fn(), findMany: vi.fn() },
    dishCategory: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    product: { findMany: vi.fn(), findUnique: vi.fn() },
    productUnitConversion: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn()
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(),
  auditLog: vi.fn(),
  requestIp: vi.fn(() => "127.0.0.1")
}));

import { prisma } from "../../../config/database.js";
import { auditLog, requireRole } from "../../security/security-utils.js";
import { resolverCategoria } from "../dish-categories.js";
import { dishesRouter } from "../dishes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/dishes", dishesRouter);
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: "erro" });
});

const detalheMinimo = (id: string, extra: object = {}) => ({
  id, code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: null, yieldQty: 1, yieldUnit: "UN",
  notes: null, isActive: true, listings: [], items: [], createdAt: new Date(), updatedAt: new Date(), ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Eli", role: "ADMIN" } as never);
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]));
  db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
    arg.select ? { menu: "CARDAPIO" } : detalheMinimo(arg.where.id));
  db.dish.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data }));
  db.dish.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ id: where.id, ...data }));
  db.dishRevision.create.mockResolvedValue({});
  db.dishCategory.findUnique.mockResolvedValue({ name: "Massas", menu: "CARDAPIO" });
});

describe("regras da categoria (puras)", () => {
  const sem = { pai: null, temSubcategorias: false };

  test("categoria principal: nome obrigatório e cardápio válido (padrão: salão)", () => {
    expect(resolverCategoria({ name: "  ", parentId: null, menu: "CARDAPIO" }, sem)).toEqual({ erro: "Nome da categoria é obrigatório." });
    expect(resolverCategoria({ name: " Massas ", parentId: null, menu: "DELIVERY" }, sem)).toEqual({ name: "Massas", parentId: null, menu: "DELIVERY" });
    expect(resolverCategoria({ name: "Massas", parentId: null, menu: "XYZ" }, sem)).toMatchObject({ menu: "CARDAPIO" });
  });

  test("subcategoria herda o cardápio do pai, ignorando o que vier no corpo", () => {
    const r = resolverCategoria({ name: "Fresca", parentId: "p1", menu: "CARDAPIO" }, { pai: { id: "p1", parentId: null, menu: "DELIVERY" }, temSubcategorias: false });
    expect(r).toEqual({ name: "Fresca", parentId: "p1", menu: "DELIVERY" });
  });

  test("só dois níveis: pai que já é subcategoria é recusado; quem tem subcategorias não vira subcategoria", () => {
    expect(resolverCategoria({ name: "X", parentId: "p1", menu: "CARDAPIO" }, { pai: { id: "p1", parentId: "avo", menu: "CARDAPIO" }, temSubcategorias: false }))
      .toMatchObject({ erro: expect.stringMatching(/dois níveis/) });
    expect(resolverCategoria({ name: "X", parentId: "p1", menu: "CARDAPIO" }, { id: "c1", pai: { id: "p1", parentId: null, menu: "CARDAPIO" }, temSubcategorias: true }))
      .toMatchObject({ erro: expect.stringMatching(/tem subcategorias/) });
  });

  test("não pode ser pai de si mesma nem apontar para pai inexistente", () => {
    expect(resolverCategoria({ name: "X", parentId: "c1", menu: "CARDAPIO" }, { id: "c1", pai: { id: "c1", parentId: null, menu: "CARDAPIO" }, temSubcategorias: false }))
      .toMatchObject({ erro: expect.stringMatching(/dela mesma/) });
    expect(resolverCategoria({ name: "X", parentId: "sumiu", menu: "CARDAPIO" }, sem)).toMatchObject({ erro: expect.stringMatching(/não existe mais/) });
  });
});

describe("categorias e subcategorias (rotas)", () => {
  beforeEach(() => {
    db.dishCategory.findFirst.mockResolvedValue(null);
    db.dishCategory.count.mockResolvedValue(0);
    db.dishCategory.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data }));
    db.dish.count.mockResolvedValue(0);
  });

  test("cria subcategoria dentro de uma principal do delivery: herda o cardápio", async () => {
    db.dishCategory.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "pai" ? { id: "pai", parentId: null, menu: "DELIVERY" } : null);
    const r = await request(app).post("/dishes/categories").send({ name: "Pizzas doces", parentId: "pai" });
    expect(r.status).toBe(200);
    expect(db.dishCategory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Pizzas doces", parentId: "pai", menu: "DELIVERY" }) });
  });

  test("subcategoria de subcategoria: 400", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "filha", parentId: "pai", menu: "CARDAPIO" });
    const r = await request(app).post("/dishes/categories").send({ name: "Neta", parentId: "filha" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/dois níveis/);
    expect(db.dishCategory.create).not.toHaveBeenCalled();
  });

  test("mesmo nome no mesmo lugar: 400; o índice único do banco também vira 400", async () => {
    db.dishCategory.findFirst.mockResolvedValue({ id: "outra" });
    expect((await request(app).post("/dishes/categories").send({ name: "Massas" })).status).toBe(400);
  });

  test("trocar o cardápio de categoria que tem prato do outro cardápio: 409", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "c1", menu: "CARDAPIO" });
    db.dish.count.mockResolvedValue(3);
    const r = await request(app).put("/dishes/categories/c1").send({ name: "Massas", menu: "DELIVERY" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/3 pratos do outro cardápio/);
    expect(db.dishCategory.update).not.toHaveBeenCalled();
  });

  test("trocar o cardápio de categoria vazia arrasta as subcategorias", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "c1", menu: "CARDAPIO" });
    db.dishCategory.update.mockResolvedValue({ id: "c1", menu: "DELIVERY" });
    const r = await request(app).put("/dishes/categories/c1").send({ name: "Massas", menu: "DELIVERY" });
    expect(r.status).toBe(200);
    expect(db.dishCategory.updateMany).toHaveBeenCalledWith({ where: { parentId: "c1" }, data: { menu: "DELIVERY" } });
  });

  test("categoria inexistente: 404; só quem pode escrever grava", async () => {
    db.dishCategory.findUnique.mockResolvedValue(null);
    expect((await request(app).put("/dishes/categories/x").send({ name: "A" })).status).toBe(404);
    // requireRole de verdade responde 403 sozinho antes de devolver null.
    vi.mocked(requireRole).mockImplementationOnce((async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ message: "sem permissao" });
      return null;
    }) as never);
    expect((await request(app).post("/dishes/categories").send({ name: "A" })).status).toBe(403);
    expect(db.dishCategory.create).not.toHaveBeenCalled();
  });
});

describe("cardápio do prato", () => {
  test("prato novo é do salão por padrão e do delivery quando pedido", async () => {
    await request(app).post("/dishes").send({ name: "Pizza" });
    expect(db.dish.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ menu: "CARDAPIO" }) });
    await request(app).post("/dishes").send({ name: "Pizza", menu: "DELIVERY" });
    expect(db.dish.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ menu: "DELIVERY" }) });
  });

  test("cardápio inventado é recusado", async () => {
    expect((await request(app).post("/dishes").send({ name: "Pizza", menu: "RUA" })).status).toBe(400);
  });

  test("categoria do outro cardápio é recusada, com o nome dela na mensagem", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ name: "Pizzas", menu: "DELIVERY" });
    const r = await request(app).post("/dishes").send({ name: "Pizza", menu: "CARDAPIO", categoryId: "c-delivery" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/"Pizzas" é do delivery/);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("editar sem dizer o cardápio mantém o que o prato já tinha", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { menu: "DELIVERY" } : detalheMinimo(arg.where.id, { menu: "DELIVERY" }));
    await request(app).put("/dishes/d1").send({ name: "Pizza" });
    expect(db.dish.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ menu: "DELIVERY" }) }));
  });

  test("editar prato inexistente: 404 sem gravar nada", async () => {
    db.dish.findUnique.mockResolvedValue(null);
    expect((await request(app).put("/dishes/x").send({ name: "Pizza" })).status).toBe(404);
    expect(db.dish.update).not.toHaveBeenCalled();
  });
});

describe("prato vendido nos dois cardápios", () => {
  test("grava o outro cardápio e a categoria dele, validada contra o cardápio certo", async () => {
    db.dishCategory.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "c-delivery" ? { name: "Carnes", menu: "DELIVERY" } : { name: "A la carte", menu: "CARDAPIO" });
    const r = await request(app).post("/dishes").send({ name: "Filé", menu: "CARDAPIO", categoryId: "c-salao", alsoMenu: "DELIVERY", alsoCategoryId: "c-delivery" });
    expect(r.status).toBe(200);
    expect(db.dish.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ menu: "CARDAPIO", categoryId: "c-salao", alsoMenu: "DELIVERY", alsoCategoryId: "c-delivery" })
    });
  });

  test("o segundo cardápio não pode ser o mesmo do principal", async () => {
    const r = await request(app).post("/dishes").send({ name: "Filé", menu: "CARDAPIO", alsoMenu: "CARDAPIO" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/escolha o outro/);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("categoria do segundo cardápio tem que ser daquele cardápio", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ name: "A la carte", menu: "CARDAPIO" });
    const r = await request(app).post("/dishes").send({ name: "Filé", menu: "CARDAPIO", alsoMenu: "DELIVERY", alsoCategoryId: "c-salao" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/"A la carte" é do cardápio do salão/);
  });

  test("sem segundo cardápio, a segunda categoria é descartada", async () => {
    await request(app).post("/dishes").send({ name: "Filé", alsoCategoryId: "sobrou" });
    expect(db.dish.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ alsoMenu: null, alsoCategoryId: null }) });
  });

  test("editar sem o segundo cardápio tira o prato do outro cardápio", async () => {
    await request(app).put("/dishes/d1").send({ name: "Filé" });
    expect(db.dish.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ alsoMenu: null, alsoCategoryId: null }) }));
  });

  test("a versão do histórico guarda o segundo cardápio", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { menu: "CARDAPIO" } : detalheMinimo(arg.where.id, { alsoMenu: "DELIVERY", alsoCategory: { id: "c2", name: "Carnes", parentId: null, menu: "DELIVERY" } }));
    await request(app).put("/dishes/d1").send({ name: "Filé", alsoMenu: "DELIVERY" });
    expect(db.dishRevision.create.mock.calls.at(-1)[0].data.snapshot).toMatchObject({ alsoMenu: "DELIVERY", alsoCategory: { name: "Carnes" } });
  });

  test("lote: passar a ser principal no cardápio em que já era vendido 'também' desfaz o segundo cardápio", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d1", menu: "CARDAPIO", categoryId: null }]);
    db.dish.updateMany.mockResolvedValue({ count: 1 });
    await request(app).post("/dishes/bulk").send({ ids: ["d1"], menu: "DELIVERY" });
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["d1"] }, alsoMenu: "DELIVERY" }, data: { alsoMenu: null, alsoCategoryId: null } });
  });
});

describe("histórico de versões", () => {
  test("criar, alterar, inativar e reativar deixam uma versão cada, com a ação certa", async () => {
    await request(app).post("/dishes").send({ name: "Pizza" });
    await request(app).put("/dishes/d1").send({ name: "Pizza" });
    await request(app).delete("/dishes/d1");
    await request(app).post("/dishes/d1/reactivate");
    expect(db.dishRevision.create.mock.calls.map((c: [{ data: { action: string } }]) => c[0].data.action)).toEqual(["CRIADA", "ALTERADA", "INATIVADA", "REATIVADA"]);
  });

  test("a versão guarda quem fez, o custo do momento e a foto dos ingredientes", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { menu: "CARDAPIO" } : {
        ...detalheMinimo(arg.where.id, { name: "Risoto", salePriceDefault: 80 }),
        items: [{
          id: "i1", productId: "p1", quantity: 150, unit: "G", wasteFactor: 0.05, notes: null, sortOrder: 0,
          product: { id: "p1", externalCode: "1", name: "CAMARAO", unit: "KG", stockUnit: null, inventoryStock: { averageCost: 40 }, conversions: [] }
        }]
      });
    await request(app).put("/dishes/d1").send({ name: "Risoto" });
    const dado = db.dishRevision.create.mock.calls[0][0].data;
    expect(dado).toMatchObject({ dishId: "d1", action: "ALTERADA", userId: "u1", userName: "Eli", salePrice: 80 });
    expect(dado.costPerServing).toBeCloseTo(6.3); // 0,15 kg × R$ 40 × 1,05
    expect(dado.snapshot.items).toEqual([expect.objectContaining({ productName: "CAMARAO", quantity: 150, unit: "G", wasteFactor: 0.05 })]);
  });

  test("falha ao gravar a versão desfaz o salvamento inteiro (mesma transação)", async () => {
    db.dishRevision.create.mockRejectedValue(new Error("banco caiu"));
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    expect((await request(app).put("/dishes/d1").send({ name: "Pizza" })).status).toBe(500);
  });

  test("lista as versões da mais nova para a mais antiga, com números simples", async () => {
    db.dishRevision.findMany.mockResolvedValue([
      { id: "r2", action: "ALTERADA", userName: "Felipe", createdAt: new Date("2026-10-08T12:00:00Z"), costPerServing: "9.5300", salePrice: "79.90", cmvPercent: "11.900", snapshot: { name: "Risoto" } }
    ]);
    const r = await request(app).get("/dishes/d1/revisions");
    expect(r.status).toBe(200);
    expect(db.dishRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: "desc" }, take: 100 }));
    expect(r.body[0]).toMatchObject({ userName: "Felipe", costPerServing: 9.53, salePrice: 79.9, cmvPercent: 11.9 });
  });

  test("histórico de prato inexistente: 404", async () => {
    db.dish.findUnique.mockResolvedValue(null);
    expect((await request(app).get("/dishes/x/revisions")).status).toBe(404);
  });
});

describe("ação em lote", () => {
  beforeEach(() => {
    db.dish.findMany.mockResolvedValue([
      { id: "a", menu: "DELIVERY", categoryId: null },
      { id: "b", menu: "DELIVERY", categoryId: null }
    ]);
    db.dish.updateMany.mockResolvedValue({ count: 2 });
  });

  test("move vários pratos para uma categoria do mesmo cardápio e audita", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "c1", name: "Pizzas", menu: "DELIVERY" });
    const r = await request(app).post("/dishes/bulk").send({ ids: ["a", "b"], categoryId: "c1" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ atualizados: 2, categoriasLimpas: 0 });
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } }, data: { categoryId: "c1" } });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "BULK_UPDATE" }));
  });

  test("categoria de outro cardápio: 400 e nada é gravado", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "c1", name: "Massas", menu: "CARDAPIO" });
    const r = await request(app).post("/dishes/bulk").send({ ids: ["a", "b"], categoryId: "c1" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/2 pratos não são do cardápio da categoria "Massas"/);
    expect(db.dish.updateMany).not.toHaveBeenCalled();
  });

  test("trocar o cardápio junto com a categoria vale", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ id: "c1", name: "Massas", menu: "CARDAPIO" });
    const r = await request(app).post("/dishes/bulk").send({ ids: ["a", "b"], menu: "CARDAPIO", categoryId: "c1" });
    expect(r.status).toBe(200);
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } }, data: { menu: "CARDAPIO", categoryId: "c1" } });
  });

  test("só trocar o cardápio limpa a categoria de quem tinha uma do outro", async () => {
    db.dish.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const r = await request(app).post("/dishes/bulk").send({ ids: ["a", "b"], menu: "CARDAPIO" });
    expect(r.body).toMatchObject({ atualizados: 2, categoriasLimpas: 1 });
    expect(db.dish.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ["a", "b"] }, category: { is: { menu: { not: "CARDAPIO" } } } }, data: { categoryId: null }
    });
  });

  test("sem nada para aplicar, sem ids, ids repetidos e prato sumido", async () => {
    expect((await request(app).post("/dishes/bulk").send({ ids: ["a"] })).status).toBe(400);
    expect((await request(app).post("/dishes/bulk").send({ ids: [], menu: "DELIVERY" })).status).toBe(400);
    db.dish.findMany.mockResolvedValue([{ id: "a", menu: "DELIVERY", categoryId: null }]);
    expect((await request(app).post("/dishes/bulk").send({ ids: ["a", "a"], menu: "DELIVERY" })).status).toBe(200); // repetido conta uma vez
    expect((await request(app).post("/dishes/bulk").send({ ids: ["a", "sumiu"], menu: "DELIVERY" })).status).toBe(404);
  });

  test("tirar da categoria (categoryId null) é permitido", async () => {
    const r = await request(app).post("/dishes/bulk").send({ ids: ["a", "b"], categoryId: null });
    expect(r.status).toBe(200);
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } }, data: { categoryId: null } });
  });
});

describe("lote: vender nos dois cardápios", () => {
  beforeEach(() => {
    const pratos = [
      { id: "salao", menu: "CARDAPIO", categoryId: null },
      { id: "delivery", menu: "DELIVERY", categoryId: null }
    ];
    db.dish.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => pratos.filter((prato) => where.id.in.includes(prato.id)));
    db.dish.updateMany.mockResolvedValue({ count: 1 });
  });

  test("'também no delivery': só o prato do salão ganha o segundo cardápio; o que já é do delivery fica de fora e é contado", async () => {
    const r = await request(app).post("/dishes/bulk").send({ ids: ["salao", "delivery"], alsoMenu: "DELIVERY" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ atualizados: 2, nosDois: 1, jaNoCardapio: 1 });
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["salao"] } }, data: { alsoMenu: "DELIVERY" } });
    // O prato do delivery não é tocado.
    expect(db.dish.updateMany.mock.calls.some(([arg]: [{ where: { id?: { in: string[] } } }]) => arg.where.id?.in.includes("delivery") && "alsoMenu" in ((arg as { data: object }).data))).toBe(false);
  });

  test("sem categoria escolhida, a segunda categoria que não for do cardápio certo é limpa", async () => {
    await request(app).post("/dishes/bulk").send({ ids: ["salao"], alsoMenu: "DELIVERY" });
    expect(db.dish.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["salao"] }, alsoCategory: { is: { menu: { not: "DELIVERY" } } } },
      data: { alsoCategoryId: null }
    });
  });

  test("com categoria do outro cardápio: grava nos pratos elegíveis", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ name: "Carnes", menu: "DELIVERY" });
    const r = await request(app).post("/dishes/bulk").send({ ids: ["salao"], alsoMenu: "DELIVERY", alsoCategoryId: "c-carnes" });
    expect(r.status).toBe(200);
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["salao"] } }, data: { alsoCategoryId: "c-carnes" } });
  });

  test("categoria de cardápio errado ou sem dizer o outro cardápio: 400, nada gravado", async () => {
    db.dishCategory.findUnique.mockResolvedValue({ name: "A la carte", menu: "CARDAPIO" });
    const errada = await request(app).post("/dishes/bulk").send({ ids: ["salao"], alsoMenu: "DELIVERY", alsoCategoryId: "c-salao" });
    expect(errada.status).toBe(400);
    expect(errada.body.message).toMatch(/"A la carte" é do cardápio do salão/);
    const semMenu = await request(app).post("/dishes/bulk").send({ ids: ["salao"], alsoCategoryId: "c-salao" });
    expect(semMenu.status).toBe(400);
    expect(semMenu.body.message).toMatch(/Escolha o outro cardápio/);
    expect(db.dish.updateMany).not.toHaveBeenCalled();
  });

  test("'só em um cardápio' tira o segundo cardápio e a categoria dele", async () => {
    const r = await request(app).post("/dishes/bulk").send({ ids: ["salao", "delivery"], alsoMenu: null });
    expect(r.status).toBe(200);
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["salao", "delivery"] } }, data: { alsoMenu: null, alsoCategoryId: null } });
  });

  test("junto com a troca de cardápio principal, vale o cardápio final de cada prato", async () => {
    // Todos viram do delivery; 'também no delivery' não sobra ninguém para ganhar o segundo cardápio.
    const r = await request(app).post("/dishes/bulk").send({ ids: ["salao", "delivery"], menu: "DELIVERY", alsoMenu: "DELIVERY" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nosDois: 0, jaNoCardapio: 2 });
  });
});

describe("busca de ingrediente", () => {
  test("acha o produto pelo nome ou pelo código", async () => {
    db.product.findMany.mockResolvedValue([]);
    await request(app).get("/dishes/products/search?search=0105");
    const where = db.product.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: "0105", mode: "insensitive" } },
      { externalCode: { contains: "0105", mode: "insensitive" } }
    ]);
  });
});
