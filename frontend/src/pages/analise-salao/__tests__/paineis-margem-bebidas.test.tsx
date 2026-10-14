import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AnaliseMargemBebidas, AnaliseMargemBebidasAFazer, AnaliseMargemBebidasLinha } from "../../../api/client";
import { SessionContext } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { MargemBebidasPanel } from "../MargemBebidasPanel";
import { sessao } from "./fixtures";

// Dados 100% fictícios (repositório público).
const linha = (over: Partial<AnaliseMargemBebidasLinha> = {}): AnaliseMargemBebidasLinha => ({
  codigo: "R1", nome: "REFRIGERANTE LATA", categoria: "BEBIDAS", quantidade: 200, quantidadeSemCobranca: 0, receita: 2400, precoMedio: 12, insumo: "REFRIGERANTE LATA 350ML", consumo: "1 UN de REFRIGERANTE LATA 350ML",
  custoPorVenda: 3.5, margemUnitaria: 8.5, margemPct: 0.7083, cmvPct: 0.2917, margemTotal: 1700, ...over
});
const faltante = (over: Partial<AnaliseMargemBebidasAFazer> = {}): AnaliseMargemBebidasAFazer => ({
  codigo: "S1", nome: "SUCO DA CASA", categoria: "BEBIDAS", quantidade: 60, receita: 1080, pctReceita: 0.183, situacao: "sem-vinculo", insumo: null, problema: null,
  sugestoes: [{ insumoId: "i-polpa", nome: "POLPA DE FRUTA 1KG", similaridade: 0.5 }], ...over
});

function bebidas(over: Partial<AnaliseMargemBebidas> = {}): AnaliseMargemBebidas {
  return {
    periodo: { inicio: "2026-09-14", fim: "2026-10-13" }, hojeFicouDeFora: false,
    cobertura: { receitaBebidas: 5900, receitaComMargem: 4820, receitaSemVinculo: 1080, receitaCustoIncompleto: 0, pctComMargem: 0.8169, pctSemVinculo: 0.183, pctCustoIncompleto: 0, bebidasComMargem: 2 },
    linhas: [
      linha(),
      linha({ codigo: "P1", nome: "DOSE PROMOCIONAL", quantidade: 100, receita: 500, precoMedio: 5, custoPorVenda: 10, margemUnitaria: -5, margemPct: -1, cmvPct: 2, margemTotal: -500, consumo: "100 ML de DESTILADO 700ML" })
    ],
    aFazer: [faltante(), faltante({ codigo: "C1", nome: "CAFE EXPRESSO", receita: 800, pctReceita: 0.1356, situacao: "custo-incompleto", insumo: "CAFE 500G", problema: "Sem conversao de ML para UN.", sugestoes: [] })],
    insumosParaVincular: [{ id: "i-lata", nome: "REFRIGERANTE LATA 350ML", unidade: "UN" }, { id: "i-polpa", nome: "POLPA DE FRUTA 1KG", unidade: "UN" }, { id: "i-vinho", nome: "VINHO 750ML", unidade: "UN" }],
    insumosTruncados: false,
    insights: [{ id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null, titulo: "DOSE PROMOCIONAL vende abaixo do custo de compra", detalhe: "Preço médio de R$ 5,00 contra custo de R$ 10,00.", acao: "Confira o vínculo." }],
    ...over
  };
}

const abrir = (dados: AnaliseMargemBebidas = bebidas(), extra: Partial<React.ComponentProps<typeof MargemBebidasPanel>> = {}, ocultar = false) => {
  const props = { dados, podeEditar: true, onVincular: vi.fn().mockResolvedValue(undefined), ...extra };
  render(
    <SessionContext.Provider value={sessao(ocultar)}>
      <HideValuesProvider>
        <MargemBebidasPanel {...props} />
      </HideValuesProvider>
    </SessionContext.Provider>
  );
  return props;
};
const tabela = () => screen.getByRole("region", { name: "Tabela de margem das bebidas" });
const preencher = (nome: string, insumo: string, quantidade: string, unidade: string) => {
  fireEvent.change(screen.getByLabelText(new RegExp(`Insumo comprado para ${nome}`)), { target: { value: insumo } });
  fireEvent.change(screen.getByLabelText(new RegExp(`Quanto uma venda de ${nome} consome`)), { target: { value: quantidade } });
  fireEvent.change(screen.getByLabelText(new RegExp(`Unidade do consumo de ${nome}`)), { target: { value: unidade } });
};
const lista = () => screen.getByRole("region", { name: "Bebidas do PDV sem margem calculada" });
const linhaDe = (texto: string) => within(tabela()).getByText(texto).closest("tr") as HTMLElement;

