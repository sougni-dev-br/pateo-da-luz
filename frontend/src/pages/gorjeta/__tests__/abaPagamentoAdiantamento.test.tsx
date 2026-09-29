import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import type { ReactElement } from "react";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaPagamento } from "../AbaPagamento";
import { toRows } from "../gorjetaUtils";

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
    salarioProporcional: 2200, adiantamentoSalarial: 0, totalAPagar: 2500, baseSalary: 2200, pixKeyType: null, pixKey: null,
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    ...over,
  } as TipComputedParticipant;
}

function comp(participants: TipComputedParticipant[]): TipComputation {
  return {
    year: 2026, month: 9, label: "Gorjeta 26/08–25/09", participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0,
    adiantamento: { percent: 40, dia: 20 },
  } as unknown as TipComputation;
}

// Money lê o contexto de ocultar valores, que lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("lista de pagamento: coluna Adiantamento", () => {
  test("mostra o adiantamento com sinal de menos, traço para quem não recebe e o total", () => {
    const c = comp([
      pessoa({ employeeId: "a", employeeName: "Ana Adiantada", adiantamentoSalarial: 880, totalAPagar: 1620 }),
      pessoa({ employeeId: "b", employeeName: "Bia Sem Adiantamento" }),
    ]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    const th = screen.getByRole("columnheader", { name: /Adiantamento/ });
    expect(th.getAttribute("title")).toContain("40% do salário base, pago no dia 20");
    const ana = screen.getByText("Ana Adiantada").closest("tr")!;
    expect(within(ana).getByText(/− R\$\s*880,00/)).toBeTruthy();
    const bia = screen.getByText("Bia Sem Adiantamento").closest("tr")!;
    expect(within(bia).getAllByText("—").length).toBeGreaterThan(0);
    const total = screen.getByText("Total").closest("tr")!;
    expect(within(total).getByText(/− R\$\s*880,00/)).toBeTruthy();
  });

  test("sem a permissão de Funcionários (adiantamento null) não quebra: fica o traço", () => {
    const c = comp([pessoa({ employeeId: "a", employeeName: "Ana", adiantamentoSalarial: null, baseSalary: null })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByText(/− R\$\s*880/)).toBeNull();
  });
});
