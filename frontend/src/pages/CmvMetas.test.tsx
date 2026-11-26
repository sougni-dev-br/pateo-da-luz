import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LinhaPainelMetaCmv, ListaMetasCmv, PainelMetasCmv, RankingMetaCmv, VisoesMetaCmv } from "../api/client";

const getPainelMetasCmv = vi.fn();
const getMetasCmv = vi.fn();
const salvarMetaCmv = vi.fn();
const removerMetaCmv = vi.fn();
const getVisoesMetasCmv = vi.fn();
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  getPainelMetasCmv: (...a: unknown[]) => getPainelMetasCmv(...a),
  getMetasCmv: (...a: unknown[]) => getMetasCmv(...a),
  salvarMetaCmv: (...a: unknown[]) => salvarMetaCmv(...a),
  removerMetaCmv: (...a: unknown[]) => removerMetaCmv(...a),
  getVisoesMetasCmv: (...a: unknown[]) => getVisoesMetasCmv(...a),
}));

import { HideValuesProvider } from "../design-system";
import { SessionContext, type SessionContextValue } from "../context/SessionContext";
import { MemoryRouter } from "react-router-dom";
import { CmvMetas } from "./CmvMetas";

// Money lê o contexto de ocultar valores, que por sua vez lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const renderTela = (url = "/cmv/metas?mes=2026-11") => render(<SessionContext.Provider value={SESSAO}><HideValuesProvider><MemoryRouter initialEntries={[url]}><CmvMetas /></MemoryRouter></HideValuesProvider></SessionContext.Provider>);

const vazio: RankingMetaCmv = { linhas: [], outros: { quantidade: 0, compras: 0, comprasAnterior: 0 }, total: 0, totalAnterior: 0 };
const visoes = (o: Partial<VisoesMetaCmv> = {}): VisoesMetaCmv => ({
  mes: "2026-11", mesAnterior: "2026-10", ateODia: "2026-11-10", mesCorrente: true, diasNoMes: 30, diasNoMesAnterior: 31, comparacaoAteODia: 10,
  meta: { alvoPercentual: 30, alertaPercentual: 27 }, faturamento: 100000, faturamentoAnterior: 90000,
  ritmo: {
    atual: Array.from({ length: 10 }, (_, i) => ({ dia: i + 1, faturamento: 10000, compras: 3300 })),
    anterior: Array.from({ length: 31 }, (_, i) => ({ dia: i + 1, faturamento: 9000, compras: 2500 })),
  },
  distribuicao: {
    categoria: vazio, subcategoria: vazio, produto: vazio,
    fornecedor: { linhas: [{ id: "f1", nome: "Hortifruti Exemplo", compras: 20000, comprasAnterior: 10000 }, { id: "f2", nome: "Açougue Exemplo", compras: 13000, comprasAnterior: 0 }], outros: { quantidade: 0, compras: 0, comprasAnterior: 0 }, total: 33000, totalAnterior: 10000 },
  },
  ...o,
});

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
  getVisoesMetasCmv.mockResolvedValue(visoes());
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

  test("ritmo do mês compara as compras acumuladas com o teto da meta até hoje", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela();
    // 10 dias: compras 33.000 contra teto de 30% × 100.000 = 30.000.
    expect(await screen.findByText(/Até o dia 10: compras/)).toHaveTextContent(/acima em/);
    expect(screen.getByText("Teto da meta (30%)")).toBeInTheDocument();
  });

  test("a distribuição troca de aba como no Dashboard, com peso no CMV e variação", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela();
    fireEvent.click(await screen.findByRole("tab", { name: "Fornecedor" }));
    const painelAba = screen.getByRole("tabpanel", { name: /por fornecedor/ });
    expect(within(painelAba).getByText("Hortifruti Exemplo")).toBeInTheDocument();
    expect(within(painelAba).getByText("20,0 pts")).toBeInTheDocument();
    expect(within(painelAba).getByText(/▲ 100%/)).toBeInTheDocument();
    expect(within(painelAba).getByText("novo")).toBeInTheDocument();
  });

  test("a aba escolhida vem do endereço", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    renderTela("/cmv/metas?mes=2026-11&visao=fornecedor");
    expect(await screen.findByText("Hortifruti Exemplo")).toBeInTheDocument();
  });

  test("se as visões falham, o painel continua e o erro aparece no lugar delas", async () => {
    getPainelMetasCmv.mockResolvedValue(painel([linhaGeral()]));
    getVisoesMetasCmv.mockRejectedValue(new Error("rede"));
    renderTela();
    expect(await screen.findByText("rede")).toBeInTheDocument();
    expect(screen.getAllByText("Acima da meta").length).toBeGreaterThan(0);
  });

  test("histórico abre em gráfico e alterna para a tabela", async () => {
    getPainelMetasCmv.mockResolvedValue({ ...painel([linhaGeral()]), historico: [
      { mes: "2026-10", faturamento: 300000, compras: 90000, base: "CMV_REAL", comprasSobreFaturamento: 30, realizadoPercentual: 31.5, alvoPercentual: 30, status: "VERMELHO" },
    ] });
    renderTela();
    expect(await screen.findByRole("list", { name: /Realizado de CMV por mês/ })).toHaveTextContent("31,5%");
    fireEvent.click(screen.getByRole("tab", { name: "Tabela" }));
    expect(screen.getByRole("table", { name: /Histórico de CMV/ })).toBeInTheDocument();
  });
});
