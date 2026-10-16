import { fireEvent, render as renderRaw, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { DashboardRankingView } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { composicao, visaoInicial } from "./naturezas";
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

const visao = (produtos: Array<[string, number]>): DashboardRankingView => {
  const rows = produtos.map(([name, total]) => ({ name, total }));
  const total = rows.reduce((s, r) => s + r.total, 0);
  return { category: { rows, total }, supplier: { rows, total }, product: { rows, total } };
};

const NATUREZAS: NaturezasDasCompras = {
  byNature: [
    { nature: "INSUMO", total: 900, items: 2 },
    { nature: "SERVICO", total: 100, items: 1 },
  ],
  unitemizedTotal: 0,
  views: {
    TODAS: visao([["Peixe", 600], ["Carne", 300], ["Conserto", 100]]),
    INSUMO: visao([["Peixe", 600], ["Carne", 300]]),
    SERVICO: visao([["Conserto", 100]]),
  },
};

const VAZIO = { rows: [], total: 0 };
const painel = (naturezas: NaturezasDasCompras | undefined) => (
  <PurchasesPanel
    total={1000}
    count={3}
    delta={null}
    rankings={{ category: VAZIO, supplier: VAZIO, product: VAZIO }}
    naturezas={naturezas}
  />
);

const nomesNaLista = () =>
  within(screen.getByRole("tabpanel")).getAllByRole("listitem").map((li) => li.querySelector(".dash-bar-name")!.textContent);

describe("composicao", () => {
  test("percentuais somam 100 incluindo notas sem itens", () => {
    const s = composicao([{ nature: "INSUMO", total: 750 }], 250);
    expect(s.map((x) => [x.chave, x.pct])).toEqual([["INSUMO", 75], ["SEM_ITENS", 25]]);
  });

  test("natureza sem valor não vira segmento", () => {
    expect(composicao([{ nature: "INSUMO", total: 0 }], 0)).toEqual([]);
  });
});

describe("visaoInicial", () => {
  test("abre em Insumos quando há insumo no mês", () => {
    expect(visaoInicial([{ nature: "SERVICO", total: 1 }, { nature: "INSUMO", total: 1 }])).toBe("INSUMO");
  });

  test("sem insumo, abre em todas", () => {
    expect(visaoInicial([{ nature: "SERVICO", total: 1 }])).toBe("TODAS");
  });
});

describe("PurchasesPanel com natureza", () => {
  test("abre em Insumos: serviço não aparece entre os produtos", () => {
    render(painel(NATUREZAS));
    expect(screen.getByRole("button", { name: /Insumos/ }).getAttribute("aria-pressed")).toBe("true");
    expect(nomesNaLista()).toEqual(["Peixe", "Carne"]);
  });

  test("escolher Serviços recorta a lista", () => {
    render(painel(NATUREZAS));
    fireEvent.click(screen.getByRole("button", { name: /Serviços/ }));
    expect(nomesNaLista()).toEqual(["Conserto"]);
  });

  test("Todas mostra tudo", () => {
    render(painel(NATUREZAS));
    fireEvent.click(screen.getByRole("button", { name: "Todas" }));
    expect(nomesNaLista()).toEqual(["Peixe", "Carne", "Conserto"]);
  });

  test("natureza escolhida que não existe no mês mostra lista vazia, não outra visão", () => {
    const { rerender } = render(painel(NATUREZAS));
    fireEvent.click(screen.getByRole("button", { name: /Serviços/ }));
    const semServico: NaturezasDasCompras = {
      byNature: [{ nature: "INSUMO", total: 900, items: 2 }],
      unitemizedTotal: 0,
      views: { TODAS: NATUREZAS.views.TODAS, INSUMO: NATUREZAS.views.INSUMO },
    };
    rerender(
      <SessionContext.Provider value={sessao}>
        <HideValuesProvider>{painel(semServico)}</HideValuesProvider>
      </SessionContext.Provider>,
    );
    expect(screen.getByText(/Nenhuma compra de serviços neste mês/)).toBeTruthy();
  });

  test("sem escolha da pessoa, a visão acompanha os dados e abre em Insumos quando eles chegam", () => {
    const soServico: NaturezasDasCompras = {
      byNature: [{ nature: "SERVICO", total: 100, items: 1 }],
      unitemizedTotal: 0,
      views: { TODAS: NATUREZAS.views.TODAS, SERVICO: NATUREZAS.views.SERVICO },
    };
    const { rerender } = render(painel(soServico));
    expect(screen.getByRole("button", { name: "Todas" }).getAttribute("aria-pressed")).toBe("true");
    rerender(
      <SessionContext.Provider value={sessao}>
        <HideValuesProvider>{painel(NATUREZAS)}</HideValuesProvider>
      </SessionContext.Provider>,
    );
    expect(screen.getByRole("button", { name: /Insumos/ }).getAttribute("aria-pressed")).toBe("true");
  });

  test("backend sem natureza continua funcionando sem a barra", () => {
    render(
      <PurchasesPanel
        total={10}
        count={1}
        delta={null}
        rankings={{ category: { rows: [{ name: "Cat", total: 10 }], total: 10 }, supplier: VAZIO, product: VAZIO }}
      />,
    );
    expect(screen.queryByRole("group", { name: /natureza/ })).toBeNull();
    expect(screen.getByText("Cat")).toBeTruthy();
  });
});
