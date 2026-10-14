import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CardapioPanel } from "../CardapioPanel";
import { CurvaAbc } from "../CurvaAbc";
import { MixDeCategorias } from "../MixDeCategorias";
import { SimulacoesDoCardapio } from "../SimulacoesDoCardapio";
import { TabelaAbc } from "../TabelaAbc";
import { VendaPorComanda } from "../VendaPorComanda";
import { cardapio, renderComSessao } from "./fixtures";

describe("CardapioPanel", () => {
  test("mostra os quatro indicadores com o que cada um quer dizer", () => {
    const { container } = renderComSessao(<CardapioPanel dados={cardapio()} />);
    const cartoes = [...container.querySelectorAll("article")].map((a) => a.textContent ?? "");
    expect(cartoes[0]).toMatch(/Produtos vendidos.*41.*8 fazem 80% da receita/);
    expect(cartoes[1]).toMatch(/Cauda longa.*6.*menos de 0,1% cada e somam 0,3% da receita/);
    expect(cartoes[2]).toMatch(/Maior dependência.*50%.*PRODUTO ALFA/);
    expect(cartoes[3]).toMatch(/Vendido a R\$ 0.*1.*40 unidades sem valor lançado/);
  });

  test("dependencia a partir de 40% fica em aviso; abaixo, neutra", () => {
    const alta = renderComSessao(<CardapioPanel dados={cardapio()} />);
    expect(alta.container.querySelectorAll(".ds-kpi-card-warning").length).toBe(1);
    alta.unmount();
    const baixa = renderComSessao(<CardapioPanel dados={cardapio({ resumo: { ...cardapio().resumo, maiorProduto: { produto: "X", participacao: 0.39 } } })} />);
    expect(baixa.container.querySelectorAll(".ds-kpi-card-warning").length).toBe(0);
  });

  test("produto vendido a R$ 0 deixa o cartao em perigo; sem nenhum, neutro", () => {
    const com = renderComSessao(<CardapioPanel dados={cardapio()} />);
    expect(com.container.querySelectorAll(".ds-kpi-card-danger").length).toBe(1);
    com.unmount();
    const sem = renderComSessao(<CardapioPanel dados={cardapio({ resumo: { ...cardapio().resumo, semPrecoProdutos: 0, semPrecoUnidades: 0 }, semPreco: [] })} />);
    expect(sem.container.querySelectorAll(".ds-kpi-card-danger").length).toBe(0);
    expect(screen.getByText("nenhum produto sem valor")).toBeTruthy();
  });

  test("os avisos aparecem sem link (ja estamos na secao) e a hipotese e rotulada", () => {
    renderComSessao(<CardapioPanel dados={cardapio()} />);
    expect(screen.getByText("1 produto vendido a R$ 0")).toBeTruthy();
    expect(screen.getByText("hipótese, não previsão")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir/ })).toBeNull();
  });

  test("sem avisos: diz que esta normal", () => {
    renderComSessao(<CardapioPanel dados={cardapio({ insights: [] })} />);
    expect(screen.getByText(/Nada fora do normal no cardápio/)).toBeTruthy();
  });

  test("avisa que pouca venda nao e motivo, sozinha, para cortar", () => {
    renderComSessao(<CardapioPanel dados={cardapio()} />);
    expect(screen.getByText(/não é motivo, sozinha, para cortar/)).toBeTruthy();
  });

  test("hoje fora da conta: aviso", () => {
    renderComSessao(<CardapioPanel dados={cardapio({ hojeFicouDeFora: true })} />);
    expect(screen.getByText(/Hoje fica de fora/)).toBeTruthy();
  });

  test("sem item vendido: orienta a atualizar o agente, sem zeros", () => {
    renderComSessao(<CardapioPanel dados={cardapio({ resumo: { ...cardapio().resumo, produtosVendidos: 0 } })} />);
    expect(screen.getByText(/Ainda não há item vendido neste período/)).toBeTruthy();
    expect(screen.queryByText("Produtos vendidos")).toBeNull();
  });

  test("cauda longa e vendido a R$ 0 ficam em secoes recolhidas, e so aparecem se existirem", () => {
    const { container } = renderComSessao(<CardapioPanel dados={cardapio()} />);
    const sumarios = [...container.querySelectorAll("details > summary")].map((s) => s.textContent);
    expect(sumarios).toEqual(["Cauda longa: 6 produtos abaixo de 0,1% da receita", "Vendido a R$ 0: 1 produto"]);
    expect(container.querySelector("details[open]")).toBeNull();
    const vazio = renderComSessao(<CardapioPanel dados={cardapio({ cauda: { ...cardapio().cauda, produtos: 0, exemplos: [] }, semPreco: [] })} />);
    expect(vazio.container.querySelectorAll("details").length).toBe(0);
  });

  test("ocultar valores esconde os reais, inclusive nos textos dos avisos", () => {
    const { container } = renderComSessao(<CardapioPanel dados={cardapio()} />, { ocultar: true });
    expect(container.querySelector(".insights")?.textContent ?? "").not.toMatch(/R\$ \d/);
    expect(container.querySelector(".simulacao-lista")?.textContent ?? "").not.toMatch(/R\$ \d/);
    expect(container.querySelector(".mix tbody")?.textContent ?? "").not.toMatch(/R\$ \d/);
  });
});

