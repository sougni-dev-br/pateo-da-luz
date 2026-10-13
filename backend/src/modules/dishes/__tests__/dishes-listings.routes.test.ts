import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Preço do prato por canal e por loja: o da 99 vem do cardápio dela; os demais são lançados à mão.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    dish: { findUnique: vi.fn(), findMany: vi.fn() },
    dishListing: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    deliveryStore: { findMany: vi.fn(), findUnique: vi.fn() },
    dishRevision: { create: vi.fn(), findMany: vi.fn() },
    dishCategory: { findMany: vi.fn(), findUnique: vi.fn() },
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
import { requireRole } from "../../security/security-utils.js";
import { dishesRouter } from "../dishes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/dishes", dishesRouter);
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: "erro" });
});

const detalheComListagens = (id: string) => ({
  id, code: null, name: "Filé", menu: "CARDAPIO", category: null, alsoMenu: "DELIVERY", alsoCategory: null, salePriceDefault: 80,
  yieldQty: 1, yieldUnit: "UN", notes: null, isActive: true, items: [], createdAt: new Date(), updatedAt: new Date(),
  listings: [
    { id: "l1", channel: "IFOOD", deliveryStoreId: "s-ifood", deliveryStore: { nickname: "Pateo da Luz", platform: "IFOOD" }, externalItemId: `manual:${id}`, externalName: "Filé", price: 99.9, isActive: true, lastSeenAt: new Date() },
    { id: "l2", channel: "NOVENTA_NOVE", deliveryStoreId: "s-99", deliveryStore: { nickname: "Pateo Frei Caneca", platform: "NOVENTA_NOVE" }, externalItemId: "12345", externalName: "Filé", price: 109.9, isActive: true, lastSeenAt: new Date() }
  ]
});

const listagemManual = { id: "l1", externalItemId: "manual:d1", price: 99.9, isActive: true, deliveryStore: { nickname: "Pateo da Luz" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Eli", role: "ADMIN" } as never);
  db.$transaction.mockImplementation(async (arg: unknown) => (arg as (tx: unknown) => unknown)(prisma));
  db.dish.findUnique.mockImplementation(async (arg: { where: { id: string }; select?: object }) =>
    arg.select ? { id: arg.where.id, name: "Filé" } : detalheComListagens(arg.where.id));
  db.deliveryStore.findUnique.mockResolvedValue({ id: "s-ifood", platform: "IFOOD", nickname: "Pateo da Luz", active: true });
  db.dishListing.count.mockResolvedValue(0);
  db.dishListing.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "nova", ...data }));
  db.dishRevision.create.mockResolvedValue({});
});

describe("lojas e preços por canal", () => {
  test("lista as lojas ativas para o seletor, sem confundir com um prato", async () => {
    db.deliveryStore.findMany.mockResolvedValue([{ id: "s1", platform: "IFOOD", nickname: "Pateo da Luz" }]);
    const r = await request(app).get("/dishes/delivery-stores");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: "s1", platform: "IFOOD", nickname: "Pateo da Luz" }]);
    expect(db.deliveryStore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });

  test("lança o preço de uma loja: canal da plataforma, chave manual, e deixa versão no histórico", async () => {
    const r = await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s-ifood", price: 99.9 });
    expect(r.status).toBe(200);
    expect(db.dishListing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dishId: "d1", channel: "IFOOD", deliveryStoreId: "s-ifood", externalItemId: "manual:d1", price: 99.9, isActive: true })
    });
    expect(db.dishRevision.create).toHaveBeenCalledTimes(1);
    expect(db.dishRevision.create.mock.calls[0][0].data.snapshot.canais).toEqual([
      { canal: "IFOOD", loja: "Pateo da Luz", preco: 99.9 },
      { canal: "NOVENTA_NOVE", loja: "Pateo Frei Caneca", preco: 109.9 }
    ]);
  });

  test("loja que já tem preço para o prato (importado ou lançado): 409 sem criar", async () => {
    db.dishListing.count.mockResolvedValue(1);
    const r = await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s-ifood", price: 50 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Pateo da Luz já tem preço/);
    expect(db.dishListing.create).not.toHaveBeenCalled();
  });

  test("preço inválido, loja inativa ou prato inexistente são recusados", async () => {
    expect((await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s-ifood", price: 0 })).status).toBe(400);
    expect((await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s-ifood", price: -5 })).status).toBe(400);
    expect((await request(app).post("/dishes/d1/listings").send({ price: 10 })).status).toBe(400);

    db.deliveryStore.findUnique.mockResolvedValue({ id: "s", platform: "IFOOD", nickname: "Velha", active: false });
    expect((await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s", price: 10 })).status).toBe(400);

    db.dish.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/dishes/x/listings").send({ deliveryStoreId: "s-ifood", price: 10 })).status).toBe(404);
    expect(db.dishListing.create).not.toHaveBeenCalled();
  });

  test("só quem pode editar ficha lança preço", async () => {
    vi.mocked(requireRole).mockImplementation(async (_q, res) => {
      (res as express.Response).status(403).json({ message: "negado" });
      return null as never;
    });
    const r = await request(app).post("/dishes/d1/listings").send({ deliveryStoreId: "s-ifood", price: 50 });
    expect(r.status).toBe(403);
    expect(db.dishListing.create).not.toHaveBeenCalled();
  });

  test("altera o preço de uma listagem lançada à mão", async () => {
    db.dishListing.findFirst.mockResolvedValue(listagemManual);
    const r = await request(app).put("/dishes/d1/listings/l1").send({ price: 104.9 });
    expect(r.status).toBe(200);
    expect(db.dishListing.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { price: 104.9 } });
    expect(db.dishRevision.create).toHaveBeenCalledTimes(1);
  });

  test("preço que veio do cardápio da 99 não se altera nem se apaga aqui", async () => {
    db.dishListing.findFirst.mockResolvedValue({ id: "l2", externalItemId: "12345", price: 109.9, isActive: true, deliveryStore: { nickname: "Pateo Frei Caneca" } });
    const alterar = await request(app).put("/dishes/d1/listings/l2").send({ price: 1 });
    expect(alterar.status).toBe(400);
    expect(alterar.body.message).toMatch(/portal da plataforma/);
    expect((await request(app).delete("/dishes/d1/listings/l2")).status).toBe(400);
    expect(db.dishListing.update).not.toHaveBeenCalled();
    expect(db.dishListing.delete).not.toHaveBeenCalled();
  });

  test("pausar a loja e apagar o preço lançado à mão; listagem inexistente: 404", async () => {
    db.dishListing.findFirst.mockResolvedValue(listagemManual);
    expect((await request(app).put("/dishes/d1/listings/l1").send({ isActive: false })).status).toBe(200);
    expect(db.dishListing.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { isActive: false } });
    expect((await request(app).put("/dishes/d1/listings/l1").send({})).status).toBe(400);

    expect((await request(app).delete("/dishes/d1/listings/l1")).status).toBe(200);
    expect(db.dishListing.delete).toHaveBeenCalledWith({ where: { id: "l1" } });

    db.dishListing.findFirst.mockResolvedValue(null);
    expect((await request(app).delete("/dishes/d1/listings/zz")).status).toBe(404);
  });
});
