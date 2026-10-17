import { describe, expect, test } from "vitest";
import { productListOrderBy, productListWhere } from "../product-list-filter.js";

describe("productListWhere: pendência múltipla", () => {
  test("uma pendência", () => {
    expect(productListWhere({ pendencia: "sem-subcategoria" })).toMatchObject({ subcategoryId: null });
  });

  test("várias pendências separadas por vírgula valem juntas (e)", () => {
    expect(productListWhere({ pendencia: "sem-subcategoria,sem-setor" })).toMatchObject({ subcategoryId: null, inventorySectorId: null });
  });

  test("valor desconhecido ou herdado do protótipo é ignorado, sem virar filtro", () => {
    expect(productListWhere({ pendencia: "constructor,sem-dre,xpto" })).toEqual({ dreCategoryId: null });
    expect(productListWhere({ pendencia: "constructor" })).toEqual({});
  });
});

describe("productListWhere: omitir um critério (para contar as opções dele)", () => {
  const consulta = { category: "SECOS", nature: "INSUMO", sector: "ESTOQUE", pendencia: "sem-setor", isActive: "true" };

  test("sem omitir, todos valem", () => {
    expect(productListWhere(consulta)).toMatchObject({ category: { name: "SECOS" }, nature: "INSUMO", inventorySector: { name: "ESTOQUE" }, inventorySectorId: null, isActive: true });
  });

  test("omitindo a categoria, ela some e o resto fica", () => {
    const where = productListWhere(consulta, { omitir: ["category"] });
    expect(where).not.toHaveProperty("category");
    expect(where).toMatchObject({ nature: "INSUMO", isActive: true });
  });

  test("omitir a pendência tira só as pendências", () => {
    const where = productListWhere(consulta, { omitir: ["pendencia"] });
    expect(where).not.toHaveProperty("inventorySectorId");
    expect(where).toMatchObject({ category: { name: "SECOS" } });
  });

  test("categoria omitida leva a subcategoria junto (ela depende da categoria)", () => {
    const where = productListWhere({ category: "SECOS", subcategory: "ARROZ" }, { omitir: ["category"] });
    expect(where).not.toHaveProperty("subcategory");
  });
});

describe("productListOrderBy", () => {
  test("padrão: nome crescente", () => {
    expect(productListOrderBy({})).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  test("por nome, na direção pedida", () => {
    expect(productListOrderBy({ sort: "name", dir: "desc" })).toEqual([{ name: "desc" }, { id: "asc" }]);
  });

  test.each([
    ["nature", { nature: "desc" }],
    ["category", { category: { name: "desc" } }],
    ["sector", { inventorySector: { name: "desc" } }],
    ["stock", { controlsStock: "desc" }],
    ["dre", { dreCategory: { name: "desc" } }]
  ])("ordena por %s, com o nome como desempate", (campo, esperado) => {
    const ordem = productListOrderBy({ sort: campo, dir: "desc" });
    expect(ordem[0]).toEqual(esperado);
    expect(ordem.slice(-2)).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  test("campo desconhecido ou direção inválida caem no padrão", () => {
    expect(productListOrderBy({ sort: "senha", dir: "desc" })).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(productListOrderBy({ sort: "category", dir: "sideways" })).toEqual([{ category: { name: "asc" } }, { name: "asc" }, { id: "asc" }]);
  });
});
