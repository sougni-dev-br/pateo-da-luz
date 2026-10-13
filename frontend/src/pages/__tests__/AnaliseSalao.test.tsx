import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AnaliseCancelamentos, AnaliseDescontos, AnaliseItensCancelados, AnaliseVendasPorPessoa } from "../../api/client";

vi.mock("../../api/client", () => ({
  getAnaliseCancelamentos: vi.fn(),
  getAnaliseDescontos: vi.fn(),
  getAnaliseItensCancelados: vi.fn(),
  getAnaliseVendasPorPessoa: vi.fn()
}));

import { getAnaliseCancelamentos, getAnaliseDescontos, getAnaliseItensCancelados, getAnaliseVendasPorPessoa } from "../../api/client";
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

function itensCancelados(over: Partial<AnaliseItensCancelados> = {}): AnaliseItensCancelados {
  const linha = (pessoa: string, itens: number, valor: number) => ({ pessoa, itens, vendas: itens, valor, participacao: 0.5 });
  return {
    periodo: PERIODO,
    cobertura: { itensCancelados: 12, itensSemVenda: 0, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: { itens: 12, vendasAfetadas: 9, valorCancelado: 640, valorItensRecebidos: 9000, taxaValor: 0.0664, semQuemCancelou: 0, semMotivo: 12, mesmaPessoa: 5, comOsDoisNomes: 12 },
    porQuemLancou: [linha("Helena Fictícia", 8, 400), linha("Igor Fictício", 4, 240)],
    porQuemCancelou: [linha("Júlia Fictícia", 12, 640)],
    porProduto: [{ produto: "BUFFET PROMO 15", grupo: "Buffet", linhas: 3, quantidade: 14, valor: 500 }],
    porHora: [{ hora: "13", itens: 7, valor: 400 }],
    maiores: [{ saleId: "1", data: "2026-10-02", hora: "13:11", produto: "BUFFET PROMO 15", quantidade: 14, valor: 500, quemLancou: "Helena Fictícia", quemCancelou: "Júlia Fictícia", motivo: null }],
    ...over
  };
}

function descontos(over: Partial<AnaliseDescontos> = {}): AnaliseDescontos {
  return {
    periodo: PERIODO,
    cobertura: { vendasComDado: 100, vendasSemDado: 0, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: {
      vendasRecebidas: 100, vendasComDesconto: 6, taxaVendas: 0.06, valorDescontos: 480, valorSubtotal: 12000,
      percentualSobreSubtotal: 0.04, descontoMedio: 80, acimaDe50: 2, semPessoa: 0, semTipo: 0
    },
    porTipo: [
      { tipo: "POR VALOR", vendas: 4, valor: 300, participacao: 0.625, percentualMedio: 0.4 },
      { tipo: "DESCONTO 30%", vendas: 2, valor: 180, participacao: 0.375, percentualMedio: 0.3 }
    ],
    porPessoa: [{ pessoa: "Kátia Fictícia", vendas: 6, valor: 480, participacao: 1, percentualMedio: 0.04 }],
    porTurno: [{ turno: "Jantar", vendas: 60, vendasComDesconto: 6, taxa: 0.1, valor: 480 }],
    maiores: [{ saleId: "1", data: "2026-10-02", hora: "20:30", turno: "Jantar", pessoas: 2, subtotal: 100, desconto: 90, percentual: 0.9, tipo: "POR VALOR", pessoa: "Kátia Fictícia" }],
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
  vi.mocked(getAnaliseItensCancelados).mockResolvedValue(itensCancelados());
  vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos());
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

describe("Análise do Salão — itens cancelados", () => {
  async function abrirAba() {
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.click(screen.getByRole("tab", { name: "Itens cancelados" }));
  }

  test("a aba busca o relatório certo e mostra quem lançou, quem cancelou e o produto", async () => {
    await abrirAba();
    expect(await screen.findByText("Igor Fictício", { selector: "td" })).toBeTruthy();
    expect(getAnaliseItensCancelados).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Júlia Fictícia", { selector: "td" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("BUFFET PROMO 15").length).toBeGreaterThan(0);
    expect(screen.getByText("em 9 vendas pagas")).toBeTruthy();
  });

  test("explica que a venda inteira cancelada fica na outra aba", async () => {
    await abrirAba();
    expect(await screen.findByText(/A venda inteira cancelada fica na aba Cancelamentos/)).toBeTruthy();
  });

  test("avisa quando nenhum item tem motivo", async () => {
    await abrirAba();
    expect(await screen.findByText(/Nenhum item cancelado tem motivo registrado/)).toBeTruthy();
  });

  test("quem cancelou ainda não importado: avisa e não mostra a tabela de quem cancelou", async () => {
    vi.mocked(getAnaliseItensCancelados).mockResolvedValue(itensCancelados({
      resumo: { ...itensCancelados().resumo, semQuemCancelou: 12, mesmaPessoa: 0, comOsDoisNomes: 0 },
      porQuemCancelou: [{ pessoa: "(não informado)", itens: 12, vendas: 9, valor: 640, participacao: 1 }]
    }));
    await abrirAba();
    expect(await screen.findByText(/Ainda não temos quem cancelou cada item/)).toBeTruthy();
    expect(screen.queryByText("Quem cancelou")).toBeNull();
    expect(screen.queryByText("Quem lançou também cancelou")).toBeNull();
  });

  test("parte sem quem cancelou: aviso leve e a tabela continua", async () => {
    vi.mocked(getAnaliseItensCancelados).mockResolvedValue(itensCancelados({ resumo: { ...itensCancelados().resumo, semQuemCancelou: 4 } }));
    await abrirAba();
    expect(await screen.findByText(/4 de 12 itens ainda estão sem quem cancelou/)).toBeTruthy();
    expect(screen.getByText("Quem cancelou")).toBeTruthy();
  });

  test("sem item cancelado no período: mensagem simples, sem zeros", async () => {
    vi.mocked(getAnaliseItensCancelados).mockResolvedValue(itensCancelados({
      cobertura: { itensCancelados: 0, itensSemVenda: 0, primeiroDia: null, ultimoDia: null },
      resumo: { itens: 0, vendasAfetadas: 0, valorCancelado: 0, valorItensRecebidos: 0, taxaValor: 0, semQuemCancelou: 0, semMotivo: 0, mesmaPessoa: 0, comOsDoisNomes: 0 },
      porQuemLancou: [], porQuemCancelou: [], porProduto: [], porHora: [], maiores: []
    }));
    await abrirAba();
    expect(await screen.findByText(/Nenhum item cancelado em vendas pagas neste período/)).toBeTruthy();
  });

  test("itens descartados por falta da venda são avisados, não somem calados", async () => {
    vi.mocked(getAnaliseItensCancelados).mockResolvedValue(itensCancelados({
      cobertura: { itensCancelados: 12, itensSemVenda: 3, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" }
    }));
    await abrirAba();
    expect(await screen.findByText(/3 itens cancelados ficaram de fora porque a venda deles não foi importada/)).toBeTruthy();
  });

  test("o aviso de motivo é informativo e o KPI de quem lançou e cancelou é neutro", async () => {
    await abrirAba();
    expect(await screen.findByText("5 de 12")).toBeTruthy();
    expect(screen.getByText(/corrigiu o próprio lançamento/)).toBeTruthy();
  });
});

describe("Análise do Salão — descontos", () => {
  async function abrirAba() {
    renderizar();
    await screen.findByText("Bruno Fictício");
    fireEvent.click(screen.getByRole("tab", { name: "Descontos" }));
  }

  test("a aba busca o relatório certo e mostra tipo, quem registrou e os maiores", async () => {
    await abrirAba();
    expect(await screen.findByText("DESCONTO 30%", { selector: "td" })).toBeTruthy();
    expect(getAnaliseDescontos).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Kátia Fictícia", { selector: "td" }).length).toBeGreaterThan(0);
    expect(screen.getByText("6 de 100 vendas")).toBeTruthy();
  });

  test("avisa quantos descontos passam de 50% do subtotal", async () => {
    await abrirAba();
    expect(await screen.findByText(/2 vendas com desconto acima de 50% do subtotal/)).toBeTruthy();
  });

  test("explica que 'quem registrou' vem do campo do PDV e precisa de confirmação", async () => {
    await abrirAba();
    expect(await screen.findByText(/campo de quem cancelou\/registrou do PDV/)).toBeTruthy();
  });

  test("linhas ainda sem dado de desconto: avisa e nao mostra 'zero descontos'", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({
      cobertura: { vendasComDado: 0, vendasSemDado: 480, primeiroDia: null, ultimoDia: null },
      resumo: { vendasRecebidas: 0, vendasComDesconto: 0, taxaVendas: 0, valorDescontos: 0, valorSubtotal: 0, percentualSobreSubtotal: 0, descontoMedio: 0, acimaDe50: 0, semPessoa: 0, semTipo: 0 },
      porTipo: [], porPessoa: [], porTurno: [], maiores: []
    }));
    await abrirAba();
    expect(await screen.findByText(/Ainda não há dado de desconto neste período/)).toBeTruthy();
    expect(screen.queryByText("Descontos por tipo")).toBeNull();
  });

  test("parte do período sem dado: aviso leve e o relatório continua", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({
      cobertura: { vendasComDado: 100, vendasSemDado: 40, primeiroDia: "2026-09-20", ultimoDia: "2026-10-13" }
    }));
    await abrirAba();
    expect(await screen.findByText(/40 vendas do período ainda não têm dado de desconto/)).toBeTruthy();
    expect(screen.getByText("Descontos por tipo")).toBeTruthy();
  });

  test("tipo ou pessoa não informados são avisados", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({ resumo: { ...descontos().resumo, semPessoa: 3, semTipo: 2 } }));
    await abrirAba();
    expect(await screen.findByText(/3 descontos sem a pessoa que registrou e 2 sem o tipo/)).toBeTruthy();
  });

  test("período sem nenhuma venda: não manda 'atualizar o agente'", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({
      cobertura: { vendasComDado: 0, vendasSemDado: 0, primeiroDia: null, ultimoDia: null },
      resumo: { vendasRecebidas: 0, vendasComDesconto: 0, taxaVendas: 0, valorDescontos: 0, valorSubtotal: 0, percentualSobreSubtotal: 0, descontoMedio: 0, acimaDe50: 0, semPessoa: 0, semTipo: 0 },
      porTipo: [], porPessoa: [], porTurno: [], maiores: []
    }));
    await abrirAba();
    expect(await screen.findByText(/Nenhuma venda recebida neste período/)).toBeTruthy();
    expect(screen.queryByText(/agente do PDV precisa estar atualizado/)).toBeNull();
  });

  test("só a pessoa faltando: a frase não cita 'sem o tipo' com zero", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({ resumo: { ...descontos().resumo, semPessoa: 3, semTipo: 0 } }));
    await abrirAba();
    expect(await screen.findByText(/3 descontos sem a pessoa que registrou\./)).toBeTruthy();
  });

  test("uma venda acima de 50% usa o singular", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({ resumo: { ...descontos().resumo, acimaDe50: 1 } }));
    await abrirAba();
    expect(await screen.findByText(/1 venda com desconto acima de 50% do subtotal/)).toBeTruthy();
  });

  test("a tabela por pessoa avisa que é volume absoluto, não proporção do que cada um atendeu", async () => {
    await abrirAba();
    expect(await screen.findByText(/não considera quantas vendas cada pessoa atendeu/)).toBeTruthy();
    expect(screen.getByText("Registrado por (campo do PDV)")).toBeTruthy();
  });

  test("período sem nenhum desconto: mensagem simples", async () => {
    vi.mocked(getAnaliseDescontos).mockResolvedValue(descontos({
      resumo: { ...descontos().resumo, vendasComDesconto: 0, taxaVendas: 0, valorDescontos: 0, percentualSobreSubtotal: 0, descontoMedio: 0, acimaDe50: 0 },
      porTipo: [], porPessoa: [], porTurno: [], maiores: []
    }));
    await abrirAba();
    expect(await screen.findByText(/Nenhuma venda com desconto neste período/)).toBeTruthy();
  });
});
