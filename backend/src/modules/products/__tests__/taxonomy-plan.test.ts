import { describe, expect, it } from "vitest";
import { planTaxonomy, type CategoryState, type DecisionRow, type ProductState, type SubcategoryState } from "../taxonomy-plan.js";

// Dados inventados: o repositório é público.
const dres = [
  { id: "dre-cmv", name: "Custo de Alimentos" },
  { id: "dre-esc", name: "Material de Escritório" },
  { id: "dre-beb", name: "Bebidas" }
];

const categoria = (extra: Partial<CategoryState> & { id: string; name: string }): CategoryState => ({
  nature: null,
  defaultDreCategoryId: null,
  isActive: true,
  ...extra
});

const produto = (extra: Partial<ProductState> & { id: string; externalCode: string }): ProductState => ({
  categoryId: null,
  subcategoryId: null,
  nature: null,
  ...extra
});

const base = () => ({
  categories: [categoria({ id: "c-ins", name: "INSUMOS" }), categoria({ id: "c-desp", name: "DESPESAS" }), categoria({ id: "c-beb", name: "BEBIDAS" })],
  subcategories: [
    { id: "s-zero", name: "0", categoryId: "c-ins" },
    { id: "s-agua", name: "AGUA", categoryId: "c-ins" },
    { id: "s-vazia", name: "LEGITIMA VAZIA", categoryId: "c-beb" },
    { id: "s-zero-vazia", name: "0", categoryId: "c-desp" }
  ] as SubcategoryState[],
  dreCategories: dres
});

const decisao = (codigo: string, nature: DecisionRow["nature"], category: string | null): DecisionRow => ({ codigo, nature, category });

