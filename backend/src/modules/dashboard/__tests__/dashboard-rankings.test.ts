import { describe, expect, test } from "vitest";
import { categoriaDoItem, montarRankings, type CompraParaRanking, type ItemDeCompra } from "../dashboard-rankings.js";

// Valores e nomes fictícios.
const item = (over: Partial<ItemDeCompra>): ItemDeCompra => ({
  totalPrice: 100,
  productName: "Produto",
  categoryName: "Categoria",
  rawCategory: null,
  nature: "INSUMO",
  ...over,
});

const compra = (supplierName: string, items: ItemDeCompra[], totalAmount?: number): CompraParaRanking => ({
  supplierName,
  items,
  totalAmount: totalAmount ?? items.reduce((s, i) => s + i.totalPrice, 0),
});

describe("categoriaDoItem", () => {
  test("a categoria do cadastro vence a escrita na nota", () => {
    // A nota antiga dizia "INSUMOS"; o cadastro reorganizado diz "LATICINIOS".
    expect(categoriaDoItem({ categoryName: "LATICINIOS", rawCategory: "INSUMOS" })).toBe("LATICINIOS");
  });

  test("a da nota só vale quando o produto não tem categoria", () => {
    expect(categoriaDoItem({ categoryName: null, rawCategory: "INSUMOS" })).toBe("INSUMOS");
    expect(categoriaDoItem({ categoryName: null, rawCategory: null })).toBe("Sem categoria");
  });
});

describe("montarRankings", () => {
  const compras = [
    compra("Açougue A", [
      item({ productName: "Alcatra", categoryName: "CARNES", totalPrice: 500 }),
      item({ productName: "Saco de lixo", categoryName: "LIMPEZA", nature: "CONSUMO", totalPrice: 40 }),
    ]),
    compra("Prestador B", [item({ productName: "Manutenção", categoryName: "MANUTENCAO", nature: "SERVICO", totalPrice: 300 })]),
    compra("Hortifruti C", [item({ productName: "Tomate", categoryName: "FLV", totalPrice: 200, rawCategory: "INSUMOS" })]),
  ];

  test("serviço não aparece entre os produtos da natureza Insumo", () => {
    const r = montarRankings(compras);
    expect(r.views.INSUMO!.product.rows.map((l) => l.name)).toEqual(["Alcatra", "Tomate"]);
    expect(r.views.SERVICO!.product.rows.map((l) => l.name)).toEqual(["Manutenção"]);
  });

  test("a visão de todas continua mostrando tudo", () => {
    const r = montarRankings(compras);
    expect(r.views.TODAS!.product.rows.map((l) => l.name)).toContain("Manutenção");
    expect(r.views.TODAS!.product.total).toBe(1040);
  });

  test("totais por natureza saem na ordem fixa e somam os itens", () => {
    const r = montarRankings(compras);
    expect(r.byNature).toEqual([
      { nature: "INSUMO", total: 700, items: 2 },
      { nature: "CONSUMO", total: 40, items: 1 },
      { nature: "SERVICO", total: 300, items: 1 },
    ]);
  });

  test("dentro de uma natureza, o fornecedor soma só os itens dela", () => {
    const r = montarRankings(compras);
    expect(r.views.CONSUMO!.supplier.rows).toEqual([{ name: "Açougue A", total: 40 }]);
    // Na visão de todas, soma a nota inteira.
    expect(r.views.TODAS!.supplier.rows.find((l) => l.name === "Açougue A")!.total).toBe(540);
  });

  test("item sem natureza vai para SEM_NATUREZA", () => {
    const r = montarRankings([compra("D", [item({ nature: null, productName: "Genérico" })])]);
    expect(r.byNature[0].nature).toBe("SEM_NATUREZA");
    expect(r.views.SEM_NATUREZA!.product.rows[0].name).toBe("Genérico");
  });

  test("produto sem natureza herda a da categoria", () => {
    const r = montarRankings([compra("H", [item({ nature: null, categoryNature: "CONSUMO", productName: "Detergente" })])]);
    expect(r.byNature.map((n) => n.nature)).toEqual(["CONSUMO"]);
  });

  test("categoria traz as subcategorias dela, com a falta separada", () => {
    const r = montarRankings([
      compra("I", [
        item({ categoryName: "CARNES", subcategoryName: "Bovinos", totalPrice: 300 }),
        item({ categoryName: "CARNES", subcategoryName: "Aves", totalPrice: 100 }),
        item({ categoryName: "CARNES", subcategoryName: "Bovinos", totalPrice: 50 }),
        item({ categoryName: "CARNES", subcategoryName: null, totalPrice: 20 }),
      ]),
    ]);
    const carnes = r.views.INSUMO!.category.rows[0];
    expect(carnes.total).toBe(470);
    expect(carnes.children).toEqual([
      { name: "Bovinos", total: 350 },
      { name: "Aves", total: 100 },
      { name: "Sem subcategoria", total: 20 },
    ]);
    // A soma das subcategorias fecha com a categoria.
    expect(carnes.children!.reduce((s, c) => s + c.total, 0)).toBe(carnes.total);
  });

  test("aba de subcategorias ranqueia todas, com a categoria de cada uma", () => {
    const r = montarRankings([
      compra("K", [
        item({ categoryName: "FLV", subcategoryName: "Legumes", totalPrice: 300 }),
        item({ categoryName: "CARNES", subcategoryName: "Bovinos", totalPrice: 500 }),
        item({ categoryName: "FLV", subcategoryName: null, totalPrice: 40 }),
        item({ categoryName: "CARNES", subcategoryName: null, totalPrice: 60 }),
      ]),
    ]);
    expect(r.views.INSUMO!.subcategory.rows).toEqual([
      { name: "Bovinos", group: "CARNES", total: 500 },
      { name: "Legumes", group: "FLV", total: 300 },
      { name: "Sem subcategoria", group: "CARNES", total: 60 },
      { name: "Sem subcategoria", group: "FLV", total: 40 },
    ]);
    expect(r.views.INSUMO!.subcategory.total).toBe(900);
  });

  test("fornecedor e produto não ganham subníveis", () => {
    const r = montarRankings([compra("J", [item({ subcategoryName: "X" })])]);
    expect(r.views.TODAS!.product.rows[0].children).toBeUndefined();
    expect(r.views.TODAS!.supplier.rows[0].children).toBeUndefined();
  });

  test("nota sem itemização vira linha na categoria só da visão de todas", () => {
    const r = montarRankings([compra("E", [item({ totalPrice: 100 })], 350)]);
    expect(r.unitemizedTotal).toBe(250);
    expect(r.views.TODAS!.category.rows).toContainEqual({ name: "Sem itemização", total: 250 });
    expect(r.views.INSUMO!.category.rows.map((l) => l.name)).not.toContain("Sem itemização");
  });

  test("centavos de arredondamento não viram linha", () => {
    const r = montarRankings([compra("F", [item({ totalPrice: 100 })], 100.03)]);
    expect(r.unitemizedTotal).toBe(0);
  });

  test("ranking corta no top 10, mas o total é do mês inteiro", () => {
    const itens = Array.from({ length: 12 }, (_, i) => item({ productName: `P${i}`, totalPrice: 10 + i }));
    const r = montarRankings([compra("G", itens)]);
    expect(r.views.INSUMO!.product.rows).toHaveLength(10);
    expect(r.views.INSUMO!.product.total).toBe(itens.reduce((s, i) => s + i.totalPrice, 0));
  });
});
