import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ProductHistory } from "../../../api/client";
import { renderComSessao } from "../../analise-salao/__tests__/fixtures";
import { PriceComparison } from "../PriceComparison";

type Comparison = ProductHistory["priceComparison"];

const FORN_A = {
  supplierName: "Horti A", lastDate: "2026-06-20", purchases: 14, recent: [10.5, 10.5], isCheapest: true, lastPrice: 10.5, minPrice: 10.5, avgPrice: 10.5,
  daysSinceLast: 5, isStale: false, lastQuantity: 20, previousPrice: 10.5, changePercent: 0
};
const FORN_B = {
  supplierName: "Horti B", lastDate: "2026-06-25", purchases: 5, recent: [10, 11, 13.32], isCheapest: false, lastPrice: 13.32, minPrice: 10, avgPrice: 11.4,
  daysSinceLast: 2, isStale: false, lastQuantity: 7, previousPrice: 11, changePercent: 21.1
};

function renderizar(comparison: Comparison | undefined) {
  return renderComSessao(<PriceComparison comparison={comparison} />);
}

const base: Comparison = { unit: "KG", suppliers: [FORN_A, FORN_B], savings: null, ignoredOtherUnit: 0 };

describe("PriceComparison", () => {
  test("nao renderiza nada sem compras", () => {
    const { container } = renderizar({ ...base, suppliers: [] });
    expect(container).toBeEmptyDOMElement();
    const semDados = renderizar(undefined);
    expect(semDados.container).toBeEmptyDOMElement();
  });

  test("lista os fornecedores e marca o mais barato", () => {
    renderizar(base);
    const itens = screen.getAllByRole("listitem");
    expect(itens).toHaveLength(2);
    expect(within(itens[0]).getByText("Horti A")).toBeInTheDocument();
    expect(within(itens[0]).getByText("Mais barato")).toBeInTheDocument();
    expect(within(itens[1]).queryByText("Mais barato")).not.toBeInTheDocument();
  });

  test("mostra a diferenca do mais caro para o mais barato", () => {
    renderizar(base);
    const mais_caro = screen.getAllByRole("listitem")[1];
    expect(mais_caro).toHaveTextContent("+");
    expect(mais_caro).toHaveTextContent("26,9%");
    expect(mais_caro).toHaveClass("is-notable");
  });

  test("com um fornecedor so, nao compara nem marca mais barato", () => {
    renderizar({ ...base, suppliers: [FORN_A] });
    expect(screen.queryByText("Mais barato")).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não há o que comparar/i)).toBeInTheDocument();
  });

  test("avisa quando compras ficaram de fora por unidade diferente", () => {
    renderizar({ ...base, ignoredOtherUnit: 2 });
    expect(screen.getByText(/2 compras ficaram de fora porque estão em outra unidade/)).toBeInTheDocument();
  });

  test("preco que nunca mudou nao repete menor e medio", () => {
    renderizar(base);
    expect(within(screen.getAllByRole("listitem")[0]).getByText("14 compras, sempre o mesmo preço")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[1]).getByText(/menor/)).toBeInTheDocument();
  });

  describe("leitura para quem compra", () => {
    test("destaca o melhor preco, quem vende e ha quanto tempo foi pago", () => {
      renderizar(base);
      const melhor = screen.getByLabelText("Melhor preço hoje");
      expect(melhor).toHaveTextContent("Horti A");
      expect(melhor).toHaveTextContent("/KG");
      expect(melhor).toHaveTextContent("Último preço pago há 5 dias");
    });

    test("avisa para confirmar o preco quando o melhor preco e antigo", () => {
      renderizar({ ...base, suppliers: [{ ...FORN_A, daysSinceLast: 60, isStale: true }, FORN_B] });
      expect(screen.getByLabelText("Melhor preço hoje")).toHaveTextContent("Preço de há 60 dias: confirme com o fornecedor antes de pedir.");
      expect(within(screen.getAllByRole("listitem")[0]).getByText("Preço antigo")).toBeInTheDocument();
    });

    test("mostra quanto se pagou a mais nos ultimos 90 dias", () => {
      renderizar({ ...base, savings: { windowDays: 90, amount: 30, spent: 180, percent: 16.7, purchases: 2 } });
      const melhor = screen.getByLabelText("Melhor preço hoje");
      expect(melhor).toHaveTextContent("Nos últimos 90 dias, 2 compras saíram acima desse preço");
      expect(melhor).toHaveTextContent("16,7% do gasto");
    });

    test("so mostra o painel de melhor preco quando ha o que comparar", () => {
      renderizar({ ...base, suppliers: [FORN_A] });
      expect(screen.queryByLabelText("Melhor preço hoje")).not.toBeInTheDocument();
    });

    test("avisa quando um fornecedor subiu o preco desde a compra anterior dele", () => {
      renderizar(base);
      const linhaB = screen.getAllByRole("listitem")[1];
      expect(linhaB).toHaveTextContent("Subiu 21,1% desde a compra anterior");
      expect(within(screen.getAllByRole("listitem")[0]).queryByText(/desde a compra anterior/)).not.toBeInTheDocument();
    });

    test("mostra a quantidade da ultima compra como referencia de pedido", () => {
      renderizar(base);
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("pediu 20 KG");
    });
  });
});
