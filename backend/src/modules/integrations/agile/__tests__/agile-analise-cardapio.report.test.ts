import { describe, expect, test } from "vitest";
import {
  LIMITE_CAUDA, LIMITE_CLASSE_A, MAX_ITENS_ABC, MIN_COMANDAS_PARA_TAXA, montarCardapio, PONTO_SIMULADO, type LinhaAttach, type LinhaProduto
} from "../agile-analise-cardapio.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-30" }; // 30 dias
const prod = (produto: string, valor: number, quantidade: number, over: Partial<LinhaProduto> = {}): LinhaProduto => ({
  janela: "atual", produto, grupo: "G", categoria: "ALIMENTOS", quantidade, valor, ...over
});
const attach = (over: Partial<LinhaAttach> = {}): LinhaAttach => ({
  janela: "atual", turno: "Almoço", comandas: 1000, pessoas: 2000, comBebida: 800, comAlcool: 100, comCafe: 200, comSobremesa: 30,
  qtdBebida: 1600, valBebida: 16000, qtdAlcool: 120, valAlcool: 3000, qtdCafe: 250, valCafe: 2500, qtdSobremesa: 30, valSobremesa: 750, ...over
});
const cardapio = (produtos: LinhaProduto[], att: LinhaAttach[] = []) => montarCardapio({ periodo, produtos, attach: att });

describe("curva ABC", () => {
  test("classifica pela receita acumulada ANTES do produto: o que sozinho passa de 80% e A", () => {
    const r = cardapio([prod("Dominante", 900, 90), prod("Medio", 60, 6), prod("Pequeno", 40, 4)]);
    const classes = Object.fromEntries(r.abc.itens.map((i) => [i.produto, i.classe]));
    expect(classes).toEqual({ Dominante: "A", Medio: "B", Pequeno: "C" });
  });

  test("participacao e acumulada somam ate 1 e estao em ordem decrescente de valor", () => {
    const r = cardapio([prod("B", 300, 3), prod("A", 500, 5), prod("C", 200, 2)]);
    expect(r.abc.itens.map((i) => i.produto)).toEqual(["A", "B", "C"]);
    expect(r.abc.itens.map((i) => i.acumulada)).toEqual([0.5, 0.8, 1]);
    expect(r.abc.itens.map((i) => i.participacao)).toEqual([0.5, 0.3, 0.2]);
  });

  test("os limites das classes sao 80% e 95%", () => {
    expect(LIMITE_CLASSE_A).toBe(0.8);
    const r = cardapio([prod("p1", 80, 1), prod("p2", 15, 1), prod("p3", 5, 1)]);
    // antes de p2 o acumulado e 80% (nao < 80%): p2 e B; antes de p3 e 95% (nao < 95%): p3 e C
    expect(r.abc.itens.map((i) => i.classe)).toEqual(["A", "B", "C"]);
  });

  test("resumo por classe soma produtos e receita", () => {
    const r = cardapio([prod("Dominante", 900, 90), prod("Medio", 60, 6), prod("Pequeno", 40, 4)]);
    expect(r.abc.classes).toEqual([
      { classe: "A", produtos: 1, valor: 900, participacao: 0.9 },
      { classe: "B", produtos: 1, valor: 60, participacao: 0.06 },
      { classe: "C", produtos: 1, valor: 40, participacao: 0.04 }
    ]);
  });

  test("o mesmo produto em varias linhas (categorias/grupos diferentes) soma num so", () => {
    const r = cardapio([prod("Prato", 100, 1, { grupo: "X" }), prod("Prato", 50, 1, { grupo: "Y" })]);
    expect(r.abc.itens).toHaveLength(1);
    expect(r.abc.itens[0].valor).toBe(150);
  });

  test("so a janela ATUAL entra na curva; o anterior nao", () => {
    const r = cardapio([prod("Atual", 100, 1), prod("Antigo", 999, 9, { janela: "anterior" })]);
    expect(r.abc.itens.map((i) => i.produto)).toEqual(["Atual"]);
    expect(r.resumo.faturamentoItens).toBe(100);
  });

  test("a lista devolve no maximo 30 itens, mas os totais contam todos os produtos", () => {
    const muitos = Array.from({ length: 50 }, (_, i) => prod(`p${i}`, 1000 - i, 1));
    const r = cardapio(muitos);
    expect(r.abc.itens).toHaveLength(MAX_ITENS_ABC);
    expect(r.resumo.produtosVendidos).toBe(50);
    expect(r.abc.classes.reduce((s, c) => s + c.produtos, 0)).toBe(50);
  });

  test("sem vendas: tudo zerado, sem divisao por zero", () => {
    const r = cardapio([]);
    expect(r.resumo).toMatchObject({ produtosVendidos: 0, faturamentoItens: 0, produtosClasseA: 0, participacaoCauda: 0, maiorProduto: null });
    expect(r.abc.itens).toEqual([]);
    expect(r.categorias).toEqual([]);
  });
});

