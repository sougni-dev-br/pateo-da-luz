import "express-async-errors"; // como no app real: rejeicao em handler async vira 500
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Fichas tecnicas: validacao antes de gravar, transacao, codigo repetido e
// reativacao. Banco de mentira — o calculo de custo ja tem teste proprio.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    dishItem: { createMany: vi.fn(), deleteMany: vi.fn() },
    dishCategory: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
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
import { dishesRouter } from "../dishes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/dishes", dishesRouter);
// Erro nao tratado vira 500, como no app real.
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: "erro" });
});

const duplicado = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" });
const referenciaInvalida = () => new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "5" });
const inexistente = () => new Prisma.PrismaClientKnownRequestError("nao achou", { code: "P2025", clientVersion: "5" });

const ingrediente = { productId: "p1", quantity: 150, unit: "G", wasteFactor: 0.05 };
const pratoValido = { name: "  Risoto de camarão ", salePriceDefault: 79.9, yieldQty: 1, yieldUnit: "UN", items: [ingrediente] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", role: "ADMIN" } as never);
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]));
  db.product.findMany.mockResolvedValue([{ id: "p1" }]);
  db.dish.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data }));
  db.dish.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ id: where.id, ...data }));
  db.dishItem.createMany.mockResolvedValue({ count: 1 });
  db.dishItem.deleteMany.mockResolvedValue({ count: 1 });
});

describe("criar prato", () => {
  test("sem nome e recusado e nada e gravado", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, name: "   " });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/nome do prato/i);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("preco de venda negativo e recusado", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, salePriceDefault: -5 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/preco de venda/);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("rendimento zero e recusado", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, yieldQty: 0 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/rendimento/);
  });

  test("ingrediente de produto inexistente nao deixa prato orfao", async () => {
    db.product.findMany.mockResolvedValue([]);
    const r = await request(app).post("/dishes").send(pratoValido);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Produto do ingrediente nao encontrado/);
    // Antes o prato era criado e so depois os ingredientes eram conferidos.
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("quantidade zero num ingrediente e recusada antes de gravar", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: [{ ...ingrediente, quantity: 0 }] });
    expect(r.status).toBe(400);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("grava prato e ingredientes juntos, com nome aparado e preco vazio como nulo", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, salePriceDefault: "", code: " PRAT-001 " });
    expect(r.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.dish.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Risoto de camarão", code: "PRAT-001", salePriceDefault: null, yieldQty: 1, yieldUnit: "UN" })
    });
    expect(db.dishItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ productId: "p1", quantity: 150, unit: "G", wasteFactor: 0.05, sortOrder: 0 })]
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "Dish" }));
  });

  test("codigo repetido responde 409 com o codigo na mensagem", async () => {
    db.$transaction.mockRejectedValue(duplicado());
    const r = await request(app).post("/dishes").send({ ...pratoValido, code: "PRAT-001" });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Já existe um prato com o código "PRAT-001".');
  });

  test("categoria apagada no meio do caminho responde 400 legivel, nao 500", async () => {
    db.$transaction.mockRejectedValue(referenciaInvalida());
    const r = await request(app).post("/dishes").send({ ...pratoValido, categoryId: "c-apagada" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/não existe mais/);
  });

  test("preco so de espacos ou booleano nao vira 0 nem 1", async () => {
    const espacos = await request(app).post("/dishes").send({ ...pratoValido, salePriceDefault: "   " });
    expect(espacos.status).toBe(200);
    expect(db.dish.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ salePriceDefault: null }) });

    const booleano = await request(app).post("/dishes").send({ ...pratoValido, salePriceDefault: true });
    expect(booleano.status).toBe(400);
    const rendimentoBooleano = await request(app).post("/dishes").send({ ...pratoValido, yieldQty: true });
    expect(rendimentoBooleano.status).toBe(400);
  });

  test("falha inesperada continua sendo 500", async () => {
    db.$transaction.mockRejectedValue(new Error("banco caiu"));
    const r = await request(app).post("/dishes").send(pratoValido);
    expect(r.status).toBe(500);
  });
});

