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

const render = (ui: ReactElement, oculto = false) =>
  renderRaw(
    <SessionContext.Provider value={{ ...sessao, hideSensitiveValues: oculto }}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>,
  );

const categorias = {
  rows: [
    {
      name: "CARNES",
      total: 400,
      children: [
        { name: "Bovinos", total: 300 },
        { name: "Sem subcategoria", total: 100 },
      ],
    },
    { name: "FLV", total: 100 },
  ],
  total: 500,
};
const produtos = { rows: [{ name: "Alcatra", total: 300 }], total: 300 };

const NATUREZAS: NaturezasDasCompras = {
  byNature: [{ nature: "INSUMO", total: 500, items: 3 }],
  unitemizedTotal: 0,
  views: {
    TODAS: { category: categorias, supplier: produtos, product: produtos },
    INSUMO: { category: categorias, supplier: produtos, product: produtos },
  },
};

const VAZIO = { rows: [], total: 0 };
const painel = () => (
  <PurchasesPanel
    total={500}
    count={2}
    delta={null}
    rankings={{ category: VAZIO, supplier: VAZIO, product: VAZIO }}
    naturezas={NATUREZAS}
  />
);

describe("subcategorias na aba Categoria", () => {
  test("categoria com subcategorias abre e fecha mostrando valor e percentual dentro dela", () => {
    render(painel());
    const botao = screen.getByRole("button", { name: /CARNES/ });
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: /Subcategorias de CARNES/ })).toBeNull();

    fireEvent.click(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const lista = screen.getByRole("list", { name: "Subcategorias de CARNES" });
    const linhas = within(lista).getAllByRole("listitem").map((li) => li.textContent);
    expect(linhas[0]).toContain("Bovinos");
    expect(linhas[0]).toContain("75,0%");
    expect(linhas[1]).toContain("Sem subcategoria");

    fireEvent.click(botao);
    expect(screen.queryByRole("list", { name: /Subcategorias de CARNES/ })).toBeNull();
  });

  test("categoria sem subcategorias não vira botão", () => {
    render(painel());
    expect(screen.queryByRole("button", { name: /^FLV/ })).toBeNull();
    expect(screen.getByText("FLV")).toBeTruthy();
  });

  test("ocultar valores esconde os reais da sublista (percentual continua)", () => {
    const { container } = render(painel(), true);
    fireEvent.click(screen.getByRole("button", { name: /CARNES/ }));
    const lista = screen.getByRole("list", { name: "Subcategorias de CARNES" });
    expect(lista.textContent).not.toMatch(/\d{1,3}(\.\d{3})*,\d{2}/);
    expect(lista.textContent).toContain("75,0%");
    expect(container.textContent).not.toMatch(/R\$\s?\d/);
  });

  test("aba Produto não tem subníveis", () => {
    render(painel());
    fireEvent.click(screen.getByRole("tab", { name: "Produto" }));
    expect(screen.queryByRole("button", { name: /Alcatra/ })).toBeNull();
    expect(screen.queryByText(/ver as subcategorias/)).toBeNull();
  });
});
