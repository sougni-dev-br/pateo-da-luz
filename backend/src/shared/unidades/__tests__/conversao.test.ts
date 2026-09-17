import { describe, expect, test } from "vitest";
import {
  converterItemDeCompra,
  detectarEmbalagem,
  normalizarUnidade,
  resolveUnitFactor
} from "../conversao.js";

describe("normalizarUnidade", () => {
  test("junta as grafias de unidade que convivem na base", () => {
    for (const grafia of ["UN", "UNI", "und", "Unidade", "UNIDADES", "un."]) {
      expect(normalizarUnidade(grafia)).toBe("UN");
    }
    expect(normalizarUnidade("CAIXA")).toBe("CX");
    expect(normalizarUnidade("PCTE")).toBe("PCT");
  });

  test("unidade vazia continua vazia", () => {
    expect(normalizarUnidade(null)).toBe("");
    expect(normalizarUnidade("   ")).toBe("");
  });
});

describe("resolveUnitFactor", () => {
  test("mesma unidade e fator 1, mesmo com grafias diferentes", () => {
    expect(resolveUnitFactor("UN", "UNI", [])).toBe(1);
  });

  test("usa a conversao do produto e a inversa dela", () => {
    const conv = [{ fromUnit: "CX", toUnit: "UN", factor: 800 }];
    expect(resolveUnitFactor("CX", "UN", conv)).toBe(800);
    expect(resolveUnitFactor("UN", "CX", conv)).toBeCloseTo(1 / 800, 10);
  });

  test("conversao do produto vence a universal", () => {
    expect(resolveUnitFactor("KG", "G", [])).toBe(1000);
    expect(resolveUnitFactor("KG", "G", [{ fromUnit: "KG", toUnit: "G", factor: 900 }])).toBe(900);
  });

  test("sem caminho devolve null em vez de chutar 1", () => {
    expect(resolveUnitFactor("CX", "UN", [])).toBeNull();
    expect(resolveUnitFactor("KG", "UN", [])).toBeNull();
  });

  test("fator invalido no cadastro e ignorado", () => {
    expect(resolveUnitFactor("CX", "UN", [{ fromUnit: "CX", toUnit: "UN", factor: 0 }])).toBeNull();
    expect(resolveUnitFactor("CX", "UN", [{ fromUnit: "CX", toUnit: "UN", factor: -5 }])).toBeNull();
  });
});