describe("planTaxonomy", () => {
  it("cria a categoria nova com natureza e DRE usual, e move o produto", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToCreate).toEqual([{ name: "SECOS E GRAOS", nature: "INSUMO", defaultDreCategoryId: "dre-cmv" }]);
    expect(plano.productChanges).toHaveLength(1);
    expect(plano.productChanges[0].category).toEqual({ newName: "SECOS E GRAOS" });
    expect(plano.productChanges[0].nature).toBe("INSUMO");
  });

  it("desativa a categoria antiga quando ela fica sem produtos", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToDeactivate).toEqual([{ id: "c-ins", name: "INSUMOS" }]);
  });

  it("não desativa categoria que ainda tem produto", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [
        produto({ id: "p1", externalCode: "1", categoryId: "c-ins" }),
        produto({ id: "p2", externalCode: "2", categoryId: "c-ins" })
      ],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToDeactivate).toEqual([]);
  });

  it("subcategoria numérica é desfeita e some; produto fica sem subcategoria", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins", subcategoryId: "s-zero" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.productChanges[0].subcategory).toBeNull();
    expect(plano.subcategoriesToDelete.map((sub) => sub.id)).toContain("s-zero");
    expect(plano.subcategoriesToCreate).toEqual([]);
  });

  it("subcategoria de verdade é recriada sob a categoria nova, uma vez só", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [
        produto({ id: "p1", externalCode: "1", categoryId: "c-ins", subcategoryId: "s-agua" }),
        produto({ id: "p2", externalCode: "2", categoryId: "c-ins", subcategoryId: "s-agua" })
      ],
      decisions: [decisao("1", "INSUMO", "LIQUIDOS DE COZINHA"), decisao("2", "INSUMO", "LIQUIDOS DE COZINHA")]
    });
    expect(plano.subcategoriesToCreate).toEqual([{ name: "AGUA", category: { newName: "LIQUIDOS DE COZINHA" } }]);
    expect(plano.productChanges.every((mudanca) => mudanca.subcategory && "newName" in mudanca.subcategory)).toBe(true);
    expect(plano.subcategoriesToDelete.map((sub) => sub.id)).toContain("s-agua");
  });

  it("reaproveita subcategoria de mesmo nome que já existe na categoria de destino", () => {
    const estado = base();
    estado.subcategories.push({ id: "s-agua-beb", name: "AGUA", categoryId: "c-beb" });
    const plano = planTaxonomy({
      ...estado,
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins", subcategoryId: "s-agua" })],
      decisions: [decisao("1", "INSUMO", "BEBIDAS")]
    });
    expect(plano.subcategoriesToCreate).toEqual([]);
    expect(plano.productChanges[0].subcategory).toEqual({ id: "s-agua-beb" });
  });

  it("mantém subcategoria quando a categoria não muda", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-beb", subcategoryId: "s-vazia", nature: null })],
      decisions: [decisao("1", "INSUMO", "BEBIDAS")]
    });
    expect(plano.productChanges).toHaveLength(1);
    expect(plano.productChanges[0].subcategory).toEqual({ id: "s-vazia" });
    expect(plano.subcategoriesToDelete.map((sub) => sub.id)).not.toContain("s-vazia");
  });

  it("subcategoria numérica vazia desde sempre também é removida; vazia com nome de verdade fica", () => {
    const plano = planTaxonomy({ ...base(), products: [], decisions: [] });
    const apagadas = plano.subcategoriesToDelete.map((sub) => sub.id);
    expect(apagadas).toContain("s-zero");
    expect(apagadas).toContain("s-zero-vazia");
    expect(apagadas).not.toContain("s-vazia");
  });

  it("completa natureza e DRE usual de categoria existente sem sobrescrever o que já está definido", () => {
    const estado = base();
    estado.categories = [
      categoria({ id: "c-beb", name: "BEBIDAS", nature: null, defaultDreCategoryId: null }),
      categoria({ id: "c-esc", name: "MATERIAL DE ESCRITORIO", nature: "CONSUMO", defaultDreCategoryId: "dre-cmv" })
    ];
    const plano = planTaxonomy({
      ...estado,
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-beb" }), produto({ id: "p2", externalCode: "2", categoryId: "c-esc" })],
      decisions: [decisao("1", "INSUMO", "BEBIDAS"), decisao("2", "CONSUMO", "MATERIAL DE ESCRITORIO")]
    });
    expect(plano.categoriesToUpdate).toEqual([{ id: "c-beb", name: "BEBIDAS", nature: "INSUMO", defaultDreCategoryId: "dre-beb" }]);
  });

  it("só natureza: produto sem categoria decidida mantém a categoria e ganha a natureza", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", null)]
    });
    expect(plano.productChanges).toHaveLength(1);
    expect(plano.productChanges[0].category).toEqual({ id: "c-ins" });
    expect(plano.productChanges[0].nature).toBe("INSUMO");
    expect(plano.categoriesToDeactivate).toEqual([]);
  });

  it("é idempotente: aplicar de novo o mesmo plano não propõe nada", () => {
    const estado = base();
    estado.categories.push(categoria({ id: "c-secos", name: "SECOS E GRAOS", nature: "INSUMO", defaultDreCategoryId: "dre-cmv" }));
    const plano = planTaxonomy({
      ...estado,
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-secos", nature: "INSUMO" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.productChanges).toEqual([]);
    expect(plano.categoriesToCreate).toEqual([]);
    expect(plano.categoriesToUpdate).toEqual([]);
    expect(plano.categoriesToDeactivate).toEqual([]);
  });

  it("categoria fora da estrutura proposta gera aviso e não mexe no produto", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "CATEGORIA INVENTADA")]
    });
    expect(plano.warnings.some((aviso) => aviso.includes("CATEGORIA INVENTADA"))).toBe(true);
    expect(plano.productChanges.every((mudanca) => mudanca.category && "id" in mudanca.category && mudanca.category.id === "c-ins")).toBe(true);
  });

  it("reativa a categoria de destino que estava desativada", () => {
    const estado = base();
    estado.categories.push(categoria({ id: "c-secos", name: "SECOS E GRAOS", nature: "INSUMO", defaultDreCategoryId: "dre-cmv", isActive: false }));
    const plano = planTaxonomy({
      ...estado,
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToUpdate).toEqual([{ id: "c-secos", name: "SECOS E GRAOS", isActive: true }]);
  });

  it("nome de categoria com caixa diferente conta uma vez só", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" }), produto({ id: "p2", externalCode: "2", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "Secos e Graos"), decisao("2", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToCreate).toHaveLength(1);
  });

  it("avisa de decisão sem produto e de código repetido com decisões diferentes; decisão órfã não cria categoria", () => {
    const plano = planTaxonomy({
      ...base(),
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS"), decisao("1", "INSUMO", "CONGELADOS"), decisao("999", "SERVICO", "MANUTENCAO")]
    });
    expect(plano.warnings.some((aviso) => aviso.includes("mais de uma vez"))).toBe(true);
    expect(plano.warnings.some((aviso) => aviso.includes("sem produto correspondente"))).toBe(true);
    expect(plano.categoriesToCreate.map((c) => c.name)).toEqual(["CONGELADOS"]);
  });

  it("produto sem decisão não é tocado", () => {
    const plano = planTaxonomy({ ...base(), products: [produto({ id: "p1", externalCode: "9", categoryId: "c-ins" })], decisions: [] });
    expect(plano.productChanges).toEqual([]);
  });

  it("não inventa DRE: aviso quando a DRE da categoria nova não existe", () => {
    const plano = planTaxonomy({
      ...base(),
      dreCategories: [],
      products: [produto({ id: "p1", externalCode: "1", categoryId: "c-ins" })],
      decisions: [decisao("1", "INSUMO", "SECOS E GRAOS")]
    });
    expect(plano.categoriesToCreate[0].defaultDreCategoryId).toBeNull();
    expect(plano.warnings.some((aviso) => aviso.includes("Custo de Alimentos"))).toBe(true);
  });
});
