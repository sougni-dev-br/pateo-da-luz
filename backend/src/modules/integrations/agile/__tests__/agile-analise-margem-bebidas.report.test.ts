import { describe, expect, test } from "vitest";
import { custoDoVinculo, type InsumoDoBanco } from "../agile-bebidas-custo.js";
import {
  LIMITE_MARGEM_BAIXA_BEBIDA, MAX_A_FAZER_BEBIDAS, montarMargemBebidas, type BebidaVendida, type InsumoParaVincular, type VinculoDeBebida
} from "../agile-analise-margem-bebidas.report.js";

const periodo = { inicio: "2026-09-14", fim: "2026-10-13" };
const beb = (codigo: string, nome: string, valor: number, quantidade: number, categoria = "BEBIDAS"): BebidaVendida => ({ codigo, nome, categoria, quantidade, valor });
const vinc = (codigo: string, custoPorVenda: number | null, over: Partial<VinculoDeBebida> = {}): VinculoDeBebida => ({
  codigo, insumoId: "i-" + codigo, insumo: "Insumo " + codigo, quantidade: 1, unidade: "UN", custoPorVenda, custoCompleto: custoPorVenda !== null, problema: custoPorVenda === null ? "Produto sem custo medio no estoque." : null, ...over
});
const ins = (id: string, nome: string): InsumoParaVincular => ({ id, nome, unidade: "UN" });
const montar = (bebidas: BebidaVendida[], vinculos: VinculoDeBebida[] = [], insumos: InsumoParaVincular[] = []) => montarMargemBebidas({ periodo, bebidas, vinculos, insumos });

