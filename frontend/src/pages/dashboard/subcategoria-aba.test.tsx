import { fireEvent, render as renderRaw, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { PurchasesPanel, type NaturezasDasCompras } from "./Purchases";

// Nomes e valores fictícios.
const sessao = {
  user: null,
  setUser: () => undefined,
  hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined,
  canAccessSection: () => true,
  hasPermission: () => true,
} as unknown as SessionContextValue;

const render = (ui: ReactElement) =>
  renderRaw(
    <SessionContext.Provider value={sessao}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>,
  );

const simples = { rows: [{ name: "X", total: 100 }], total: 100 };
const subcategorias = {
  rows: [
    { name: "Legumes", group: "FLV", total: 60 },
    { name: "Sem subcategoria", group: "CARNES", total: 40 },
  ],
  total: 100,
};

const comAba: NaturezasDasCompras = {
  byNature: [{ nature: "INSUMO", total: 100, items: 2 }],
  unitemizedTotal: 0,
  views: {
    TODAS: { category: simples, subcategory: subcategorias, supplier: simples, product: simples },
    INSUMO: { category: simples, subcategory: subcategorias, supplier: simples, product: simples },
  },
};

const semAba: NaturezasDasCompras = {
  ...comAba,
  views: {
    TODAS: { category: simples, supplier: simples, product: simples },
    INSUMO: { category: simples, supplier: simples, product: simples },
  },
};

const VAZIO = { rows: [], total: 0 };
const painel = (naturezas: NaturezasDasCompras) => (
  <PurchasesPanel total={100} count={1} delta={null} rankings={{ category: VAZIO, supplier: VAZIO, product: VAZIO }} naturezas={naturezas} />
);

describe("aba Subcategoria", () => {
  test("fica entre Categoria e Fornecedor", () => {
    render(painel(comAba));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Categoria", "Subcategoria", "Fornecedor", "Produto"]);
  });

  test("cada subcategoria mostra a categoria a que pertence", () => {
    render(painel(comAba));
    fireEvent.click(screen.getByRole("tab", { name: "Subcategoria" }));
    const linhas = within(screen.getByRole("tabpanel")).getAllByRole("listitem").map((li) => li.querySelector(".dash-bar-name")!.textContent);
    expect(linhas).toEqual(["Legumes · FLV", "Sem subcategoria · CARNES"]);
  });

  test("servidor sem o dado de subcategoria não mostra a aba", () => {
    render(painel(semAba));
    expect(screen.queryByRole("tab", { name: "Subcategoria" })).toBeNull();
  });
});
