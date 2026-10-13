import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, DishDetail, DishListing } from "../../../../api/client";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getDishDeliveryStores: vi.fn(),
  createDishListing: vi.fn(),
  updateDishListing: vi.fn(),
  deleteDishListing: vi.fn(),
}));

import { createDishListing, deleteDishListing, getDishDeliveryStores, updateDishListing } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { PrecosPorCanal } from "../PrecosPorCanal";

const listagem = (parcial: Partial<DishListing> & { id: string }): DishListing => ({
  channel: "NOVENTA_NOVE", deliveryStoreId: "s-99", storeName: "Pateo Frei Caneca", manual: false, externalName: "Filé",
  price: 109.9, isActive: true, lastSeenAt: "2026-10-13T04:00:00.000Z", ...parcial,
});

function prato(parcial: Partial<DishDetail> = {}): DishDetail {
  return {
    id: "d1", code: null, name: "Filé", menu: "CARDAPIO", category: null, alsoMenu: "DELIVERY", alsoCategory: null, salePriceDefault: 80,
    yieldQty: 1, yieldUnit: "UN", isActive: true, itemsCount: 1, calculatedCost: 24, custoPorcao: 24, margemBruta: 56, cmvPercentual: 30,
    custoIncompleto: false, notes: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
    items: [{ id: "i1", productId: "p1", productCode: null, productName: "FILE", productUnit: "KG", quantity: 200, unit: "G", wasteFactor: 0, unitCost: 120, unitFactor: 0.001, itemCost: 24, issue: null, conversions: [], embalagemInferida: null, notes: null, sortOrder: 0 }],
    listings: [
      listagem({ id: "l99", price: 109.9 }),
      listagem({ id: "lifood", channel: "IFOOD", deliveryStoreId: "s-ifood", storeName: "Pateo da Luz", manual: true, price: 96 }),
    ],
    ...parcial,
  } as DishDetail;
}

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

const notificar = vi.fn();
const onMudou = vi.fn();
const onEditarPrato = vi.fn();

function mostrar(p: DishDetail, canEdit = true) {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <PrecosPorCanal prato={p} canEdit={canEdit} onEditarPrato={onEditarPrato} onMudou={onMudou} notificar={notificar} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDishDeliveryStores).mockResolvedValue([
    { id: "s-99", platform: "NOVENTA_NOVE", nickname: "Pateo Frei Caneca" },
    { id: "s-ifood", platform: "IFOOD", nickname: "Pateo da Luz" },
    { id: "s-ifood2", platform: "IFOOD", nickname: "Pateo da Luz Pizzaria" },
  ]);
  vi.mocked(createDishListing).mockResolvedValue({ id: "nova" });
  vi.mocked(updateDishListing).mockResolvedValue({ id: "lifood" });
  vi.mocked(deleteDishListing).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("preços por canal", () => {
  test("mostra o preço do salão e o de cada loja, cada um com o seu CMV", () => {
    mostrar(prato());
    const salao = screen.getByText("Salão (a la carte)").closest("tr")!;
    expect(within(salao).getByText(/80,00/)).toBeInTheDocument();
    expect(within(salao).getByText(/^30(,0)?%$/)).toBeInTheDocument(); // 24 / 80
    const ifood = screen.getByText("Pateo da Luz").closest("tr")!;
    expect(within(ifood).getByText(/96,00/)).toBeInTheDocument();
    expect(within(ifood).getByText(/^25(,0)?%$/)).toBeInTheDocument(); // 24 / 96
    const noventa = screen.getByText("Pateo Frei Caneca").closest("tr")!;
    expect(within(noventa).getByText("da plataforma")).toBeInTheDocument(); // preço da 99 não se edita aqui
  });

  test("prato só do salão e sem preço de loja não mostra a seção", () => {
    mostrar(prato({ alsoMenu: null, listings: [] }));
    expect(screen.queryByRole("heading", { name: "Preços por canal" })).toBeNull();
  });

  test("prato do delivery sem nenhum preço de loja explica e deixa lançar", () => {
    mostrar(prato({ menu: "DELIVERY", alsoMenu: null, listings: [], salePriceDefault: null }));
    expect(screen.getByText(/Nenhuma loja do delivery tem preço/)).toBeInTheDocument();
    expect(screen.queryByText("Salão (a la carte)")).toBeNull();
    expect(screen.getByRole("button", { name: /Adicionar preço de uma loja/ })).toBeInTheDocument();
  });

  test("lança o preço de uma loja que ainda não tem; as que já têm não aparecem na escolha", async () => {
    mostrar(prato());
    fireEvent.click(screen.getByRole("button", { name: /Adicionar preço de uma loja/ }));
    const loja = (await screen.findByLabelText("Loja")) as HTMLSelectElement;
    await waitFor(() => expect([...loja.options].map((o) => o.textContent)).toEqual(["Escolha a loja", "iFood · Pateo da Luz Pizzaria"]));

    fireEvent.change(loja, { target: { value: "s-ifood2" } });
    fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "89.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Gravar" }));

    await waitFor(() => expect(createDishListing).toHaveBeenCalledWith("d1", { deliveryStoreId: "s-ifood2", price: 89.9 }));
    expect(notificar).toHaveBeenCalledWith("success", "Preço lançado.");
    expect(onMudou).toHaveBeenCalledTimes(1);
  });

  test("altera e remove só o preço lançado à mão", async () => {
    mostrar(prato());
    const ifood = screen.getByText("Pateo da Luz").closest("tr")!;
    fireEvent.click(within(ifood).getByRole("button", { name: "Alterar" }));
    const campo = (await screen.findByLabelText("Preço (R$)")) as HTMLInputElement;
    expect(campo.value).toBe("96");
    fireEvent.change(campo, { target: { value: "104.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Gravar" }));
    await waitFor(() => expect(updateDishListing).toHaveBeenCalledWith("d1", "lifood", { price: 104.9 }));

    fireEvent.click(within(ifood).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(deleteDishListing).toHaveBeenCalledWith("d1", "lifood"));
    expect(onMudou).toHaveBeenCalledTimes(2);
  });

  test("mostra o erro do servidor e não fecha o diálogo", async () => {
    vi.mocked(createDishListing).mockRejectedValue(new Error("Pateo da Luz Pizzaria já tem preço para este prato."));
    mostrar(prato());
    fireEvent.click(screen.getByRole("button", { name: /Adicionar preço de uma loja/ }));
    const loja = (await screen.findByLabelText("Loja")) as HTMLSelectElement;
    await waitFor(() => expect(loja.options.length).toBeGreaterThan(1));
    fireEvent.change(loja, { target: { value: "s-ifood2" } });
    fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Gravar" }));
    expect(await screen.findByText(/já tem preço para este prato/)).toBeInTheDocument();
    expect(onMudou).not.toHaveBeenCalled();
  });

  test("quem só consulta não vê ações", () => {
    mostrar(prato(), false);
    expect(screen.queryByRole("button", { name: /Adicionar preço/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Alterar" })).toBeNull();
  });
});
