import { fireEvent, render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { CmvPeriodDetail } from "../../../api/client";
import { ComposicaoDoPeriodo } from "../ComposicaoDoPeriodo";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

const SESSAO = {
  user: null,
  setUser: () => undefined,
  hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined,
  canAccessSection: () => true,
  hasPermission: () => true,
} as unknown as SessionContextValue;

/** Money le o contexto de ocultar valores, que por sua vez le a sessao. */
const render = (ui: ReactElement) =>
  renderRaw(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>
  );

/** Abril/2026 como o endpoint devolve: 4 categorias que somam as compras. */
const DETALHE = {
  purchasesGrossTotal: 171254.31,
  revenueNetTotal: 377400.74,
  purchaseByCategory: [
    { categoryName: "Custo de Alimentos", totalAmount: 147407.86, itemsCount: 641 },
    { categoryName: "Embalagens", totalAmount: 12782.63, itemsCount: 31 },
    { categoryName: "Bebidas", totalAmount: 11045.66, itemsCount: 54 },
    { categoryName: "Descartáveis / Delivery", totalAmount: 18.16, itemsCount: 1 }
  ],
  purchaseBySupplier: [
    { supplierId: "s1", supplierName: "NOVA UNIAO ALIMENTOS", supplierDocument: "07.172.011/0001-06", totalAmount: 39564.14, purchasesCount: 9 },
    { supplierId: "s2", supplierName: "PESCADOS POPO", supplierDocument: null, totalAmount: 38011.4, purchasesCount: 10 }
  ],
  revenueByChannel: [
    { channel: "Salão", grossAmount: 228240.69, netAmount: 207653.04, count: 28 },
    { channel: "Delivery", grossAmount: 169747.7, netAmount: 169747.7, count: 84 }
  ]
} as unknown as CmvPeriodDetail;

describe("ComposicaoDoPeriodo", () => {
  test("abre em categorias e mostra so uma tabela por vez", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);

    expect(screen.getByText("Custo de Alimentos")).toBeInTheDocument();
    // As outras duas nao ocupam altura enquanto nao sao pedidas.
    expect(screen.queryByText("NOVA UNIAO ALIMENTOS")).not.toBeInTheDocument();
    expect(screen.queryByText("Salão")).not.toBeInTheDocument();
  });

  test("trocar de aba troca a tabela", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);

    fireEvent.click(screen.getByRole("tab", { name: /fornecedores/i }));
    expect(screen.getByText("NOVA UNIAO ALIMENTOS")).toBeInTheDocument();
    expect(screen.queryByText("Custo de Alimentos")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /canais/i }));
    expect(screen.getByText("Salão")).toBeInTheDocument();
  });

  test("a aba diz quantas linhas tem, para escolher sem abrir as tres", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);

    expect(screen.getByRole("tab", { name: /categorias/i })).toHaveTextContent("4");
    expect(screen.getByRole("tab", { name: /fornecedores/i })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /canais/i })).toHaveTextContent("2");
  });

  test("a participacao e' sobre o total do periodo, nao sobre o topo da lista", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);
    // 147.407,86 de 171.254,31 = 86,1%
    expect(screen.getByText("86,1%")).toBeInTheDocument();
  });

  test("receita usa o total liquido como base, nao o de compras", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);
    fireEvent.click(screen.getByRole("tab", { name: /canais/i }));
    // 207.653,04 de 377.400,74 = 55,0%
    expect(screen.getByText("55,0%")).toBeInTheDocument();
  });

  test("sem detalhe ainda carregado, as abas aparecem zeradas em vez de sumir", () => {
    render(<ComposicaoDoPeriodo detail={null} />);

    expect(screen.getByRole("tab", { name: /categorias/i })).toHaveTextContent("0");
    expect(screen.getByText("Sem dados para este período.")).toBeInTheDocument();
  });

  test("fornecedor sem documento nao quebra a linha", () => {
    render(<ComposicaoDoPeriodo detail={DETALHE} />);
    fireEvent.click(screen.getByRole("tab", { name: /fornecedores/i }));
    expect(screen.getByText("PESCADOS POPO")).toBeInTheDocument();
  });
});