describe("MargemBebidasPanel: resumo", () => {
  test("explica a conta de revenda: preco menos custo de COMPRA, sem perdas e com preco antes do desconto", () => {
    abrir();
    const contexto = document.querySelector(".analise-contexto")?.textContent ?? "";
    expect(contexto).toMatch(/margem = preço médio cobrado no PDV menos o custo de compra/);
    expect(contexto).toMatch(/perdas, quebra nem mão de obra/);
    expect(contexto).toMatch(/antes dos descontos da comanda/);
  });

  test("quatro indicadores: cobertura, quantas, margem ponderada e o que falta", () => {
    abrir();
    const cartoes = [...document.querySelectorAll("article")].map((a) => a.textContent ?? "");
    expect(cartoes[0]).toMatch(/Bebidas com margem.*82%.*R\$ 4\.820 de R\$ 5\.900/);
    expect(cartoes[1]).toMatch(/Quantas bebidas.*2/);
    // (1.700 - 500) / 2.900 = 41,4%
    expect(cartoes[2]).toMatch(/Margem das bebidas com custo.*41%.*R\$ 1\.200/);
    expect(cartoes[3]).toMatch(/Sem margem ainda.*18%/);
  });

  test("sem margem ainda soma quem nao tem vinculo e quem tem custo incompleto", () => {
    abrir(bebidas({ cobertura: { ...bebidas().cobertura, pctSemVinculo: 0.1, pctCustoIncompleto: 0.2 } }));
    expect(document.querySelectorAll("article")[3].textContent).toMatch(/Sem margem ainda.*30%/);
  });

  test("cobertura baixa pinta o indicador de atencao; boa nao", () => {
    abrir(bebidas({ cobertura: { ...bebidas().cobertura, pctComMargem: 0.3 } }));
    expect(document.querySelectorAll("article")[0].className).toMatch(/warning/);
  });

  test("cobertura boa nao pinta de atencao", () => {
    abrir();
    expect(document.querySelectorAll("article")[0].className).not.toMatch(/warning/);
  });

  test("sem venda de bebida: mensagem simples", () => {
    abrir(bebidas({ cobertura: { ...bebidas().cobertura, receitaBebidas: 0 }, linhas: [], aFazer: [] }));
    expect(screen.getByText(/Nenhuma bebida vendida neste período/)).toBeTruthy();
  });

  test("prioridades: mostra o aviso de margem negativa", () => {
    abrir();
    expect(screen.getByText("DOSE PROMOCIONAL vende abaixo do custo de compra")).toBeTruthy();
  });

  test("ocultar valores mascara os reais", () => {
    abrir(bebidas(), {}, true);
    const r1 = linhaDe("REFRIGERANTE LATA").textContent ?? "";
    expect(r1).toContain("R$ ••••");
    expect(r1).not.toMatch(/R\$ 12,00|R\$ 1\.700/);
  });
});

