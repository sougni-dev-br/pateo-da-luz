import "express-async-errors"; // como no app real: rejeicao em handler async vira 500
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Fichas tecnicas: validacao antes de gravar, transacao, codigo repetido e
// reativacao. Banco de mentira — o calculo de custo ja tem teste proprio.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    wasteEntry: { groupBy: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    dishRevision: { create: vi.fn(), findMany: vi.fn() },
    dishItem: { createMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    dishCategory: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    product: { findMany: vi.fn(), findUnique: vi.fn() },
    productUnitConversion: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn(),
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

// Detalhe minimo de um prato: o que carregarDetalhe precisa para montar a resposta e a versao do historico.
const detalheMinimo = (id: string) => ({
  id, code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: null, yieldQty: 1, yieldUnit: "UN",
  notes: null, isActive: true, listings: [], items: [], createdAt: new Date(), updatedAt: new Date()
});

beforeEach(() => {
  vi.clearAllMocks();
  db.dishItem.findMany.mockResolvedValue([]);
  db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
    arg.select ? { menu: "CARDAPIO", yieldQty: 1, yieldUnit: "UN" } : detalheMinimo(arg.where.id));
  db.dishRevision.create.mockResolvedValue({});
  db.dishCategory.findUnique.mockResolvedValue({ name: "A la carte", menu: "CARDAPIO" });
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
    expect(db.dishItem.deleteMany).toHaveBeenCalledWith({ where: { dishId: "d1", menu: "CARDAPIO" } });
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

describe("conversão informada na ficha", () => {
  const abacaxi = { id: "p9", name: "ABACAXI", unit: "UN", stockUnit: null };
  const gravadas = [
    { fromUnit: "UN", toUnit: "G", factor: 1200 },
    { fromUnit: "UN", toUnit: "KG", factor: 1.2 }
  ];

  // 1ª chamada de findMany: linhas existentes (checagem de conflito); 2ª: o que ficou gravado.
  function existentes(linhas: object[]) {
    db.productUnitConversion.findMany.mockReset();
    db.productUnitConversion.findMany.mockResolvedValueOnce(linhas).mockResolvedValue(gravadas);
  }

  beforeEach(() => {
    db.product.findUnique.mockResolvedValue(abacaxi);
    db.productUnitConversion.deleteMany.mockResolvedValue({ count: 0 });
    db.productUnitConversion.createMany.mockResolvedValue({ count: 2 });
    existentes([]);
  });

  test("1 UN = 1200 g grava estoque→g e estoque→kg, na direção exata, e devolve as conversões", async () => {
    const r = await request(app).post("/dishes/products/p9/conversions").send({ unit: "g", amount: 1200 });
    expect(r.status).toBe(200);
    expect(db.productUnitConversion.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ productId: "p9", fromUnit: "UN", toUnit: "G", factor: 1200 }),
        expect.objectContaining({ productId: "p9", fromUnit: "UN", toUnit: "KG", factor: 1.2 })
      ]
    });
    expect(r.body.conversions).toHaveLength(2);
    expect(r.body.embalagemInferida).toBeNull();
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPSERT_CONVERSION", entityId: "p9" }));
  });

  test("conversão cadastrada que diverge: 409 com aviso, sem gravar nada", async () => {
    existentes([{ id: "c1", fromUnit: "KG", toUnit: "UN", factor: 0.2, isActive: true }]); // 1 UN = 5 kg
    const r = await request(app).post("/dishes/products/p9/conversions").send({ unit: "G", amount: 4800 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/já tem conversão cadastrada/);
    expect(r.body.message).toMatch(/compras e a contagem/);
    expect(db.productUnitConversion.createMany).not.toHaveBeenCalled();
    expect(db.productUnitConversion.deleteMany).not.toHaveBeenCalled();
  });

  test("com replace, troca: apaga as antigas da grandeza (inclusive grafias e inativas) e grava as novas", async () => {
    existentes([
      { id: "c1", fromUnit: "KG", toUnit: "UN", factor: 0.2, isActive: true },
      { id: "c2", fromUnit: "GR", toUnit: "UND", factor: 0.0002, isActive: false },
      { id: "c3", fromUnit: "CX", toUnit: "UN", factor: 12, isActive: true } // outra grandeza: fica
    ]);
    const r = await request(app).post("/dishes/products/p9/conversions").send({ unit: "G", amount: 4800, replace: true });
    expect(r.status).toBe(200);
    expect(db.productUnitConversion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] } } });
    expect(db.productUnitConversion.createMany).toHaveBeenCalledTimes(1);
  });

  test("conversão já cadastrada com o mesmo valor não é conflito", async () => {
    existentes([{ id: "c1", fromUnit: "UN", toUnit: "G", factor: 1200, isActive: true }]);
    const r = await request(app).post("/dishes/products/p9/conversions").send({ unit: "G", amount: 1200 });
    expect(r.status).toBe(200);
  });

  test("unidade fora de g/kg/ml/l, igual à do estoque ou da mesma grandeza é recusada sem gravar", async () => {
    expect((await request(app).post("/dishes/products/p9/conversions").send({ unit: "colher", amount: 10 })).status).toBe(400);
    expect((await request(app).post("/dishes/products/p9/conversions").send({ unit: "UN", amount: 10 })).status).toBe(400);
    db.product.findUnique.mockResolvedValue({ id: "p8", name: "FRANGO", unit: "KG", stockUnit: null });
    expect((await request(app).post("/dishes/products/p8/conversions").send({ unit: "G", amount: 1000 })).status).toBe(400);
    expect(db.productUnitConversion.createMany).not.toHaveBeenCalled();
  });

  test("quantidade zero, negativa, ausente, gigante ou minúscula é recusada", async () => {
    for (const amount of [0, -5, undefined, "abc", 5_000_000, 0.0000001]) {
      const r = await request(app).post("/dishes/products/p9/conversions").send({ unit: "G", amount });
      expect(r.status).toBe(400);
    }
    expect(db.productUnitConversion.createMany).not.toHaveBeenCalled();
  });

  test("produto inexistente responde 404", async () => {
    db.product.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/dishes/products/x/conversions").send({ unit: "G", amount: 10 })).status).toBe(404);
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
      { id: "l1", channel: "NOVENTA_NOVE", price: 49.9, isActive: true, externalItemId: "9001", externalName: "Risoto", lastSeenAt: new Date(), deliveryStore: { nickname: "Pateo Frei Caneca", platform: "NOVENTA_NOVE" } },
      { id: "l2", channel: "NOVENTA_NOVE", price: 60.9, isActive: true, externalItemId: "manual:d1", externalName: "Risoto", lastSeenAt: new Date(), deliveryStore: null }
    ]
  };

  test("lista resume os precos praticados nos canais", async () => {
    db.dish.findMany.mockResolvedValue([{
      ...prato,
      listings: prato.listings.map((l) => ({ price: l.price, channel: l.channel, deliveryStoreId: l.deliveryStore ? "s1" : null, deliveryStore: l.deliveryStore ? { nickname: l.deliveryStore.nickname } : null }))
    }]);
    const r = await request(app).get("/dishes");
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ listingsCount: 2, listingPriceMin: 49.9, listingPriceMax: 60.9, itemsCount: 1 });
    // O preço em cada loja vai junto: é com ele que a tela calcula o CMV de cada prato em cada lugar.
    expect(r.body[0].canais).toEqual([
      { channel: "NOVENTA_NOVE", deliveryStoreId: "s1", storeName: "Pateo Frei Caneca", price: 49.9 },
      { channel: "NOVENTA_NOVE", deliveryStoreId: null, storeName: null, price: 60.9 }
    ]);
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
      expect.objectContaining({ storeName: "Pateo Frei Caneca", price: 49.9, manual: false }),
      expect.objectContaining({ storeName: null, price: 60.9, manual: true })
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
    db.dishCategory.findMany.mockResolvedValue([{ id: "c1", name: "A la carte", sortOrder: 0, isActive: true, notes: null, _count: { dishes: 12, alsoDishes: 2 } }]);
    const r = await request(app).get("/dishes/categories");
    expect(r.body).toEqual([expect.objectContaining({ name: "A la carte", dishesCount: 14 })]);
    expect(r.body[0]._count).toBeUndefined();
  });
});