describe("cauda longa", () => {
  test("produto abaixo de 0,1% da receita e cauda; no limite exato, nao", () => {
    expect(LIMITE_CAUDA).toBe(0.001);
    const r = cardapio([prod("Grande", 99_800, 100), prod("NoLimite", 100, 1), prod("Cauda", 99.9, 1)]);
    // total 100.000 -> 0,1% = 100: "NoLimite" (0,1%) fica de fora; "Cauda" (0,0999%) entra
    expect(r.cauda.exemplos.map((e) => e.produto)).toEqual(["Cauda"]);
    expect(r.cauda.produtos).toBe(1);
  });

  test("participacao da cauda e a soma dos produtos da cauda sobre o total", () => {
    const itens = [prod("Grande", 99_000, 100), ...Array.from({ length: 10 }, (_, i) => prod(`c${i}`, 50, 1))];
    const r = cardapio(itens);
    expect(r.cauda).toMatchObject({ produtos: 10, valor: 500 });
    expect(r.cauda.participacao).toBeCloseTo(500 / 99_500, 4);
  });

  test("produto a R$ 0 nao entra na cauda (e outro problema)", () => {
    const r = cardapio([prod("Grande", 100_000, 100), prod("Brinde", 0, 5)]);
    expect(r.cauda.produtos).toBe(0);
  });

  test("exemplos limitados a 12, do que mais vende para o que menos vende", () => {
    const itens = [prod("Grande", 1_000_000, 100), ...Array.from({ length: 20 }, (_, i) => prod(`c${i}`, 10 + i, 1))];
    const r = cardapio(itens);
    expect(r.cauda.exemplos).toHaveLength(12);
    expect(r.cauda.exemplos[0].valor).toBeGreaterThanOrEqual(r.cauda.exemplos[11].valor);
    expect(r.cauda.produtos).toBe(20);
  });
});

describe("produtos vendidos a R$ 0", () => {
  test("lista so quem teve quantidade e valor zero, do que mais saiu para o que menos", () => {
    const r = cardapio([
      prod("Normal", 1000, 10), prod("Brinde A", 0, 71), prod("Brinde B", 0, 2), prod("Sem quantidade", 0, 0), prod("Parcial", 50, 5)
    ]);
    expect(r.semPreco.map((s) => [s.produto, s.unidades])).toEqual([["Brinde A", 71], ["Brinde B", 2]]);
    expect(r.resumo).toMatchObject({ semPrecoProdutos: 2, semPrecoUnidades: 73 });
  });

  test("um produto vendido a R$ 0 em uma linha e com valor em outra NAO e 'a zero'", () => {
    const r = cardapio([prod("Misto", 0, 3, { grupo: "A" }), prod("Misto", 90, 3, { grupo: "B" })]);
    expect(r.semPreco).toEqual([]);
  });

  test("gera aviso de alerta com os nomes", () => {
    const r = cardapio([prod("Normal", 1000, 10), prod("CHOPP", 0, 71)]);
    const i = r.insights.find((x) => x.id === "vendido-a-zero");
    expect(i).toMatchObject({ tom: "alerta", secao: "cardapio", impactoMes: null });
    expect(i?.detalhe).toContain("CHOPP");
    expect(i?.titulo).toBe("1 produto vendido a R$ 0");
  });
});