describe("MargemBebidasPanel: tabela", () => {
  test("preco medio, custo de compra, margem por venda e total (com centavos)", () => {
    abrir();
    const celulas = [...linhaDe("REFRIGERANTE LATA").querySelectorAll("td")].map((c) => c.textContent);
    expect(celulas[0]).toBe("200");
    expect(celulas[1]).toBe("R$ 12,00");
    expect(celulas[2]).toBe("R$ 3,50");
    expect(celulas[3]).toMatch(/R\$ 8,50.*70,8% do preço · custo 29,2%/);
    expect(celulas[4]).toBe("R$ 1.700");
  });

  test("diz quanto uma venda consome do insumo, numa coluna de vinculo propria (nao dentro do nome da linha)", () => {
    abrir();
    const dose = linhaDe("DOSE PROMOCIONAL");
    expect(dose.querySelector("th")?.textContent).toBe("DOSE PROMOCIONAL");
    expect(dose.querySelectorAll("td")[5].textContent).toMatch(/Consome 100 ML de DESTILADO 700ML.*desfazer vínculo/);
    expect(within(tabela()).getByRole("columnheader", { name: "Vínculo" })).toBeTruthy();
  });

  test("unidades sem cobranca aparecem junto das vendidas (o preco medio sai so das pagas)", () => {
    abrir(bebidas({ linhas: [linha({ quantidade: 200, quantidadeSemCobranca: 30 })] }));
    expect(linhaDe("REFRIGERANTE LATA").querySelectorAll("td")[0].textContent).toMatch(/200.*30 sem cobrança/);
  });

  test("mostrando N de M so quando ha mais pendencias do que a lista traz", () => {
    abrir(bebidas({ totalAFazer: 44 }));
    expect(screen.getByText(/Mostrando as 2 que mais vendem, de 44 pendentes/)).toBeTruthy();
  });

  test("lista completa (total igual ao mostrado) ou sem total: sem o aviso de 'mostrando'", () => {
    abrir(bebidas({ totalAFazer: 2 }));
    expect(screen.queryByText(/Mostrando as/)).toBeNull();
  });

  test("sem cortesia nao aparece 'sem cobranca'", () => {
    abrir();
    expect(screen.queryByText(/sem cobrança/)).toBeNull();
  });

  test("desfazer com clique repetido manda uma requisicao so", async () => {
    let concluir: () => void = () => undefined;
    const onVincular = vi.fn().mockReturnValue(new Promise<void>((resolve) => { concluir = resolve; }));
    abrir(bebidas(), { onVincular });
    const botao = screen.getAllByRole("button", { name: "Desfazer vínculo de REFRIGERANTE LATA" })[0];
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(onVincular).toHaveBeenCalledTimes(1);
    concluir();
    await waitFor(() => expect(onVincular).toHaveBeenCalledTimes(1));
  });

  test("bebida abaixo do custo: texto, sinal de menos e marca (nao so cor)", () => {
    abrir();
    const dose = linhaDe("DOSE PROMOCIONAL");
    expect(dose.textContent).toMatch(/abaixo do custo/);
    expect(dose.textContent).toMatch(/−R\$ 5,00/);
    expect(dose.querySelector(".variacao-ruim")).not.toBeNull();
    expect(linhaDe("REFRIGERANTE LATA").querySelector(".variacao-ruim")).toBeNull();
  });

  test("rola por teclado", () => {
    abrir();
    expect(tabela().getAttribute("tabindex")).toBe("0");
  });

  test("sem linhas: convida a vincular", () => {
    abrir(bebidas({ linhas: [] }));
    expect(screen.getByText(/Nenhuma bebida com margem calculada/)).toBeTruthy();
  });

  test("desfazer vinculo: onVincular com insumoId null; sem permissao nao aparece", async () => {
    const p = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer vínculo de REFRIGERANTE LATA" }));
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("R1", "REFRIGERANTE LATA", null));
  });

  test("sem permissao de editar: nenhum botao de vincular ou desfazer", () => {
    abrir(bebidas(), { podeEditar: false });
    expect(screen.queryByRole("button", { name: /Desfazer vínculo|^Vincular/ })).toBeNull();
    expect(screen.getAllByText(/Falta ligar esta bebida ao insumo comprado/).length).toBe(2);
  });

  test("falha ao desfazer: erro anunciado com o nome da bebida", async () => {
    abrir(bebidas(), { onVincular: vi.fn().mockRejectedValue(new Error("falhou")) });
    fireEvent.click(screen.getAllByRole("button", { name: "Desfazer vínculo de REFRIGERANTE LATA" })[0]);
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível desfazer o vínculo de REFRIGERANTE LATA: falhou");
  });
});