describe("pratos aguardando ficha (criados pelo desperdício)", () => {
  test("aguardando primeiro, o que mais saiu na frente; depois as que já têm ficha", async () => {
    db.dish.findMany.mockResolvedValue([
      { id: "a", name: "Farofa", yieldUnit: "KG", fichaPendente: true, pendenteDesde: new Date("2026-10-01T12:00:00Z"), pendentePorId: "u1", pendenteObservacao: null, fichaConcluidaEm: null },
      { id: "c", name: "Arroz de forno", yieldUnit: "KG", fichaPendente: false, pendenteDesde: new Date("2026-09-01T12:00:00Z"), pendentePorId: "u1", pendenteObservacao: null, fichaConcluidaEm: new Date("2026-09-10T12:00:00Z") },
      { id: "b", name: "Purê de batata", yieldUnit: "KG", fichaPendente: true, pendenteDesde: new Date("2026-10-05T12:00:00Z"), pendentePorId: "u2", pendenteObservacao: "leva manteiga", fichaConcluidaEm: null },
    ]);
    db.wasteEntry.groupBy.mockResolvedValue([
      { dishId: "a", _count: { _all: 1 }, _sum: { quantity: 2 }, _max: { occurredOn: new Date("2026-10-02T00:00:00Z") } },
      { dishId: "b", _count: { _all: 4 }, _sum: { quantity: 9.5 }, _max: { occurredOn: new Date("2026-10-10T00:00:00Z") } },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "u1", name: "Ana" }, { id: "u2", name: "Beto" }]);

    const r = await request(app).get("/dishes/buffet");
    expect(r.status).toBe(200);
    expect(r.body.map((p: { name: string }) => p.name)).toEqual(["Purê de batata", "Farofa", "Arroz de forno"]);
    expect(r.body[0]).toMatchObject({ pending: true, requestedBy: "Beto", notes: "leva manteiga", wasteEntries: 4, wasteQuantity: 9.5, unit: "KG" });
    expect(r.body[2]).toMatchObject({ pending: false, wasteEntries: 0 });
    expect(r.body[2].completedAt).toBeTruthy();
    expect(db.dish.findMany.mock.calls[0][0].where).toEqual({ fichaDeBuffet: true });
    expect(db.wasteEntry.groupBy.mock.calls[0][0].where).toMatchObject({ cancelledAt: null });
  });

  test("sem preparações de buffet devolve lista vazia sem consultar o desperdício", async () => {
    db.dish.findMany.mockResolvedValue([]);
    const r = await request(app).get("/dishes/buffet");
    expect(r.body).toEqual([]);
    expect(db.wasteEntry.groupBy).not.toHaveBeenCalled();
  });

  test("a lista de pratos nunca traz preparação de buffet (não é vendida)", async () => {
    db.dish.findMany.mockResolvedValue([]);
    await request(app).get("/dishes?showInactive=true");
    expect(db.dish.findMany.mock.calls[0][0].where).toMatchObject({ fichaDeBuffet: false });
  });

  test("salvar a ficha completa valora o desperdício sem valor e informa quantos", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    db.dish.update.mockResolvedValue({ id: "d1" });
    db.dish.updateMany.mockResolvedValue({ count: 1 });
    db.wasteEntry.findMany.mockResolvedValue([{ id: "w1", quantity: 2, unit: "UN" }]);
    // carregarDetalhe lê o prato: devolve uma ficha com custo conhecido (1 ingrediente, 10 por porção).
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { menu: "CARDAPIO", yieldQty: 1, yieldUnit: "UN" } : {
        ...detalheMinimo(arg.where.id),
        items: [{ id: "i1", menu: "CARDAPIO", productId: "p1", quantity: 1, unit: "UN", wasteFactor: 0, sortOrder: 0, product: { id: "p1", name: "Batata", unit: "UN", stockUnit: "UN", externalCode: null, inventoryStock: { averageCost: 10, currentQuantity: 5 }, conversions: [] } }],
      });
    const r = await request(app).put("/dishes/d1").send(pratoValido);
    expect(r.status).toBe(200);
    expect(r.body.desperdicio).toMatchObject({ completa: true, revalorizados: 1, concluiuPendencia: true });
    expect(db.wasteEntry.update).toHaveBeenCalled();
  });

  test("se a conclusão falha, a ficha continua salva (200) e o erro vai para o log", async () => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    db.dish.update.mockResolvedValue({ id: "d1" });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) => {
      if (arg.select) return { menu: "CARDAPIO" };
      return detalheMinimo(arg.where.id);
    });
    db.wasteEntry.findMany.mockRejectedValue(new Error("banco fora"));
    const r = await request(app).put("/dishes/d1").send(pratoValido);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe("d1");
    erro.mockRestore();
  });
});

