import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AnaliseMargemBuffet, AnaliseVendasPorPessoa } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";

vi.mock("../../api/client", () => ({
  getAnaliseResumo: vi.fn(),
  getAnaliseDemanda: vi.fn(),
  getAnaliseCardapio: vi.fn(),
  getAnaliseMargem: vi.fn(),
  getAnaliseMargemBebidas: vi.fn(),
  getAnaliseMargemBuffet: vi.fn(),
  salvarCustoBuffetAnalise: vi.fn(),
  vincularBebidaAnaliseMargem: vi.fn(),
  vincularProdutoAnaliseMargem: vi.fn(),
  getAnalisePerdas: vi.fn(),
  getAnaliseVendasPorPessoa: vi.fn(),
  getAnaliseMetas: vi.fn(),
  salvarAnaliseMeta: vi.fn()
}));

import { getAnaliseCardapio, getAnaliseDemanda, getAnaliseMargem, getAnaliseMargemBebidas, getAnaliseMargemBuffet, getAnaliseMetas, getAnalisePerdas, getAnaliseResumo, getAnaliseVendasPorPessoa, salvarCustoBuffetAnalise, vincularBebidaAnaliseMargem, vincularProdutoAnaliseMargem } from "../../api/client";
import { cardapio, demanda, perdas, PERIODO, renderComSessao, resumo, sessao } from "../analise-salao/__tests__/fixtures";
import { AnaliseSalao } from "../AnaliseSalao";

const equipe: AnaliseVendasPorPessoa = {
  periodo: PERIODO,
  cobertura: { itensComPessoa: 50, itensSemPessoa: 0 },
  resumo: { pessoas: 1, valorTotal: 5000, valorSemPessoa: 0, itensSemPessoa: 0 },
  hojeFicouDeFora: false,
  pessoas: [{ pessoa: "Carla Fictícia", valor: 5000, participacao: 1, itens: 120, vendas: 40, ticketMedio: 125, itensPorVenda: 3, mix: [{ grupo: "Bebidas", valor: 2000, participacao: 0.4 }] }]
};

const buffetBase = (): AnaliseMargemBuffet => ({
  periodo: PERIODO, hojeFicouDeFora: false,
  buffet: { comandas: 100, pessoas: 200, receita: 10000, receitaPorPessoa: 50, pctDaReceita: 0.5 },
  faixas: [{ produto: "BUFFET PROMO 20", comandas: 100, pessoas: 200, receita: 10000, receitaPorPessoa: 50, pctReceita: 1 }],
  meses: [{ ano: 2026, mes: 9, comandas: 100, pessoas: 200, receita: 10000, receitaPorPessoa: 50, custoPorPessoa: null, margemPorPessoa: null, margemTotal: null, margemPct: null, status: "sem-custo" }],
  margem: null, cobertura: { pessoasComCusto: 0, pessoasTotal: 200, pctComCusto: 0, mesesSemCusto: 1 }, referencia: null, insights: []
});

