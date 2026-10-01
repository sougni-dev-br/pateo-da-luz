import { fireEvent, render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ApuracaoRescisao, TipComputation, TipComputedParticipant } from "../../../api/client";
import type { ReactElement } from "react";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { ApuracaoRescisaoPainel } from "../../../components/pessoal/ApuracaoRescisao";
import { AbaPagamento } from "../AbaPagamento";
import { celulaValorHoraExtra, linhaListaPagamento } from "../exportarPdf";
import { toRows, valorHoraExtraTotal } from "../gorjetaUtils";

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
    salarioProporcional: 2200, adiantamentoSalarial: 0, valorHoraExtra: 0, valorAdicionalNoturno: 0, totalAPagar: 2500, baseSalary: 2200,
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
const render = (ui: ReactElement, sessao: SessionContextValue = SESSAO) => renderRaw(<SessionContext.Provider value={sessao}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

// Ana: 10h de HE (R$ 150) e 7h de noturno (R$ 16) sobre R$ 2.200 de base.
const ANA = { employeeId: "a", employeeName: "Ana Hora Extra", horaExtra: "10:00", adicionalNoturno: "7:00", valorHoraExtra: 150, valorAdicionalNoturno: 16, totalAPagar: 2666 };

describe("lista de pagamento: hora extra e adicional noturno do sem registro", () => {
  test("colunas com as horas digitadas, o valor calculado e os totais", () => {
    const c = comp([pessoa(ANA), pessoa({ employeeId: "b", employeeName: "Bia Sem Horas" })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly={false} onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: /Valor HE\/noturno/ }).getAttribute("title")).toContain("salário ÷ 220 × 1,5");
    const ana = screen.getByText("Ana Hora Extra").closest("tr")!;
    expect((within(ana).getByLabelText("Hora extra") as HTMLInputElement).value).toBe("10:00");
    expect((within(ana).getByLabelText("Adicional noturno") as HTMLInputElement).value).toBe("7:00");
    expect(within(ana).getByText("166,00")).toBeTruthy();
    expect(within(ana).getByText("2.666,00")).toBeTruthy();
    const bia = screen.getByText("Bia Sem Horas").closest("tr")!;
    expect(within(bia).getAllByText("—").length).toBeGreaterThan(0);
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getByText("10:00")).toBeTruthy();
    expect(within(total).getByText("7:00")).toBeTruthy();
    expect(within(total).getByText("166,00")).toBeTruthy();
    expect(screen.getByText(/Lista de pagamento \(salário − adiantamento \+ gorjeta \+ hora extra\)/)).toBeTruthy();
    expect(screen.getByText(/adicional noturno = 20% sobre a hora noturna de 52,5 min/)).toBeTruthy();
  });

  test("digitar grava pela linha e normaliza para h:mm ao sair do campo", () => {
    const onRow = vi.fn();
    const c = comp([pessoa(ANA)]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly={false} onRow={onRow} onError={vi.fn()} />);
    const ana = screen.getByText("Ana Hora Extra").closest("tr")!;
    const he = within(ana).getByLabelText("Hora extra");
    fireEvent.change(he, { target: { value: "7,5" } });
    expect(onRow).toHaveBeenCalledWith("a", { horaExtra: "7,5" });
    fireEvent.blur(he, { target: { value: "7,5" } });
    expect(onRow).toHaveBeenLastCalledWith("a", { horaExtra: "7:30" });
    fireEvent.blur(within(ana).getByLabelText("Adicional noturno"), { target: { value: "2h15" } });
    expect(onRow).toHaveBeenLastCalledWith("a", { adicionalNoturno: "2:15" });
  });

  test("período fechado ou só leitura: campos desabilitados", () => {
    const c = comp([pessoa(ANA)]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const ana = screen.getByText("Ana Hora Extra").closest("tr")!;
    expect((within(ana).getByLabelText("Hora extra") as HTMLInputElement).disabled).toBe(true);
    expect((within(ana).getByLabelText("Adicional noturno") as HTMLInputElement).disabled).toBe(true);
  });

  test("sem a permissão de Funcionários (valor null): \"oculto\" na linha e no total, com a nota", () => {
    const c = comp([pessoa({ ...ANA, valorHoraExtra: null, valorAdicionalNoturno: null, adiantamentoSalarial: null, baseSalary: null })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const ana = screen.getByText("Ana Hora Extra").closest("tr")!;
    expect(within(ana).getAllByText("oculto").length).toBe(2); // adiantamento e hora extra
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getAllByText("oculto").length).toBe(2);
    expect(screen.getByText(/A pagar já considera a hora extra/)).toBeTruthy();
  });

  test("respeita \"ocultar valores\"", () => {
    const c = comp([pessoa(ANA)]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, { ...SESSAO, hideSensitiveValues: true } as SessionContextValue);
    const ana = screen.getByText("Ana Hora Extra").closest("tr")!;
    expect(within(ana).queryByText("166,00")).toBeNull();
  });

  test("pago na rescisão: o valor aparece, mas não soma no total da lista", () => {
    const c = comp([pessoa(ANA), pessoa({ ...ANA, employeeId: "c", employeeName: "Caio Saiu", pagoNaRescisao: true, tipoCalculo: "RESCISAO", totalAPagar: 0 })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getByText("166,00")).toBeTruthy();
  });
});

describe("hora extra no PDF da lista e nas regras compartilhadas", () => {
  test("valor total: null = sem permissão; soma HE + noturno", () => {
    expect(valorHoraExtraTotal({ valorHoraExtra: null, valorAdicionalNoturno: null })).toBeNull();
    expect(valorHoraExtraTotal({ valorHoraExtra: 150, valorAdicionalNoturno: 16 })).toBe(166);
  });
  test("célula do PDF e linha com as horas em h:mm", () => {
    expect(celulaValorHoraExtra(null)).toBe("oculto");
    expect(celulaValorHoraExtra(0)).toBe("");
    expect(celulaValorHoraExtra(166)).toMatch(/^R\$\s*166,00$/);
    const linha = linhaListaPagamento(pessoa({ ...ANA, horaExtra: "7,5" }));
    expect(linha.slice(7, 10)).toEqual(["7:30", "7:00", expect.stringMatching(/166,00/)]);
    expect(linha[10]).toMatch(/2\.666,00/);
  });
});

describe("apuração da rescisão: hora extra", () => {
  const base: ApuracaoRescisao = {
    saida: "2026-09-22", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 22, salarioProporcional: 1613.26 },
    gorjetaObservacao: null,
    sugestao: { salario: 1613.26, gorjeta: 186.8, creditos: 166, horaExtra: 166, vales: 0, valesRotulo: null, adiantamento: 0, vtDesconto: 0, bruto: 1966.06 },
    horaExtra: { horaExtra: "10:00", adicionalNoturno: "7:00", valor: 166 },
  };
  test("mostra a linha com as horas e o líquido já com ela", () => {
    render(<ApuracaoRescisaoPainel apuracao={base} aberto />);
    expect(screen.getByText("Hora extra e adicional noturno")).toBeTruthy();
    expect(screen.getByText(/HE 10:00 · noturno 7:00/)).toBeTruthy();
    expect(screen.getAllByText(/1\.966,06/).length).toBeGreaterThan(0);
  });
  test("sem horas a linha não aparece", () => {
    render(<ApuracaoRescisaoPainel apuracao={{ ...base, horaExtra: null }} aberto />);
    expect(screen.queryByText("Hora extra e adicional noturno")).toBeNull();
  });
});
