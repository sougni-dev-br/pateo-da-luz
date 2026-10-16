import { describe, expect, test } from "vitest";
import { NATURE_DEFAULTS } from "../product-nature.js";
import { padraoDeProdutoNovo, planilhaPodeReclassificar } from "../product-defaults.js";

describe("padraoDeProdutoNovo", () => {
  test("herda natureza, DRE usual e estoque da categoria", () => {
    const padrao = padraoDeProdutoNovo({ nature: "INSUMO", defaultDreCategoryId: "dre-cmv" });
    expect(padrao).toEqual({ nature: "INSUMO", dreCategoryId: "dre-cmv", controlsStock: NATURE_DEFAULTS.INSUMO.controlsStock });
  });

  test("durável nasce sem controle de estoque", () => {
    expect(padraoDeProdutoNovo({ nature: "DURAVEL", defaultDreCategoryId: null }).controlsStock).toBe(false);
  });

  test("categoria sem DRE usual deixa a DRE vazia", () => {
    expect(padraoDeProdutoNovo({ nature: "SERVICO", defaultDreCategoryId: null }).dreCategoryId).toBeNull();
  });

  test("categoria sem natureza não decide nada", () => {
    expect(padraoDeProdutoNovo({ nature: null, defaultDreCategoryId: "x" })).toEqual({
      nature: null,
      dreCategoryId: null,
      controlsStock: null
    });
  });

  test("sem categoria não decide nada", () => {
    expect(padraoDeProdutoNovo(null).nature).toBeNull();
  });
});

describe("planilhaPodeReclassificar", () => {
  test("produto novo ou sem natureza segue a planilha", () => {
    expect(planilhaPodeReclassificar(null)).toBe(true);
    expect(planilhaPodeReclassificar({ nature: null })).toBe(true);
  });

  test("produto já organizado não é reclassificado pela planilha", () => {
    expect(planilhaPodeReclassificar({ nature: "INSUMO" })).toBe(false);
  });
});
