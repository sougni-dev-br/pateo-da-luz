import { describe, expect, it } from "vitest";
import type { DishDetail } from "../../api/client";
import { alturaDaLinha, copiasDaFolha, folhaDoNome, folhaDoPrato, folhaEmBranco, linhasDaTabela, MAXIMO_DE_COPIAS } from "../folhaDaFicha";

const prato = {
  name: "Penne ao sugo", code: "PRAT-1", menu: "DELIVERY" as const, yieldQty: 2, yieldUnit: "PORÇÃO",
  category: { id: "f", name: "Fresca", parentId: "m", parentName: "Massas", menu: "DELIVERY" as const }
};

describe("folha da ficha técnica", () => {
  it("em branco: sem nada escrito, 16 linhas, cardápio e categoria só se pedidos", () => {
    const folha = folhaEmBranco();
    expect(folha).toMatchObject({ prato: "", menu: null, categoria: "", linhas: 16, ingredientes: [] });
    expect(linhasDaTabela(folha)).toHaveLength(16);
    expect(folhaEmBranco({ menu: "DELIVERY", categoria: "Pizzas", subcategoria: "Doces", linhas: 24 })).toMatchObject({ menu: "DELIVERY", categoria: "Pizzas", subcategoria: "Doces", linhas: 24 });
  });

  it("só com o nome: prato, código, cardápio, categoria principal e subcategoria já escritos", () => {
    expect(folhaDoNome(prato)).toMatchObject({
      prato: "Penne ao sugo", codigo: "PRAT-1", menu: "DELIVERY", categoria: "Massas", subcategoria: "Fresca", rendimento: "2", unidadeDoRendimento: "PORÇÃO"
    });
  });

  it("categoria sem pai vai para o campo de categoria, e subcategoria fica vazia", () => {
    expect(folhaDoNome({ ...prato, category: { id: "b", name: "Buffet", parentId: null, parentName: null, menu: "CARDAPIO" } }))
      .toMatchObject({ categoria: "Buffet", subcategoria: "" });
    expect(folhaDoNome({ ...prato, category: null })).toMatchObject({ categoria: "", subcategoria: "" });
  });

  const detalhe = {
    ...prato, id: "d1", salePriceDefault: 59.9, notes: "Mantecar fora do fogo.", isActive: true,
    items: [
      { id: "i1", productId: "p1", productCode: "0101", productName: "CAMARAO", quantity: 150, unit: "G", wasteFactor: 0.05, notes: "descascado" },
      { id: "i2", productId: "p2", productCode: null, productName: "CEBOLA", quantity: 0.5, unit: "UN", wasteFactor: 0, notes: null }
    ]
  } as unknown as DishDetail;

  it("preenchida: ingredientes com quantidade, unidade e perda em %, preço e modo de preparo", () => {
    const folha = folhaDoPrato(detalhe);
    expect(folha.preco).toBe("59,90");
    expect(folha.modoDePreparo).toBe("Mantecar fora do fogo.");
    expect(folha.ingredientes[0]).toEqual({ nome: "CAMARAO", codigo: "0101", quantidade: "150", unidade: "G", perda: "5", observacao: "descascado" });
    expect(folha.ingredientes[1]).toMatchObject({ quantidade: "0,5", unidade: "UN", perda: "", codigo: "" });
  });

  it("a tabela completa as linhas em branco depois dos ingredientes", () => {
    const linhas = linhasDaTabela(folhaDoPrato(detalhe));
    expect(linhas).toHaveLength(16);
    expect(linhas[1].nome).toBe("CEBOLA");
    expect(linhas[2].nome).toBe("");
  });

  it("ficha grande nunca perde ingrediente: as linhas crescem, com folga para anotar", () => {
    const muitos = { ...detalhe, items: Array.from({ length: 20 }, (_, i) => ({ ...detalhe.items[0], id: `i${i}`, productName: `ING${i}` })) } as DishDetail;
    const folha = folhaDoPrato(muitos, 16);
    expect(folha.linhas).toBe(23);
    expect(linhasDaTabela(folha)).toHaveLength(23);
  });

  it("número de linhas inválido volta ao padrão e o teto é 40", () => {
    expect(folhaEmBranco({ linhas: Number.NaN }).linhas).toBe(16);
    expect(folhaEmBranco({ linhas: -3 }).linhas).toBe(16);
    expect(folhaEmBranco({ linhas: 999 }).linhas).toBe(40);
  });

  it("cópias: pelo menos 1, no máximo 50", () => {
    const folha = folhaEmBranco();
    expect(copiasDaFolha(folha, 5)).toHaveLength(5);
    expect(copiasDaFolha(folha, 0)).toHaveLength(1);
    expect(copiasDaFolha(folha, 9999)).toHaveLength(MAXIMO_DE_COPIAS);
    expect(copiasDaFolha(folha, Number.NaN)).toHaveLength(1);
  });

  it("quanto mais linhas, menor a linha, para a tabela caber numa A4", () => {
    const altura = (n: number) => parseFloat(alturaDaLinha(n));
    expect(altura(12)).toBeGreaterThan(altura(16));
    expect(altura(16)).toBeGreaterThan(altura(20));
    expect(altura(20)).toBeGreaterThan(altura(24));
  });
});