describe("ficha de produção como ingrediente (ficha dentro de ficha)", () => {
  const fichaDeBaixo = { id: "massa", name: "Nhoque - Massa", yieldUnit: "UN", fichaDeProducao: true, items: [] as Array<{ componentDishId: string | null }> };
  const itemFicha = { componentDishId: "massa", quantity: 1, unit: "UN" };

  beforeEach(() => {
    // O validador consulta as fichas pedidas por id (nome, unidade de rendimento e os ingredientes que são ficha).
    db.dish.findMany.mockImplementation(async (arg: { where: { id?: { in?: string[] } } }) => (arg.where.id?.in ?? []).includes("massa") ? [fichaDeBaixo] : []);
  });

  test("grava o ingrediente-ficha sem produto, com a ficha de baixo no lugar", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: [ingrediente, itemFicha] });
    expect(r.status).toBe(200);
    expect(db.dishItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ productId: "p1", componentDishId: null }),
        expect.objectContaining({ productId: null, componentDishId: "massa", quantity: 1, unit: "UN" }),
      ]
    });
  });

  test("ingrediente é produto OU ficha: os dois juntos ou nenhum dos dois é recusado", async () => {
    const dois = await request(app).post("/dishes").send({ ...pratoValido, items: [{ ...itemFicha, productId: "p1" }] });
    expect(dois.status).toBe(400);
    const nenhum = await request(app).post("/dishes").send({ ...pratoValido, items: [{ quantity: 1, unit: "UN" }] });
    expect(nenhum.status).toBe(400);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("ficha de baixo que não existe é recusada antes de gravar", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: [{ ...itemFicha, componentDishId: "fantasma" }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Ficha de produção do ingrediente não encontrada/);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("unidade que não é a de rendimento da ficha (g de uma ficha que rende em UN) é recusada com a explicação", async () => {
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: [{ ...itemFicha, unit: "G" }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/rende em UN/);
  });

  test("editar: uma ficha não pode ter a si mesma como ingrediente", async () => {
    const r = await request(app).put("/dishes/massa").send({ ...pratoValido, items: [itemFicha] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/a si mesma/);
    expect(db.dishItem.createMany).not.toHaveBeenCalled();
  });

  test("editar: ciclo (a ficha escolhida já usa esta) é recusado", async () => {
    db.dish.findMany.mockImplementation(async (arg: { where: { id?: { in?: string[] } } }) =>
      (arg.where.id?.in ?? []).includes("massa") ? [{ ...fichaDeBaixo, items: [{ componentDishId: "d1" }] }] : []);
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, items: [itemFicha] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/já usa esta ficha/);
  });
});

describe("busca de fichas para usar como ingrediente", () => {
  test("volta no formato da busca de produtos, com a unidade de rendimento e o custo de uma unidade", async () => {
    db.dish.findMany.mockImplementation(async (arg: { select?: { id?: boolean } }) =>
      arg.select?.id && !("name" in (arg.select ?? {})) ? [{ id: "massa" }] : [{
        id: "massa", name: "Nhoque - Massa", code: null, menu: "DELIVERY", alsoMenu: null, yieldQty: 12, yieldUnit: "UN",
        items: [{ menu: "DELIVERY", quantity: 1000, unit: "G", wasteFactor: 0, componentDishId: null, product: { id: "p", externalCode: null, name: "FARINHA", unit: "KG", stockUnit: "KG", inventoryStock: { averageCost: 12, currentQuantity: 1 }, conversions: [] } }]
      }]);
    const r = await request(app).get("/dishes/fichas/search?search=nhoq&exclude=outro");
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ id: "massa", name: "Nhoque - Massa", unit: "UN", averageCost: 1, kind: "FICHA", incompleta: false });
    const consulta = db.dish.findMany.mock.calls[0][0];
    expect(consulta.where.id).toEqual({ not: "outro" });
    expect(JSON.stringify(consulta.where)).toContain("nhoq");
    // Prato vendido não é oferecido como ingrediente: só ficha de produção.
    expect(consulta.where.fichaDeProducao).toBe(true);
  });
});