describe("detectarEmbalagem - nomes reais da base", () => {
  const primeira = (nome: string) => detectarEmbalagem(nome)[0];

  test("le o C800 do item que estourou o inventario de agosto", () => {
    // O nome tem dimensao (12X30 cm) e embalagem (C800). Ler a dimensao seria
    // pior que nao ler nada: daria um fator de 12 num produto de 800.
    const r = primeira("SACO AMOSTRA TARJA 12X30 C800");
    expect(r.quantidade).toBe(800);
    expect(r.trecho).toContain("C800");
    expect(r.confianca).toBe("alta");
  });

  test.each([
    ["CANUDO PARA RECHEIO C/40", 40],
    ["CANUDO SACHE BIO 5MM PETTIT C500", 500],
    ["COLHER REF MASTER CRISTAL PRAFESTA 50UNI", 50],
    ["EMBALAGEM PARA BATATA FRITA PCTE C/100", 100],
    ["ESPONJA MULTIUSO ALTA PERF C/3", 3],
    ["ETIQUETA 50X50 COUCHE REDONDA. C/1000", 1000],
    ["ETIQUETA MANIPU. PERS. SIF 60X40 C/1000", 1000],
    ["LUVA DESCARTAVEL PLASTICA C/100", 100],
    ["LUVA LATEX DESCARTAVEL G CX 100UNI", 100],
    ["LUVA PROC VINIL G S/PO MEDIX C/100", 100],
    ["MINI COLHER P/CAFE C/200", 200],
    ["PALITO REGINA P/ CHURRASCO 25CM C/50", 50],
    ["PANO MULT 28X240 AZ. TOP LIFECLEAN C/600 - PERFEX", 600],
    ["POTE REDONDO 145ML C25 CX20", 25],
    ["POTE RETANGULAR 250ML C/24 CX 6", 24],
    ["PT. INTERF. LUXO 20X21 NEW CLEAN C/1000", 1000],
    ["SACOLA KRAFT 30X32X19 BRASPEL C/100", 100],
    ["SACO LIXO VM. PLAMAX 100LTS M6 C/50", 50],
    ["GUARDANAPO F/D GF 33X33 C/50 CX 60", 50],
    ["COPO SUPREMO 300ML C/40 CX 16", 40],
    ["GARRAFA 300ML DELIVERY - PLATS SUPRA C/TAMP LR C100", 100]
  ])("%s tem embalagem de %i", (nome, esperado) => {
    expect(primeira(nome).quantidade).toBe(esperado);
  });

  test("dimensao, volume e medida nunca viram embalagem", () => {
    // Nenhum destes tem marcador de embalagem: a resposta certa e "nao sei".
    for (const nome of [
      "SALMAO",
      "CONTRA FILE",
      "COCA COLA ZERO 350ML",
      "QUEIJO PARMESAO TROPICAL",
      "PISTACHE CRU S/CASCA 1KG",
      "ETIQUETA 50X50 COUCHE REDONDA",
      "SACO AMOSTRA TARJA 12X30"
    ]) {
      expect(detectarEmbalagem(nome)).toHaveLength(0);
    }
  });

  test("C barra seguido de palavra nao e embalagem", () => {
    // "C/TAMP" = com tampa. Nao ha numero, entao nao ha leitura.
    const achados = detectarEmbalagem("PLATS SUPRA C/TAMP LR");
    expect(achados).toHaveLength(0);
  });

  test("peso na embalagem vem com a unidade junto", () => {
    const r = primeira("SACO CRISTAL 60X80CM 0,20 PT C/5KG");
    expect(r.quantidade).toBe(5);
    expect(r.unidade).toBe("KG");
  });

  test.each([
    ["ATUM PEDACOS PCT 500G", 500, "G"],
    ["GERGELIM BRANCO PCTE 500GR", 500, "G"],
    ["CALDO DE LEGUMES PCTE 1,01KG", 1.01, "KG"],
    ["ALHO FRITO PCT 1,01K GRANULADO", 1.01, "KG"],
    ["TOMATE SECO PT 700G", 700, "G"],
    ["MACARRAO LASANHA CAIXA 500G", 500, "G"],
    ["CHOC.PO 32% CACAU NESTLE CX 1,01 KG", 1.01, "KG"]
  ])("%s e peso, nao contagem", (nome, qtd, un) => {
    // Esta e a armadilha que a varredura nos 677 produtos revelou: "PCTE 500GR"
    // lido como "pacote com 500 unidades" e o mesmo erro do SACO AMOSTRA, so que
    // em 8 produtos de uma vez.
    const r = primeira(nome);
    expect(r.quantidade).toBe(qtd);
    expect(r.unidade).toBe(un);
  });

  test("o sufixo nao engole a palavra seguinte", () => {
    // "C/40 CX 16": o sufixo de 40 e vazio, nao "CX". Se engolisse, qualquer
    // palavra depois do numero poderia mudar a classificacao da leitura.
    const r = primeira("COPO SUPREMO 300ML C/40 CX 16");
    expect(r.trecho).toBe("C/40");
    expect(r.unidade).toBeNull();
  });

  test("dimensao colada no codigo nao vira sufixo", () => {
    const r = primeira("COPO ISOPOR 118ML C/20 CX. C50X20");
    expect(r.unidade).toBeNull();
    expect(r.trecho).not.toMatch(/X/);
  });

  test("virgula de milhar ambigua cai para confianca baixa", () => {
    // "1,800GR" pode ser 1,8 ou 1800. Nenhuma das duas da para afirmar.
    const r = primeira("PALMITO PICADO PT 1,800GR");
    expect(r.confianca).toBe("baixa");
  });

  test("numero que descreve o produto fica com confianca baixa", () => {
    // 1000 FOLHAS sao folhas por rolo, nao rolos por pacote.
    const r = primeira("PAP.INT BCO EXTRA LUXO 2DB C/1000 FOLHAS");
    expect(r.quantidade).toBe(1000);
    expect(r.confianca).toBe("baixa");
  });

  test("separa o pacote da caixa que agrupa pacotes", () => {
    const todos = detectarEmbalagem("POTE RETANGULAR 750ML C/24 CX 6");
    expect(todos.find((e) => e.nivel === "pacote")?.quantidade).toBe(24);
    expect(todos.find((e) => e.nivel === "caixa")?.quantidade).toBe(6);
  });

  test("nome vazio ou lixo nao quebra", () => {
    expect(detectarEmbalagem("")).toEqual([]);
    expect(detectarEmbalagem(null)).toEqual([]);
    expect(detectarEmbalagem("C/0")).toEqual([]);
    expect(detectarEmbalagem("C/1")).toEqual([]);
  });
});

