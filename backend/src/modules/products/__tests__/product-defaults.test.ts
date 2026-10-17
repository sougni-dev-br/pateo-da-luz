import { describe, expect, test } from "vitest";
import { NATURE_DEFAULTS } from "../product-nature.js";
import {
  categoriaDaEstruturaParaItemNovo,
  ehCategoriaLegada,
  ehNomeDeCategoriaLegada,
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

  test("sinal de embalagem no nome impede o roteamento automático", () => {
    expect(categoriaDaEstruturaParaItemNovo("Sacola de papel para pao", "INSUMOS")).toBeNull();
    expect(categoriaDaEstruturaParaItemNovo("Embalagem para molho", "INSUMOS")).toBeNull();
    expect(categoriaDaEstruturaParaItemNovo("Caixa para frango", "INSUMOS")).toBeNull();
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
        findUnique: async ({ where }: { where: { id: string } }) => categorias.find((c) => c.id === where.id) ?? null,
        findFirst: async ({ where }: { where: { name: { equals: string }; isActive?: boolean } }) =>
          categorias.find(
            (c) =>
              String(c.name).toLowerCase() === where.name.equals.toLowerCase() && (where.isActive === undefined || c.isActive !== false)
          ) ?? null
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

  test("categoria antiga sem regra clara não recebe o produto: fica sem categoria e sem natureza", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, laticinios]), { descricao: "Coisa estranha", categoryId: "c-ins" });
    expect(r).toMatchObject({ categoryId: null, reclassificada: false, padrao: { nature: null, controlsStock: null } });
  });

  test("categoria de destino ausente no banco não quebra: o produto fica sem categoria (a antiga é legada)", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos]), { descricao: "Queijo", categoryId: "c-ins" });
    expect(r.categoryId).toBeNull();
    expect(r.reclassificada).toBe(false);
  });

  test("destino com outra grafia no banco ainda é achado", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, { ...laticinios, name: "Laticinios e Frios" }]), { descricao: "Queijo", categoryId: "c-ins" });
    expect(r.categoryId).toBe("c-lat");
  });

  test("destino desativado não recebe produto novo", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, { ...laticinios, isActive: false }]), { descricao: "Queijo", categoryId: "c-ins" });
    expect(r.categoryId).toBeNull();
  });

  test("destino sem natureza cai no fallback", async () => {
    const r = await estruturaDeProdutoNovo(banco([insumos, { ...laticinios, nature: null }]), { descricao: "Queijo", categoryId: "c-ins" });
    expect(r).toMatchObject({ categoryId: null, reclassificada: false });
  });

  test("categoria já carregada pelo chamador evita nova consulta", async () => {
    const r = await estruturaDeProdutoNovo(banco([laticinios]), { descricao: "Queijo", categoryId: "c-ins", categoria: insumos as never });
    expect(r.categoryId).toBe("c-lat");
  });

  test("sem categoria na planilha, nada a decidir", async () => {
    const r = await estruturaDeProdutoNovo(banco([]), { descricao: "Queijo", categoryId: undefined });
    expect(r).toMatchObject({ categoryId: undefined, reclassificada: false, padrao: { nature: null } });
  });
});

describe("ehCategoriaLegada", () => {
  test("categoria inativa é legada", () => {
    expect(ehCategoriaLegada({ name: "QUALQUER", nature: "INSUMO", isActive: false })).toBe(true);
  });

  test("INSUMOS e DESPESAS sem natureza são legadas, mesmo ativas", () => {
    expect(ehCategoriaLegada({ name: "INSUMOS", nature: null, isActive: true })).toBe(true);
    expect(ehCategoriaLegada({ name: "Despesas", nature: null })).toBe(true);
  });

  test("categoria da estrutura nova, ou com natureza, não é", () => {
    expect(ehCategoriaLegada({ name: "SECOS E GRAOS", nature: "INSUMO", isActive: true })).toBe(false);
    expect(ehCategoriaLegada({ name: "INSUMOS", nature: "INSUMO", isActive: true })).toBe(false);
    expect(ehCategoriaLegada(null)).toBe(false);
  });
});

describe("estruturaDeProdutoNovo: categoria legada da planilha", () => {
  const legadaInativa = { id: "c-ins", name: "INSUMOS", nature: null, defaultDreCategoryId: null, isActive: false };
  const bancoCom = (categorias: Array<Record<string, unknown>>) =>
    ({
      category: {
        findUnique: async ({ where }: { where: { id: string } }) => categorias.find((c) => c.id === where.id) ?? null,
        findFirst: async ({ where }: { where: { name: { equals: string } } }) =>
          categorias.find((c) => String(c.name).toLowerCase() === where.name.equals.toLowerCase() && c.isActive !== false) ?? null
      }
    }) as never;

  test("legada inativa com nome claro vai para a categoria da estrutura nova", async () => {
    const laticinios = { id: "c-lat", name: "LATICINIOS E FRIOS", nature: "INSUMO", defaultDreCategoryId: "dre-cmv", isActive: true };
    const r = await estruturaDeProdutoNovo(bancoCom([legadaInativa, laticinios]), { descricao: "Queijo mussarela", categoryId: "c-ins", categoria: legadaInativa as never });
    expect(r).toMatchObject({ categoryId: "c-lat", reclassificada: true });
  });

  test("legada sem regra clara não recebe o produto: fica sem categoria, para classificar à mão", async () => {
    const r = await estruturaDeProdutoNovo(bancoCom([legadaInativa]), { descricao: "Coisa estranha", categoryId: "c-ins", categoria: legadaInativa as never });
    expect(r).toMatchObject({ categoryId: null, reclassificada: false, padrao: { nature: null, controlsStock: null } });
  });

  test("INSUMOS ativa sem natureza também é tratada como legada", async () => {
    const legadaAtiva = { ...legadaInativa, isActive: true };
    const r = await estruturaDeProdutoNovo(bancoCom([legadaAtiva]), { descricao: "Coisa estranha", categoryId: "c-ins", categoria: legadaAtiva as never });
    expect(r.categoryId).toBeNull();
  });
});

describe("ehNomeDeCategoriaLegada", () => {
  test("INSUMOS e DESPESAS, em qualquer caixa, são vocabulário antigo", () => {
    expect(ehNomeDeCategoriaLegada("INSUMOS")).toBe(true);
    expect(ehNomeDeCategoriaLegada(" despesas ")).toBe(true);
    expect(ehNomeDeCategoriaLegada("SECOS E GRAOS")).toBe(false);
    expect(ehNomeDeCategoriaLegada(null)).toBe(false);
  });
});
