import { describe, expect, test } from "vitest";
import {
  controleDeEstoqueDoProdutoNovo,
  dadosDeCriacaoDoProduto,
  ehSetorAposentado,
  interpretarSetorDaPlanilha,
  shouldControlStock
} from "../catalog-product-rules.js";

describe("ehSetorAposentado", () => {
  test.each(["NÃO BATER EST", "nao bater est", "Não Bater Estoque", "  NAO BATER EST  "])("%s é o setor aposentado", (nome) => {
    expect(ehSetorAposentado(nome)).toBe(true);
  });

  test.each(["ESTOQUE", "CAMARA FRIA", "", null, undefined])("%s não é", (nome) => {
    expect(ehSetorAposentado(nome as string | null | undefined)).toBe(false);
  });
});

describe("shouldControlStock", () => {
  test("setor aposentado e custo fixo/variável não controlam estoque", () => {
    expect(shouldControlStock("NÃO BATER EST", null)).toBe(false);
    expect(shouldControlStock("ESTOQUE", "Custo Fixo")).toBe(false);
    expect(shouldControlStock("ESTOQUE", "custo variável")).toBe(false);
  });

  test("setor comum controla", () => {
    expect(shouldControlStock("ESTOQUE", null)).toBe(true);
  });
});

describe("interpretarSetorDaPlanilha", () => {
  test("setor aposentado: não vira setor, não controla estoque e não conta como setor faltando", () => {
    const r = interpretarSetorDaPlanilha("NÃO BATER EST", "NÃO BATER EST", null);
    expect(r).toMatchObject({
      sectorName: null,
      controlsStock: false,
      missingSector: false,
      countableInGeneral: false,
      countableInSectoral: false,
      countabilityReasons: ["SEM_CONTROLE_ESTOQUE"]
    });
  });

  test("setor comum segue como antes", () => {
    expect(interpretarSetorDaPlanilha("ESTOQUE", "ESTOQUE", null)).toMatchObject({
      sectorName: "ESTOQUE", controlsStock: true, missingSector: false, countableInSectoral: true, countabilityReasons: []
    });
  });

  test("sem setor continua pendência", () => {
    expect(interpretarSetorDaPlanilha(null, null, null)).toMatchObject({
      sectorName: null, controlsStock: true, missingSector: true, countableInSectoral: false, countabilityReasons: ["SEM_SETOR"]
    });
  });

  test("setor inválido (lixo de serialização) é apontado como inválido", () => {
    expect(interpretarSetorDaPlanilha("[object Object]", null, null).countabilityReasons).toEqual(["SETOR_INVALIDO"]);
  });
});

describe("controleDeEstoqueDoProdutoNovo", () => {
  test("a linha que diz que não controla vale mais que a natureza da categoria", () => {
    expect(controleDeEstoqueDoProdutoNovo(false, true)).toBe(false);
  });

  test("linha que controla segue o padrão da natureza; sem natureza, o que a linha diz", () => {
    expect(controleDeEstoqueDoProdutoNovo(true, true)).toBe(true);
    expect(controleDeEstoqueDoProdutoNovo(true, false)).toBe(false);
    expect(controleDeEstoqueDoProdutoNovo(true, null)).toBe(true);
    expect(controleDeEstoqueDoProdutoNovo(false, null)).toBe(false);
  });
});

describe("dadosDeCriacaoDoProduto", () => {
  const padrao = { nature: "INSUMO" as const, dreCategoryId: "dre-cmv", controlsStock: true };

  test("setor aposentado + roteado para categoria de insumo: nasce sem estoque, com a natureza e a DRE da categoria", () => {
    const dados = dadosDeCriacaoDoProduto({
      linha: { categoryId: "c-ins", subcategoryId: "s-x", controlsStock: false },
      estrutura: { categoryId: "c-lat", padrao }
    });
    expect(dados).toEqual({ categoryId: "c-lat", subcategoryId: undefined, nature: "INSUMO", dreCategoryId: "dre-cmv", controlsStock: false });
  });

  test("categoria legada sem rota: sem categoria, sem subcategoria, sem natureza", () => {
    const dados = dadosDeCriacaoDoProduto({
      linha: { categoryId: undefined, subcategoryId: undefined, controlsStock: true },
      estrutura: { categoryId: null, padrao: { nature: null, dreCategoryId: null, controlsStock: null } }
    });
    expect(dados).toEqual({ categoryId: undefined, subcategoryId: undefined, nature: null, dreCategoryId: null, controlsStock: true });
  });

  test("categoria da estrutura nova mantida: a subcategoria da planilha vale", () => {
    const dados = dadosDeCriacaoDoProduto({
      linha: { categoryId: "c-sec", subcategoryId: "s-arroz", controlsStock: true },
      estrutura: { categoryId: "c-sec", padrao }
    });
    expect(dados).toMatchObject({ categoryId: "c-sec", subcategoryId: "s-arroz", controlsStock: true });
  });

  test("categoria roteada para outra: a subcategoria da planilha é descartada", () => {
    const dados = dadosDeCriacaoDoProduto({
      linha: { categoryId: "c-ins", subcategoryId: "s-x", controlsStock: true },
      estrutura: { categoryId: "c-lat", padrao }
    });
    expect(dados.subcategoryId).toBeUndefined();
  });
});

describe("interpretarSetorDaPlanilha: desvincular", () => {
  test("marca setor aposentado para o import desvincular o produto", () => {
    expect(interpretarSetorDaPlanilha("NÃO BATER EST", "NÃO BATER EST", null).setorAposentado).toBe(true);
    expect(interpretarSetorDaPlanilha("ESTOQUE", "ESTOQUE", null).setorAposentado).toBe(false);
  });
});
