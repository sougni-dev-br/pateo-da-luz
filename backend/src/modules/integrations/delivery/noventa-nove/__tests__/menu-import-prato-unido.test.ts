import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    deliveryStore: { findMany: vi.fn() },
    dish: { findMany: vi.fn(), create: vi.fn() },
    dishListing: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() }
  }
}));
vi.mock("../noventa-nove-http-client.js", () => ({ callNoventaNoveShop: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import { callNoventaNoveShop } from "../noventa-nove-http-client.js";
import { importarCardapios } from "../noventa-nove-menu.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.deliveryStore.findMany.mockResolvedValue([{ id: "loja1", nickname: "Loja", externalId: "e1", shopIdRemote: "s1" }]);
  db.dishListing.count.mockResolvedValue(0);
  db.dishListing.updateMany.mockResolvedValue({ count: 0 });
});

describe("import do cardápio da 99 com prato unido ou renomeado no ERP", () => {
  test("listagem que já existe continua no prato dela: não cria prato duplicado nem desfaz a união", async () => {
    // No ERP o prato se chama "Gnocchi ao ragú"; na 99 a loja o chama de "Nhoque de Ragú".
    db.dish.findMany.mockResolvedValue([{ id: "d-gnocchi", name: "Gnocchi ao ragú" }]);
    db.dishListing.findMany.mockResolvedValue([{ id: "l1", dishId: "d-gnocchi", deliveryStoreId: "loja1", externalItemId: "nome:nhoque de ragú", externalName: "Nhoque de Ragú" }]);
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [{ item_name: "Nhoque de Ragú", price: 5990, status: 1 }] } as never);

    await importarCardapios();

    expect(db.dish.create).not.toHaveBeenCalled();
    expect(db.dishListing.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "l1" }, data: expect.objectContaining({ dishId: "d-gnocchi", price: 59.9 })
    }));
  });

  test("item novo (sem listagem) continua procurando o prato pelo nome e cria quando não existe", async () => {
    db.dish.findMany.mockResolvedValue([]);
    db.dishListing.findMany.mockResolvedValue([]);
    db.dish.create.mockResolvedValue({ id: "d-novo" });
    db.dishListing.create.mockResolvedValue({ id: "l-novo" });
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [{ item_name: "Pizza Nova", price: 4000, status: 1 }] } as never);

    await importarCardapios();

    expect(db.dish.create).toHaveBeenCalledTimes(1);
    expect(db.dishListing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dishId: "d-novo" }) }));
  });
});

describe("import da 99 quando os itens passam a vir com código", () => {
  test("listagem antiga (chave por nome) é reaproveitada e ganha o código: não duplica listagem nem prato", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d-coca", name: "Coca-Cola 350ml" }]);
    db.dishListing.findMany.mockResolvedValue([
      { id: "l-antiga", dishId: "d-coca", deliveryStoreId: "loja1", externalItemId: "nome:coca-cola 350ml", externalName: "Coca-Cola 350ml" }
    ]);
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [{ app_item_id: "LP-021", item_name: "Coca-Cola 350ml", price: 800, status: 1 }] } as never);

    await importarCardapios();

    expect(db.dishListing.create).not.toHaveBeenCalled();
    expect(db.dish.create).not.toHaveBeenCalled();
    expect(db.dishListing.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "l-antiga" }, data: expect.objectContaining({ externalItemId: "LP-021", dishId: "d-coca", price: 8 })
    }));
  });

  test("a mesma listagem antiga não serve a dois itens", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d1", name: "Pizza" }]);
    db.dishListing.findMany.mockResolvedValue([{ id: "l1", dishId: "d1", deliveryStoreId: "loja1", externalItemId: "nome:pizza", externalName: "Pizza" }]);
    db.dishListing.create.mockResolvedValue({ id: "l2" });
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [
      { app_item_id: "A-1", item_name: "Pizza", price: 4000, status: 1 },
      { app_item_id: "A-2", item_name: "Pizza", price: 4500, status: 1 }
    ] } as never);

    await importarCardapios();

    expect(db.dishListing.update).toHaveBeenCalledTimes(1);
    expect(db.dishListing.create).toHaveBeenCalledTimes(1);
  });
});

describe("import da 99: o que saiu do cardápio fica pausado", () => {
  test("pausa as listagens da loja que não vieram nesta leitura", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d1", name: "Pizza" }]);
    db.dishListing.findMany.mockResolvedValue([{ id: "l1", dishId: "d1", deliveryStoreId: "loja1", externalItemId: "A-1", externalName: "Pizza" }]);
    db.dishListing.count.mockResolvedValue(2); // a loja tinha 2 ativas; a 99 devolveu 1
    db.dishListing.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [{ app_item_id: "A-1", item_name: "Pizza", price: 4000, status: 1 }] } as never);

    const r = await importarCardapios();

    expect(db.dishListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ channel: "NOVENTA_NOVE", deliveryStoreId: "loja1", isActive: true, lastSeenAt: { lt: expect.any(Date) } }),
      data: { isActive: false }
    }));
    expect(r.perStore[0].listagensPausadas).toBe(1);
  });

  test("leitura muito menor que o cardápio conhecido (resposta parcial?) não pausa nada", async () => {
    db.dish.findMany.mockResolvedValue([{ id: "d1", name: "Pizza" }]);
    db.dishListing.findMany.mockResolvedValue([{ id: "l1", dishId: "d1", deliveryStoreId: "loja1", externalItemId: "A-1", externalName: "Pizza" }]);
    db.dishListing.count.mockResolvedValue(10);
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [{ app_item_id: "A-1", item_name: "Pizza", price: 4000, status: 1 }] } as never);

    const r = await importarCardapios();

    expect(db.dishListing.updateMany).not.toHaveBeenCalled();
    expect(r.perStore[0].listagensPausadas).toBe(0);
    expect(r.perStore[0].message).toMatch(/nada foi pausado/);
  });

  test("cardápio vazio na resposta não pausa nada", async () => {
    db.dish.findMany.mockResolvedValue([]);
    db.dishListing.findMany.mockResolvedValue([]);
    vi.mocked(callNoventaNoveShop).mockResolvedValue({ items: [] } as never);
    await importarCardapios();
    expect(db.dishListing.updateMany).not.toHaveBeenCalled();
  });
});
