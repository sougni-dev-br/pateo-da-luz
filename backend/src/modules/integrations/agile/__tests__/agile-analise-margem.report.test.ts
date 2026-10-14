import { describe, expect, test } from "vitest";
import { similaridade, sugerirPratos, tokensDoNome } from "../agile-nomes.js";
import {
  LIMITE_MARGEM_BAIXA, MAX_A_FAZER, montarMargem, type PratoDoSalao, type ProdutoVendido, type VinculoDoPdv
} from "../agile-analise-margem.report.js";

const periodo = { inicio: "2026-09-14", fim: "2026-10-13" };
const prod = (codigo: string, nome: string, valor: number, quantidade: number, categoria = "PRATOS"): ProdutoVendido => ({ codigo, nome, categoria, quantidade, valor });
const prato = (id: string, nome: string, custoPorcao: number | null, over: Partial<PratoDoSalao> = {}): PratoDoSalao => ({
  id, nome, precoFicha: 60, custoPorcao, itensNaFicha: custoPorcao === null ? 0 : 3, custoCompleto: custoPorcao !== null, ...over
});
const montar = (produtos: ProdutoVendido[], pratos: PratoDoSalao[] = [], vinculos: VinculoDoPdv[] = []) => montarMargem({ periodo, produtos, pratos, vinculos });

describe("nomes: tokens e sugestoes", () => {
  test("tokens sem acento, caixa, stopwords e plural", () => {
    expect(tokensDoNome("Filé à Parmegiana c/ Arroz e Fritas")).toEqual(["file", "parmegiana", "arroz", "fritas"].map((t) => (t === "fritas" ? "frita" : t)));
  });

  test("sugere o prato mais parecido, mesmo com erro de digitacao de uma letra", () => {
    const pratos = [prato("a", "Pallard de Mignon", 20), prato("b", "Milanesa de frango com risoto de limão", 18), prato("c", "Fraldinha assada ao molho de queijos", 25)];
    const s = sugerirPratos("PAILLARD DE MIGNON C/ RISOTO DE PARMESAO", pratos);
    expect(s[0]).toMatchObject({ pratoId: "a" });
  });

  test("o limiar e inclusivo: 'BIFE ANCHO DO PATEO' ainda sugere a ficha mais longa do mesmo corte", () => {
    const s = sugerirPratos("BIFE ANCHO DO PATEO", [prato("a", "Bife Ancho Grelhado Batatas e Arroz Biro Biro", 19)]);
    expect(s[0]).toMatchObject({ pratoId: "a", similaridade: 0.4 });
  });

  test("palavra de 4 letras ainda tolera uma letra de diferenca; palavra curta nao", () => {
    expect(similaridade("FILET", "File")).toBe(1);
    expect(similaridade("PAO", "PAU")).toBe(0);
  });

  test("nada parecido: sem sugestao (melhor nao sugerir do que sugerir errado)", () => {
    expect(sugerirPratos("CHOPP BRAHMA", [prato("a", "Pallard de Mignon", 20)])).toEqual([]);
  });

  test("no maximo 3 sugestoes, da mais para a menos parecida", () => {
    const pratos = ["Baby beef grelhado ao molho mostarda e risoto alho poro", "Baby Beef a Milanesa e Nhoque", "Baby beef ao molho madeira", "Baby beef na chapa", "Salmão grelhado"].map((n, i) => prato(String(i), n, 20));
    const s = sugerirPratos("BABY BEEF C/ RISOTO", pratos);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.map((x) => x.similaridade)).toEqual([...s.map((x) => x.similaridade)].sort((a, b) => b - a));
    expect(s.some((x) => x.pratoId === "4")).toBe(false);
  });
});

