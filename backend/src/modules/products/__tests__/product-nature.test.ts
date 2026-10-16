import { describe, expect, it } from "vitest";
import {
  NATURE_DEFAULTS,
  PRODUCT_NATURES,
  avisosDaNatureza,
  camposObrigatoriosFaltando,
  rankSimilarNames
} from "../product-nature.js";

const completo = {
  name: "Farinha de trigo",
  unitMeasureId: "un1",
  categoryId: "cat1",
  dreCategoryId: "dre1",
  inventorySectorId: "set1",
  controlsStock: true
};

describe("NATURE_DEFAULTS", () => {
  it("define padrao para cada natureza", () => {
    for (const nature of PRODUCT_NATURES) {
      expect(NATURE_DEFAULTS[nature].label).toBeTruthy();
      expect(NATURE_DEFAULTS[nature].dreGroups.length).toBeGreaterThan(0);
    }
  });

  it("insumo e embalagem entram no CMV e controlam estoque", () => {
    expect(NATURE_DEFAULTS.INSUMO.dreGroups).toEqual(["CMV_COMPRAS"]);
    expect(NATURE_DEFAULTS.INSUMO.controlsStock).toBe(true);
    expect(NATURE_DEFAULTS.EMBALAGEM.dreGroups).toEqual(["CMV_COMPRAS"]);
  });

  it("duravel e servico nao controlam estoque", () => {
    expect(NATURE_DEFAULTS.DURAVEL.controlsStock).toBe(false);
    expect(NATURE_DEFAULTS.SERVICO.controlsStock).toBe(false);
  });
});

describe("camposObrigatoriosFaltando", () => {
  it("nao exige nada quando a natureza nao foi enviada (cliente antigo)", () => {
    expect(camposObrigatoriosFaltando({ name: "X" })).toEqual([]);
  });

  it("aceita cadastro completo de insumo", () => {
    expect(camposObrigatoriosFaltando({ ...completo, nature: "INSUMO" })).toEqual([]);
  });

  it("lista o que falta num insumo", () => {
    const faltando = camposObrigatoriosFaltando({ name: "X", nature: "INSUMO", controlsStock: true });
    expect(faltando).toEqual(["unidade", "categoria", "categoria DRE", "setor"]);
  });

  it("nao exige setor quando nao controla estoque", () => {
    const faltando = camposObrigatoriosFaltando({
      ...completo,
      nature: "DURAVEL",
      inventorySectorId: "",
      controlsStock: false
    });
    expect(faltando).toEqual([]);
  });

  it("aceita nome de categoria nova no lugar do id", () => {
    const faltando = camposObrigatoriosFaltando({
      ...completo,
      categoryId: "",
      categoryName: "Congelados",
      nature: "INSUMO"
    });
    expect(faltando).toEqual([]);
  });

  it("servico exige so nome e categoria DRE", () => {
    const faltando = camposObrigatoriosFaltando({ name: "Dedetizacao", nature: "SERVICO", dreCategoryId: "dre9" });
    expect(faltando).toEqual([]);
  });
});

describe("avisosDaNatureza", () => {
  it("avisa insumo fora do CMV", () => {
    const avisos = avisosDaNatureza({ nature: "INSUMO", dreGroup: "DESPESAS_GERAIS", controlsStock: true });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("CMV");
  });

  it("avisa duravel dentro do CMV", () => {
    expect(avisosDaNatureza({ nature: "DURAVEL", dreGroup: "CMV_COMPRAS", controlsStock: false })).toHaveLength(1);
  });

  it("avisa insumo fora do estoque", () => {
    const avisos = avisosDaNatureza({ nature: "INSUMO", dreGroup: "CMV_COMPRAS", controlsStock: false });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("estoque");
  });

  it("nao avisa quando a combinacao e a esperada", () => {
    expect(avisosDaNatureza({ nature: "INSUMO", dreGroup: "CMV_COMPRAS", controlsStock: true })).toEqual([]);
  });

  it("nao avisa sem natureza", () => {
    expect(avisosDaNatureza({ nature: null, dreGroup: "CMV_COMPRAS", controlsStock: true })).toEqual([]);
  });

  it("consumo aceita estoque ligado ou desligado", () => {
    expect(avisosDaNatureza({ nature: "CONSUMO", dreGroup: "DESPESAS_GERAIS", controlsStock: true })).toEqual([]);
    expect(avisosDaNatureza({ nature: "CONSUMO", dreGroup: "DESPESAS_GERAIS", controlsStock: false })).toEqual([]);
  });
});

describe("rankSimilarNames", () => {
  const candidatos = [
    { id: "a", name: "Farinha de trigo tipo 1", normalizedName: "farinha de trigo tipo 1" },
    { id: "b", name: "Farinha de rosca", normalizedName: "farinha de rosca" },
    { id: "c", name: "Detergente", normalizedName: "detergente" }
  ];

  it("ordena por palavras em comum e descarta quem nao compartilha nenhuma", () => {
    const resultado = rankSimilarNames("farinha de trigo", candidatos);
    expect(resultado.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("ignora palavras curtas e liga" , () => {
    const resultado = rankSimilarNames("de", candidatos);
    expect(resultado).toEqual([]);
  });

  it("limita a quantidade devolvida", () => {
    expect(rankSimilarNames("farinha", candidatos, 1)).toHaveLength(1);
  });
});