describe("converterItemDeCompra", () => {
  const CAIXA_DE_800 = [{ fromUnit: "CX", toUnit: "UN", factor: 800 }];

  test("o caso de agosto: 1 CX de R$ 113,16 vira 800 UN de R$ 0,14145", () => {
    const r = converterItemDeCompra({
      quantity: 1,
      unitPrice: 113.16,
      unidadeDaCompra: "CX",
      unidadeDeEstoque: "UN",
      conversions: CAIXA_DE_800
    });
    expect(r.convertedQuantity).toBe(800);
    expect(r.convertedUnitPrice).toBeCloseTo(0.14145, 6);
    expect(r.conversionFactorUsed).toBe(800);
    expect(r.conversionMissing).toBe(false);
  });

  test("o total do item nunca muda - e a garantia que protege o CMV", () => {
    const casos = [
      { quantity: 1, unitPrice: 113.16, conv: CAIXA_DE_800 },
      { quantity: 3, unitPrice: 47.9, conv: CAIXA_DE_800 },
      { quantity: 2.5, unitPrice: 19.99, conv: [{ fromUnit: "CX", toUnit: "UN", factor: 24 }] },
      { quantity: 7, unitPrice: 0.07, conv: [{ fromUnit: "CX", toUnit: "UN", factor: 1000 }] }
    ];
    for (const caso of casos) {
      const r = converterItemDeCompra({
        quantity: caso.quantity,
        unitPrice: caso.unitPrice,
        unidadeDaCompra: "CX",
        unidadeDeEstoque: "UN",
        conversions: caso.conv
      });
      const totalOriginal = caso.quantity * caso.unitPrice;
      const totalConvertido = r.convertedQuantity! * r.convertedUnitPrice!;
      expect(totalConvertido).toBeCloseTo(totalOriginal, 8);
    }
  });

  test("unidade igual passa direto com fator 1", () => {
    const r = converterItemDeCompra({
      quantity: 10,
      unitPrice: 5,
      unidadeDaCompra: "KG",
      unidadeDeEstoque: "KG",
      conversions: []
    });
    expect(r.conversionFactorUsed).toBe(1);
    expect(r.convertedQuantity).toBe(10);
    expect(r.conversionMissing).toBe(false);
  });

  test("unidade diferente sem conversao marca missing e nao inventa numero", () => {
    const r = converterItemDeCompra({
      quantity: 1,
      unitPrice: 113.16,
      unidadeDaCompra: "CX",
      unidadeDeEstoque: "UN",
      conversions: []
    });
    expect(r.conversionMissing).toBe(true);
    expect(r.convertedQuantity).toBeNull();
    expect(r.convertedUnitPrice).toBeNull();
    expect(r.motivo).toMatch(/nao ha conversao/i);
  });

  test("cadastro incompleto nao vira alarme de conversao faltando", () => {
    // Produto sem unidade de estoque: nao ha para onde converter. Marcar
    // "missing" aqui encheria a fila de pendencias de coisa que nao e pendencia.
    const r = converterItemDeCompra({
      quantity: 1,
      unitPrice: 10,
      unidadeDaCompra: "CX",
      unidadeDeEstoque: null,
      conversions: CAIXA_DE_800
    });
    expect(r.conversionMissing).toBe(false);
    expect(r.convertedQuantity).toBeNull();
  });

  test("quantidade zero ou negativa nao converte", () => {
    for (const quantity of [0, -3]) {
      const r = converterItemDeCompra({
        quantity,
        unitPrice: 10,
        unidadeDaCompra: "CX",
        unidadeDeEstoque: "UN",
        conversions: CAIXA_DE_800
      });
      expect(r.convertedQuantity).toBeNull();
      expect(r.conversionMissing).toBe(false);
    }
  });

  test("KG para G usa a conversao universal sem cadastro", () => {
    const r = converterItemDeCompra({
      quantity: 2,
      unitPrice: 30,
      unidadeDaCompra: "KG",
      unidadeDeEstoque: "G",
      conversions: []
    });
    expect(r.conversionFactorUsed).toBe(1000);
    expect(r.convertedQuantity).toBe(2000);
    expect(r.convertedUnitPrice).toBeCloseTo(0.03, 8);
  });
});
