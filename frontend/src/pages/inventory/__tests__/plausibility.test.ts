import { describe, expect, test } from "vitest";
import { evaluateQuantity, packSizeFromName, type QuantityPlausibility } from "../shared";

const vazio: QuantityPlausibility = {
  itemId: "i1", median: null, maxCount: null, weakBaseline: false, erraticHistory: false, observations: 0, purchasedEver: null
};
// Carne: historico coerente, contada entre 20 e 60, comprada bastante.
const carne: QuantityPlausibility = {
  itemId: "carne", median: 40, maxCount: 60, weakBaseline: false, erraticHistory: false, observations: 6, purchasedEver: 900
};

describe("evaluateQuantity — base e o historico de contagem", () => {
  test("quantidade normal nao gera aviso", () => {
    expect(evaluateQuantity(carne, "38,5")).toEqual([]);
  });

  test("acima da maior contagem ja vista avisa", () => {
    expect(evaluateQuantity(carne, "400")).toContain("FORA_DA_FAIXA");
  });

  test("logo acima do maior historico ainda passa (margem de 5x)", () => {
    // Compra grande e contagem atipica sao legitimas — o aviso so vale para
    // desvio de ordem de grandeza, senao vira ruido.
    expect(evaluateQuantity(carne, "150")).toEqual([]);
  });

  test("zero num produto que sempre tem estoque pede confirmacao", () => {
    // Sinal que teria pego o incidente da virgula: 16,5 virava 0.
    expect(evaluateQuantity(carne, "0")).toEqual(["ZERO_INESPERADO"]);
  });

  test("uma ordem de grandeza abaixo da mediana avisa", () => {
    expect(evaluateQuantity(carne, "1")).toContain("FORA_DA_FAIXA");
  });

  test("campo vazio nao acusa nada", () => {
    expect(evaluateQuantity(carne, "")).toEqual([]);
  });

  test("sem historico suficiente nao acusa nada", () => {
    expect(evaluateQuantity(vazio, "12345")).toEqual([]);
  });

  test("item sem dado de plausibilidade nao acusa nada", () => {
    expect(evaluateQuantity(undefined, "999999")).toEqual([]);
  });
});

describe("evaluateQuantity — estoque anterior ao sistema", () => {
  // O ERP registra compras a partir de jun/2026. Produto comprado antes disso
  // aparece com compra irrisoria e estoque real. O historico de contagem prova
  // que a quantidade existe, entao a compra NAO pode servir de teto.
  const licorAntigo: QuantityPlausibility = {
    itemId: "licor", median: 6, maxCount: 6.5, weakBaseline: false, erraticHistory: false, observations: 5, purchasedEver: 1
  };

  test("contagem coerente com o historico passa, mesmo acima do comprado", () => {
    expect(evaluateQuantity(licorAntigo, "6,5")).toEqual([]);
  });

  test("nem 3x o comprado dispara, se o historico sustenta", () => {
    expect(evaluateQuantity(licorAntigo, "5")).toEqual([]);
  });

  test("desvio real continua sendo pego pelo historico", () => {
    expect(evaluateQuantity(licorAntigo, "500")).toContain("FORA_DA_FAIXA");
  });
});

describe("evaluateQuantity — historico erratico (confusao de unidade)", () => {
  // PALITO C/2000: contagens de 0,7 (sache) a 1800 (palito avulso). A mediana cai
  // em 800 e acusaria de atipico justamente o valor certo. Sem base confiavel, a
  // compra volta a ser o unico sinal utilizavel.
  const palito: QuantityPlausibility = {
    itemId: "palito", median: null, maxCount: null, weakBaseline: false, erraticHistory: true, observations: 4, purchasedEver: 1
  };

  test("o valor CERTO nao e acusado de atipico", () => {
    expect(evaluateQuantity(palito, "1")).toEqual(["CONFERIR_UNIDADE"]);
  });

  test("o valor errado e pego pelo teto de compras", () => {
    expect(evaluateQuantity(palito, "1600")).toEqual(["CONFERIR_UNIDADE", "MAIOR_QUE_COMPRADO"]);
  });

  test("zero nao vira falso ZERO_INESPERADO sem mediana confiavel", () => {
    expect(evaluateQuantity(palito, "0")).toEqual(["CONFERIR_UNIDADE"]);
  });
});

describe("packSizeFromName", () => {
  test("extrai o tamanho do pacote do nome", () => {
    expect(packSizeFromName("SACHE DE PALITO DE DENTE BAMBU C/ 2000")).toBe(2000);
    expect(packSizeFromName("GUARDANAPO F/D GF 33X33 C/50 CX 60")).toBe(50);
    expect(packSizeFromName("LUVA PROC VINIL G S/PO MEDIX C/100")).toBe(100);
  });

  test("ignora nome sem indicacao de pacote", () => {
    expect(packSizeFromName("CONTRA FILE")).toBeNull();
    expect(packSizeFromName("VINHO TINTO SECO RANDON 4,6 LITROS")).toBeNull();
    expect(packSizeFromName(null)).toBeNull();
  });
});

describe("evaluateQuantity — base fraca (uma unica contagem anterior)", () => {
  // Com uma contagem so nao se sabe se ela estava certa. Margem larga, so lado alto.
  const umaContagem = (maxCount: number): QuantityPlausibility => ({
    itemId: "u1", median: null, maxCount, weakBaseline: true,
    erraticHistory: false, observations: 1, purchasedEver: null
  });

  test("desvio grosseiro no lado alto avisa", () => {
    // MINI COLHER C/200: unica contagem anterior 1, alguem digitou 90.
    expect(evaluateQuantity(umaContagem(1), "90")).toEqual(["FORA_DA_FAIXA"]);
  });

  test("variacao normal nao avisa", () => {
    // PIMENTAO: unica contagem anterior 0,5, agora 3,5. Hortifruti varia assim.
    expect(evaluateQuantity(umaContagem(0.5), "3,5")).toEqual([]);
  });

  test("zero nao e acusado — base fraca demais para afirmar que deveria ter estoque", () => {
    // Perecivel zera o tempo todo. Acusar aqui encheria a tela de ruido.
    expect(evaluateQuantity(umaContagem(3), "0")).toEqual([]);
  });

  test("lado baixo nao e acusado", () => {
    expect(evaluateQuantity(umaContagem(100), "2")).toEqual([]);
  });

  test("quando a unica contagem anterior era a errada, o valor certo passa limpo", () => {
    // PALITO: a unica contagem anterior era 1800 (palito avulso). Digitar 1, que
    // e o certo, nao pode ser acusado — foi o falso positivo que derrubou a v1.
    expect(evaluateQuantity(umaContagem(1800), "1")).toEqual([]);
  });
});
