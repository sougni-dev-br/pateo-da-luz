import { render as renderRaw, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { AbaApuracao } from "../AbaApuracao";
import { AbaPagamento } from "../AbaPagamento";
import { linhaListaPagamento } from "../exportarPdf";
import { SeletorFuncionario } from "../SeletorFuncionario";
import { toRows } from "../gorjetaUtils";

// Sem registro que não participa da gorjeta: aparece na Lista de pagamento só com o
// salário (gorjeta "—" e selo), e não entra na tabela nem nas somas da apuração.
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: null, companyName: null, functionName: null,
    isActive: true, semRegistro: true, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    pointsAdjustment: 0, fixedAmount: null, faltas: 0, faltasOrigem: "ESCALA", atestados: 0, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "ESCALA",
    escala: { faltas: 0, atestados: 0, ferias: 0 }, folgasEscala: { total: 0, folga: 0, feriado: 0, bancoHoras: 0 },
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

// Carmelita: admitida 23/09, R$ 2.300 → 8 dias = 613,36; vale de 50.
const CARMELITA = pessoa({
  participantId: "tp9", employeeId: "c", employeeName: "Carmelita Teste", foraDaGorjeta: true, basePoints: 0, points: 0, pontosApurados: 0,
  pontosDireito: 0, valorPonto: 0, gorjetaCalculada: 0, rateioAmount: 0, admissionDate: "2026-09-23T00:00:00.000Z",
  diasSalario: 8, salarioProporcional: 613.36, baseSalary: 2300, descontos: 50, valesTotal: 50, netCommission: -50, totalAPagar: 563.36,
  vales: [{ id: "v1", type: "REFEICAO", amount: 50, date: null, notes: null }],
});
const ANA = pessoa({ participantId: "tp1", employeeId: "a", employeeName: "Ana Participa", semRegistro: false, salarioProporcional: 0, totalAPagar: 300 });

const comp = (participants: TipComputedParticipant[]) => ({
  year: 2026, month: 9, label: "Gorjeta 26/08–25/09", participants, reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0,
  sobraRescisaoParaSaldo: false, adiantamento: { percent: 40, dia: 20 },
} as unknown as TipComputation);

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

describe("lista de pagamento com quem está fora da gorjeta", () => {
  test("aparece com selo, gorjeta \"—\" (title) e o total a pagar do salário menos vales", () => {
    const c = comp([ANA, CARMELITA]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly={false} onRow={vi.fn()} onError={vi.fn()} />);
    const linha = screen.getByText("Carmelita Teste").closest("tr")!;
    expect(within(linha).getByText("fora da gorjeta")).toBeTruthy();
    expect(within(linha).getByTitle("não participa da gorjeta").textContent).toBe("—");
    expect(within(linha).getByText("613,36")).toBeTruthy();
    expect(within(linha).getByText("563,36")).toBeTruthy();
  });

  test("PDF: nome com \"(fora da gorjeta)\" e traço na gorjeta", () => {
    const linha = linhaListaPagamento(CARMELITA);
    expect(linha[0]).toBe("Carmelita Teste (fora da gorjeta)");
    expect(linha[4]).toBe("—");
    expect(linha[10]).toContain("563,36");
  });
});

describe("apuração com quem está fora da gorjeta", () => {
  test("não entra na tabela do rateio nem nas somas; fica na seção recolhida \"só salário\"", () => {
    const c = comp([ANA, CARMELITA]);
    render(
      <AbaApuracao comp={c} rows={toRows(c)} readonly={false} onRow={vi.fn()} onRemove={vi.fn()} onVerVales={vi.fn()}
        recibo={{ antesDeGravar: vi.fn(), onAplicado: vi.fn(), onErro: vi.fn() }} onGorjetaReal={vi.fn()} />,
    );
    // Na tabela, só quem participa (1 pessoa); o total distribuído não leva os vales dela.
    expect(screen.queryByRole("textbox", { name: /Carmelita/ })).toBeNull();
    expect(screen.queryByLabelText("Ajuste de pontos de Carmelita Teste")).toBeNull();
    const total = screen.getByText("Total distribuído").closest("tr")!;
    expect(within(total).getAllByText(/300,00/).length).toBeGreaterThan(0);
    expect(within(total).queryByText(/250,00/)).toBeNull();
    const secao = screen.getByTestId("fora-da-gorjeta");
    expect(within(secao).getByText("Fora da gorjeta — só salário (1)")).toBeTruthy();
    expect(within(secao).getByText("Carmelita Teste")).toBeTruthy();
    expect(within(secao).getByRole("button", { name: "Vales de Carmelita Teste" }).textContent).toBe("1 vale(s)");
  });
});

describe("seletor de vales", () => {
  test("quem está fora da gorjeta aparece como \"só salário\"", () => {
    render(<SeletorFuncionario valor="tp9" onEscolher={vi.fn()} pessoas={[
      { participantId: "tp9", nome: "Carmelita Teste", funcao: null, empresa: null, semRegistro: true, foraDaGorjeta: true, liquida: -50 },
    ]} />);
    expect(screen.getByText(/fora da gorjeta: o vale sai do salário/)).toBeTruthy();
  });
});
