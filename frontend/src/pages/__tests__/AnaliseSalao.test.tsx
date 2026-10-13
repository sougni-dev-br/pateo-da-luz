import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AnaliseCancelamentos, AnaliseVendasPorPessoa } from "../../api/client";

vi.mock("../../api/client", () => ({
  getAnaliseCancelamentos: vi.fn(),
  getAnaliseVendasPorPessoa: vi.fn()
}));

import { getAnaliseCancelamentos, getAnaliseVendasPorPessoa } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { AnaliseSalao } from "../AnaliseSalao";

const SESSAO = {
  user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true
} as unknown as SessionContextValue;

const PERIODO = { inicio: "2026-09-14", fim: "2026-10-13" };

// Dados fictícios.
function cancelamentos(over: Partial<AnaliseCancelamentos> = {}): AnaliseCancelamentos {
  return {
    periodo: PERIODO,
    cobertura: { vendasComDetalhe: 100, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: { vendas: 100, canceladas: 7, taxaCancelamento: 0.07, valorCancelado: 1234.5, valorFaturado: 20000, semMotivo: 7 },
    porPessoa: [
      { pessoa: "Ana Fictícia", canceladas: 4, valor: 900, participacao: 0.73 },
      { pessoa: "Bruno Fictício", canceladas: 3, valor: 334.5, participacao: 0.27 }
    ],
    porTurno: [{ turno: "Jantar", vendas: 60, canceladas: 5, taxa: 0.0833, valor: 1000 }],
    porHora: [{ hora: "20", vendas: 30, canceladas: 3, taxa: 0.1, valor: 600 }, { hora: "—", vendas: 2, canceladas: 0, taxa: 0, valor: 0 }],
    porDia: [],
    maiores: [{ saleId: "9", data: "2026-10-02", hora: "20:30", turno: "Jantar", pessoa: "Ana Fictícia", pessoas: 4, valor: 450, motivo: null }],
    ...over
  };
}

const vendasPessoa: AnaliseVendasPorPessoa = {
  periodo: PERIODO,
  cobertura: { itensComPessoa: 50, itensSemPessoa: 0 },
  resumo: { pessoas: 1, valorTotal: 5000, valorSemPessoa: 0, itensSemPessoa: 0 },
  pessoas: [{
    pessoa: "Carla Fictícia", valor: 5000, participacao: 1, itens: 120, vendas: 40, ticketMedio: 125, itensPorVenda: 3,
    mix: [{ grupo: "Bebidas", valor: 2000, participacao: 0.4 }]
  }]
};

function renderizar() {
  return render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider><AnaliseSalao /></HideValuesProvider>
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAnaliseCancelamentos).mockResolvedValue(cancelamentos());
  vi.mocked(getAnaliseVendasPorPessoa).mockResolvedValue(vendasPessoa);
});

describe("Análise do Salão — cancelamentos", () => {
  test("abre em cancelamentos, pedindo os últimos 30 dias, e mostra quem cancelou", async () => {
    renderizar();
    expect(await screen.findByText("Bruno Fictício")).toBeTruthy();
    const periodo = vi.mocked(getAnaliseCancelamentos).mock.calls[0][0];
    expect(periodo.inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodo.fim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText("7 de 100 vendas")).toBeTruthy();
    expect(screen.getByText("Bruno Fictício")).toBeTruthy();
    expect(getAnaliseVendasPorPessoa).not.toHaveBeenCalled();
  });

  test("hora sem informação aparece como 'Sem hora'", async () => {
    renderizar();
    expect(await screen.findByText("Sem hora")).toBeTruthy();
    expect(screen.getByText("20h")).toBeTruthy();
  });

  test("sem venda detalhada no período: explica que falta atualizar o agente, sem mostrar zeros", async () => {
    vi.mocked(getAnaliseCancelamentos).mockResolvedValue(cancelamentos({
      cobertura: { vendasComDetalhe: 0, primeiroDia: null, ultimoDia: null },
      resumo: { vendas: 0, canceladas: 0, taxaCancelamento: 0, valorCancelado: 0, valorFaturado: 0, semMotivo: 0 },
      porPessoa: [], porTurno: [], porHora: [], maiores: []
    }));
    renderizar();
    expect(await screen.findByText(/Ainda não há venda detalhada neste período/)).toBeTruthy();
    expect(screen.queryByText("Quem cancelou")).toBeNull();
  });

  test("avisa quando nenhum cancelamento tem motivo", async () => {
    renderizar();
    expect(await screen.findByText(/Nenhum dos 7 cancelamentos tem motivo registrado/)).toBeTruthy();
  });

  test("não avisa de motivo quando pelo menos um foi informado", async () => {
    vi.mocked(getAnaliseCancelamentos).mockResolvedValue(cancelamentos({ resumo: { ...cancelamentos().resumo, semMotivo: 3 } }));
    renderizar();
    await screen.findByText("Bruno Fictício");
    expect(screen.queryByText(/tem motivo registrado/)).toBeNull();
  });

  test("avisa que o detalhe começa depois do início do período", async () => {
    vi.mocked(getAnaliseCancelamentos).mockResolvedValue(cancelamentos({
      cobertura: { vendasComDetalhe: 100, primeiroDia: "2026-10-01", ultimoDia: "2026-10-13" }
    }));
    renderizar();
    expect(await screen.findByText(/O detalhe das vendas começa em 01\/10\/2026/)).toBeTruthy();
  });

  test("erro da API aparece na tela", async () => {
    vi.mocked(getAnaliseCancelamentos).mockRejectedValue(new Error("Usuário sem permissão para a análise do salão."));
    renderizar();
    expect(await screen.findByText("Usuário sem permissão para a análise do salão.")).toBeTruthy();
  });
});

describe("Análise do Salão — período e abas", () => {
  test("trocar o período pede o relatório de novo", async () => {
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    await waitFor(() => expect(getAnaliseCancelamentos).toHaveBeenCalledTimes(2));
  });

  test("data apagada: avisa e não chama a API", async () => {
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    expect(await screen.findByText(/Confira as datas/)).toBeTruthy();
    expect(getAnaliseCancelamentos).toHaveBeenCalledTimes(1);
  });

  test("a aba 'Vendas por pessoa' busca o outro relatório", async () => {
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.click(screen.getByRole("tab", { name: "Vendas por pessoa" }));
    expect(await screen.findByText("Carla Fictícia")).toBeTruthy();
    expect(getAnaliseVendasPorPessoa).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ticket médio é o valor lançado pela pessoa/)).toBeTruthy();
    expect(screen.getByText(/Bebidas/)).toBeTruthy();
  });

  test("vendas por pessoa vazio explica o motivo, e itens sem nome aparecem em aviso", async () => {
    vi.mocked(getAnaliseVendasPorPessoa).mockResolvedValue({
      ...vendasPessoa, pessoas: [], resumo: { pessoas: 0, valorTotal: 0, valorSemPessoa: 300, itensSemPessoa: 12 },
      cobertura: { itensComPessoa: 0, itensSemPessoa: 12 }
    });
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.click(screen.getByRole("tab", { name: "Vendas por pessoa" }));
    expect(await screen.findByText(/Nenhum item com o funcionário que o lançou/)).toBeTruthy();
    expect(screen.getByText(/Há 12 itens sem essa informação/)).toBeTruthy();
  });
});