describe("sugestões de ficha de produção para o prato", () => {
  test("acha a massa copiada à mão e devolve o que trocar", async () => {
    db.dish.findUnique.mockImplementation(async () => ({ id: "prato", menu: "DELIVERY", items: [
      { id: "a", menu: "DELIVERY", productId: "farinha", componentDishId: null, quantity: 83.3333, unit: "G" },
      { id: "b", menu: "DELIVERY", productId: "batata", componentDishId: null, quantity: 83.3333, unit: "G" },
      { id: "c", menu: "DELIVERY", productId: "creme", componentDishId: null, quantity: 150, unit: "G" },
    ] }));
    db.dish.findMany.mockResolvedValue([{ id: "massa", name: "Nhoque - Massa", menu: "DELIVERY", yieldQty: 12, yieldUnit: "UN", items: [
      { menu: "DELIVERY", productId: "farinha", quantity: 1000, unit: "G" }, { menu: "DELIVERY", productId: "batata", quantity: 1000, unit: "G" },
    ] }]);
    const r = await request(app).get("/dishes/prato/sugestoes-de-ficha");
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ componentDishId: "massa", name: "Nhoque - Massa", quantity: 1, unit: "UN", itemIds: ["a", "b"] });
    // O custo da ficha de baixo vem junto (aqui a ficha de mentira não tem produtos, então fica incompleta e sem custo).
    expect(r.body[0]).toHaveProperty("unitCost");
    expect(r.body[0]).toHaveProperty("incompleta");
  });

  test("prato que não existe é 404", async () => {
    db.dish.findUnique.mockResolvedValue(null);
    expect((await request(app).get("/dishes/x/sugestoes-de-ficha")).status).toBe(404);
  });

  test("ficha que já usa outra ficha não entra na comparação", async () => {
    db.dish.findUnique.mockImplementation(async () => ({ id: "prato", menu: "DELIVERY", items: [{ id: "a", menu: "DELIVERY", productId: "farinha", componentDishId: null, quantity: 100, unit: "G" }, { id: "b", menu: "DELIVERY", productId: "x", componentDishId: null, quantity: 1, unit: "UN" }] }));
    db.dish.findMany.mockResolvedValue([{ id: "mista", name: "Mista", menu: "DELIVERY", yieldQty: 1, yieldUnit: "UN", items: [{ menu: "DELIVERY", productId: "farinha", quantity: 100, unit: "G" }, { menu: "DELIVERY", productId: null, quantity: 1, unit: "UN" }] }]);
    expect((await request(app).get("/dishes/prato/sugestoes-de-ficha")).body).toEqual([]);
  });
});