describe("MixDeCategorias", () => {
  const dados = cardapio().categorias;

  test("participacao, receita, produtos e variacao em pontos percentuais", () => {
    renderComSessao(<MixDeCategorias linhas={dados} comparar />);
    const linha = screen.getByText("ALIMENTOS").closest("tr") as HTMLElement;
    expect(within(linha).getByText("70,0%")).toBeTruthy();
    expect(within(linha).getByText("R$ 70.000")).toBeTruthy();
    expect(within(linha).getByText("−2,0 pp")).toBeTruthy();
    expect(within(screen.getByText("BEBIDAS").closest("tr") as HTMLElement).getByText("+1,0 pp")).toBeTruthy();
  });

  test("a barra e proporcional a MAIOR categoria (a maior ocupa 100%, as outras ficam relativas)", () => {
    const { container } = renderComSessao(<MixDeCategorias linhas={dados} comparar />);
    const larguras = [...container.querySelectorAll(".mix-preenchimento")].map((e) => (e as HTMLElement).style.width);
    expect(larguras.map(parseFloat).map((n) => Math.round(n))).toEqual([100, 20]); // 0,70 e 0,14 -> 14/70 = 20%
  });

  test("sem periodo anterior, a coluna de variacao some", () => {
    renderComSessao(<MixDeCategorias linhas={dados} comparar={false} />);
    expect(screen.queryByText("vs. anterior")).toBeNull();
  });

  test("lista vazia: mensagem simples", () => {
    renderComSessao(<MixDeCategorias linhas={[]} comparar />);
    expect(screen.getByText("Nenhum item vendido neste período.")).toBeTruthy();
  });
});

describe("VendaPorComanda", () => {
  test("uma coluna por turno e o total, com a base de comandas em cada uma", () => {
    renderComSessao(<VendaPorComanda attach={cardapio().attach} />);
    const cabecalho = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(cabecalho.some((t) => /Almoço.*700 comandas/.test(t ?? ""))).toBe(true);
    expect(cabecalho.some((t) => /Jantar.*300 comandas/.test(t ?? ""))).toBe(true);
    expect(cabecalho.some((t) => /Total.*1\.000 comandas/.test(t ?? ""))).toBe(true);
  });

  test("cada celula mostra a fatia das comandas e a receita por pessoa", () => {
    renderComSessao(<VendaPorComanda attach={cardapio().attach} />);
    const bebida = screen.getByText("Bebida").closest("tr") as HTMLElement;
    expect(within(bebida).getByText("80,0%")).toBeTruthy(); // almoco
    expect(within(bebida).getByText("95,0%")).toBeTruthy(); // jantar
    expect(within(bebida).getByText("85,0%")).toBeTruthy(); // total
  });

  test("a variacao do total mostra sinal e pp, sem colorir como bom ou ruim", () => {
    const attach = cardapio().attach;
    const { container } = renderComSessao(<VendaPorComanda attach={{ ...attach, geral: { ...attach.geral, itens: { ...attach.geral.itens, cafe: { ...attach.geral.itens.cafe, variacaoPontos: -0.05, pctComandasAnterior: 0.25 } } } }} />);
    const linhas = [...container.querySelectorAll("tbody tr")];
    const cafe = linhas.find((l) => l.textContent?.startsWith("Café")) as HTMLElement;
    expect(cafe.querySelector(".venda-variacao")?.textContent).toBe("−5,0 pp");
    expect(cafe.querySelector(".venda-variacao")?.className).not.toMatch(/variacao-(bom|ruim)/);
  });

  test("turno 'outro' nao vira coluna", () => {
    const attach = cardapio().attach;
    renderComSessao(<VendaPorComanda attach={{ ...attach, turnos: [...attach.turnos, { ...attach.turnos[0], turno: "OUTRO", rotulo: "Outro turno" }] }} />);
    expect(screen.queryByText(/Outro turno/)).toBeNull();
  });

  test("sem comandas: mensagem simples", () => {
    const attach = cardapio().attach;
    renderComSessao(<VendaPorComanda attach={{ turnos: [], geral: { ...attach.geral, comandas: 0 } }} />);
    expect(screen.getByText(/Nenhuma comanda com número de pessoas/)).toBeTruthy();
  });

  test("a tabela e uma regiao rolavel navegavel por teclado", () => {
    renderComSessao(<VendaPorComanda attach={cardapio().attach} />);
    expect(screen.getByRole("region", { name: /O que cada comanda leva/ }).getAttribute("tabindex")).toBe("0");
  });
});

