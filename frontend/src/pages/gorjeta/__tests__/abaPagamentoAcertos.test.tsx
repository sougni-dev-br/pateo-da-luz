import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import type { TipComputation, TipComputedParticipant } from "../../../api/client";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  lancarAcertosLista: vi.fn(),
}));

import { lancarAcertosLista } from "../../../api/client";
import { AbaPagamento } from "../AbaPagamento";
import { toRows } from "../gorjetaUtils";

// Botão "Lançar acertos no Contas a Pagar" na aba da lista de pagamento: o acerto de cada sem
// registro vira título SALARIO. Dados fictícios.
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

function comp(participants: TipComputedParticipant[], extra: Partial<TipComputation> = {}): TipComputation {
  return {
    year: 2026, month: 9, label: "Gorjeta 26/08–25/09", periodId: "per1", status: "CLOSED", participants,
    reservaTotal: 0, reservaPontos: 0, saldo: 0, fundoReservaSaldo: 0, adiantamento: { percent: 40, dia: 20 }, ...extra,
  } as unknown as TipComputation;
}

const sessao = (role: string | null): SessionContextValue => ({
  user: role ? { id: "u1", name: "Fulano", role, permissions: {} } : null,
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue);
const render = (ui: ReactElement, s: SessionContextValue) => renderRaw(<SessionContext.Provider value={s}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const BOTAO = { name: /Lançar acertos no Contas a Pagar/ };

describe("lançar os acertos da lista no Contas a Pagar", () => {
  test("lança e mostra o que criou, atualizou e os avisos", async () => {
    vi.mocked(lancarAcertosLista).mockResolvedValue({
      criados: 1, atualizados: 1, semMudanca: 2, avisos: ["Bia Exemplo: salário de 09/2026 já lançado como \"Salário\"."],
      detalhes: {
        competencia: "09/2026", semMudanca: 2, avisos: [], avisosSemValor: [],
        criados: [{ employeeId: "a", nome: "Ana Exemplo", valor: 1695, vencimento: "2026-10-07" }],
        atualizados: [{ employeeId: "c", nome: "Caio Exemplo", antes: 900, depois: 950 }],
      },
    });
    const c = comp([pessoa({ employeeId: "a", employeeName: "Ana Exemplo" })]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    fireEvent.click(screen.getByRole("button", BOTAO));
    expect(lancarAcertosLista).toHaveBeenCalledWith(2026, 9);
    const resultado = await screen.findByRole("status");
    expect(resultado.textContent).toMatch(/1 criado.*1 atualizado.*2 sem mudança/);
    expect(resultado.textContent).toMatch(/Ana Exemplo.*1\.695,00.*vence 07\/10\/2026/);
    expect(resultado.textContent).toMatch(/Caio Exemplo.*900,00.*950,00/);
    expect(resultado.textContent).toContain("Bia Exemplo: salário de 09/2026 já lançado");
  });

  test("sem ver Funcionários: só as contagens", async () => {
    vi.mocked(lancarAcertosLista).mockResolvedValue({ criados: 2, atualizados: 0, semMudanca: 0, avisos: [], detalhes: null });
    const c = comp([pessoa({})]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    fireEvent.click(screen.getByRole("button", BOTAO));
    const resultado = await screen.findByRole("status");
    expect(resultado.textContent).toMatch(/2 criados/);
    expect(resultado.textContent).not.toMatch(/R\$/);
  });

  test("erro vira mensagem de erro da página", async () => {
    vi.mocked(lancarAcertosLista).mockRejectedValue(new Error("Mês 09/2026 fechado"));
    const onError = vi.fn();
    const c = comp([pessoa({})]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={onError} />, sessao("ADMIN"));
    fireEvent.click(screen.getByRole("button", BOTAO));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("Mês 09/2026 fechado")));
  });

  test("apuração aberta: botão desabilitado, com o motivo, e nada é lançado", () => {
    const aberta = comp([pessoa({})], { status: "OPEN" });
    render(<AbaPagamento comp={aberta} rows={toRows(aberta)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    const botao = screen.getByRole("button", BOTAO);
    expect(botao).toBeDisabled();
    expect(botao.getAttribute("title")).toMatch(/Feche a apuração antes/);
    expect(lancarAcertosLista).not.toHaveBeenCalled();
  });

  test("sem a permissão de editar a Folha, sem período ou sem ninguém sem registro: sem o botão", () => {
    const c = comp([pessoa({})]);
    const { unmount } = render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao(null));
    expect(screen.queryByRole("button", BOTAO)).toBeNull();
    unmount();
    const semPeriodo = comp([pessoa({})], { periodId: null });
    const r2 = render(<AbaPagamento comp={semPeriodo} rows={toRows(semPeriodo)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    expect(screen.queryByRole("button", BOTAO)).toBeNull();
    r2.unmount();
    const soClt = comp([pessoa({ semRegistro: false })]);
    render(<AbaPagamento comp={soClt} rows={toRows(soClt)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    expect(screen.queryByRole("button", BOTAO)).toBeNull();
  });

  test("trocar de mês zera o resultado do lançamento", async () => {
    vi.mocked(lancarAcertosLista).mockResolvedValue({ criados: 1, atualizados: 0, semMudanca: 0, avisos: [], detalhes: null });
    const set = comp([pessoa({})]);
    const out = comp([pessoa({})], { month: 10, periodId: "per2" });
    const s = sessao("ADMIN");
    const ui = (c: TipComputation) => <SessionContext.Provider value={s}><HideValuesProvider>
      <AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} /></HideValuesProvider></SessionContext.Provider>;
    const { rerender } = renderRaw(ui(set));
    fireEvent.click(screen.getByRole("button", BOTAO));
    expect(await screen.findByText(/Acertos no Contas a Pagar/)).toBeInTheDocument();
    rerender(ui(out));
    expect(screen.queryByText(/Acertos no Contas a Pagar/)).toBeNull();
  });

  test("resposta do mês anterior que chega depois da troca é ignorada", async () => {
    let resolver!: (v: Awaited<ReturnType<typeof lancarAcertosLista>>) => void;
    vi.mocked(lancarAcertosLista).mockImplementation(() => new Promise((r) => { resolver = r; }));
    const s = sessao("ADMIN");
    const set = comp([pessoa({})]);
    const out = comp([pessoa({})], { month: 10, periodId: "per2" });
    const ui = (c: TipComputation) => <SessionContext.Provider value={s}><HideValuesProvider>
      <AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} /></HideValuesProvider></SessionContext.Provider>;
    const { rerender } = renderRaw(ui(set));
    fireEvent.click(screen.getByRole("button", BOTAO));
    rerender(ui(out));
    resolver({ criados: 1, atualizados: 0, semMudanca: 0, avisos: [], detalhes: null });
    await waitFor(() => expect(screen.getByRole("button", BOTAO)).not.toBeDisabled());
    expect(screen.queryByText(/Acertos no Contas a Pagar/)).toBeNull();
  });

  test("avisos repetidos aparecem todos (chave sem colisão)", async () => {
    const aviso = "Pessoa Exemplo: sem PIX no cadastro.";
    vi.mocked(lancarAcertosLista).mockResolvedValue({ criados: 0, atualizados: 0, semMudanca: 2, avisos: [aviso, aviso], detalhes: null });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = comp([pessoa({})]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    fireEvent.click(screen.getByRole("button", BOTAO));
    expect(await screen.findAllByText(aviso)).toHaveLength(2);
    expect(erro.mock.calls.some((args) => String(args[0]).includes("same key"))).toBe(false);
    erro.mockRestore();
  });

  test("recusa do servidor (período fechado) aparece junto do botão", async () => {
    vi.mocked(lancarAcertosLista).mockRejectedValue(new Error("Mês 09/2026 fechado no financeiro"));
    const c = comp([pessoa({})]);
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, sessao("ADMIN"));
    fireEvent.click(screen.getByRole("button", BOTAO));
    expect(await screen.findByRole("alert")).toHaveTextContent("Acertos não lançados: Mês 09/2026 fechado no financeiro");
  });

  test("sem editar a gorjeta (critério do resto da aba): sem o botão", () => {
    const gerente = (editaGorjeta: boolean) => ({ ...sessao("GERENTE"), user: { id: "u2", name: "Beltrano", role: "GERENTE", modulePermissions: { payroll: { view: true, edit: true }, "payroll-tips": { view: true, edit: editaGorjeta } } } } as unknown as SessionContextValue);
    const c = comp([pessoa({})]);
    const r1 = render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, gerente(false));
    expect(screen.queryByRole("button", BOTAO)).toBeNull();
    r1.unmount();
    render(<AbaPagamento comp={c} rows={toRows(c)} readonly onRow={vi.fn()} onError={vi.fn()} />, gerente(true));
    expect(screen.getByRole("button", BOTAO)).toBeInTheDocument();
  });
});