describe("editar prato", () => {
  test("prato inexistente responde 404", async () => {
    db.$transaction.mockRejectedValue(inexistente());
    const r = await request(app).put("/dishes/nao-existe").send(pratoValido);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe("Prato não encontrado.");
  });

  test("troca prato e ingredientes na mesma transacao", async () => {
    const r = await request(app).put("/dishes/d1").send(pratoValido);
    expect(r.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.dishItem.deleteMany).toHaveBeenCalledWith({ where: { dishId: "d1" } });
    expect(db.dishItem.createMany).toHaveBeenCalledTimes(1);
  });

  test("sem a lista de ingredientes nao mexe nos ingredientes", async () => {
    const { items: _items, ...semItens } = pratoValido;
    const r = await request(app).put("/dishes/d1").send(semItens);
    expect(r.status).toBe(200);
    expect(db.dishItem.deleteMany).not.toHaveBeenCalled();
  });

  test("ingrediente invalido nao altera o prato", async () => {
    db.product.findMany.mockResolvedValue([]);
    const r = await request(app).put("/dishes/d1").send(pratoValido);
    expect(r.status).toBe(400);
    expect(db.dish.update).not.toHaveBeenCalled();
  });

  test("isActive=false inativa; omitido mantem ativo", async () => {
    await request(app).put("/dishes/d1").send({ ...pratoValido, isActive: false });
    expect(db.dish.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
    await request(app).put("/dishes/d1").send(pratoValido);
    expect(db.dish.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });
});

describe("inativar e reativar", () => {
  test("reativa o prato e registra auditoria", async () => {
    const r = await request(app).post("/dishes/d1/reactivate");
    expect(r.status).toBe(200);
    expect(db.dish.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { isActive: true } });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REACTIVATE", entityId: "d1" }));
  });

  test("reativar prato inexistente responde 404", async () => {
    db.dish.update.mockRejectedValue(inexistente());
    const r = await request(app).post("/dishes/x/reactivate");
    expect(r.status).toBe(404);
  });

  test("inativar prato inexistente responde 404 em vez de 500", async () => {
    db.dish.update.mockRejectedValue(inexistente());
    const r = await request(app).delete("/dishes/x");
    expect(r.status).toBe(404);
  });
});

describe("leitura", () => {
  const produto = {
    id: "p1", externalCode: "001", name: "CAMARAO", unit: "KG", stockUnit: null,
    inventoryStock: { averageCost: 40, currentQuantity: 2 }, conversions: []
  };
  const prato = {
    id: "d1", code: null, name: "Risoto", category: null, salePriceDefault: null, yieldQty: 1, yieldUnit: "UN",
    notes: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    items: [{ id: "i1", productId: "p1", product: produto, quantity: 100, unit: "G", wasteFactor: 0, notes: null, sortOrder: 0 }],
    listings: [
      { id: "l1", channel: "NOVENTA_NOVE", price: 49.9, isActive: true, externalName: "Risoto", lastSeenAt: new Date(), deliveryStore: { nickname: "Pateo Frei Caneca", platform: "NOVENTA_NOVE" } },
      { id: "l2", channel: "NOVENTA_NOVE", price: 60.9, isActive: true, externalName: "Risoto", lastSeenAt: new Date(), deliveryStore: null }
    ]
  };

  test("lista resume os precos praticados nos canais", async () => {
    db.dish.findMany.mockResolvedValue([{ ...prato, listings: prato.listings.map((l) => ({ price: l.price })) }]);
    const r = await request(app).get("/dishes");
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ listingsCount: 2, listingPriceMin: 49.9, listingPriceMax: 60.9, itemsCount: 1 });
  });

  test("prato sem listagem nao inventa faixa de preco", async () => {
    db.dish.findMany.mockResolvedValue([{ ...prato, listings: [] }]);
    const r = await request(app).get("/dishes");
    expect(r.body[0]).toMatchObject({ listingsCount: 0, listingPriceMin: null, listingPriceMax: null });
  });

  test("detalhe traz onde o prato e vendido, com o nome da loja", async () => {
    db.dish.findUnique.mockResolvedValue(prato);
    const r = await request(app).get("/dishes/d1");
    expect(r.status).toBe(200);
    expect(r.body.listings).toEqual([
      expect.objectContaining({ storeName: "Pateo Frei Caneca", price: 49.9 }),
      expect.objectContaining({ storeName: null, price: 60.9 })
    ]);
  });

  test("estoque em UN com peso no nome: a ficha aceita gramas e calcula o custo certo", async () => {
    const farinha = { ...produto, id: "p2", name: "FARINHA TRIGO 5KG", unit: "UN", stockUnit: null, inventoryStock: { averageCost: 25, currentQuantity: 3 } };
    db.dish.findUnique.mockResolvedValue({
      ...prato, listings: [],
      items: [{ id: "i2", productId: "p2", product: farinha, quantity: 500, unit: "G", wasteFactor: 0, notes: null, sortOrder: 0 }]
    });
    const r = await request(app).get("/dishes/d1");
    // 500 g de uma embalagem de 5 kg a R$ 25 = 0,1 UN = R$ 2,50
    expect(r.body.items[0].itemCost).toBeCloseTo(2.5);
    expect(r.body.items[0].issue).toBeNull();
    expect(r.body.items[0].embalagemInferida).toBe("1 UN = 5 KG (lido do nome do produto)");
    expect(r.body.items[0].conversions.filter((c: { inferida?: boolean }) => c.inferida)).toHaveLength(2);
    expect(r.body.custoIncompleto).toBe(false);
  });

  test("a busca de produto já devolve a conversão inferida para a tela prever o custo", async () => {
    db.product.findMany.mockResolvedValue([{ id: "p2", externalCode: "381", name: "FARINHA TRIGO 5KG", unit: "UN", stockUnit: null, inventoryStock: { averageCost: 25 }, conversions: [] }]);
    const r = await request(app).get("/dishes/products/search?search=farinha");
    expect(r.body[0]).toMatchObject({ unit: "UN", embalagemInferida: "1 UN = 5 KG (lido do nome do produto)" });
    expect(r.body[0].conversions).toEqual(expect.arrayContaining([expect.objectContaining({ fromUnit: "G", toUnit: "UN", inferida: true })]));
  });

  test("sem peso no nome e sem cadastro, continua sem conversão (nada é chutado)", async () => {
    const cebola = { ...produto, id: "p3", name: "CEBOLA", unit: "UN", stockUnit: null };
    db.dish.findUnique.mockResolvedValue({ ...prato, listings: [], items: [{ id: "i3", productId: "p3", product: cebola, quantity: 100, unit: "G", wasteFactor: 0, notes: null, sortOrder: 0 }] });
    const r = await request(app).get("/dishes/d1");
    expect(r.body.items[0].itemCost).toBeNull();
    expect(r.body.custoIncompleto).toBe(true);
    expect(r.body.items[0].embalagemInferida).toBeNull();
  });

  test("categorias trazem quantos pratos ativos cada uma tem", async () => {
    db.dishCategory.findMany.mockResolvedValue([{ id: "c1", name: "A la carte", sortOrder: 0, isActive: true, notes: null, _count: { dishes: 12 } }]);
    const r = await request(app).get("/dishes/categories");
    expect(r.body).toEqual([expect.objectContaining({ name: "A la carte", dishesCount: 12 })]);
    expect(r.body[0]._count).toBeUndefined();
  });
});