describe("margem por prato", () => {
  test("preco medio realizado, custo da porcao, margem em R$ e em %", () => {
    const r = montar([prod("1", "BABY BEEF", 5000, 100)], [prato("d1", "Baby beef", 20)], [{ codigo: "1", pratoId: "d1" }]);
    expect(r.linhas).toEqual([expect.objectContaining({ pratoId: "d1", quantidade: 100, receita: 5000, precoMedio: 50, custoPorcao: 20, margemUnitaria: 30, margemPct: 0.6, margemTotal: 3000, cmvPct: 0.4, situacao: "completa" })]);
  });

  test("cortesia nao dilui o preco do prato: preco medio das unidades pagas, custo de todas", () => {
    // 100 unidades, 20 sem cobranca; 80 pagas somam R$ 4.000 (preco 50). Custo 18 x 100 = 1.800.
    const r = montar([{ ...prod("1", "BABY BEEF", 4000, 100), quantidadePaga: 80 }], [prato("d1", "Baby beef", 18)], [{ codigo: "1", pratoId: "d1" }]);
    // Margem real da linha: 2.200 / 4.000 = 55% (nao os 64% de uma unidade paga); CMV real: 1.800 / 4.000 = 45%.
    expect(r.linhas[0]).toMatchObject({ quantidade: 100, quantidadeSemCobranca: 20, precoMedio: 50, margemUnitaria: 32, margemPct: 0.55, cmvPct: 0.45, margemTotal: 2200 });
  });

  test("sem cortesia: quantidadeSemCobranca zero e a conta de sempre", () => {
    const r = montar([{ ...prod("1", "BABY BEEF", 5000, 100), quantidadePaga: 100 }], [prato("d1", "Baby beef", 20)], [{ codigo: "1", pratoId: "d1" }]);
    expect(r.linhas[0]).toMatchObject({ quantidadeSemCobranca: 0, precoMedio: 50, margemTotal: 3000 });
  });

  test("cortesia vinda de varios codigos do mesmo prato soma as unidades pagas de cada um", () => {
    const r = montar(
      [{ ...prod("1", "A", 1000, 30), quantidadePaga: 20 }, { ...prod("2", "B", 2000, 40), quantidadePaga: 40 }],
      [prato("d1", "Prato", 10)],
      [{ codigo: "1", pratoId: "d1" }, { codigo: "2", pratoId: "d1" }]
    );
    expect(r.linhas[0]).toMatchObject({ quantidade: 70, quantidadeSemCobranca: 10, receita: 3000 });
    expect(r.linhas[0].precoMedio).toBe(50); // 3.000 / 60 pagas
  });

  test("produto sem codigo: sem sugestao (nao da para vincular)", () => {
    const r = montar([{ codigo: null, nome: "BABY BEEF", categoria: "PRATOS", quantidade: 10, valor: 1000 }], [prato("d1", "Baby beef", 20)]);
    expect(r.aFazer[0]).toMatchObject({ codigo: null, situacao: "sem-vinculo", sugestoes: [] });
  });

  test("totalAFazer conta TODAS as pendencias, mesmo as que a lista corta", () => {
    const muitos = Array.from({ length: MAX_A_FAZER + 7 }, (_, i) => prod(`c${i}`, `PRATO ${i}`, 100 + i, 1));
    const r = montar(muitos);
    expect(r.aFazer).toHaveLength(MAX_A_FAZER);
    expect(r.totalAFazer).toBe(MAX_A_FAZER + 7);
  });

  test("varios codigos do PDV no mesmo prato somam receita e quantidade", () => {
    const r = montar([prod("1", "BABY BEEF", 3000, 60), prod("2", "BABY BEEF ALMOCO", 2000, 40)], [prato("d1", "Baby beef", 20)], [{ codigo: "1", pratoId: "d1" }, { codigo: "2", pratoId: "d1" }]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ quantidade: 100, receita: 5000, precoMedio: 50 });
    expect(r.linhas[0].produtosPdv.map((p) => p.codigo).sort()).toEqual(["1", "2"]);
  });

  test("margem negativa continua negativa (nao some)", () => {
    const r = montar([prod("1", "PRATO", 1000, 50)], [prato("d1", "Prato", 30)], [{ codigo: "1", pratoId: "d1" }]);
    expect(r.linhas[0]).toMatchObject({ precoMedio: 20, margemUnitaria: -10, margemPct: -0.5 });
  });

  test("ordena pela margem total (o que mais deixa dinheiro primeiro)", () => {
    const r = montar([prod("1", "A", 1000, 10), prod("2", "B", 9000, 100)], [prato("a", "A", 10), prato("b", "B", 10)], [{ codigo: "1", pratoId: "a" }, { codigo: "2", pratoId: "b" }]);
    expect(r.linhas.map((l) => l.pratoId)).toEqual(["b", "a"]);
  });

  test("a ordem e pela margem total, nao pela receita: prato de receita maior pode deixar menos", () => {
    const r = montar([prod("1", "CARO", 9000, 100), prod("2", "BARATO", 4000, 10)], [prato("a", "Caro", 85), prato("b", "Barato", 10)], [{ codigo: "1", pratoId: "a" }, { codigo: "2", pratoId: "b" }]);
    // Caro: preco 90, custo 85 -> 5 x 100 = 500. Barato: preco 400, custo 10 -> 390 x 10 = 3.900.
    expect(r.linhas.map((l) => l.pratoId)).toEqual(["b", "a"]);
  });

  test("ficha sem itens ou com custo incompleto NAO inventa margem", () => {
    const r = montar(
      [prod("1", "SEM FICHA", 1000, 10), prod("2", "INCOMPLETA", 2000, 20)],
      [prato("a", "Sem ficha", null), prato("b", "Incompleta", 12, { custoCompleto: false })],
      [{ codigo: "1", pratoId: "a" }, { codigo: "2", pratoId: "b" }]
    );
    expect(r.linhas).toEqual([]);
    expect(r.aFazer.map((x) => [x.codigo, x.situacao])).toEqual([["2", "custo-incompleto"], ["1", "sem-ficha"]]);
    expect(r.cobertura.receitaComMargem).toBe(0);
    expect(r.cobertura.receitaSemFicha).toBe(1000);
    expect(r.cobertura.receitaCustoIncompleto).toBe(2000);
    expect(r.cobertura.pctVinculadoSemCusto).toBe(1);
    // So quem ainda nao tem vinculo recebe sugestao de prato.
    expect(r.aFazer.every((x) => x.sugestoes.length === 0)).toBe(true);
  });

  test("vinculado a prato sem ficha nao recebe sugestao mesmo com nome parecido", () => {
    const r = montar([prod("1", "BABY BEEF", 1000, 10)], [prato("a", "Baby beef", null)], [{ codigo: "1", pratoId: "a" }]);
    expect(r.aFazer[0]).toMatchObject({ situacao: "sem-ficha", sugestoes: [] });
  });

  test("produto vinculado a prato desativado ou fora do salao: situacao propria, com sugestoes para escolher outro", () => {
    const r = montar([prod("1", "BABY BEEF", 1000, 10)], [prato("b", "Baby beef grelhado", 20)], [{ codigo: "1", pratoId: "fantasma" }]);
    expect(r.aFazer[0]).toMatchObject({ codigo: "1", situacao: "prato-indisponivel", pratoId: null });
    expect(r.aFazer[0].sugestoes[0]).toMatchObject({ pratoId: "b" });
    expect(r.cobertura.receitaPratoIndisponivel).toBe(1000);
    expect(r.cobertura.pctVinculadoSemCusto).toBe(1);
    expect(r.cobertura.pctSemVinculo).toBe(0);
  });
});

