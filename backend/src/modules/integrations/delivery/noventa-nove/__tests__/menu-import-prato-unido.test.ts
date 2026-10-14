import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    deliveryStore: { findMany: vi.fn() },
    dish: { findMany: vi.fn(), create: vi.fn() },
    dishListing: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() }
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
});

describe("import do cardápio da 99 com prato unido ou renomeado no ERP", () => {
  test("listagem que já existe continua no prato dela: não cria prato duplicado nem desfaz a união", async () => {
    // No ERP o prato se chama "Gnocchi ao ragú"; na 99 a loja o chama de "Nhoque de Ragú".
    db.dish.findMany.mockResolvedValue([{ id: "d-gnocchi", name: "Gnocchi ao ragú" }]);
    db.dishListing.findMany.mockResolvedValue([{ id: "l1", dishId: "d-gnocchi", deliveryStoreId: "loja1", externalItemId: "nome:nhoque de ragú" }]);
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
