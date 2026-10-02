import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import type { ReactElement } from "react";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaPagamento } from "../AbaPagamento";
import { linhaListaPagamento } from "../exportarPdf";
import { mostraQuinzena, quinzenaOculta, toRows } from "../gorjetaUtils";

// Lista de pagamento dos sem registro com quem recebe por quinzena: a 1ª quinzena (dia 15)
// sai do acerto do dia 30. Dados fictícios.
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: null, companyName: null, functionName: null,
    isActive: true, semRegistro: true, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 0,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    outrosDias: 0, diasPrevistosOverride: null, diasElegiveis: 31, diasReferencia: 26,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    regrasEfetivas: { descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true },
    diasPrevistos: 26, diasComputados: 26, fatorPresenca: 1, pontosApurados: 0, points: 0, pontosDireito: 0, pontosDevolvidos: 0, extraRescisao: 0,
    justificativaExtra: null, tipoCalculo: "MES", valorPonto: 150, rescisaoServicoBruto: null, rescisaoServicoOrigem: null, rescisaoValorFixo: null,
    pagoNaRescisao: false, rescisaoRecibo: null, rescisaoContasPagar: null, gorjetaCalculada: 0, gorjetaReal: null, rescisaoPendente: false,
    rateioAmount: 0, descontos: 0, creditos: 0, valesTotal: 0, netCommission: 0, diasSalarioOverride: null, diasSalario: 30,
    salarioProporcional: 2000, adiantamentoSalarial: 0, primeiraQuinzena: 0, totalAPagar: 2000, baseSalary: 2000, pixKeyType: null, pixKey: null,
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    ...over,
  } as TipComputedParticipant;
}

// Rafa: R$ 2.000, recebe por quinzena; setembro cheio → 1.000 no dia 30.
const RAFA = pessoa({ employeeId: "r", employeeName: "Rafa Quinzena", primeiraQuinzena: 1000, totalAPagar: 1000 });
const BIA = pessoa({ employeeId: "b", employeeName: "Bia Mensal" });

function comp(participants: TipComputedParticipant[]): TipComputation {
  return {
    year: 2026, month: 9, label: "Gorjeta 26/08–25/09", participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0,
    adiantamento: { percent: 40, dia: 20 },
  } as unknown as TipComputation;
}

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
// Cabeçalhos da tabela da lista de pagamento (a da contabilidade vem antes, na mesma aba).
const colunasDaLista = () => within(screen.getByRole("columnheader", { name: /A pagar/ }).closest("tr")!)
  .getAllByRole("columnheader").map((h) => h.textContent ?? "");