describe("cobertura e lista a fazer", () => {
  const produtos = [
    prod("b1", "BUFFET PROMO 15", 6000, 300, "ALIMENTOS"),
    prod("p1", "BABY BEEF", 1000, 20),
    prod("p2", "FILET OSWALDO ARANHA", 800, 16),
    prod("p3", "PRATO RARO", 200, 4),
    prod("z", "BRINDE", 0, 40)
  ];
  const pratos = [prato("d1", "Baby beef", 20)];
  const r = montar(produtos, pratos, [{ codigo: "p1", pratoId: "d1" }]);

  test("o buffet nao entra como prato: fica separado, porque margem de buffet e por pessoa, nao por prato", () => {
    expect(r.cobertura.receitaBuffet).toBe(6000);
    expect(r.aFazer.some((x) => x.codigo === "b1")).toBe(false);
    expect(r.linhas.some((l) => l.produtosPdv.some((p) => p.codigo === "b1"))).toBe(false);
  });

  test("bebida e revenda: fica fora da conta de pratos e aparece em receitaBebidas", () => {
    const rb = montar([prod("1", "BABY BEEF", 1000, 20), prod("2", "REFRIGERANTE", 500, 100, "BEBIDAS"), prod("3", "VINHO", 300, 3, "VINHOS")], [], []);
    expect(rb.cobertura).toMatchObject({ receitaPratos: 1000, receitaBebidas: 800 });
    expect(rb.aFazer.map((x) => x.codigo)).toEqual(["1"]);
  });

  test("cobertura em % da receita dos PRATOS (sem buffet): com margem, sem ficha e sem vinculo", () => {
    expect(r.cobertura.receitaPratos).toBe(2000);
    expect(r.cobertura.receitaComMargem).toBe(1000);
    expect(r.cobertura.receitaSemVinculo).toBe(1000);
    expect(r.cobertura.pctComMargem).toBe(0.5);
    expect(r.cobertura.pctSemVinculo).toBe(0.5);
    expect(r.cobertura.pctVinculadoSemCusto).toBe(0);
    expect(r.cobertura.pctDaReceitaTotalComMargem).toBeCloseTo(1000 / 8000, 4);
  });

  test("a fazer: o que mais vende primeiro, com a participacao na receita e sem produto a R$ 0", () => {
    expect(r.aFazer.map((x) => x.codigo)).toEqual(["p2", "p3"]);
    expect(r.aFazer[0]).toMatchObject({ situacao: "sem-vinculo", receita: 800, pctReceita: 0.4 });
    expect(r.aFazer.some((x) => x.codigo === "z")).toBe(false);
  });

  test("a fazer traz sugestoes de prato para vincular", () => {
    const comSugestao = montar([prod("p2", "FILET OSWALDO ARANHA", 800, 16)], [prato("o", "Filé Oswaldo Aranha", 22)]);
    expect(comSugestao.aFazer[0].sugestoes[0]).toMatchObject({ pratoId: "o" });
  });

  test("limita a lista a fazer", () => {
    const muitos = Array.from({ length: MAX_A_FAZER + 10 }, (_, i) => prod(`c${i}`, `PRATO ${i}`, 100 + i, 1));
    expect(montar(muitos).aFazer).toHaveLength(MAX_A_FAZER);
  });

  test("lista de pratos para escolher no vinculo: so os do salao, em ordem alfabetica", () => {
    const rr = montar([], [prato("2", "Zebra", 1), prato("1", "Abacaxi", 1)]);
    expect(rr.pratosParaVincular.map((p) => p.nome)).toEqual(["Abacaxi", "Zebra"]);
  });

  test("periodo sem venda: tudo zero e sem divisao por zero", () => {
    const vazio = montar([]);
    expect(vazio.cobertura).toMatchObject({ receitaPratos: 0, pctComMargem: 0, pctSemVinculo: 0, receitaBuffet: 0 });
    expect(vazio.linhas).toEqual([]);
  });
});

