import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    buffetPlateItem: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    dish: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../buffet-costs.service.js", () => ({
  custosDosPratos: vi.fn(), custoVisivel: vi.fn(async () => true), semValores: (c: object) => ({ ...c, costPerKg: null }), MAX_PRATOS_NO_CUSTO: 300,
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { custoVisivel, custosDosPratos } from "../buffet-costs.service.js";
import { buffetCostsRouter } from "../buffet-costs.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/buffet-plates", buffetCostsRouter);

const prato = { id: "i1", namePt: "Purê de batata", dishId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1" } as never);
  db.buffetPlateItem.findUnique.mockResolvedValue(prato);
  db.buffetPlateItem.update.mockImplementation(async ({ data }: { data: { dishId: string | null } }) => ({ id: "i1", dishId: data.dishId }));
  db.buffetPlateItem.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("ligar prato da plaquinha à ficha", () => {
  test("liga a uma ficha existente e audita", async () => {
    db.dish.findUnique.mockResolvedValue({ id: "d1" });
    const r = await request(app).put("/buffet-plates/items/i1/dish").send({ dishId: "d1" });
    expect(r.status).toBe(200);
    expect(db.buffetPlateItem.update.mock.calls[0][0].data).toEqual({ dishId: "d1" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "LINK_BUFFET_PLATE_DISH", newValue: { dishId: "d1" } }));
  });

  test("desliga com dishId nulo sem consultar ficha", async () => {
    const r = await request(app).put("/buffet-plates/items/i1/dish").send({ dishId: null });
    expect(r.status).toBe(200);
    expect(db.dish.findUnique).not.toHaveBeenCalled();
    expect(db.buffetPlateItem.update.mock.calls[0][0].data).toEqual({ dishId: null });
  });

  test("recusa ficha inexistente, prato inexistente, corpo inválido e sessão ausente", async () => {
    db.dish.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put("/buffet-plates/items/i1/dish").send({ dishId: "x" })).status).toBe(400);
    db.buffetPlateItem.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put("/buffet-plates/items/zz/dish").send({ dishId: null })).status).toBe(404);
    expect((await request(app).put("/buffet-plates/items/i1/dish").send({})).status).toBe(400);
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as never);
    expect((await request(app).put("/buffet-plates/items/i1/dish").send({ dishId: null })).status).toBe(401);
    expect(db.buffetPlateItem.update).not.toHaveBeenCalled();
  });
});

