import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AnaliseBuffetMes, AnaliseMargemBuffet } from "../../../api/client";
import { SessionContext } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { MargemBuffetPanel } from "../MargemBuffetPanel";
import { sessao } from "./fixtures";

// Dados 100% fictícios (repositório público).
const mes = (over: Partial<AnaliseBuffetMes> = {}): AnaliseBuffetMes => ({
  ano: 2026, mes: 9, comandas: 400, pessoas: 800, receita: 40000, receitaPorPessoa: 50, custoPorPessoa: null, margemPorPessoa: null, margemTotal: null, margemPct: null, status: "sem-custo", ...over
});
const mesComCusto = (over: Partial<AnaliseBuffetMes> = {}) =>
  mes({ custoPorPessoa: 30, margemPorPessoa: 20, margemTotal: 16000, margemPct: 0.4, status: "com-custo", ...over });

function buffet(over: Partial<AnaliseMargemBuffet> = {}): AnaliseMargemBuffet {
  return {
    periodo: { inicio: "2026-09-01", fim: "2026-10-13" }, hojeFicouDeFora: false,
    buffet: { comandas: 600, pessoas: 1200, receita: 62000, receitaPorPessoa: 51.67, pctDaReceita: 0.62 },
    faixas: [
      { produto: "BUFFET PROMO 20", comandas: 400, pessoas: 800, receita: 40000, receitaPorPessoa: 50, pctReceita: 0.645 },
      { produto: "BUFFET PROMO 15", comandas: 200, pessoas: 400, receita: 22000, receitaPorPessoa: 55, pctReceita: 0.355 }
    ],
    meses: [mes(), mes({ mes: 10, comandas: 200, pessoas: 400, receita: 22000, receitaPorPessoa: 55 })],
    margem: null,
    cobertura: { pessoasComCusto: 0, pessoasTotal: 1200, pctComCusto: 0, mesesSemCusto: 2 },
    referencia: null,
    insights: [],
    ...over
  };
}

const comCusto = () =>
  buffet({
    meses: [mesComCusto(), mes({ mes: 10, comandas: 200, pessoas: 400, receita: 22000, receitaPorPessoa: 55 })],
    margem: { pessoas: 800, receita: 40000, custo: 24000, margem: 16000, custoPorPessoa: 30, margemPorPessoa: 20, margemPct: 0.4 },
    cobertura: { pessoasComCusto: 800, pessoasTotal: 1200, pctComCusto: 0.6667, mesesSemCusto: 1 },
    referencia: { ano: 2026, mes: 9, valor: 30 }
  });

const abrir = (dados: AnaliseMargemBuffet = buffet(), extra: Partial<React.ComponentProps<typeof MargemBuffetPanel>> = {}, ocultar = false) => {
  const props = { dados, podeEditar: true, onSalvarCusto: vi.fn().mockResolvedValue(undefined), ...extra };
  render(
    <SessionContext.Provider value={sessao(ocultar)}>
      <HideValuesProvider>
        <MargemBuffetPanel {...props} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );
  return props;
};
const tabelaMeses = () => screen.getByRole("region", { name: "Tabela do buffet por mês" });
const tabelaFaixas = () => screen.getByRole("region", { name: "Tabela do buffet por faixa de preço" });
const kpi = (rotulo: string) => screen.getAllByText(rotulo).find((e) => e.classList.contains("ds-kpi-card-label"))?.closest("article") as HTMLElement;

