import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ApuracaoRescisao, TipComputation, TipComputedParticipant } from "../../../api/client";
import type { ReactElement } from "react";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { ApuracaoRescisaoPainel } from "../../../components/pessoal/ApuracaoRescisao";
import { AbaPagamento } from "../AbaPagamento";
import { linhaListaPagamento } from "../exportarPdf";
import { REGRA_DSR, mostraDsr, toRows } from "../gorjetaUtils";

// DSR sobre a hora extra e o noturno de quem não tem registro (a partir de setembro/2026).
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: null, companyName: null, functionName: null,
    isActive: true, semRegistro: true, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true },
    diasPrevistos: 26, diasComputados: 26, fatorPresenca: 1, pontosApurados: 2, points: 2, pontosDireito: 2, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, tipoCalculo: "MES", valorPonto: 150, rescisaoServicoBruto: null, rescisaoServicoOrigem: null, rescisaoValorFixo: null,
    pagoNaRescisao: false, rescisaoRecibo: null, rescisaoContasPagar: null, gorjetaCalculada: 300, gorjetaReal: null, rescisaoPendente: false,
    rateioAmount: 300, descontos: 0, creditos: 0, valesTotal: 0, netCommission: 300, diasSalarioOverride: null, diasSalario: 30,
    salarioProporcional: 2200, adiantamentoSalarial: 0, valorHoraExtra: 0, valorAdicionalNoturno: 0, valorDsr: 0, totalAPagar: 2500, baseSalary: 2200,
    pixKeyType: null, pixKey: null, horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    ...over,
  } as TipComputedParticipant;
}

function comp(participants: TipComputedParticipant[]): TipComputation {
  return {
    year: 2026, month: 9, label: "Gorjeta 26/08–25/09", participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0,
    adiantamento: { percent: 40, dia: 20 },
  } as unknown as TipComputation;
}

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

// 10h de HE (R$ 150) + 7h de noturno (R$ 16); setembro/2026: DSR = 166 × 5 ÷ 25 = 33,20.
const DORA = {
  employeeId: "d", employeeName: "Dora Exemplo", horaExtra: "10:00", adicionalNoturno: "7:00",
  valorHoraExtra: 150, valorAdicionalNoturno: 16, valorDsr: 33.2, totalAPagar: 2699.2,
};

describe("lista de pagamento: DSR ao lado da hora extra", () => {
  test("coluna DSR com o valor, o total, a regra e a fórmula", () => {
    const c = comp([pessoa(DORA), pessoa({ employeeId: "b", employeeName: "Beto Sem Horas" })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly={false} onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /^DSR/ }).getAttribute("title")).toContain(REGRA_DSR);
    const dora = screen.getByText("Dora Exemplo").closest("tr")!;
    expect(within(dora).getByText("166,00")).toBeTruthy();
    expect(within(dora).getByText("33,20")).toBeTruthy();
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getByText("33,20")).toBeTruthy();
    expect(screen.getByText(/\+ hora extra e noturno \+ DSR\)/)).toBeTruthy();
    expect(screen.getByText(/DSR = \(hora extra \+ noturno\) × domingos e feriados ÷ dias úteis do mês/)).toBeTruthy();
  });

  test("sem a permissão de Funcionários: DSR \"oculto\"", () => {
    const c = comp([pessoa({ ...DORA, valorHoraExtra: null, valorAdicionalNoturno: null, valorDsr: null, adiantamentoSalarial: null, baseSalary: null })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const dora = screen.getByText("Dora Exemplo").closest("tr")!;
    expect(within(dora).getAllByText("oculto").length).toBe(3); // adiantamento, hora extra e DSR
  });

  test("ninguém com DSR (mês antes de setembro/2026): sem a coluna", () => {
    const c = comp([pessoa({ ...DORA, valorDsr: 0, totalAPagar: 2666 })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole("columnheader", { name: /^DSR/ })).toBeNull();
    expect(screen.queryByText(/\+ DSR\)/)).toBeNull();
  });

  test("regra compartilhada: quando mostrar a coluna", () => {
    expect(mostraDsr([pessoa({ valorDsr: 0 })])).toBe(false);
    expect(mostraDsr([pessoa({ valorDsr: 10 })])).toBe(true);
    expect(mostraDsr([pessoa({ valorDsr: null, horaExtra: "2:00" })])).toBe(true);
    expect(mostraDsr([pessoa({ valorDsr: undefined })])).toBe(false);
  });
});

describe("PDF da lista: DSR", () => {
  test("com DSR, a coluna entra depois do valor HE/AN", () => {
    const linha = linhaListaPagamento(pessoa(DORA), false, true);
    expect(linha[9]).toMatch(/166,00/);
    expect(linha[10]).toMatch(/33,20/);
    expect(linha[11]).toMatch(/2\.699,20/);
    expect(linhaListaPagamento(pessoa({ ...DORA, valorDsr: null }), false, true)[10]).toBe("oculto");
    // Sem a coluna, a linha é a de antes.
    expect(linhaListaPagamento(pessoa(DORA))).toHaveLength(12);
  });
});

describe("apuração da rescisão: DSR", () => {
  const base: ApuracaoRescisao = {
    saida: "2026-09-22", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 22, salarioProporcional: 1613.26 },
    gorjetaObservacao: null,
    sugestao: { salario: 1613.26, gorjeta: 186.8, creditos: 199.2, horaExtra: 199.2, vales: 0, valesRotulo: null, adiantamento: 0, vtDesconto: 0, bruto: 1999.26 },
    horaExtra: { horaExtra: "10:00", adicionalNoturno: "7:00", dsr: 33.2, valor: 199.2 },
  };
  test("com DSR, a linha diz que o valor leva o DSR e a regra", () => {
    render(<ApuracaoRescisaoPainel apuracao={base} aberto />);
    expect(screen.getByText("Hora extra, adicional noturno e DSR")).toBeTruthy();
    expect(screen.getByText(/DSR = \(hora extra \+ noturno\) × domingos e feriados ÷ dias úteis do mês/)).toBeTruthy();
  });
  test("sem DSR (apuração antiga), o rótulo de antes", () => {
    render(<ApuracaoRescisaoPainel apuracao={{ ...base, horaExtra: { horaExtra: "10:00", adicionalNoturno: "7:00", valor: 166 } }} aberto />);
    expect(screen.getByText("Hora extra e adicional noturno")).toBeTruthy();
  });
});