describe("mix por categoria e comparacao", () => {
  const atual = [prod("a", 600, 6, { categoria: "ALIMENTOS" }), prod("b", 300, 3, { categoria: "BEBIDAS" }), prod("c", 100, 1, { categoria: null })];
  const anterior = [
    prod("a", 400, 4, { categoria: "ALIMENTOS", janela: "anterior" }),
    prod("b", 600, 6, { categoria: "BEBIDAS", janela: "anterior" })
  ];

  test("participacao no periodo e variacao em pontos contra o anterior", () => {
    const r = cardapio([...atual, ...anterior]);
    const alimentos = r.categorias.find((c) => c.nome === "ALIMENTOS");
    const bebidas = r.categorias.find((c) => c.nome === "BEBIDAS");
    expect(alimentos).toMatchObject({ valor: 600, participacao: 0.6, participacaoAnterior: 0.4, variacaoPontos: 0.2, produtos: 1, precoMedio: 100 });
    expect(bebidas).toMatchObject({ participacao: 0.3, participacaoAnterior: 0.6, variacaoPontos: -0.3 });
  });

  test("categoria nula vira '(sem categoria)' e categoria nova (sem anterior) tem participacao anterior zero", () => {
    const r = cardapio([...atual, ...anterior]);
    const semCategoria = r.categorias.find((c) => c.nome === "(sem categoria)");
    expect(semCategoria).toMatchObject({ participacao: 0.1, participacaoAnterior: 0, variacaoPontos: 0.1 });
  });

  test("sem periodo anterior: sem comparacao (nulo, nao zero)", () => {
    const r = cardapio(atual);
    expect(r.categorias.every((c) => c.participacaoAnterior === null && c.variacaoPontos === null)).toBe(true);
  });

  test("ordenado do maior para o menor valor", () => {
    expect(cardapio(atual).categorias.map((c) => c.nome)).toEqual(["ALIMENTOS", "BEBIDAS", "(sem categoria)"]);
  });

  test("grupos: limitados a 10, mesmos campos", () => {
    const muitos = Array.from({ length: 15 }, (_, i) => prod(`p${i}`, 100 - i, 1, { grupo: `G${i}` }));
    expect(cardapio(muitos).grupos).toHaveLength(10);
  });
});

describe("taxas por comanda e por pessoa", () => {
  test("percentual de comandas, itens por pessoa, receita por pessoa e preco medio", () => {
    const r = cardapio([], [attach()]);
    const b = r.attach.geral.itens.bebida;
    expect(b).toMatchObject({ pctComandas: 0.8, porPessoa: 0.8, receitaPorPessoa: 8, precoMedio: 10, quantidade: 1600, valor: 16000 });
    expect(r.attach.geral.itens.sobremesa.pctComandas).toBe(0.03);
  });

  test("o denominador e SEMPRE a comanda/pessoa do periodo (nao duplica por item)", () => {
    const r = cardapio([], [attach({ comandas: 500, pessoas: 1000, comBebida: 250, qtdBebida: 1000, valBebida: 5000 })]);
    expect(r.attach.geral.itens.bebida).toMatchObject({ pctComandas: 0.5, porPessoa: 1, receitaPorPessoa: 5 });
  });

  test("agrupa por turno (almoco e jantar) e soma o geral", () => {
    const r = cardapio([], [
      attach({ turno: "Almoço", comandas: 1000, pessoas: 2000, comSobremesa: 10 }),
      attach({ turno: "Jantar", comandas: 500, pessoas: 800, comSobremesa: 40 })
    ]);
    expect(r.attach.turnos.map((t) => t.turno)).toEqual(["ALMOCO", "JANTAR"]);
    expect(r.attach.turnos[0].itens.sobremesa.pctComandas).toBe(0.01);
    expect(r.attach.turnos[1].itens.sobremesa.pctComandas).toBe(0.08);
    expect(r.attach.geral).toMatchObject({ comandas: 1500, pessoas: 2800 });
    expect(r.attach.geral.itens.sobremesa.pctComandas).toBeCloseTo(50 / 1500, 4);
  });

  test("duas linhas do mesmo turno (ex.: 'Almoço' e 'almoço ') somam no mesmo turno", () => {
    const r = cardapio([], [attach({ turno: "Almoço", comandas: 600 }), attach({ turno: "almoço ", comandas: 400 })]);
    expect(r.attach.turnos).toHaveLength(1);
    expect(r.attach.turnos[0].comandas).toBe(1000);
  });

  test("comparacao com o periodo anterior em pontos percentuais", () => {
    const r = cardapio([], [attach({ comBebida: 800 }), attach({ janela: "anterior", comBebida: 900 })]);
    expect(r.attach.geral.itens.bebida).toMatchObject({ pctComandas: 0.8, pctComandasAnterior: 0.9, variacaoPontos: -0.1 });
  });

  test("periodo curto (menos de 14 dias) nao compara com o anterior, nem no attach nem no mix", () => {
    const curto = { inicio: "2026-10-01", fim: "2026-10-07" };
    const r = montarCardapio({
      periodo: curto,
      produtos: [prod("a", 400, 4), prod("a", 400, 4, { janela: "anterior" })],
      attach: [attach({ comBebida: 700 }), attach({ janela: "anterior", comBebida: 900 })]
    });
    expect(r.attach.geral.itens.bebida.variacaoPontos).toBeNull();
    expect(r.categorias[0].variacaoPontos).toBeNull();
    expect(r.insights.some((i) => i.id === "bebida-caiu")).toBe(false);
  });

  test("anterior com poucas comandas nao serve de comparacao", () => {
    const r = cardapio([], [attach(), attach({ janela: "anterior", comandas: MIN_COMANDAS_PARA_TAXA - 1, comBebida: 0 })]);
    expect(r.attach.geral.itens.bebida.variacaoPontos).toBeNull();
    expect(r.attach.geral.itens.bebida.pctComandasAnterior).toBeNull();
  });

  test("sem comandas: zeros, sem divisao por zero", () => {
    const r = cardapio([], [attach({ comandas: 0, pessoas: 0, comBebida: 0, qtdBebida: 0, valBebida: 0 })]);
    expect(r.attach.geral.itens.bebida).toMatchObject({ pctComandas: 0, porPessoa: 0, receitaPorPessoa: 0, precoMedio: 0 });
  });
});