describe("avisos", () => {
  test("margem abaixo do limite vira aviso com o prato e o impacto", () => {
    const r = montar([prod("1", "ALFA", 1000, 20)], [prato("a", "Alfa", 40)], [{ codigo: "1", pratoId: "a" }]); // preco 50, custo 40 -> 20%
    expect(LIMITE_MARGEM_BAIXA).toBeGreaterThan(0.2);
    expect(r.insights.map((i) => i.id)).toContain("margem-baixa");
    expect(r.insights.find((i) => i.id === "margem-baixa")?.titulo).toContain("Alfa");
  });

  test("margem negativa e alerta, antes da margem baixa", () => {
    const r = montar([prod("1", "ALFA", 1000, 50), prod("2", "BETA", 1000, 20)], [prato("a", "Alfa", 30), prato("b", "Beta", 40)], [{ codigo: "1", pratoId: "a" }, { codigo: "2", pratoId: "b" }]);
    expect(r.insights[0]).toMatchObject({ id: "margem-negativa", tom: "alerta" });
  });

  test("cobertura baixa avisa que a margem calculada e so uma parte da receita", () => {
    const r = montar([prod("1", "ALFA", 100, 2), prod("2", "BETA", 900, 18)], [prato("a", "Alfa", 10)], [{ codigo: "1", pratoId: "a" }]);
    const ins = r.insights.find((i) => i.id === "cobertura-baixa");
    expect(ins?.tom).toBe("info");
    expect(ins?.titulo).toMatch(/10%/);
  });

  test("margem boa e cobertura alta: sem aviso", () => {
    const r = montar([prod("1", "ALFA", 1000, 20)], [prato("a", "Alfa", 10)], [{ codigo: "1", pratoId: "a" }]);
    expect(r.insights).toEqual([]);
  });

  test("limites exatos: 50% de margem nao e baixa; 500 de receita ja conta; cobertura de 50% nao avisa", () => {
    const exata = montar([prod("1", "ALFA", 1000, 20)], [prato("a", "Alfa", 25)], [{ codigo: "1", pratoId: "a" }]); // preco 50, custo 25 -> 50%
    expect(exata.insights.map((i) => i.id)).not.toContain("margem-baixa");
    const quinhentos = montar([prod("1", "ALFA", 500, 10)], [prato("a", "Alfa", 60)], [{ codigo: "1", pratoId: "a" }]); // preco 50, custo 60
    expect(quinhentos.insights.map((i) => i.id)).toContain("margem-negativa");
    const metade = montar([prod("1", "ALFA", 500, 10), prod("2", "BETA", 500, 10)], [prato("a", "Alfa", 10)], [{ codigo: "1", pratoId: "a" }]);
    expect(metade.cobertura.pctComMargem).toBe(0.5);
    expect(metade.insights.map((i) => i.id)).not.toContain("cobertura-baixa");
  });

  test("margem exatamente zero nao e negativa (e baixa)", () => {
    const r = montar([prod("1", "ALFA", 1000, 20)], [prato("a", "Alfa", 50)], [{ codigo: "1", pratoId: "a" }]);
    expect(r.insights.map((i) => i.id)).toEqual(["margem-baixa"]);
  });

  test("produto a R$ 0 nao entra nem na lista a fazer nem na cobertura", () => {
    const r = montar([prod("z", "BRINDE", 0, 40), prod("1", "ALFA", 100, 2)]);
    expect(r.aFazer.map((x) => x.codigo)).toEqual(["1"]);
    expect(r.cobertura.receitaPratos).toBe(100);
  });
});