describe("ficha de produção x prato vendido", () => {
  const producao = { name: "Nhoque - Massa", yieldQty: 12, yieldUnit: "UN", items: [ingrediente] };

  test("criar ficha de produção: sem preço, categoria nem segundo cardápio, mesmo que a tela mande", async () => {
    const r = await request(app).post("/dishes").send({ ...producao, fichaDeProducao: true, salePriceDefault: 40, categoryId: "c1", alsoMenu: "DELIVERY", alsoCategoryId: "c2", alsoItems: [ingrediente] });
    expect(r.status).toBe(200);
    expect(db.dish.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fichaDeProducao: true, salePriceDefault: null, categoryId: null, alsoMenu: null, alsoCategoryId: null })
    });
    // Só a lista principal é gravada.
    expect(db.dishItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  test("prato comum nasce como prato vendido", async () => {
    await request(app).post("/dishes").send(pratoValido);
    expect(db.dish.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fichaDeProducao: false }) });
  });

  test("a lista de pratos não traz ficha de produção, e ?tipo=producao traz só elas", async () => {
    db.dish.findMany.mockResolvedValue([]);
    await request(app).get("/dishes");
    expect(db.dish.findMany.mock.calls[0][0].where).toMatchObject({ fichaDeProducao: false });
    db.dish.findMany.mockClear();
    await request(app).get("/dishes?tipo=producao");
    expect(db.dish.findMany.mock.calls[0][0].where).toMatchObject({ fichaDeProducao: true });
  });

  test("prato vendido não entra como ingrediente de outra ficha", async () => {
    db.dish.findMany.mockImplementation(async (arg: { where: { id?: { in?: string[] } } }) =>
      (arg.where.id?.in ?? []).includes("massa") ? [{ id: "massa", name: "Nhoque ao molho", yieldUnit: "UN", fichaDeProducao: false, items: [] }] : []);
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: [{ componentDishId: "massa", quantity: 1, unit: "UN" }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/prato vendido, não uma ficha de produção/);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("editar: ficha de produção que já é ingrediente de outra não vira prato vendido", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { yieldQty: 1, yieldUnit: "UN", menu: "CARDAPIO", alsoMenu: null, alsoCategoryId: null, fichaDeProducao: true } : detalheMinimo(arg.where.id));
    db.dishItem.count.mockResolvedValue(2);
    const r = await request(app).put("/dishes/massa").send({ ...producao, fichaDeProducao: false });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/ingrediente de 2 itens de outras fichas/);
    expect(db.dish.update).not.toHaveBeenCalled();
  });

  test("editar: prato com preço nos canais não vira ficha de produção", async () => {
    db.dishListing = { count: vi.fn().mockResolvedValue(1) };
    db.agileProdutoPrato = { count: vi.fn().mockResolvedValue(0) };
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, fichaDeProducao: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/preço nos canais/);
    expect(db.dish.update).not.toHaveBeenCalled();
  });

  test("editar sem mandar o tipo (tela antiga) mantém a ficha de produção como está e continua sem preço", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { yieldQty: 1, yieldUnit: "UN", menu: "CARDAPIO", alsoMenu: null, alsoCategoryId: null, fichaDeProducao: true, yieldUnit: "UN" } : detalheMinimo(arg.where.id));
    const r = await request(app).put("/dishes/massa").send({ ...producao, salePriceDefault: 40 });
    expect(r.status).toBe(200);
    expect(db.dish.update.mock.calls[0][0].data).toMatchObject({ fichaDeProducao: true, salePriceDefault: null, categoryId: null });
  });
});