describe("simulacao de +1 ponto percentual", () => {
  test("valor mensal = 1% x comandas por mes x preco medio do item (hipotese)", () => {
    // 1000 comandas em 30 dias = 1000 por mes; sobremesa a R$ 25
    const r = cardapio([], [attach()]);
    const s = r.simulacoes.find((x) => x.item === "sobremesa");
    expect(PONTO_SIMULADO).toBe(0.01);
    expect(s).toMatchObject({ precoMedio: 25, comandasPorMes: 1000 });
    expect(s?.valorMes).toBe(0.01 * 1000 * 25);
  });

  test("o periodo mais curto escala as comandas para 30 dias", () => {
    const r = montarCardapio({ periodo: { inicio: "2026-10-01", fim: "2026-10-15" }, produtos: [], attach: [attach({ comandas: 500 })] }); // 15 dias
    expect(r.simulacoes[0].comandasPorMes).toBe(1000);
  });

  test("item sem preco medio (nunca vendido) nao tem simulacao", () => {
    const r = cardapio([], [attach({ comSobremesa: 0, qtdSobremesa: 0, valSobremesa: 0 })]);
    expect(r.simulacoes.find((x) => x.item === "sobremesa")?.valorMes).toBeNull();
  });

  test("poucas comandas: nao simula", () => {
    const r = cardapio([], [attach({ comandas: MIN_COMANDAS_PARA_TAXA - 1 })]);
    expect(r.simulacoes.every((s) => s.valorMes === null)).toBe(true);
  });

  test("tem uma simulacao para cada item de atencao", () => {
    expect(cardapio([], [attach()]).simulacoes.map((s) => s.item)).toEqual(["bebida", "alcool", "cafe", "sobremesa"]);
  });
});