const renderizar = () => renderComSessao(<AnaliseSalao />);
const aba = (nome: string) => screen.getByRole("tab", { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAnaliseResumo).mockResolvedValue(resumo());
  vi.mocked(getAnaliseDemanda).mockResolvedValue(demanda());
  vi.mocked(getAnaliseCardapio).mockResolvedValue(cardapio());
  vi.mocked(getAnaliseMargem).mockResolvedValue({
    periodo: PERIODO, hojeFicouDeFora: false,
    cobertura: { receitaTotal: 1000, receitaBuffet: 0, receitaBebidas: 0, receitaPratos: 1000, receitaComMargem: 0, receitaSemFicha: 0, receitaCustoIncompleto: 0, receitaSemVinculo: 1000, receitaPratoIndisponivel: 0, pctComMargem: 0, pctVinculadoSemCusto: 0, pctSemVinculo: 1, pctDaReceitaTotalComMargem: 0, pratosComMargem: 0 },
    linhas: [], aFazer: [], pratosParaVincular: [], insights: []
  });
  vi.mocked(getAnaliseMargemBebidas).mockResolvedValue({
    periodo: PERIODO, hojeFicouDeFora: false,
    cobertura: { receitaBebidas: 500, receitaComMargem: 0, receitaSemVinculo: 500, receitaCustoIncompleto: 0, pctComMargem: 0, pctSemVinculo: 1, pctCustoIncompleto: 0, bebidasComMargem: 0 },
    linhas: [], aFazer: [], insumosParaVincular: [], insumosTruncados: false, insights: []
  });
  vi.mocked(getAnaliseMargemBuffet).mockResolvedValue(buffetBase());
  vi.mocked(getAnalisePerdas).mockResolvedValue(perdas());
  vi.mocked(getAnaliseVendasPorPessoa).mockResolvedValue(equipe);
  vi.mocked(getAnaliseMetas).mockResolvedValue({
    mes: { ano: 2026, mes: 10, inicio: "2026-10-01", fim: "2026-10-31", diasNoMes: 31, encerrado: false, futuro: false },
    cobertura: { diasComMovimento: 14, diasRestantes: 15, diasNoRitmo: 48, podeProjetar: true },
    indicadores: [{ indicador: "faturamento", rotulo: "Faturamento do mês", menorEMelhor: false, meta: null, realizado: 150000, projecao: 280000, progresso: null, faltam: null, porDiaAtual: 10000, porDiaNecessario: null, situacao: "sem-meta", referencia: null }]
  });
});