const render = (ui: ReactElement, sessao: SessionContextValue = SESSAO) => renderRaw(<SessionContext.Provider value={sessao}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("lista de pagamento: coluna 1ª quinzena (15)", () => {
  test("mostra a quinzena negativa, traço para quem não recebe, o total e a regra no título", () => {
    const c = comp([RAFA, BIA]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const th = screen.getByRole("columnheader", { name: /1ª quinzena \(15\)/ });
    expect(th.getAttribute("title")).toContain("metade do salário base, paga no dia 15");
    const rafa = screen.getByText("Rafa Quinzena").closest("tr")!;
    const celulas = within(rafa).getAllByRole("cell");
    const colunas = colunasDaLista();
    const iq = colunas.findIndex((t) => t.includes("1ª quinzena"));
    const ap = colunas.findIndex((t) => t.includes("A pagar"));
    expect(celulas[iq].textContent).toMatch(/–\s*R\$\s*1\.000,00/);
    expect(celulas[ap].textContent).toMatch(/1\.000,00/);
    const bia = screen.getByText("Bia Mensal").closest("tr")!;
    expect(within(bia).getAllByRole("cell")[iq].textContent).toBe("—");
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getAllByRole("cell")[iq].textContent).toMatch(/1\.000,00/);
  });

  test("o resumo do topo e o título da lista mencionam a 1ª quinzena", () => {
    const c = comp([RAFA]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Lista de pagamento (salário − adiantamento − 1ª quinzena + gorjeta + hora extra)")).toBeTruthy();
    expect(screen.getByText(/sem registro: salário − adiantamento − 1ª quinzena/)).toBeTruthy();
  });

  test("ninguém recebe por quinzena: sem a coluna e sem a quinzena no resumo", () => {
    const c = comp([BIA]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole("columnheader", { name: /1ª quinzena/ })).toBeNull();
    expect(screen.getByText("Lista de pagamento (salário − adiantamento + gorjeta + hora extra)")).toBeTruthy();
  });

  test("respeita \"ocultar valores\"", () => {
    const c = comp([RAFA]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, { ...SESSAO, hideSensitiveValues: true } as SessionContextValue);
    const rafa = screen.getByText("Rafa Quinzena").closest("tr")!;
    expect(within(rafa).queryByText(/1\.000,00/)).toBeNull();
    expect(within(rafa).getAllByLabelText("valor oculto").length).toBeGreaterThan(0);
  });

  test("sem a permissão de Funcionários (quinzena null): \"oculto\" na linha e no total, com a nota do A pagar", () => {
    const c = comp([pessoa({ employeeId: "r", employeeName: "Rafa", primeiraQuinzena: null, adiantamentoSalarial: null, valorHoraExtra: null, baseSalary: null, totalAPagar: 1000 })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const colunas = colunasDaLista();
    const iq = colunas.findIndex((t) => t.includes("1ª quinzena"));
    expect(iq).toBeGreaterThan(0);
    const rafa = screen.getByText("Rafa").closest("tr")!;
    expect(within(rafa).getAllByRole("cell")[iq].textContent).toContain("oculto");
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getAllByRole("cell")[iq].textContent).toContain("oculto");
    expect(screen.getByText(/A pagar já considera a 1ª quinzena/)).toBeTruthy();
    const th = screen.getByRole("columnheader", { name: /1ª quinzena/ });
    expect(th.getAttribute("title")).not.toContain("metade do salário");
  });

  test("total da coluna não soma quem foi pago na rescisão (a quinzena desconta lá)", () => {
    const saiu = pessoa({ employeeId: "s", employeeName: "Saiu Rescisao", primeiraQuinzena: 1000, totalAPagar: 0, pagoNaRescisao: true, tipoCalculo: "RESCISAO", terminationDate: "2026-09-22T00:00:00.000Z" });
    const c = comp([RAFA, saiu]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const colunas = colunasDaLista();
    const iq = colunas.findIndex((t) => t.includes("1ª quinzena"));
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getAllByRole("cell")[iq].textContent).toMatch(/1\.000,00/);
  });
});

describe("1ª quinzena: regras compartilhadas e PDF", () => {
  test("mostraQuinzena / quinzenaOculta", () => {
    expect(mostraQuinzena([{ primeiraQuinzena: 0 }, { primeiraQuinzena: undefined }])).toBe(false);
    expect(mostraQuinzena([{ primeiraQuinzena: 1000 }])).toBe(true);
    expect(mostraQuinzena([{ primeiraQuinzena: null }])).toBe(true);
    expect(quinzenaOculta([{ primeiraQuinzena: null }])).toBe(true);
    expect(quinzenaOculta([{ primeiraQuinzena: undefined }, { primeiraQuinzena: 0 }])).toBe(false);
  });

  test("PDF: a coluna entra depois do adiantamento só quando pedida", () => {
    const com = linhaListaPagamento(RAFA, true);
    expect(com).toHaveLength(13);
    expect(com[4]).toMatch(/^- R\$\s*1\.000,00$/);
    expect(com[11]).toMatch(/1\.000,00/); // A pagar
    expect(linhaListaPagamento(BIA, true)[4]).toBe("");
    expect(linhaListaPagamento(pessoa({ primeiraQuinzena: null }), true)[4]).toBe("oculto");
    // Sem quinzena na lista: as 12 colunas de sempre.
    expect(linhaListaPagamento(RAFA)).toHaveLength(12);
  });
});
