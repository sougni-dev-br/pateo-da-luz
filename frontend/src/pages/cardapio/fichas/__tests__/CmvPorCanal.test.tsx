import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppUser, DishListItem } from "../../../../api/client";
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

const FILE = prato({ id: "f", name: "Filé", alsoMenu: "DELIVERY", canais: [canal("NOVENTA_NOVE", "Frei Caneca", 100), canal("NOVENTA_NOVE", "Pizzaria", 60), canal("IFOOD", "Pateo da Luz", 120)] });
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