describe("Análise do Salão — estrutura", () => {
  test("abre no Resumo, pede os últimos 30 dias e nao busca as outras secoes", async () => {
    renderizar();
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    const periodo = vi.mocked(getAnaliseResumo).mock.calls[0][0];
    expect(periodo.inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodo.fim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getAnaliseDemanda).not.toHaveBeenCalled();
    expect(getAnalisePerdas).not.toHaveBeenCalled();
    expect(getAnaliseVendasPorPessoa).not.toHaveBeenCalled();
  });

  test("tem as sete secoes, nesta ordem", () => {
    renderizar();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Resumo", "Quando vendemos", "Cardápio", "Margem", "Perdas", "Equipe", "Metas"]);
  });

  test("metas: so busca ao abrir, esconde o filtro de periodo (e por mes) e nao chama os relatorios por periodo", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    expect(getAnaliseMetas).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Período")).toBeTruthy();
    fireEvent.click(aba("Metas"));
    expect(await screen.findByRole("heading", { name: /de 20\d\d$/ })).toBeTruthy();
    expect(getAnaliseMetas).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Período")).toBeNull();
    expect(screen.queryByLabelText("De")).toBeNull();
    expect(getAnaliseDemanda).not.toHaveBeenCalled();
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByLabelText("Período")).toBeTruthy();
  });

  test("metas: erro da API aparece sem derrubar as outras secoes", async () => {
    vi.mocked(getAnaliseMetas).mockRejectedValue(new Error("Falha nas metas"));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Metas"));
    expect(await screen.findByText(/Falha nas metas/)).toBeTruthy();
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
  });

  test("margem: so busca ao abrir, com o periodo do topo", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    expect(getAnaliseMargem).not.toHaveBeenCalled();
    fireEvent.click(aba("Margem"));
    expect(await screen.findByText(/Margem por prato/)).toBeTruthy();
    expect(getAnaliseMargem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAnaliseMargem).mock.calls[0][0]).toEqual(expect.objectContaining({ inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect(screen.getByLabelText("Período")).toBeTruthy();
  });

  test("margem: quem edita vincula pela tela e o relatorio e relido; quem so ve nao tem o botao", async () => {
    const comLista = {
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaTotal: 1000, receitaBuffet: 0, receitaBebidas: 0, receitaPratos: 1000, receitaComMargem: 0, receitaSemFicha: 0, receitaCustoIncompleto: 0, receitaSemVinculo: 1000, receitaPratoIndisponivel: 0, pctComMargem: 0, pctVinculadoSemCusto: 0, pctSemVinculo: 1, pctDaReceitaTotalComMargem: 0, pratosComMargem: 0 },
      linhas: [], pratosParaVincular: [{ id: "p1", nome: "Prato Um" }], insights: [],
      aFazer: [{ codigo: "X1", nome: "PRATO UM", categoria: "PRATOS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, pratoId: null, prato: null, sugestoes: [] }]
    };
    vi.mocked(getAnaliseMargem).mockResolvedValue(comLista);
    vi.mocked(vincularProdutoAnaliseMargem).mockResolvedValue({ ok: true });
    const comPermissao = (modulePermissions?: Record<string, unknown>, role = "ADMIN") =>
      render(
        <MemoryRouter>
          <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role, modulePermissions } } as unknown as SessionContextValue}>
            <HideValuesProvider>
              <AnaliseSalao />
            </HideValuesProvider>
          </SessionContext.Provider>
        </MemoryRouter>
      );
    const editor = comPermissao();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    fireEvent.change(await screen.findByLabelText(/Prato da ficha para PRATO UM/), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO UM" }));
    await waitFor(() => expect(vincularProdutoAnaliseMargem).toHaveBeenCalledWith({ codigo: "X1", nome: "PRATO UM", pratoId: "p1" }));
    await waitFor(() => expect(getAnaliseMargem).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/PRATO UM vinculado\. Margem recalculada\./)).toBeTruthy();
    editor.unmount();

    comPermissao({ "analise-salao": { view: true, create: false, edit: false, delete: false, admin: false } }, "GESTAO");
    fireEvent.click(aba("Margem"));
    await screen.findByText(/Falta ligar este produto a um prato/);
    expect(screen.queryByRole("button", { name: /^Vincular/ })).toBeNull();
  });

  test("margem: o buffet e buscado junto, so ao abrir, e informar o custo grava, recarrega so o buffet e anuncia", async () => {
    vi.mocked(salvarCustoBuffetAnalise).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role: "ADMIN" } } as unknown as SessionContextValue}>
          <HideValuesProvider>
            <AnaliseSalao />
          </HideValuesProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    );
    await screen.findByText("Faturamento por dia");
    expect(getAnaliseMargemBuffet).not.toHaveBeenCalled();
    fireEvent.click(aba("Margem"));
    expect(await screen.findByText("Buffet: margem por pessoa")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Informar o custo por pessoa de setembro de 2026/ }));
    fireEvent.change(screen.getByLabelText(/Custo de comida por pessoa em setembro de 2026/), { target: { value: "32,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar custo" }));
    await waitFor(() => expect(salvarCustoBuffetAnalise).toHaveBeenCalledWith({ ano: 2026, mes: 9, valor: 32.5 }));
    await waitFor(() => expect(getAnaliseMargemBuffet).toHaveBeenCalledTimes(2));
    expect(getAnaliseMargem).toHaveBeenCalledTimes(1);
    expect(getAnaliseMargemBebidas).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Custo do buffet salvo\./)).toBeTruthy();
  });

  test("margem: erro no buffet tem botao de tentar de novo, que busca so o buffet, sem derrubar pratos e bebidas", async () => {
    vi.mocked(getAnaliseMargemBuffet).mockRejectedValueOnce(new Error("Falha do buffet."));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    expect(await screen.findByText(/Falha do buffet\./)).toBeTruthy();
    expect(await screen.findByText("Bebidas: margem de revenda")).toBeTruthy();
    const tentativas = screen.getAllByRole("button", { name: "Tentar de novo" });
    fireEvent.click(tentativas[tentativas.length - 1]);
    await waitFor(() => expect(getAnaliseMargemBuffet).toHaveBeenCalledTimes(2));
    expect(getAnaliseMargem).toHaveBeenCalledTimes(1);
    expect(getAnaliseMargemBebidas).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Buffet: margem por pessoa")).toBeTruthy();
  });

  test("margem: as bebidas (revenda) sao buscadas junto, so ao abrir, e vincular bebida chama a API e recarrega so as bebidas", async () => {
    vi.mocked(getAnaliseMargemBebidas).mockResolvedValue({
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaBebidas: 1000, receitaComMargem: 0, receitaSemVinculo: 1000, receitaCustoIncompleto: 0, pctComMargem: 0, pctSemVinculo: 1, pctCustoIncompleto: 0, bebidasComMargem: 0 },
      linhas: [], insumosParaVincular: [{ id: "i1", nome: "INSUMO UM", unidade: "UN" }], insumosTruncados: false, insights: [],
      aFazer: [{ codigo: "B1", nome: "BEBIDA UM", categoria: "BEBIDAS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, insumo: null, problema: null, sugestoes: [] }]
    });
    vi.mocked(vincularBebidaAnaliseMargem).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role: "ADMIN" } } as unknown as SessionContextValue}>
          <HideValuesProvider>
            <AnaliseSalao />
          </HideValuesProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    );
    await screen.findByText("Faturamento por dia");
    expect(getAnaliseMargemBebidas).not.toHaveBeenCalled();
    fireEvent.click(aba("Margem"));
    expect(await screen.findByText("Bebidas: margem de revenda")).toBeTruthy();
    fireEvent.change(await screen.findByLabelText(/Insumo comprado para BEBIDA UM/), { target: { value: "i1" } });
    fireEvent.change(screen.getByLabelText(/Quanto uma venda de BEBIDA UM consome/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Unidade do consumo de BEBIDA UM/), { target: { value: "UN" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular BEBIDA UM" }));
    await waitFor(() => expect(vincularBebidaAnaliseMargem).toHaveBeenCalledWith({ codigo: "B1", nome: "BEBIDA UM", insumoId: "i1", quantidade: 1, unidade: "UN" }));
    await waitFor(() => expect(getAnaliseMargemBebidas).toHaveBeenCalledTimes(2));
    expect(getAnaliseMargem).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Vínculo de BEBIDA UM salvo\. Margem recalculada\./)).toBeTruthy();
    // Terminada a releitura, o foco vai para o aviso (a linha clicada saiu da lista).
    expect(document.activeElement?.getAttribute("role")).toBe("status");
    expect(document.activeElement?.textContent).toMatch(/Vínculo de BEBIDA UM salvo/);
  });

  test("margem: logo depois de vincular o aviso diz 'Recalculando' (nunca 'recalculada' antes da releitura) e o foco ainda nao se move", async () => {
    let terminar: (v: unknown) => void = () => undefined;
    const base = {
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaTotal: 1000, receitaBuffet: 0, receitaBebidas: 0, receitaPratos: 1000, receitaComMargem: 0, receitaSemFicha: 0, receitaCustoIncompleto: 0, receitaSemVinculo: 1000, receitaPratoIndisponivel: 0, pctComMargem: 0, pctVinculadoSemCusto: 0, pctSemVinculo: 1, pctDaReceitaTotalComMargem: 0, pratosComMargem: 0 },
      linhas: [], pratosParaVincular: [{ id: "p1", nome: "Prato Um" }], insights: [],
      aFazer: [{ codigo: "X1", nome: "PRATO UM", categoria: "PRATOS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, pratoId: null, prato: null, sugestoes: [] }]
    };
    vi.mocked(getAnaliseMargem).mockResolvedValueOnce(base).mockReturnValueOnce(new Promise((resolve) => { terminar = resolve as (v: unknown) => void; }) as never);
    vi.mocked(vincularProdutoAnaliseMargem).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role: "ADMIN" } } as unknown as SessionContextValue}>
          <HideValuesProvider>
            <AnaliseSalao />
          </HideValuesProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    );
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    fireEvent.change(await screen.findByLabelText(/Prato da ficha para PRATO UM/), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO UM" }));
    expect(await screen.findByText(/PRATO UM vinculado\. Recalculando a margem…/)).toBeTruthy();
    expect(screen.queryByText(/Margem recalculada/)).toBeNull();
    expect(document.activeElement?.getAttribute("role")).not.toBe("status");
    terminar(base);
    expect(await screen.findByText(/PRATO UM vinculado\. Margem recalculada\./)).toBeTruthy();
  });

  test("margem: se a releitura depois de vincular falha, o aviso nao diz que recalculou", async () => {
    vi.mocked(getAnaliseMargemBebidas).mockResolvedValueOnce({
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaBebidas: 1000, receitaComMargem: 0, receitaSemVinculo: 1000, receitaCustoIncompleto: 0, pctComMargem: 0, pctSemVinculo: 1, pctCustoIncompleto: 0, bebidasComMargem: 0 },
      linhas: [], insumosParaVincular: [{ id: "i1", nome: "INSUMO UM", unidade: "UN" }], insumosTruncados: false, insights: [],
      aFazer: [{ codigo: "B1", nome: "BEBIDA UM", categoria: "BEBIDAS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, insumo: null, problema: null, sugestoes: [] }]
    }).mockRejectedValueOnce(new Error("Falha de rede"));
    vi.mocked(vincularBebidaAnaliseMargem).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role: "ADMIN" } } as unknown as SessionContextValue}>
          <HideValuesProvider>
            <AnaliseSalao />
          </HideValuesProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    );
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    fireEvent.change(await screen.findByLabelText(/Insumo comprado para BEBIDA UM/), { target: { value: "i1" } });
    fireEvent.change(screen.getByLabelText(/Quanto uma venda de BEBIDA UM consome/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Unidade do consumo de BEBIDA UM/), { target: { value: "UN" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular BEBIDA UM" }));
    expect(await screen.findByText(/Mas não foi possível atualizar a margem: Falha de rede/)).toBeTruthy();
    expect(screen.queryByText(/Margem recalculada/)).toBeNull();
  });

  test("margem: erro nas bebidas tem botao de tentar de novo, que busca so as bebidas", async () => {
    vi.mocked(getAnaliseMargemBebidas).mockRejectedValueOnce(new Error("Falha nas bebidas"));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    await screen.findByText(/Falha nas bebidas/);
    const botoes = screen.getAllByRole("button", { name: "Tentar de novo" });
    fireEvent.click(botoes[botoes.length - 1]);
    await waitFor(() => expect(getAnaliseMargemBebidas).toHaveBeenCalledTimes(2));
    expect(getAnaliseMargem).toHaveBeenCalledTimes(1);
  });

  test("margem: recarregar os pratos nao desmonta o formulario das bebidas (nem apaga o que se digitou)", async () => {
    vi.mocked(getAnaliseMargemBebidas).mockResolvedValue({
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaBebidas: 1000, receitaComMargem: 0, receitaSemVinculo: 1000, receitaCustoIncompleto: 0, pctComMargem: 0, pctSemVinculo: 1, pctCustoIncompleto: 0, bebidasComMargem: 0 },
      linhas: [], insumosParaVincular: [{ id: "i1", nome: "INSUMO UM", unidade: "UN" }], insumosTruncados: false, insights: [],
      aFazer: [{ codigo: "B1", nome: "BEBIDA UM", categoria: "BEBIDAS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, insumo: null, problema: null, sugestoes: [] }]
    });
    vi.mocked(getAnaliseMargem).mockResolvedValue({
      periodo: PERIODO, hojeFicouDeFora: false,
      cobertura: { receitaTotal: 1000, receitaBuffet: 0, receitaBebidas: 0, receitaPratos: 1000, receitaComMargem: 0, receitaSemFicha: 0, receitaCustoIncompleto: 0, receitaSemVinculo: 1000, receitaPratoIndisponivel: 0, pctComMargem: 0, pctVinculadoSemCusto: 0, pctSemVinculo: 1, pctDaReceitaTotalComMargem: 0, pratosComMargem: 0 },
      linhas: [], pratosParaVincular: [{ id: "p1", nome: "Prato Um" }], insights: [],
      aFazer: [{ codigo: "X1", nome: "PRATO UM", categoria: "PRATOS", quantidade: 10, receita: 1000, pctReceita: 1, situacao: "sem-vinculo" as const, pratoId: null, prato: null, sugestoes: [] }]
    });
    vi.mocked(vincularProdutoAnaliseMargem).mockResolvedValue({ ok: true });
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ ...sessao(), user: { id: "u", role: "ADMIN" } } as unknown as SessionContextValue}>
          <HideValuesProvider>
            <AnaliseSalao />
          </HideValuesProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    );
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    const campo = (await screen.findByLabelText(/Quanto uma venda de BEBIDA UM consome/)) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "150" } });
    fireEvent.change(await screen.findByLabelText(/Prato da ficha para PRATO UM/), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular PRATO UM" }));
    await waitFor(() => expect(getAnaliseMargem).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText(/Quanto uma venda de BEBIDA UM consome/) as HTMLInputElement).value).toBe("150");
    expect(screen.getByLabelText(/Quanto uma venda de BEBIDA UM consome/)).toBe(campo);
  });

  test("margem: erro nas bebidas aparece na secao delas sem derrubar a margem dos pratos", async () => {
    vi.mocked(getAnaliseMargemBebidas).mockRejectedValue(new Error("Falha nas bebidas"));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Margem"));
    expect(await screen.findByText(/Falha nas bebidas/)).toBeTruthy();
    expect(screen.getByText(/Margem por prato/)).toBeTruthy();
  });

  test("resumo: periodo curto explica por que nao compara; base fraca tem o outro texto", async () => {
    vi.mocked(getAnaliseResumo).mockResolvedValueOnce({ ...resumo(), anteriorConfiavel: false, motivoSemComparacao: "periodo-curto", comparacao: null });
    renderizar();
    expect(await screen.findByText(/Períodos de menos de 14 dias não são comparados/)).toBeTruthy();
    expect(screen.queryByText(/O período anterior tem poucos dias com movimento/)).toBeNull();
  });

  test("resumo: base anterior fraca em periodo longo mantem o texto da base", async () => {
    vi.mocked(getAnaliseResumo).mockResolvedValueOnce({ ...resumo(), anteriorConfiavel: false, motivoSemComparacao: "base-fraca", comparacao: null });
    renderizar();
    expect(await screen.findByText(/O período anterior tem poucos dias com movimento/)).toBeTruthy();
    expect(screen.queryByText(/Períodos de menos de 14 dias/)).toBeNull();
  });

  test("resumo: diz que faturamento inclui a taxa de servico e que cardapio e margem nao", async () => {
    renderizar();
    expect(await screen.findByText(/inclui a taxa de serviço.*sem a taxa de serviço e antes dos descontos/)).toBeTruthy();
  });

  test("cardapio: nao busca ate abrir, e uma vez aberto nao refaz ao voltar", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    expect(getAnaliseCardapio).not.toHaveBeenCalled();
    fireEvent.click(aba("Cardápio"));
    await screen.findByText(/Curva ABC/);
    fireEvent.click(aba("Resumo"));
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Cardápio"));
    await screen.findByText(/Curva ABC/);
    expect(getAnaliseCardapio).toHaveBeenCalledTimes(1);
  });

  test("cardapio: erro da API aparece e nao vaza para as outras secoes", async () => {
    vi.mocked(getAnaliseCardapio).mockRejectedValue(new Error("Falha no cardápio."));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Cardápio"));
    expect(await screen.findByText("Falha no cardápio.")).toBeTruthy();
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(screen.queryByText("Falha no cardápio.")).toBeNull();
  });

  test("cada secao busca o seu relatorio", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Quando vendemos"));
    expect(await screen.findByText(/Quantas pessoas chegam, por dia da semana e hora/)).toBeTruthy();
    fireEvent.click(aba("Cardápio"));
    expect(await screen.findByText(/Curva ABC: poucos produtos sustentam a receita/)).toBeTruthy();
    fireEvent.click(aba("Perdas"));
    expect(await screen.findByText("Do cancelado à perda potencial")).toBeTruthy();
    fireEvent.click(aba("Equipe"));
    expect(await screen.findByText("Carla Fictícia")).toBeTruthy();
    expect([getAnaliseDemanda, getAnaliseCardapio, getAnalisePerdas, getAnaliseVendasPorPessoa].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  test("voltar para uma secao ja carregada, no mesmo periodo, nao refaz a consulta", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Perdas"));
    await screen.findByText("Do cancelado à perda potencial");
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    fireEvent.click(aba("Perdas"));
    expect(await screen.findByText("Do cancelado à perda potencial")).toBeTruthy();
    expect(getAnaliseResumo).toHaveBeenCalledTimes(1);
    expect(getAnalisePerdas).toHaveBeenCalledTimes(1);
  });

  test("equipe: se hoje ficou de fora, avisa", async () => {
    vi.mocked(getAnaliseVendasPorPessoa).mockResolvedValue({ ...equipe, hojeFicouDeFora: true });
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Equipe"));
    expect(await screen.findByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("o link de um aviso do resumo abre a secao certa", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(screen.getByRole("button", { name: /Abrir Perdas/ }));
    expect(await screen.findByText("Do cancelado à perda potencial")).toBeTruthy();
    expect(aba("Perdas").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Análise do Salão — periodo", () => {
  test("trocar o periodo pede o relatorio da secao ativa de novo", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    await waitFor(() => expect(getAnaliseResumo).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getAnaliseResumo).mock.calls[1][0]).not.toEqual(vi.mocked(getAnaliseResumo).mock.calls[0][0]);
  });

  test("depois de trocar o periodo, as outras secoes buscam de novo (nao reaproveitam o antigo)", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Perdas"));
    await screen.findByText("Do cancelado à perda potencial");
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "ultimos90" } });
    await waitFor(() => expect(getAnalisePerdas).toHaveBeenCalledTimes(2));
  });

  test("dado do periodo antigo nao aparece enquanto o novo carrega", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    let liberar: (v: ReturnType<typeof resumo>) => void = () => undefined;
    vi.mocked(getAnaliseResumo).mockReturnValue(new Promise((resolve) => { liberar = resolve; }));
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    expect(await screen.findByText("Carregando…")).toBeTruthy();
    expect(screen.queryByText("Faturamento por dia")).toBeNull();
    liberar(resumo());
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
  });

  test("data apagada: avisa e nao chama a API", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    expect(await screen.findByText(/Confira as datas/)).toBeTruthy();
    expect(getAnaliseResumo).toHaveBeenCalledTimes(1);
  });

  test("editar a data manualmente vira 'Personalizado'", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    expect((screen.getByLabelText("Período") as HTMLSelectElement).value).toBe("personalizado");
    await waitFor(() => expect(getAnaliseResumo).toHaveBeenCalledTimes(2));
  });
});