describe("MargemBuffetPanel: lado da receita", () => {
  test("sem custo informado mostra pessoas e ticket e deixa custo e margem em branco (sem inventar margem)", () => {
    abrir();
    expect(kpi("Pessoas no buffet").textContent).toContain("1.200");
    expect(kpi("Ticket por pessoa").textContent).toContain("R$ 51,67");
    expect(kpi("Custo por pessoa").textContent).toContain("—");
    expect(kpi("Margem por pessoa").textContent).toContain("informe o custo para calcular");
  });

  test("periodo sem buffet: mensagem simples", () => {
    abrir(buffet({ buffet: { comandas: 0, pessoas: 0, receita: 0, receitaPorPessoa: 0, pctDaReceita: 0 }, faixas: [], meses: [] }));
    expect(screen.getByText("Nenhum buffet vendido neste período.")).toBeInTheDocument();
  });

  test("tabela por faixa lista pessoas e ticket de cada faixa", () => {
    abrir();
    const linha = within(tabelaFaixas()).getByText("BUFFET PROMO 15").closest("tr") as HTMLElement;
    expect(linha.textContent).toContain("400");
    expect(linha.textContent).toContain("R$ 55,00");
  });

  test("faixa com ticket abaixo do custo medio e marcada", () => {
    abrir(buffet({
      margem: { pessoas: 1200, receita: 62000, custo: 66000, margem: -4000, custoPorPessoa: 55, margemPorPessoa: -3.33, margemPct: -0.06 },
      cobertura: { pessoasComCusto: 1200, pessoasTotal: 1200, pctComCusto: 1, mesesSemCusto: 0 }
    }));
    const marcada = within(tabelaFaixas()).getByText("BUFFET PROMO 20").closest("tr") as HTMLElement;
    expect(marcada.textContent).toContain("abaixo do custo médio");
    const nao = within(tabelaFaixas()).getByText("BUFFET PROMO 15").closest("tr") as HTMLElement;
    expect(nao.textContent).not.toContain("abaixo do custo médio");
  });

  test("faixa com poucas pessoas nao e marcada (mesmo corte do aviso do servidor)", () => {
    abrir(buffet({
      faixas: [{ produto: "BUFFET STAFF", comandas: 3, pessoas: 10, receita: 100, receitaPorPessoa: 10, pctReceita: 0.01 }],
      margem: { pessoas: 1200, receita: 62000, custo: 36000, margem: 26000, custoPorPessoa: 30, margemPorPessoa: 21.67, margemPct: 0.42 },
      cobertura: { pessoasComCusto: 1200, pessoasTotal: 1200, pctComCusto: 1, mesesSemCusto: 0 }
    }));
    expect(within(tabelaFaixas()).getByText("BUFFET STAFF").closest("tr")?.textContent).not.toContain("abaixo do custo médio");
  });

  test("ocultar valores mascara os reais", () => {
    abrir(comCusto(), {}, true);
    expect(document.body.textContent).not.toContain("R$ 51,67");
    expect(document.body.textContent).toContain("R$ ••••");
  });
});

describe("MargemBuffetPanel: margem com custo informado", () => {
  test("mostra custo, margem por pessoa e margem total do mes com custo", () => {
    abrir(comCusto());
    const set = within(tabelaMeses()).getByText("setembro de 2026").closest("tr") as HTMLElement;
    expect(set.textContent).toContain("R$ 30,00");
    expect(set.textContent).toContain("R$ 20,00");
    expect(set.textContent).toContain("40% do ticket");
    expect(kpi("Margem por pessoa").textContent).toContain("R$ 20,00");
  });

  test("mes sem custo diz 'não informado' e nao mostra margem", () => {
    abrir(comCusto());
    const out = within(tabelaMeses()).getByText("outubro de 2026").closest("tr") as HTMLElement;
    expect(out.textContent).toContain("não informado");
  });

  test("custo parcial deixa o cartao de custo em alerta e diz quantas pessoas cobre", () => {
    abrir(comCusto());
    expect(kpi("Custo por pessoa").textContent).toContain("67% das pessoas");
    expect(kpi("Custo por pessoa").className).toContain("warning");
    abrir(buffet({ ...comCusto(), cobertura: { pessoasComCusto: 1200, pessoasTotal: 1200, pctComCusto: 1, mesesSemCusto: 0 } }));
    expect(screen.getAllByText("Custo por pessoa").filter((e) => e.classList.contains("ds-kpi-card-label"))[1].closest("article")?.className).not.toContain("warning");
  });

  test("margem negativa e marcada como abaixo do custo", () => {
    abrir(buffet({
      meses: [mesComCusto({ custoPorPessoa: 80, margemPorPessoa: -30, margemTotal: -24000, margemPct: -0.6 })],
      margem: { pessoas: 800, receita: 40000, custo: 64000, margem: -24000, custoPorPessoa: 80, margemPorPessoa: -30, margemPct: -0.6 },
      cobertura: { pessoasComCusto: 800, pessoasTotal: 800, pctComCusto: 1, mesesSemCusto: 0 }
    }));
    const linha = within(tabelaMeses()).getByText("setembro de 2026").closest("tr") as HTMLElement;
    expect(linha.textContent).toContain("abaixo do custo");
  });

  test("mostra os avisos do servidor", () => {
    abrir(buffet({ insights: [{ id: "sem-custo-informado", tom: "info", secao: "margem", hipotese: false, impactoMes: null, titulo: "Sem custo de comida por pessoa informado neste período", detalhe: "d", acao: "a" }] }));
    expect(screen.getByText("Sem custo de comida por pessoa informado neste período")).toBeInTheDocument();
  });
});