describe("ficha de produção em uso", () => {
  const comoProducao = (extra: object = {}) => async (arg: { where: { id: string }; select?: object }) =>
    arg.select
      ? { menu: "CARDAPIO", alsoMenu: null, alsoCategoryId: null, fichaDeProducao: true, fichaDeBuffet: false, yieldUnit: "UN", ...extra }
      : { ...detalheMinimo(arg.where.id), fichaDeProducao: true };
  const producao = { name: "Nhoque - Massa", yieldQty: 12, yieldUnit: "UN", items: [ingrediente] };

  test("inativar uma ficha de produção que é ingrediente de outra é recusado, com a contagem", async () => {
    db.dishItem.count.mockResolvedValueOnce(3);
    const r = await request(app).delete("/dishes/massa");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/ingrediente de 3 itens de outras fichas/);
    expect(db.dish.update).not.toHaveBeenCalled();
  });

  test("trocar a unidade de rendimento de uma ficha em uso é recusado; sem uso, passa", async () => {
    db.dish.findUnique.mockImplementation(comoProducao());
    db.dishItem.count.mockResolvedValue(2);
    const recusada = await request(app).put("/dishes/massa").send({ ...producao, yieldUnit: "KG" });
    expect(recusada.status).toBe(400);
    expect(recusada.body.message).toMatch(/não dá para trocar a unidade de rendimento/);
    db.dishItem.count.mockResolvedValue(0);
    const livre = await request(app).put("/dishes/massa").send({ ...producao, yieldUnit: "KG" });
    expect(livre.status).toBe(200);
  });

  test("mudar só a quantidade do rendimento de uma ficha em uso é permitido", async () => {
    db.dish.findUnique.mockImplementation(comoProducao());
    db.dishItem.count.mockResolvedValue(2);
    const r = await request(app).put("/dishes/massa").send({ ...producao, yieldQty: 10 });
    expect(r.status).toBe(200);
  });

  test("o detalhe da ficha de produção diz em quais fichas ela é usada, sem repetir e em ordem", async () => {
    db.dish.findUnique.mockImplementation(comoProducao());
    db.dishItem.findMany.mockResolvedValue([
      { dish: { id: "b", name: "Nhoque ao molho" } }, { dish: { id: "a", name: "Gnocchi 4 queijos" } }, { dish: { id: "b", name: "Nhoque ao molho" } },
    ]);
    const r = await request(app).get("/dishes/massa");
    expect(r.status).toBe(200);
    expect(r.body.usadaEm).toEqual([{ id: "a", name: "Gnocchi 4 queijos" }, { id: "b", name: "Nhoque ao molho" }]);
  });

  test("preparação do buffet do desperdício não vira ficha de produção", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { yieldQty: 1, yieldUnit: "UN", menu: "CARDAPIO", alsoMenu: null, alsoCategoryId: null, fichaDeProducao: false, fichaDeBuffet: true, yieldUnit: "UN" } : detalheMinimo(arg.where.id));
    const r = await request(app).put("/dishes/pure").send({ ...producao, fichaDeProducao: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/buffet/);
  });

  test("mais de 300 ingredientes é recusado antes de consultar o banco", async () => {
    const muitos = Array.from({ length: 301 }, (_, i) => ({ productId: `p${i}`, quantity: 1, unit: "G" }));
    const r = await request(app).post("/dishes").send({ ...pratoValido, items: muitos });
    expect(r.status).toBe(400);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  test("a revalidação dentro da transação trava as gravações de ficha e recusa o ciclo que outra gravação acabou de fechar", async () => {
    // A validação isolada (fora da transação) não via nada; dentro da transação a ficha de baixo já usa esta.
    let chamadas = 0;
    db.dish.findMany.mockImplementation(async (arg: { where: { id?: { in?: string[] } } }) => {
      chamadas += 1;
      const ids = arg.where.id?.in ?? [];
      if (!ids.includes("massa")) return [];
      return [{ id: "massa", name: "Nhoque - Massa", yieldUnit: "UN", fichaDeProducao: true, items: chamadas > 1 ? [{ componentDishId: "d1" }] : [] }];
    });
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, items: [{ componentDishId: "massa", quantity: 1, unit: "UN" }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/já usa esta ficha/);
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.dishItem.createMany).not.toHaveBeenCalled();
  });
});