describe("MargemBebidasPanel: o que falta", () => {
  test("selos de situacao e a participacao na receita das bebidas", () => {
    abrir();
    const suco = within(lista()).getByText("SUCO DA CASA").closest("tr") as HTMLElement;
    expect(within(suco).getByText("Sem vínculo")).toBeTruthy();
    expect(suco.textContent).toMatch(/18,3% da receita das bebidas/);
    const cafe = within(lista()).getByText("CAFE EXPRESSO").closest("tr") as HTMLElement;
    expect(within(cafe).getByText("Custo incompleto")).toBeTruthy();
    expect(cafe.textContent).toMatch(/insumo vinculado \(CAFE 500G\) não gera custo: Sem conversao de ML para UN\./);
  });

  test("select de insumo: primeiro os parecidos, depois todos os demais, sem repetir", () => {
    abrir();
    const select = screen.getByLabelText(/Insumo comprado para SUCO DA CASA/) as HTMLSelectElement;
    const grupos = [...select.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
    expect(grupos).toEqual([
      ["Parecidos com o nome", ["POLPA DE FRUTA 1KG (UN)"]],
      ["Outros insumos com custo", ["REFRIGERANTE LATA 350ML (UN)", "VINHO 750ML (UN)"]]
    ]);
  });

  test("busca por parte do nome (sem acento e sem caixa) filtra as opcoes; o insumo escolhido nunca some", () => {
    abrir();
    const select = () => screen.getByLabelText(/Insumo comprado para SUCO DA CASA/) as HTMLSelectElement;
    fireEvent.change(select(), { target: { value: "i-vinho" } });
    fireEvent.change(screen.getByLabelText(/Buscar insumo para SUCO DA CASA/), { target: { value: "refrigerante" } });
    const rotulos = [...select().querySelectorAll("option")].map((o) => o.textContent);
    expect(rotulos).toContain("REFRIGERANTE LATA 350ML (UN)");
    expect(rotulos).toContain("VINHO 750ML (UN)"); // escolhido antes da busca
    expect(select().value).toBe("i-vinho");
  });

  test("a busca tira do select o que nao combina com o texto digitado", () => {
    abrir();
    const rotulos = () => [...(screen.getByLabelText(/Insumo comprado para SUCO DA CASA/) as HTMLSelectElement).querySelectorAll("option")].map((o) => o.textContent);
    expect(rotulos()).toContain("REFRIGERANTE LATA 350ML (UN)");
    fireEvent.change(screen.getByLabelText(/Buscar insumo para SUCO DA CASA/), { target: { value: "VINHO" } });
    expect(rotulos()).toContain("VINHO 750ML (UN)");
    expect(rotulos()).not.toContain("REFRIGERANTE LATA 350ML (UN)");
  });

  test("muitos insumos: so os primeiros 50 do resto entram no select, com aviso para digitar parte do nome", () => {
    const muitos = Array.from({ length: 120 }, (_, i) => ({ id: `i${i}`, nome: `INSUMO ${String(i).padStart(3, "0")}`, unidade: "UN" }));
    abrir(bebidas({ insumosParaVincular: muitos }));
    const select = screen.getByLabelText(/Insumo comprado para SUCO DA CASA/) as HTMLSelectElement;
    expect(select.querySelectorAll('optgroup[label="Outros insumos com custo"] option')).toHaveLength(50);
    expect(screen.getAllByText(/Mostrando 50 de 120: digite parte do nome/).length).toBeGreaterThan(0);
  });

  test("lista de insumos cortada pelo servidor: avisa quem edita", () => {
    abrir(bebidas({ insumosTruncados: true }));
    expect(screen.getByText(/lista de insumos passou do limite/)).toBeTruthy();
  });

  test("insumos cortados: quem so ve nao recebe o aviso", () => {
    abrir(bebidas({ insumosTruncados: true }), { podeEditar: false });
    expect(screen.queryByText(/lista de insumos passou do limite/)).toBeNull();
  });

  test("quantidade e unidade comecam vazias: nao existe padrao de 1 UN que grave a garrafa inteira por taca", () => {
    const p = abrir();
    expect((screen.getByLabelText(/Quanto uma venda de SUCO DA CASA consome/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/Unidade do consumo de SUCO DA CASA/) as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(/Insumo comprado para SUCO DA CASA/), { target: { value: "i-vinho" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Escolha o insumo e a unidade/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test("vincular envia codigo, nome, insumo, quantidade e unidade escolhidos", async () => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-polpa", "1", "UN");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("S1", "SUCO DA CASA", "i-polpa", 1, "UN"));
  });

  test("0.750 e lido como tres quartos (nao 750); 1.500 segue sendo mil e quinhentos", async () => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-polpa", "0.750", "KG");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("S1", "SUCO DA CASA", "i-polpa", 0.75, "KG"));
  });

  test("taca: 150 ML (quantidade decimal em pt-BR e unidade escolhida)", async () => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-vinho", "0,15", "L");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    await waitFor(() => expect(p.onVincular).toHaveBeenCalledWith("S1", "SUCO DA CASA", "i-vinho", 0.15, "L"));
  });

  test("com unidade e quantidade mas sem insumo: erro anunciado, nada gravado", () => {
    const p = abrir();
    fireEvent.change(screen.getByLabelText(/Quanto uma venda de SUCO DA CASA consome/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Unidade do consumo de SUCO DA CASA/), { target: { value: "UN" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Escolha o insumo e a unidade/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test("sem escolher nada: erro anunciado, nada gravado", () => {
    const p = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Escolha o insumo e a unidade/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test.each([["zero", "0"], ["texto", "abc"], ["vazio", ""]])("quantidade invalida (%s): erro anunciado e nao grava", (_n, digitado) => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-polpa", digitado, "UN");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/maior que zero/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test.each([["1.500"], ["200.000"], ["2.500"]])("quantidade ambigua (%s): recusada com a explicacao, nada gravado", (digitado) => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-polpa", digitado, "L");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/é ambíguo: use vírgula para decimais/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test("sem ambiguidade: '0.750', '1,5', '1500' e '150' passam", async () => {
    const p = abrir();
    for (const [texto, esperado] of [["0.750", 0.75], ["1,5", 1.5], ["1500", 1500], ["150", 150]] as const) {
      preencher("SUCO DA CASA", "i-polpa", texto, "ML");
      fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
      await waitFor(() => expect(p.onVincular).toHaveBeenLastCalledWith("S1", "SUCO DA CASA", "i-polpa", esperado, "ML"));
    }
  });

  test("quantidade acima do teto do servidor e recusada no cliente", () => {
    const p = abrir();
    preencher("SUCO DA CASA", "i-polpa", "200000,5", "UN");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect(screen.getByRole("alert").textContent).toMatch(/acima do limite/);
    expect(p.onVincular).not.toHaveBeenCalled();
  });

  test("falha do servidor ao vincular: erro anunciado e o botao volta", async () => {
    abrir(bebidas(), { onVincular: vi.fn().mockRejectedValue(new Error("Insumo inválido: escolha um insumo ativo e com custo médio no estoque.")) });
    preencher("SUCO DA CASA", "i-polpa", "1", "UN");
    fireEvent.click(screen.getByRole("button", { name: "Vincular SUCO DA CASA" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Insumo inválido/);
    expect(screen.getByRole("button", { name: "Vincular SUCO DA CASA" })).toBeTruthy();
  });

  test("bebida sem codigo: explica que nao da para vincular", () => {
    abrir(bebidas({ aFazer: [faltante({ codigo: null, sugestoes: [] })] }));
    expect(screen.getByText(/não tem código no PDV e não dá para vincular/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Vincular/ })).toBeNull();
  });

  test("lista vazia: tudo calculado", () => {
    abrir(bebidas({ aFazer: [] }));
    expect(screen.getByText(/Toda bebida vendida neste período já tem margem calculada/)).toBeTruthy();
  });

  test("a lista rola por teclado", () => {
    abrir();
    expect(lista().getAttribute("tabindex")).toBe("0");
  });
});