describe("Análise do Salão — voltar a um período cuja consulta foi abortada", () => {
  test("P1 carregado, escolhe P2 (pendente) e volta para P1: nao fica preso em 'Carregando…'", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    vi.mocked(getAnaliseResumo).mockReturnValue(new Promise(() => undefined)); // P2 nunca responde
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    expect(await screen.findByText("Carregando…")).toBeTruthy();
    vi.mocked(getAnaliseResumo).mockResolvedValue(resumo());
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "ultimos30" } });
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(screen.queryByText("Carregando…")).toBeNull();
  });

  test("P2 falha e o usuario volta a P1: o erro de P2 nao aparece sobre os dados de P1", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    vi.mocked(getAnaliseResumo).mockRejectedValue(new Error("Falha em P2."));
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    expect(await screen.findByText("Falha em P2.")).toBeTruthy();
    vi.mocked(getAnaliseResumo).mockResolvedValue(resumo());
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "ultimos30" } });
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(screen.queryByText("Falha em P2.")).toBeNull();
  });

  test("trocar de aba no meio da carga e voltar: a consulta e refeita e nao fica 'Carregando…'", async () => {
    vi.mocked(getAnaliseDemanda).mockReturnValueOnce(new Promise(() => undefined));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Quando vendemos"));
    expect(await screen.findByText("Carregando…")).toBeTruthy();
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    fireEvent.click(aba("Quando vendemos"));
    expect(await screen.findByText(/Quantas pessoas chegam/)).toBeTruthy();
    expect(getAnaliseDemanda).toHaveBeenCalledTimes(2);
  });

  test("o sinal de cancelamento e repassado a API e disparado ao trocar de periodo", async () => {
    renderizar();
    await screen.findByText("Faturamento por dia");
    const sinal = vi.mocked(getAnaliseResumo).mock.calls[0][1] as AbortSignal;
    expect(sinal).toBeInstanceOf(AbortSignal);
    vi.mocked(getAnaliseResumo).mockReturnValue(new Promise(() => undefined));
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "mesAnterior" } });
    await waitFor(() => expect(getAnaliseResumo).toHaveBeenCalledTimes(2));
    expect(sinal.aborted).toBe(true);
  });
});

