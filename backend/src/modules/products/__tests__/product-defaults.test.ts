import { describe, expect, test } from "vitest";
import { NATURE_DEFAULTS } from "../product-nature.js";
import {
  categoriaDaEstruturaParaItemNovo,
  estruturaDeProdutoNovo,
  padraoDeProdutoNovo,
  planilhaPodeReclassificar
} from "../product-defaults.js";

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

describe("categoriaDaEstruturaParaItemNovo", () => {
  test("item de insumo na categoria antiga vai para a categoria da estrutura quando o nome é claro", () => {
    expect(categoriaDaEstruturaParaItemNovo("Queijo mussarela fatiado", "INSUMOS")).toBe("LATICINIOS E FRIOS");
  });

  test("nome que não casa com regra fica onde a planilha disse", () => {
    expect(categoriaDaEstruturaParaItemNovo("Produto misterioso", "INSUMOS")).toBeNull();
  });

  test("regra de média confiança não decide sozinha", () => {
    expect(categoriaDaEstruturaParaItemNovo("Agua sanitaria 5L", "INSUMOS")).toBeNull();
  });

  test("despesa sem DRE conhecida não é roteada", () => {
    expect(categoriaDaEstruturaParaItemNovo("Conta de energia", "DESPESAS")).toBeNull();
  });
});

describe("estruturaDeProdutoNovo", () => {
  const laticinios = { id: "c-lat", name: "LATICINIOS E FRIOS", nature: "INSUMO", defaultDreCategoryId: "dre-cmv" };
  const insumos = { id: "c-ins", name: "INSUMOS", nature: null, defaultDreCategoryId: null };
  const banco = (categorias: Array<Record<string, unknown>>) =>
    ({
      category: {
        findUnique: async ({ where }: { where: { id?: string; name?: string } }) =>
          categorias.find((c) => (where.id ? c.id === where.id : c.name === where.name)) ?? null
      }
    }) as never;

  test("categoria antiga com nome claro é trocada pela da estrutura e herda o padrão dela", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, laticinios]), { descricao: "Queijo mussarela", categoryId: "c-ins" });
    expect(r).toMatchObject({ categoryId: "c-lat", reclassificada: true, padrao: { nature: "INSUMO", dreCategoryId: "dre-cmv", controlsStock: true } });
  });

  test("categoria da planilha que já tem natureza fica como está", async () => {
    const r = await estruturaDeProdutoNovo(banco([laticinios]), { descricao: "Queijo", categoryId: "c-lat" });
    expect(r).toMatchObject({ categoryId: "c-lat", reclassificada: false, padrao: { nature: "INSUMO" } });
  });

  test("categoria antiga sem regra clara fica na antiga, sem natureza", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, laticinios]), { descricao: "Coisa estranha", categoryId: "c-ins" });
    expect(r).toMatchObject({ categoryId: "c-ins", reclassificada: false, padrao: { nature: null, controlsStock: null } });
  });

  test("categoria de destino ausente no banco não quebra: fica na da planilha", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos]), { descricao: "Queijo", categoryId: "c-ins" });
    expect(r.categoryId).toBe("c-ins");
    expect(r.reclassificada).toBe(false);
  });

  test("sem categoria na planilha, nada a decidir", async () => {
    const r = await estruturaDeProdutoNovo(banco([]), { descricao: "Queijo", categoryId: undefined });
    expect(r).toMatchObject({ categoryId: undefined, reclassificada: false, padrao: { nature: null } });
  });
});
