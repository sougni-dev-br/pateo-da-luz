import { fireEvent, render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { AttentionList, type AttentionItem } from "./AttentionList";
import { ResultPanel, RevenueHero } from "./Panels";
import { PurchasesPanel } from "./Purchases";

const sessao = (hidden: boolean) =>
  ({
    user: null,
    setUser: () => undefined,
    hideSensitiveValues: hidden,
    toggleSensitiveValues: () => undefined,
    canAccessSection: () => true,
    hasPermission: () => true,
  }) as unknown as SessionContextValue;

const render = (ui: ReactElement, hidden = false) =>
  renderRaw(
    <SessionContext.Provider value={sessao(hidden)}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>,
  );

// Valores fictícios.
const VALOR_VISIVEL = /\d{1,3}(\.\d{3})*,\d{2}/;

describe("RevenueHero", () => {
  test("a conta fecha sem termo extra quando líquido = bruto − serviço", () => {
    render(<RevenueHero gross={1100} service={100} net={1000} delta={null} />);
    expect(screen.queryByText(/Deduções do delivery/)).toBeNull();
  });

  test("delivery sem serviço ganha o termo de deduções para a conta fechar", () => {
    render(<RevenueHero gross={1100} service={100} net={800} delta={null} />);
    const termo = screen.getByText(/Deduções do delivery/).closest("div")!;
    expect(termo.textContent).toContain("200,00");
  });

  test("ocultar valores não deixa número em reais na tela", () => {
    const { container } = render(<RevenueHero gross={1100} service={100} net={800} delta={null} />, true);
    expect(container.textContent).not.toMatch(VALOR_VISIVEL);
  });
});

describe("ResultPanel", () => {
  test("subtrações não mostram o sinal duas vezes", () => {
    const { container } = render(<ResultPanel net={1000} purchases={300} smallExpenses={50} result={650} margin={65} />);
    const compras = screen.getByText("− Compras").parentElement!;
    expect(compras.querySelector(".ds-money-sign")).toBeNull();
    expect(container.textContent).toContain("650,00");
  });

  test("ocultar valores esconde o resultado", () => {
    const { container } = render(<ResultPanel net={1000} purchases={300} smallExpenses={0} result={700} margin={70} />, true);
    expect(container.textContent).not.toMatch(VALOR_VISIVEL);
  });
});

describe("AttentionList", () => {
  const itens: AttentionItem[] = [
    { key: "a", bucket: "urgent", tone: "danger", title: "Contas vencidas", amount: 1234.5, actionLabel: "Contas a pagar", actionPath: "/financeiro/contas-a-pagar" },
    { key: "b", bucket: "waiting", tone: "info", title: "inventário final" },
  ];

  test("item com permissão vira botão que navega", () => {
    const onNavigate = vi.fn();
    render(<AttentionList items={itens} canNavigate={() => true} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Contas vencidas/ }));
    expect(onNavigate).toHaveBeenCalledWith("/financeiro/contas-a-pagar");
  });

  test("sem permissão para a tela de destino não há botão", () => {
    render(<AttentionList items={itens} canNavigate={() => false} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Contas vencidas")).toBeTruthy();
  });

  test("espera de fim de mês fica fora da contagem de pendências", () => {
    render(<AttentionList items={itens} canNavigate={() => true} onNavigate={vi.fn()} />);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/Aguardando o fim do mês/)).toBeTruthy();
  });

  test("ocultar valores esconde o valor das contas", () => {
    const { container } = render(<AttentionList items={itens} canNavigate={() => true} onNavigate={vi.fn()} />, true);
    expect(container.textContent).not.toMatch(VALOR_VISIVEL);
  });
});

describe("PurchasesPanel", () => {
  const rankings = {
    category: { rows: [{ name: "Carnes", total: 600 }, { name: "Peixes", total: 300 }], total: 1000 },
    supplier: { rows: [{ name: "Fornecedor A", total: 1000 }], total: 1000 },
    product: { rows: [], total: 0 },
  };

  test("mostra a linha Demais com o que ficou fora da lista", () => {
    render(<PurchasesPanel total={1000} count={3} delta={null} rankings={rankings} />);
    const demais = screen.getByText("Demais").closest("li")!;
    expect(demais.textContent).toContain("100,00");
    expect(demais.textContent).toContain("10,0%");
  });

  test("sem o resumo, a legenda não afirma que não há compras", () => {
    render(<PurchasesPanel total={1000} count={null} delta={null} rankings={rankings} />);
    expect(screen.queryByText(/Nenhuma compra lançada/)).toBeNull();
  });
});