describe("Análise do Salão — tentar de novo e foco", () => {
  test("depois de um erro, o botao 'Tentar de novo' busca outra vez", async () => {
    vi.mocked(getAnaliseResumo).mockRejectedValueOnce(new Error("Falha momentânea."));
    renderizar();
    expect(await screen.findByText(/Falha momentânea\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(getAnaliseResumo).toHaveBeenCalledTimes(2);
  });

  test("depois de 'Tentar de novo', trocar de aba e voltar no mesmo periodo NAO refaz a consulta", async () => {
    vi.mocked(getAnaliseResumo).mockRejectedValueOnce(new Error("Falha momentânea."));
    renderizar();
    await screen.findByText(/Falha momentânea\./);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Perdas"));
    await screen.findByText("Do cancelado à perda potencial");
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(getAnaliseResumo).toHaveBeenCalledTimes(2); // a original que falhou + o retry
  });

  test("abrir uma secao por um link leva o foco para o conteudo, nao para o body", async () => {
    const { container } = renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(screen.getByRole("button", { name: /Abrir Perdas/ }));
    await screen.findByText("Do cancelado à perda potencial");
    const conteudo = container.querySelector(".analise-conteudo") as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(conteudo));
  });
});

describe("Análise do Salão — erro e carga", () => {
  test("erro da API aparece na tela e nao deixa dado velho", async () => {
    vi.mocked(getAnaliseResumo).mockRejectedValue(new Error("Usuário sem permissão para a análise do salão."));
    renderizar();
    expect(await screen.findByText("Usuário sem permissão para a análise do salão.")).toBeTruthy();
    expect(screen.queryByText("Faturamento por dia")).toBeNull();
  });

  test("o erro de uma secao nao vaza para a outra", async () => {
    vi.mocked(getAnaliseDemanda).mockRejectedValue(new Error("Falha na demanda."));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Quando vendemos"));
    expect(await screen.findByText("Falha na demanda.")).toBeTruthy();
    fireEvent.click(aba("Resumo"));
    expect(await screen.findByText("Faturamento por dia")).toBeTruthy();
    expect(screen.queryByText("Falha na demanda.")).toBeNull();
  });

  test("depois de um erro, abrir a secao de novo tenta outra vez", async () => {
    vi.mocked(getAnaliseDemanda).mockRejectedValueOnce(new Error("Falha na demanda."));
    renderizar();
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Quando vendemos"));
    await screen.findByText("Falha na demanda.");
    fireEvent.click(aba("Resumo"));
    await screen.findByText("Faturamento por dia");
    fireEvent.click(aba("Quando vendemos"));
    expect(await screen.findByText(/Quantas pessoas chegam/)).toBeTruthy();
    expect(getAnaliseDemanda).toHaveBeenCalledTimes(2);
  });

  test("mostra 'Carregando…' enquanto espera e anuncia so o status", async () => {
    vi.mocked(getAnaliseResumo).mockReturnValue(new Promise(() => undefined));
    const { container } = renderizar();
    expect(await screen.findByText("Carregando…")).toBeTruthy();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain("Carregando…");
  });
});
