import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import type { ReciboPagamentoMes, TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getRecibosPagamento: vi.fn(),
}));
vi.mock("../reciboPagamento", () => ({ imprimirRecibosPagamento: vi.fn(async () => "blob:recibo") }));

import { getRecibosPagamento } from "../../../api/client";
import { imprimirRecibosPagamento } from "../reciboPagamento";
import { AbaPagamento } from "../AbaPagamento";
import { toRows } from "../gorjetaUtils";
import { reciboDoLancamento } from "../../folha/semRegistro";

// Botões de recibo de pagamento na lista de pagamento: "Recibos" (todos) e um por linha, só para
// quem vê Funcionários. Dados fictícios.
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });

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

const comp = (participants: TipComputedParticipant[]) => ({
  year: 2026, month: 9, label: "Gorjeta 26/08–25/09", periodId: "per1", status: "CLOSED", participants,
  reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0, adiantamento: { percent: 40, dia: 20 },
}) as unknown as TipComputation;

const sessao = (comFuncionarios: boolean): SessionContextValue => ({
  user: comFuncionarios
    ? { id: "u1", name: "Fulano", role: "ADMIN", permissions: {} }
    : { id: "u2", name: "Beltrano", role: "VISUALIZACAO", modulePermissions: { "payroll-tips": { view: true, edit: true } } },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue);
const render = (ui: ReactElement, s: SessionContextValue) => renderRaw(<SessionContext.Provider value={s}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const RECIBO = { tipo: "PAGAMENTO_MES", employeeId: "a", nome: "Ana Exemplo", total: 2500 } as ReciboPagamentoMes;
const lista = () => comp([
  pessoa({ employeeId: "a", employeeName: "Ana Exemplo" }),
  pessoa({ employeeId: "b", employeeName: "Bia Exemplo", totalAPagar: 0 }),
  pessoa({ employeeId: "c", employeeName: "Caio Exemplo", pagoNaRescisao: true, totalAPagar: 0 }),
]);

describe("recibos na lista de pagamento", () => {
  test("Recibos: conta só quem tem a receber e gera o PDF de todos", async () => {
    vi.mocked(getRecibosPagamento).mockResolvedValue({ competencia: "09/2026", recibos: [RECIBO] });
    const c = lista();
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(true));
    fireEvent.click(screen.getByRole("button", { name: "Recibos (1)" }));
    await waitFor(() => expect(imprimirRecibosPagamento).toHaveBeenCalledWith([RECIBO]));
    expect(getRecibosPagamento).toHaveBeenCalledWith(2026, 9);
    expect((await screen.findByText(/enviado para impressão/)).textContent).toContain("Recibos de 09/2026");
    expect(screen.getByRole("link", { name: "Abrir o PDF" }).getAttribute("href")).toBe("blob:recibo");
  });

  test("um por linha: só quem tem a receber; gera só daquela pessoa", async () => {
    vi.mocked(getRecibosPagamento).mockResolvedValue({ competencia: "09/2026", recibos: [RECIBO] });
    const c = lista();
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(true));
    expect(screen.queryByRole("button", { name: /Recibo de pagamento de Bia Exemplo/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recibo de pagamento de Ana Exemplo" }));
    await waitFor(() => expect(getRecibosPagamento).toHaveBeenCalledWith(2026, 9, "a"));
  });

  test("sem permissão de ver Funcionários: nenhum botão de recibo", () => {
    const c = lista();
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(false));
    expect(screen.queryByRole("button", { name: /^Recibos/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recibo de pagamento/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Recibo" })).toBeNull();
  });

  test("apuração aberta: botões desabilitados com o motivo", () => {
    const c = { ...lista(), status: "OPEN" } as TipComputation;
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(true));
    const todos = screen.getByRole("button", { name: "Recibos (1)" }) as HTMLButtonElement;
    expect(todos.disabled).toBe(true);
    expect(todos.title).toMatch(/Feche a apuração antes de imprimir os recibos do mês/);
    const um = screen.getByRole("button", { name: "Recibo de pagamento de Ana Exemplo" }) as HTMLButtonElement;
    expect(um.disabled).toBe(true);
    expect(um.title).toMatch(/Feche a apuração/);
    fireEvent.click(todos);
    expect(getRecibosPagamento).not.toHaveBeenCalled();
  });

  test("saiu e ainda falta o valor da rescisão: sem recibo", () => {
    const c = comp([pessoa({ employeeId: "a", employeeName: "Ana Exemplo", rescisaoPendente: true })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(true));
    expect(screen.queryByRole("button", { name: /Recibo de pagamento de Ana Exemplo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Recibos/ })).toBeNull();
  });

  test("erro do servidor (403) vira mensagem da página", async () => {
    vi.mocked(getRecibosPagamento).mockRejectedValue(new Error("é preciso permissão de ver Funcionários"));
    const onError = vi.fn();
    const c = lista();
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={onError} />, sessao(true));
    fireEvent.click(screen.getByRole("button", { name: "Recibos (1)" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("Funcionários")));
    expect(imprimirRecibosPagamento).not.toHaveBeenCalled();
  });
});

describe("recibo na Folha: quinzena e adiantamento do sem registro", () => {
  test("só ADIANTAMENTO marcado sem registro; a quinzena pela marca", () => {
    expect(reciboDoLancamento({ type: "ADIANTAMENTO", details: { semRegistro: true, primeiraQuinzena: true } })).toBe("QUINZENA");
    expect(reciboDoLancamento({ type: "ADIANTAMENTO", details: { semRegistro: true } })).toBe("ADIANTAMENTO");
    expect(reciboDoLancamento({ type: "ADIANTAMENTO", details: { base: 2600, percent: 40 } })).toBeNull(); // CLT
    expect(reciboDoLancamento({ type: "SALARIO", details: { semRegistro: true } })).toBeNull();
    expect(reciboDoLancamento({ type: "ADIANTAMENTO" })).toBeNull();
  });
});