describe("avisos do cardapio", () => {
  const produtosGrandes = [prod("Buffet", 600, 6), ...Array.from({ length: 25 }, (_, i) => prod(`p${i}`, 15, 1))];

  test("sobremesa em menos de 5% das comandas: oportunidade marcada como hipotese, com o valor do ponto", () => {
    const i = cardapio([], [attach()]).insights.find((x) => x.id === "sobremesa-baixa");
    expect(i).toMatchObject({ tom: "oportunidade", hipotese: true, secao: "cardapio", impactoMes: 250 });
    expect(i?.titulo).toBe("Sobremesa em só 3% das comandas");
    expect(i?.acao).toMatch(/toda sobremesa é lançada no PDV/);
  });

  test("sobremesa em 5% ou mais: sem aviso; com poucas comandas: sem aviso", () => {
    expect(cardapio([], [attach({ comSobremesa: 50 })]).insights.map((i) => i.id)).not.toContain("sobremesa-baixa");
    expect(cardapio([], [attach({ comandas: 50, comSobremesa: 0 })]).insights.map((i) => i.id)).not.toContain("sobremesa-baixa");
  });

  test("bebida em queda de 3 pontos ou mais contra o anterior vira alerta", () => {
    const r = cardapio([], [attach({ comBebida: 770 }), attach({ janela: "anterior", comBebida: 800 })]);
    expect(r.insights.find((i) => i.id === "bebida-caiu")).toMatchObject({ tom: "alerta" });
    const menor = cardapio([], [attach({ comBebida: 780 }), attach({ janela: "anterior", comBebida: 800 })]);
    expect(menor.insights.map((i) => i.id)).not.toContain("bebida-caiu");
  });

  test("subida nao gera alerta", () => {
    const r = cardapio([], [attach({ comBebida: 900 }), attach({ janela: "anterior", comBebida: 800 })]);
    expect(r.insights.map((i) => i.id)).not.toContain("bebida-caiu");
  });

  test("cauda longa: 30% dos produtos somando menos de 5% da receita", () => {
    const r = cardapio([prod("Grande", 99_000, 100), ...Array.from({ length: 30 }, (_, i) => prod(`c${i}`, 20, 1))]);
    const i = r.insights.find((x) => x.id === "cauda-longa");
    expect(i?.tom).toBe("info");
    expect(i?.titulo).toMatch(/^30 de 31 produtos somam só 0,6% da receita$/);
  });

  test("cauda longa so avisa com 20+ produtos", () => {
    const r = cardapio([prod("Grande", 99_000, 100), ...Array.from({ length: 10 }, (_, i) => prod(`c${i}`, 20, 1))]);
    expect(r.insights.map((i) => i.id)).not.toContain("cauda-longa");
  });

  test("dependencia: um produto com 40% ou mais da receita", () => {
    const i = cardapio(produtosGrandes).insights.find((x) => x.id === "dependencia");
    expect(i?.titulo).toBe("Buffet é 62% da receita");
    expect(cardapio([prod("A", 390, 1), prod("B", 610, 1)]).insights.find((x) => x.id === "dependencia")?.titulo).toBe("B é 61% da receita");
    expect(cardapio([prod("A", 390, 1), prod("B", 310, 1), prod("C", 300, 1)]).insights.map((x) => x.id)).not.toContain("dependencia");
  });

  test("dependencia no limite exato de 40% ja avisa", () => {
    const r = cardapio([prod("Exato", 400, 1), prod("B", 300, 1), prod("C", 300, 1)]);
    expect(r.insights.find((x) => x.id === "dependencia")?.titulo).toBe("Exato é 40% da receita");
  });

  test("ordem: alerta, oportunidade, informativo; no maximo 5", () => {
    const r = cardapio([prod("Buffet", 99_000, 100), prod("CHOPP", 0, 71), ...Array.from({ length: 30 }, (_, i) => prod(`c${i}`, 20, 1))], [attach(), attach({ janela: "anterior", comBebida: 900, comCafe: 500 })]);
    const tons = r.insights.map((i) => i.tom);
    expect(tons).toEqual([...tons].sort((a, b) => ["alerta", "oportunidade", "info"].indexOf(a) - ["alerta", "oportunidade", "info"].indexOf(b)));
    expect(r.insights.length).toBeLessThanOrEqual(5);
    expect(r.insights[0].tom).toBe("alerta");
  });

  test("tudo normal: sem avisos", () => {
    const r = cardapio([prod("A", 350, 3), prod("B", 350, 3), prod("C", 300, 4)], [attach({ comSobremesa: 80 })]);
    expect(r.insights).toEqual([]);
  });
});
