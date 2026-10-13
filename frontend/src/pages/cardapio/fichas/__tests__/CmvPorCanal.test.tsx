import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUser, DishListItem } from "../../../../api/client";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getDishNetRatios: vi.fn(),
}));

import { getDishNetRatios } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { CmvPorCanal } from "../CmvPorCanal";

const SESSAO = {
  user: { id: "u1", role: "ADMIN" } as unknown as AppUser, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

function prato(parcial: Partial<DishListItem>): DishListItem {
  return {
    id: "d", code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: 80, yieldQty: 1, yieldUnit: "UN", isActive: true,
    itemsCount: 1, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 24, custoPorcao: 24, margemBruta: 56,
    cmvPercentual: 30, custoIncompleto: false, canais: [], ...parcial,
  };
}
const canal = (channel: string, loja: string, price: number) => ({ channel, deliveryStoreId: `s-${loja}`, storeName: loja, price });

const FILE = prato({ id: "f", name: "Filé", alsoMenu: "DELIVERY", alsoItemsCount: 3, alsoCustoPorcao: 24, canais: [canal("NOVENTA_NOVE", "Frei Caneca", 100), canal("NOVENTA_NOVE", "Pizzaria", 60), canal("IFOOD", "Pateo da Luz", 120)] });
const PIZZA = prato({ id: "p", name: "Pizza", menu: "DELIVERY", salePriceDefault: null, custoPorcao: 15, canais: [canal("NOVENTA_NOVE", "Frei Caneca", 50)] });
const PUDIM = prato({ id: "s", name: "Pudim", itemsCount: 0, custoPorcao: 0 });
const abrir = vi.fn();

function mostrar(pratos: DishListItem[]) {
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <CmvPorCanal pratos={pratos} carregando={false} onAbrirPrato={abrir} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDishNetRatios).mockRejectedValue(new Error("sem dados"));
});
afterEach(cleanup);

describe("CMV por canal (tela)", () => {
  test("uma linha por prato e uma coluna por lugar; cada célula traz o CMV e o preço dele", () => {
    mostrar([FILE, PIZZA]);
    const tabela = screen.getByRole("table");
    const cabecalho = within(tabela).getAllByRole("columnheader").map((c) => c.textContent);
    expect(cabecalho).toEqual(expect.arrayContaining(["Salão (a la carte)", "99 Food", "iFood"]));

    const file = within(tabela).getByRole("button", { name: "Filé" }).closest("tr")!;
    expect(within(file).getByText(/^30(,0)?%$/)).toBeInTheDocument(); // salão: 24/80
    expect(within(file).getByText(/^40(,0)?%$/)).toBeInTheDocument(); // 99, pior loja: 24/60
    expect(within(file).getByText(/^20(,0)?%$/)).toBeInTheDocument(); // iFood: 24/120
  });

  test("'por loja' abre uma coluna para cada loja", () => {
    mostrar([FILE, PIZZA]);
    fireEvent.click(screen.getByRole("radio", { name: "Por loja" }));
    const cabecalho = within(screen.getByRole("table")).getAllByRole("columnheader").map((c) => c.textContent);
    expect(cabecalho).toEqual(expect.arrayContaining(["Frei Caneca", "Pizzaria", "Pateo da Luz"]));
  });

  test("mostra o CMV médio de cada lugar no alto", () => {
    mostrar([FILE, PIZZA]);
    const resumos = screen.getByRole("list", { name: "CMV médio por lugar" });
    expect(within(resumos).getByText("Salão (a la carte)")).toBeInTheDocument();
    expect(within(resumos).getByText("iFood")).toBeInTheDocument();
  });

  test("pratos sem ficha ficam de fora até pedir; o aviso diz quantos", () => {
    mostrar([FILE, PUDIM]);
    expect(screen.queryByRole("button", { name: "Pudim" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Incluir pratos sem ficha" }));
    expect(screen.getByRole("button", { name: "Pudim" })).toBeInTheDocument();
    expect(screen.getAllByText("Sem ficha").length).toBeGreaterThan(0);
  });

  test("com a razão da 99, o CMV da 99 passa a ser sobre o líquido, e dá para voltar à tabela", async () => {
    vi.mocked(getDishNetRatios).mockResolvedValue({
      channel: "NOVENTA_NOVE", dias: 60, plataforma: { razao: 0.5, pedidos: 100 },
      lojas: [
        { deliveryStoreId: "s-Frei Caneca", storeName: "Frei Caneca", razao: 0.5, pedidos: 60, base: "loja" },
        { deliveryStoreId: "s-Pizzaria", storeName: "Pizzaria", razao: 0.4, pedidos: 40, base: "loja" },
      ],
      canais: [
        {
          channel: "NOVENTA_NOVE", fonte: "tabela", referencia: { pedidos: 100 }, plataforma: { razao: 0.5 },
          lojas: [
            { deliveryStoreId: "s-Frei Caneca", storeName: "Frei Caneca", razao: 0.5, pedidos: 60, base: "loja" },
            { deliveryStoreId: "s-Pizzaria", storeName: "Pizzaria", razao: 0.4, pedidos: 40, base: "loja" },
          ],
        },
        {
          channel: "IFOOD", fonte: "faturamento", referencia: { de: "2026-07-31", ate: "2026-08-31" }, plataforma: { razao: 0.6 },
          lojas: [{ deliveryStoreId: "s-Pateo da Luz", storeName: "Pateo da Luz", razao: 0.6, pedidos: 0, base: "loja" }],
        },
      ],
    });
    mostrar([FILE]);
    const file = () => within(screen.getByRole("table")).getByRole("button", { name: "Filé" }).closest("tr")!;
    // 99, pior loja: Pizzaria 60 × 0,4 = 24 líquido → 24/24 = 100%.
    await waitFor(() => expect(within(file()).getByText(/^100(,0)?%$/)).toBeInTheDocument());
    expect(within(file()).getAllByText(/líq\./)).toHaveLength(2); // 99 e iFood
    expect(screen.getByText(/sobre o preço de tabela do pedido/)).toBeInTheDocument();
    expect(screen.getByText(/sobre o faturamento lançado \(31\/07 a 31\/08\)/)).toBeInTheDocument();
    // iFood: 120 × 0,60 = 72 de líquido → 24 / 72 = 33,3%
    expect(within(file()).getByText(/^33,3%$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Preço de tabela" }));
    expect(within(file()).getByText(/^40(,0)?%$/)).toBeInTheDocument(); // 24/60
    expect(within(file()).queryAllByText(/líq\./)).toHaveLength(0);
  });

  test("sem a razão da 99 não há alternância e o CMV é sobre a tabela", async () => {
    mostrar([FILE]);
    await waitFor(() => expect(getDishNetRatios).toHaveBeenCalled());
    expect(screen.queryByRole("radio", { name: "Preço de tabela" })).toBeNull();
  });

  test("abrir um prato leva à ficha dele", () => {
    mostrar([FILE]);
    fireEvent.click(screen.getByRole("button", { name: "Filé" }));
    expect(abrir).toHaveBeenCalledWith("f");
  });

  test("sem pratos ativos explica", () => {
    mostrar([prato({ id: "x", isActive: false })]);
    expect(screen.getByText("Nenhum prato neste cardápio.")).toBeInTheDocument();
  });
});