describe("MargemBuffetPanel: informar o custo do mes", () => {
  const linhaDoMes = (nome: string) => within(tabelaMeses()).getByText(nome).closest("tr") as HTMLElement;

  test("quem so ve nao tem botao nem editor", () => {
    abrir(buffet(), { podeEditar: false });
    expect(screen.queryByRole("button", { name: /Informar o custo/ })).toBeNull();
    expect(screen.getByText(/Quem pode editar a análise informa o custo/)).toBeInTheDocument();
  });

  test("abre o editor do mes, valida e grava o valor lido no formato brasileiro", async () => {
    const props = abrir();
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo por pessoa de setembro de 2026/ }));
    const campo = screen.getByLabelText(/Custo de comida por pessoa em setembro de 2026/);
    fireEvent.change(campo, { target: { value: "38,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar custo" }));
    await waitFor(() => expect(props.onSalvarCusto).toHaveBeenCalledWith(2026, 9, 38.5));
    await waitFor(() => expect(screen.queryByLabelText(/Custo de comida por pessoa em/)).toBeNull());
  });

  test.each([["0"], ["-3"], ["abc"], [""], ["10001"]])("valor %j e recusado, com mensagem, e nada e gravado", async (texto) => {
    const props = abrir();
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ }));
    fireEvent.change(screen.getByLabelText(/Custo de comida por pessoa em/), { target: { value: texto } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar custo" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(props.onSalvarCusto).not.toHaveBeenCalled();
  });

  test("cancelar devolve o foco ao botao do mes (nao ao body)", async () => {
    abrir();
    const botao = within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ });
    fireEvent.click(botao);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByLabelText(/Custo de comida por pessoa em/)).toBeNull());
    expect(document.activeElement).toBe(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ }));
  });

  test("centavos que arredondam para zero (0,004) sao recusados na tela, com a mensagem local", async () => {
    const props = abrir();
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ }));
    fireEvent.change(screen.getByLabelText(/Custo de comida por pessoa em/), { target: { value: "0,004" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar custo" }));
    expect(await screen.findByText(/pelo menos R\$ 0,01/)).toBeInTheDocument();
    expect(props.onSalvarCusto).not.toHaveBeenCalled();
  });

  test("margem sem percentual (receita zero) nao mostra '0% do ticket'", () => {
    abrir(buffet({
      margem: { pessoas: 20, receita: 0, custo: 600, margem: -600, custoPorPessoa: 30, margemPorPessoa: -30, margemPct: null },
      cobertura: { pessoasComCusto: 20, pessoasTotal: 20, pctComCusto: 1, mesesSemCusto: 0 }
    }));
    expect(kpi("Margem por pessoa").textContent).not.toContain("do ticket");
  });

  test("erro do servidor fica na tela e o editor continua aberto", async () => {
    const props = abrir(buffet(), { onSalvarCusto: vi.fn().mockRejectedValue(new Error("Custo inválido: teste.")) });
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ }));
    fireEvent.change(screen.getByLabelText(/Custo de comida por pessoa em/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar custo" }));
    expect(await screen.findByText("Custo inválido: teste.")).toBeInTheDocument();
    expect(props.onSalvarCusto).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Custo de comida por pessoa em/)).toBeInTheDocument();
  });

  test("mes com custo abre preenchido e permite remover (grava null)", async () => {
    const props = abrir(comCusto());
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Alterar o custo por pessoa de setembro de 2026/ }));
    expect(screen.getByLabelText(/Custo de comida por pessoa em setembro de 2026/)).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "Remover custo" }));
    await waitFor(() => expect(props.onSalvarCusto).toHaveBeenCalledWith(2026, 9, null));
  });

  test("sugere partir do ultimo custo informado quando e de outro mes", () => {
    abrir(comCusto());
    fireEvent.click(within(linhaDoMes("outubro de 2026")).getByRole("button", { name: /Informar o custo/ }));
    const sugestao = screen.getByRole("button", { name: /último custo informado, setembro de 2026 \(R\$ 30,00\)/ });
    fireEvent.click(sugestao);
    expect(screen.getByLabelText(/Custo de comida por pessoa em outubro de 2026/)).toHaveValue("30");
  });

  test("no proprio mes do ultimo custo nao sugere partir dele", () => {
    abrir(comCusto());
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Alterar o custo/ }));
    expect(screen.queryByText(/Partir de:/)).toBeNull();
  });

  test("mes sem pessoas nas comandas nao oferece informar custo", () => {
    abrir(buffet({ meses: [mes({ pessoas: 0, receitaPorPessoa: 0, status: "sem-pessoas" })] }));
    expect(screen.queryByRole("button", { name: /Informar o custo/ })).toBeNull();
    expect(screen.getByText("sem pessoas nas comandas")).toBeInTheDocument();
  });

  test("clique repetido em salvar nao manda duas gravacoes", async () => {
    let liberar: () => void = () => undefined;
    const lenta = vi.fn(() => new Promise<void>((resolve) => { liberar = resolve; }));
    abrir(buffet(), { onSalvarCusto: lenta });
    fireEvent.click(within(linhaDoMes("setembro de 2026")).getByRole("button", { name: /Informar o custo/ }));
    fireEvent.change(screen.getByLabelText(/Custo de comida por pessoa em/), { target: { value: "30" } });
    const salvar = screen.getByRole("button", { name: "Salvar custo" });
    fireEvent.click(salvar);
    fireEvent.click(salvar);
    expect(lenta).toHaveBeenCalledTimes(1);
    liberar();
    await waitFor(() => expect(screen.queryByLabelText(/Custo de comida por pessoa em/)).toBeNull());
  });
});