describe("margem de revenda", () => {
  test("preco medio realizado menos o custo de compra por venda", () => {
    const r = montar([beb("1", "COCA", 1290, 100)], [vinc("1", 4.4)]);
    expect(r.linhas).toEqual([expect.objectContaining({ codigo: "1", quantidade: 100, receita: 1290, precoMedio: 12.9, custoPorVenda: 4.4, margemUnitaria: 8.5, margemPct: 0.6589, cmvPct: 0.3411, margemTotal: 850 })]);
    expect(r.linhas[0].consumo).toBe("1 UN de Insumo 1");
  });

  test("consumo por venda aparece como o usuario cadastrou (150 ML de uma garrafa)", () => {
    const r = montar([beb("1", "TACA", 2400, 100)], [vinc("1", 5.2, { quantidade: 150, unidade: "ML", insumo: "Vinho 750ML" })]);
    expect(r.linhas[0].consumo).toBe("150 ML de Vinho 750ML");
  });

  test("margem negativa continua negativa", () => {
    const r = montar([beb("1", "PROMO", 500, 100)], [vinc("1", 8)]);
    expect(r.linhas[0]).toMatchObject({ precoMedio: 5, margemUnitaria: -3, margemTotal: -300 });
  });

  test("a ordem e pela margem total, nao pela receita", () => {
    const r = montar([beb("1", "CARA", 9000, 100), beb("2", "BARATA", 4000, 100)], [vinc("1", 89), vinc("2", 10)]);
    // Cara: preco 90, custo 89 -> 100. Barata: preco 40, custo 10 -> 3.000.
    expect(r.linhas.map((l) => l.codigo)).toEqual(["2", "1"]);
  });

  test("ordena pela margem total", () => {
    const r = montar([beb("1", "A", 1000, 10), beb("2", "B", 9000, 100)], [vinc("1", 10), vinc("2", 10)]);
    expect(r.linhas.map((l) => l.codigo)).toEqual(["2", "1"]);
  });

  test("custo incompleto (insumo sem custo ou sem conversao) NAO inventa margem e entra na lista com o motivo", () => {
    const r = montar([beb("1", "SEM CUSTO", 1000, 10)], [vinc("1", null)]);
    expect(r.linhas).toEqual([]);
    expect(r.aFazer[0]).toMatchObject({ codigo: "1", situacao: "custo-incompleto", insumo: "Insumo 1", problema: "Produto sem custo medio no estoque." });
    expect(r.cobertura.receitaCustoIncompleto).toBe(1000);
    expect(r.cobertura.pctCustoIncompleto).toBe(1);
    expect(r.cobertura.pctSemVinculo).toBe(0);
  });

  test("custo incompleto nao recebe sugestao de insumo (ja tem um vinculado)", () => {
    const r = montar([beb("1", "AGUA COM GAS", 1000, 10)], [vinc("1", null)], [ins("a", "AGUA COM GAS 500ML")]);
    expect(r.aFazer[0]).toMatchObject({ situacao: "custo-incompleto", sugestoes: [] });
  });

  test("bebida sem vinculo: sugestao de insumo pelo nome, so entre os que tem custo", () => {
    const r = montar([beb("1", "AGUA COM GAS", 1190, 100, "BEBIDAS NÃO ALCOOLICAS")], [], [ins("a", "CRYSTAL AGUA MINERAL C/GAS 500ML"), ins("b", "DETERGENTE 5L")]);
    expect(r.aFazer[0]).toMatchObject({ codigo: "1", situacao: "sem-vinculo" });
    expect(r.aFazer[0].sugestoes.map((s) => s.insumoId)).toEqual(["a"]);
  });

  test("so quem tem vinculo e custo completo entra nas linhas; o resto vira lista a fazer na ordem da receita", () => {
    const r = montar([beb("1", "A", 100, 2), beb("2", "B", 900, 18), beb("3", "C", 500, 9)], [vinc("1", 10)]);
    expect(r.aFazer.map((x) => x.codigo)).toEqual(["2", "3"]);
    expect(r.aFazer[0].pctReceita).toBeCloseTo(0.6, 4);
  });

  test("produto a R$ 0 (brinde) fica fora", () => {
    const r = montar([beb("z", "BRINDE", 0, 40), beb("1", "A", 100, 2)]);
    expect(r.aFazer.map((x) => x.codigo)).toEqual(["1"]);
    expect(r.cobertura.receitaBebidas).toBe(100);
  });

  test("produto sem codigo nao da para vincular: sugestao vazia e situacao propria", () => {
    const r = montar([{ codigo: null, nome: "SEM CODIGO", categoria: "BEBIDAS", quantidade: 1, valor: 100 }], [], [ins("a", "SEM CODIGO")]);
    expect(r.aFazer[0]).toMatchObject({ codigo: null, situacao: "sem-vinculo", sugestoes: [] });
  });

  test("limita a lista a fazer", () => {
    const muitas = Array.from({ length: MAX_A_FAZER_BEBIDAS + 5 }, (_, i) => beb(`c${i}`, `BEBIDA ${i}`, 100 + i, 1));
    expect(montar(muitas).aFazer).toHaveLength(MAX_A_FAZER_BEBIDAS);
  });

  test("insumos para escolher: em ordem alfabetica, e so viajam quando ha bebida a vincular", () => {
    const r = montar([beb("1", "A", 100, 2)], [], [ins("2", "Zebra"), ins("1", "Abacaxi")]);
    expect(r.insumosParaVincular.map((i) => i.nome)).toEqual(["Abacaxi", "Zebra"]);
    const tudoCalculado = montar([beb("1", "A", 100, 2)], [vinc("1", 1)], [ins("2", "Zebra")]);
    expect(tudoCalculado.insumosParaVincular).toEqual([]);
  });

  test("cortesia nao dilui o preco: o preco medio sai das unidades PAGAS e o custo conta todas", () => {
    // 100 unidades, 20 delas sem cobranca: 80 pagas somam R$ 960 (preco 12). Custo 4 x 100 = 400.
    const r = montar([{ ...beb("1", "COCA", 960, 100), quantidadePaga: 80 }], [vinc("1", 4)]);
    expect(r.linhas[0]).toMatchObject({ quantidade: 100, quantidadeSemCobranca: 20, precoMedio: 12, margemUnitaria: 8, margemTotal: 560 });
  });

  test("sem cortesia a conta e a de sempre", () => {
    const r = montar([{ ...beb("1", "COCA", 1000, 100), quantidadePaga: 100 }], [vinc("1", 4)]);
    expect(r.linhas[0]).toMatchObject({ quantidadeSemCobranca: 0, precoMedio: 10, margemTotal: 600 });
  });

  test("cortesia nao gera falso alerta de venda abaixo do custo", () => {
    // Preco de tabela 12, custo 4: sem o ajuste o preco medio cairia para 6 e nao alertaria; com 70% de cortesia cairia abaixo do custo.
    const r = montar([{ ...beb("1", "COCA", 600, 200), quantidadePaga: 50 }], [vinc("1", 4)]);
    expect(r.linhas[0].precoMedio).toBe(12);
    expect(r.insights.map((i) => i.id)).not.toContain("margem-negativa");
  });
});