describe("SimulacoesDoCardapio", () => {
  test("mostra o valor de cada ponto e diz que e hipotese, nao previsao", () => {
    renderComSessao(<SimulacoesDoCardapio simulacoes={cardapio().simulacoes} />);
    expect(screen.getByText("R$ 140")).toBeTruthy();
    expect(screen.getByText("R$ 240")).toBeTruthy();
    expect(screen.getByText(/Hipótese, não previsão/)).toBeTruthy();
    expect(screen.getByText(/1 ponto percentual a mais/)).toBeTruthy();
  });

  test("item sem valor simulavel nao aparece (nao inventa numero)", () => {
    renderComSessao(<SimulacoesDoCardapio simulacoes={cardapio().simulacoes} />);
    expect(screen.queryByText("CAFÉ", { exact: false })).toBeNull();
    expect(screen.queryByText(/^Café$/)).toBeNull();
  });

  test("nenhuma simulacao possivel: explica", () => {
    renderComSessao(<SimulacoesDoCardapio simulacoes={cardapio().simulacoes.map((s) => ({ ...s, valorMes: null }))} />);
    expect(screen.getByText(/Poucas comandas no período para simular/)).toBeTruthy();
  });
});

describe("CurvaAbc e TabelaAbc", () => {
  test("resume cada classe: quantos produtos e quanto da receita", () => {
    renderComSessao(<CurvaAbc abc={cardapio().abc} totalProdutos={41} />);
    expect(screen.getByText(/8 produtos/)).toBeTruthy();
    expect(screen.getByText(/10 produtos/)).toBeTruthy();
    expect(screen.getByText(/23 produtos/)).toBeTruthy();
  });

  test("o grafico tem descricao com quantos produtos mostra de quantos existem", () => {
    renderComSessao(<CurvaAbc abc={cardapio().abc} totalProdutos={41} />);
    expect(screen.getByRole("img", { name: "Curva ABC dos 4 produtos que mais vendem, de um total de 41" })).toBeTruthy();
  });

  test("uma barra por produto, colorida pela classe, com a receita no titulo", () => {
    const { container } = renderComSessao(<CurvaAbc abc={cardapio().abc} totalProdutos={41} />);
    expect(container.querySelectorAll("rect")).toHaveLength(4);
    expect(container.querySelectorAll("rect.abc-barra-A")).toHaveLength(2);
    expect(container.querySelector("rect title")?.textContent).toMatch(/1\. PRODUTO ALFA: R\$ 5\.000 \(50,0%\)/);
  });

  test("a linha acumulada sobe do primeiro ao ultimo produto (acumulada inclui o produto)", () => {
    const { container } = renderComSessao(<CurvaAbc abc={cardapio().abc} totalProdutos={41} />);
    const d = container.querySelector(".abc-acumulada")?.getAttribute("d") ?? "";
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeCloseTo(180 - 0.5 * 180, 0); // 50% acumulado
    expect(ys[ys.length - 1]).toBeCloseTo(0, 0); // 100%
    expect([...ys].sort((a, b) => b - a)).toEqual(ys); // nunca desce
  });

  test("sem itens: nao desenha nada", () => {
    const { container } = renderComSessao(<CurvaAbc abc={{ ...cardapio().abc, itens: [] }} totalProdutos={0} />);
    expect(container.querySelector(".abc")).toBeNull();
  });

  test("a tabela lista posicao, produto, % da receita, acumulado e classe", () => {
    renderComSessao(<TabelaAbc itens={cardapio().abc.itens} legenda="Os 4 produtos" />);
    const linha = screen.getByText("PRODUTO GAMA").closest("tr") as HTMLElement;
    expect(within(linha).getByText("3")).toBeTruthy();
    expect(within(linha).getByText("95%")).toBeTruthy();
    expect(within(linha).getByText("B")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Os 4 produtos" }).getAttribute("tabindex")).toBe("0");
  });

  test("o mix de categorias rola por teclado em tela estreita", () => {
    renderComSessao(<MixDeCategorias linhas={cardapio().categorias} comparar />);
    expect(screen.getByRole("region", { name: "Receita por categoria" }).getAttribute("tabindex")).toBe("0");
  });
});