describe("conferência da ficha pela cozinha", () => {
  test("marcar como conferida grava quem e quando; ficha sem ingredientes não pode", async () => {
    db.dishItem.count.mockResolvedValueOnce(0);
    const vazia = await request(app).post("/dishes/d1/conferir");
    expect(vazia.status).toBe(400);
    expect(vazia.body.message).toMatch(/ainda não tem ingredientes/);
    expect(db.dish.update).not.toHaveBeenCalled();

    db.dishItem.count.mockResolvedValueOnce(4);
    const ok = await request(app).post("/dishes/d1/conferir");
    expect(ok.status).toBe(200);
    expect(db.dish.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { fichaConferidaEm: expect.any(Date), fichaConferidaPorId: "u1" } });
    expect(auditLog).toHaveBeenCalled();
  });

  test("prato inexistente: 404", async () => {
    db.dish.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).post("/dishes/x/conferir")).status).toBe(404);
  });

  test("desmarcar limpa a conferência", async () => {
    const r = await request(app).delete("/dishes/d1/conferir");
    expect(r.status).toBe(200);
    expect(db.dish.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { fichaConferidaEm: null, fichaConferidaPorId: null } });
  });

  const itemGravado = (quantity: number) => ({ menu: "CARDAPIO", productId: "p1", componentDishId: null, quantity, unit: "G", wasteFactor: 0 });

  test("salvar sem mudar a receita nem o rendimento mantém a conferência", async () => {
    db.dishItem.findMany.mockResolvedValue([itemGravado(150)]);
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, items: [{ productId: "p1", quantity: 150, unit: "G", wasteFactor: 0 }] });
    expect(r.status).toBe(200);
    expect(db.dish.update).toHaveBeenCalledTimes(1);
  });

  test("mudar uma quantidade, e só ela, tira a conferência", async () => {
    db.dishItem.findMany.mockResolvedValueOnce([itemGravado(150)]).mockResolvedValue([itemGravado(200)]);
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, items: [{ productId: "p1", quantity: 200, unit: "G", wasteFactor: 0 }] });
    expect(r.status).toBe(200);
    expect(db.dish.update).toHaveBeenLastCalledWith({ where: { id: "d1" }, data: { fichaConferidaEm: null, fichaConferidaPorId: null } });
  });

  test("mudar o rendimento tira a conferência", async () => {
    const r = await request(app).put("/dishes/d1").send({ ...pratoValido, yieldQty: 2 });
    expect(r.status).toBe(200);
    expect(db.dish.update).toHaveBeenLastCalledWith({ where: { id: "d1" }, data: { fichaConferidaEm: null, fichaConferidaPorId: null } });
  });

  test("o detalhe diz quem conferiu", async () => {
    db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
      arg.select ? { yieldQty: 1, yieldUnit: "UN", menu: "CARDAPIO" } : { ...detalheMinimo(arg.where.id), fichaConferidaEm: new Date("2026-10-15T12:00:00Z"), fichaConferidaPorId: "u9" });
    (db.user as { findUnique?: unknown }).findUnique = vi.fn().mockResolvedValue({ name: "Ana" });
    const r = await request(app).get("/dishes/d1");
    expect(r.body).toMatchObject({ conferidaPor: "Ana" });
    expect(r.body.conferidaEm).toBe("2026-10-15T12:00:00.000Z");
  });
});