describe("cobertura e avisos", () => {
  test("cobertura sobre a receita das bebidas", () => {
    const r = montar([beb("1", "A", 1000, 10), beb("2", "B", 3000, 30)], [vinc("1", 4)]);
    expect(r.cobertura).toMatchObject({ receitaBebidas: 4000, receitaComMargem: 1000, receitaSemVinculo: 3000, pctComMargem: 0.25, pctSemVinculo: 0.75 });
  });

  test("periodo sem venda: tudo zero, sem divisao por zero", () => {
    const r = montar([]);
    expect(r.cobertura).toMatchObject({ receitaBebidas: 0, pctComMargem: 0, pctSemVinculo: 0 });
  });

  test("margem negativa e alerta; margem baixa e oportunidade; cobertura baixa e informacao", () => {
    const r = montar(
      [beb("1", "PERDE", 1000, 100), beb("2", "POUCO", 1000, 100), beb("3", "SEM", 8000, 800)],
      [vinc("1", 12), vinc("2", 6)]
    );
    expect(r.insights.map((i) => [i.id, i.tom])).toEqual([["margem-negativa", "alerta"], ["margem-baixa", "oportunidade"], ["cobertura-baixa", "info"]]);
    expect(r.insights[0].titulo).toContain("PERDE");
  });

  test("limites exatos: margem de exatamente o limite nao e baixa; receita de 500 ja conta", () => {
    expect(LIMITE_MARGEM_BAIXA_BEBIDA).toBeGreaterThan(0);
    const exata = montar([beb("1", "A", 1000, 100)], [vinc("1", 10 * (1 - LIMITE_MARGEM_BAIXA_BEBIDA))]);
    expect(exata.insights.map((i) => i.id)).not.toContain("margem-baixa");
    const quinhentos = montar([beb("1", "A", 500, 100)], [vinc("1", 6)]);
    expect(quinhentos.insights.map((i) => i.id)).toContain("margem-negativa");
  });

  test("margem exatamente zero nao e negativa (e baixa); cobertura de exatamente 50% nao avisa", () => {
    const zero = montar([beb("1", "A", 1000, 100)], [vinc("1", 10)]);
    expect(zero.insights.map((i) => i.id)).toEqual(["margem-baixa"]);
    const metade = montar([beb("1", "A", 500, 10), beb("2", "B", 500, 10)], [vinc("1", 1)]);
    expect(metade.cobertura.pctComMargem).toBe(0.5);
    expect(metade.insights.map((i) => i.id)).not.toContain("cobertura-baixa");
  });

  test("margem boa e cobertura alta: sem aviso", () => {
    expect(montar([beb("1", "A", 1000, 100)], [vinc("1", 2)]).insights).toEqual([]);
  });
});

describe("custo do vinculo (insumo, quantidade e unidade)", () => {
  const insumo = (over: Partial<InsumoDoBanco> = {}): InsumoDoBanco => ({ name: "COCA COLA 350ML", unit: "UN", stockUnit: "UN", averageCost: 4.41, conversions: [], ...over });

  test("1 unidade de um insumo cotado por unidade", () => {
    expect(custoDoVinculo(insumo(), 1, "UN")).toMatchObject({ custoPorVenda: 4.41, custoCompleto: true, problema: null });
  });

  test("taça: 150 ML de uma garrafa de 750 ML (conversao lida do nome do produto)", () => {
    const r = custoDoVinculo(insumo({ name: "CATRAIO - VINHO TINTO 750ML", averageCost: 26.16 }), 150, "ML");
    expect(r.custoCompleto).toBe(true);
    expect(r.custoPorVenda).toBeCloseTo(5.232, 3);
  });

  test("insumo sem custo medio: incompleto, com o motivo", () => {
    expect(custoDoVinculo(insumo({ averageCost: null }), 1, "UN")).toMatchObject({ custoPorVenda: null, custoCompleto: false, problema: expect.stringMatching(/sem custo/i) });
  });

  test("custo zero tambem e sem custo (nao inventa margem de 100%)", () => {
    expect(custoDoVinculo(insumo({ averageCost: 0 }), 1, "UN").custoCompleto).toBe(false);
  });

  test("unidade que nao converte: incompleto, com o motivo", () => {
    const r = custoDoVinculo(insumo({ name: "COCA COLA LATA" }), 100, "ML");
    expect(r).toMatchObject({ custoPorVenda: null, custoCompleto: false });
    expect(r.problema).toMatch(/conversao|conversão/i);
  });

  test("quantidade zero ou negativa nao serve", () => {
    expect(custoDoVinculo(insumo(), 0, "UN").custoCompleto).toBe(false);
    expect(custoDoVinculo(insumo(), -1, "UN").custoCompleto).toBe(false);
  });
});
