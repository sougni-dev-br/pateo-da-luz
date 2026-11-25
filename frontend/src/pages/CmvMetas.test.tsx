import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LinhaPainelMetaCmv, ListaMetasCmv, PainelMetasCmv } from "../api/client";

const getPainelMetasCmv = vi.fn();
const getMetasCmv = vi.fn();
const salvarMetaCmv = vi.fn();
const removerMetaCmv = vi.fn();
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  getPainelMetasCmv: (...a: unknown[]) => getPainelMetasCmv(...a),
  getMetasCmv: (...a: unknown[]) => getMetasCmv(...a),
  salvarMetaCmv: (...a: unknown[]) => salvarMetaCmv(...a),
  removerMetaCmv: (...a: unknown[]) => removerMetaCmv(...a),
}));

import { HideValuesProvider } from "../design-system";
import { SessionContext, type SessionContextValue } from "../context/SessionContext";
import { CmvMetas } from "./CmvMetas";

// Money lê o contexto de ocultar valores, que por sua vez lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const renderTela = () => render(<SessionContext.Provider value={SESSAO}><HideValuesProvider><CmvMetas /></HideValuesProvider></SessionContext.Provider>);

const linhaGeral = (o: Partial<LinhaPainelMetaCmv> = {}): LinhaPainelMetaCmv => ({
  escopo: "GERAL", sectorId: null, nome: "Geral",
  meta: { id: "m1", alvoPercentual: 30, alertaPercentual: 27 },
  compras: 33000, pedidosAbertos: 2000, base: "COMPRAS", comprasSobreFaturamento: 33, realizadoPercentual: 33, status: "VERMELHO",
  projecao: { faturamentoProjetado: 300000, comprasComprometidas: 35000, percentualProjetado: 11.67, tetoDeCompras: 90000, margemParaComprar: -5000 },
  ...o,
});

const painel = (linhas: LinhaPainelMetaCmv[]): PainelMetasCmv => ({
  mes: "2026-11", hoje: "2026-11-10", ateODia: "2026-11-10", mesCorrente: true, faturamento: 100000,
  cmvRealCiclo: null, linhas, historico: [],
});

const cadastro: ListaMetasCmv = {
  setores: [{ id: "s1", name: "Cozinha" }],
  metas: [{ id: "m1", escopo: "GERAL", sectorId: null, setorNome: null, alvoPercentual: 30, alertaPercentual: 27, vigenciaInicio: "2026-01-01", vigenciaFim: null, observacao: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getMetasCmv.mockResolvedValue(cadastro);
  salvarMetaCmv.mockResolvedValue({ id: "novo" });
  removerMetaCmv.mockResolvedValue({ ok: true });
});

describe("CmvMetas", () => {
  test("mostra o realizado, a situação e avisa quando o teto de compras estourou", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela();
    expect((await screen.findAllByText("Acima da meta")).length).toBeGreaterThan(0);
    expect(screen.getByText(/já estourou em/)).toBeInTheDocument();
  });

  test("com ciclo contado, a tela diz que o realizado é o CMV real e mostra compras ÷ faturamento à parte", async () => {
    getPainelMetasCmv.mockResolvedValue({
      ...painel([linhaGeral({ base: "CMV_REAL", realizadoPercentual: 62.33, comprasSobreFaturamento: 46.73, projecao: null })]),
      mesCorrente: false, cmvRealCiclo: { percentual: 62.33, periodo: "CMV abr", status: "CLOSED" },
    });
    renderTela();
    expect(await screen.findByText(/^CMV real do ciclo · /, { selector: ".mt-destaque .mt-sub" })).toBeInTheDocument();
    expect(screen.getAllByText("62,33%").length).toBeGreaterThan(0);
    expect(screen.getByText("46,73%")).toBeInTheDocument();
  });

  test("sem ciclo contado, avisa que o realizado é compras ÷ faturamento", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela();
    expect(await screen.findByText(/ciclo ainda sem contagem/)).toBeInTheDocument();
  });

  test("mês sem meta aparece como sem meta, sem inventar semáforo", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral({ meta: null, status: "SEM_DADOS", projecao: null, realizadoPercentual: 33 })]));
    renderTela();
    expect(await screen.findByText("Sem meta para este mês")).toBeInTheDocument();
  });

  test("salvar manda a meta com vírgula decimal convertida e o escopo escolhido", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela();
    await screen.findAllByText("Acima da meta");
    fireEvent.click(screen.getByRole("button", { name: /nova meta/i }));
    const form = screen.getByRole("group", { name: /nova meta de cmv/i });
    fireEvent.change(within(form).getByLabelText(/^Meta [(]%[)]/), { target: { value: "28,5" } });
    fireEvent.change(within(form).getByLabelText(/^Alerta [(]%[)]/), { target: { value: "26" } });
    fireEvent.click(within(form).getByRole("button", { name: /salvar meta/i }));
    await waitFor(() => expect(salvarMetaCmv).toHaveBeenCalled());
    expect(salvarMetaCmv).toHaveBeenCalledWith(expect.objectContaining({ escopo: "GERAL", sectorId: null, alvoPercentual: 28.5, alertaPercentual: 26 }));
    expect(await screen.findByText("Meta salva.")).toBeInTheDocument();
  });

  test("erro do servidor ao salvar fica visível e o formulário continua aberto", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    salvarMetaCmv.mockRejectedValue(new Error("O alerta deve ser maior que 0 e não passar da meta."));
    renderTela();
    await screen.findAllByText("Acima da meta");
    fireEvent.click(screen.getByRole("button", { name: /nova meta/i }));
    const form = screen.getByRole("group", { name: /nova meta de cmv/i });
    fireEvent.change(within(form).getByLabelText(/^Meta [(]%[)]/), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText(/^Alerta [(]%[)]/), { target: { value: "35" } });
    fireEvent.click(within(form).getByRole("button", { name: /salvar meta/i }));
    expect(await screen.findByText(/O alerta deve ser maior/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /nova meta de cmv/i })).toBeInTheDocument();
  });

  test("falha ao carregar mostra o erro em vez de tela vazia", async () => {
    getPainelMetasCmv.mockRejectedValue(new Error("Servidor fora do ar"));
    renderTela();
    expect(await screen.findByText("Servidor fora do ar")).toBeInTheDocument();
  });
});