describe("criar ficha pendente pelo prato", () => {
  test("cria a preparação de buffet em kg, inativa e pendente, e liga", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d9", name: "Arroz branco", fichaDeBuffet: false, isActive: true }]);
    db.dish.create.mockResolvedValue({ id: "novo", name: "Purê de batata" });
    const r = await request(app).post("/buffet-plates/items/i1/dish/pending").send({});
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ dishId: "novo", dishName: "Purê de batata", reused: false });
    expect(db.dish.create.mock.calls[0][0].data).toMatchObject({
      name: "Purê de batata", yieldQty: 1, yieldUnit: "KG", isActive: false, fichaDeBuffet: true, fichaPendente: true, pendentePorId: "u1",
    });
    expect(db.buffetPlateItem.updateMany.mock.calls[0][0]).toEqual({ where: { id: "i1", dishId: null }, data: { dishId: "novo" } });
  });

  test("com ficha de mesmo nome (sem acento ou caixa), liga a ela em vez de duplicar", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d7", name: "PURE de batata", fichaDeBuffet: true, isActive: false }]);
    const r = await request(app).post("/buffet-plates/items/i1/dish/pending").send({});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ dishId: "d7", dishName: "PURE de batata", reused: true });
    expect(db.dish.create).not.toHaveBeenCalled();
    expect(db.buffetPlateItem.updateMany.mock.calls[0][0].data).toEqual({ dishId: "d7" });
  });

  test("entre fichas homônimas prefere a de buffet, depois a ativa, com desempate fixo", async () => {
    db.dish.findMany.mockResolvedValue([
      { id: "z-delivery", name: "Purê de batata", fichaDeBuffet: false, isActive: true },
      { id: "b-buffet-2", name: "Pure de Batata", fichaDeBuffet: true, isActive: false },
      { id: "a-buffet-1", name: "purê de batata", fichaDeBuffet: true, isActive: false },
    ]);
    const r = await request(app).post("/buffet-plates/items/i1/dish/pending").send({});
    expect(r.body.dishId).toBe("a-buffet-1");
  });

  test("duas pessoas ao mesmo tempo: quem chega depois leva 409 e a ficha criada é desfeita", async () => {
    db.dish.findMany.mockResolvedValue([]);
    db.dish.create.mockResolvedValue({ id: "novo", name: "Purê de batata" });
    db.buffetPlateItem.updateMany.mockResolvedValue({ count: 0 });
    const r = await request(app).post("/buffet-plates/items/i1/dish/pending").send({});
    expect(r.status).toBe(409);
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("se o vínculo apareceu dentro da trava, responde 409 sem criar nada", async () => {
    db.buffetPlateItem.findUnique.mockResolvedValueOnce(prato).mockResolvedValueOnce({ dishId: "d1" });
    const r = await request(app).post("/buffet-plates/items/i1/dish/pending").send({});
    expect(r.status).toBe(409);
    expect(db.dish.create).not.toHaveBeenCalled();
  });

  test("prato que já tem ficha ou que não existe é recusado", async () => {
    db.buffetPlateItem.findUnique.mockResolvedValueOnce({ ...prato, dishId: "d1" });
    expect((await request(app).post("/buffet-plates/items/i1/dish/pending").send({})).status).toBe(400);
    db.buffetPlateItem.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).post("/buffet-plates/items/zz/dish/pending").send({})).status).toBe(404);
    expect(db.dish.create).not.toHaveBeenCalled();
  });
});

describe("busca de ficha e custo dos pratos", () => {
  test("busca precisa de 2 letras e devolve ativas e preparações de buffet", async () => {
    expect(await request(app).get("/buffet-plates/dish-search?q=a")).toMatchObject({ status: 200, body: [] });
    expect(db.dish.findMany).not.toHaveBeenCalled();
    db.dish.findMany.mockResolvedValue([{ id: "d1", name: "Arroz", yieldUnit: "KG", fichaPendente: false, fichaDeProducao: false }]);
    const r = await request(app).get("/buffet-plates/dish-search?q=arr");
    expect(r.body).toEqual([{ id: "d1", name: "Arroz", unit: "KG", pending: false, production: false }]);
    expect(JSON.stringify(db.dish.findMany.mock.calls[0][0].where)).toContain("fichaDeBuffet");
  });

  test("devolve o custo por prato pedido", async () => {
    vi.mocked(custosDosPratos).mockResolvedValue(new Map([["i1", { state: "OK", dishId: "d1", dishName: "Arroz", costPerKg: 8, reason: null }]]));
    const r = await request(app).get("/buffet-plates/item-costs?ids=i1, i2");
    expect(custosDosPratos).toHaveBeenCalledWith(["i1", "i2"]);
    expect(r.body.i1).toMatchObject({ state: "OK", costPerKg: 8 });
  });

  test("quem não vê custos recebe o estado da ficha sem o valor", async () => {
    vi.mocked(custosDosPratos).mockResolvedValue(new Map([["i1", { state: "OK", dishId: "d1", dishName: "Arroz", costPerKg: 8, reason: null }]]));
    vi.mocked(custoVisivel).mockResolvedValueOnce(false);
    const r = await request(app).get("/buffet-plates/item-costs?ids=i1");
    expect(r.body.i1).toMatchObject({ state: "OK", dishId: "d1", costPerKg: null });
  });
});
