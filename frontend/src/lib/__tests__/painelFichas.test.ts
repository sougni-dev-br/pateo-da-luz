import { describe, expect, it } from "vitest";
import type { DishListItem } from "../../api/client";
import { ehAnalisavel, montarPainel, veredito } from "../painelFichas";

function prato(parcial: Partial<DishListItem> = {}): DishListItem {
  return {
    id: "d", code: null, name: "Prato", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN",
    isActive: true, itemsCount: 2, listingsCount: 0, listingPriceMin: null, listingPriceMax: null,
    calculatedCost: 10, custoPorcao: 10, margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial
  };
}

const catA = { id: "a", name: "A la carte" };
const catB = { id: "b", name: "Buffet" };

describe("quem entra na análise", () => {
  it("exige ativo, ingredientes, custo completo e preço", () => {
    expect(ehAnalisavel(prato())).toBe(true);
    expect(ehAnalisavel(prato({ isActive: false }))).toBe(false);
    expect(ehAnalisavel(prato({ itemsCount: 0, cmvPercentual: 0 }))).toBe(false); // CMV 0% de ficha vazia não vale
    expect(ehAnalisavel(prato({ custoIncompleto: true }))).toBe(false); // custo parcial subestima o CMV
    expect(ehAnalisavel(prato({ salePriceDefault: null, cmvPercentual: null, margemBruta: null }))).toBe(false);
  });
});

describe("painel", () => {
  const lista = [
    prato({ id: "1", name: "Bom", category: catA, cmvPercentual: 20, margemBruta: 40 }),
    prato({ id: "2", name: "Atenção", category: catA, cmvPercentual: 35, margemBruta: 30 }),
    prato({ id: "3", name: "Alto", category: catB, cmvPercentual: 50, margemBruta: 10 }),
    prato({ id: "4", name: "Sem ficha", itemsCount: 0, cmvPercentual: 0 }),
    prato({ id: "5", name: "Parcial", custoIncompleto: true }),
    prato({ id: "6", name: "Sem preço", salePriceDefault: null, cmvPercentual: null, margemBruta: null }),
    prato({ id: "7", name: "Inativo", isActive: false, cmvPercentual: 90 })
  ];
  const painel = montarPainel(lista);

  it("conta ativos e fichas montadas, ignorando inativos", () => {
    expect(painel.ativos).toBe(6);
    expect(painel.comFicha).toBe(5);
    expect(painel.percentualComFicha).toBe(83);
    expect(painel.analisaveis).toBe(3);
  });

  it("CMV e margem médios só dos analisáveis", () => {
    expect(painel.cmvMedio).toBeCloseTo((20 + 35 + 50) / 3);
    expect(painel.margemMedia).toBeCloseTo((40 + 30 + 10) / 3);
  });

  it("distribui nas faixas 32% e 40%: 32,0 é bom, 40,0 é atenção", () => {
    expect(painel.distribuicao).toEqual({ bom: 1, atencao: 1, alto: 1 });
    const limite = montarPainel([prato({ cmvPercentual: 32 }), prato({ id: "x", cmvPercentual: 40 }), prato({ id: "y", cmvPercentual: 40.1 })]);
    expect(limite.distribuicao).toEqual({ bom: 1, atencao: 1, alto: 1 });
  });

  it("pendências por situação", () => {
    expect(painel.pendencias).toEqual({ semFicha: 1, incompletas: 1, semPreco: 1, cmvAlto: 1 });
  });

  it("rankings ordenados: maior CMV e maior margem em reais", () => {
    expect(painel.maioresCmv.map((p) => p.name)).toEqual(["Alto", "Atenção", "Bom"]);
    expect(painel.maioresMargens.map((p) => p.name)).toEqual(["Bom", "Atenção", "Alto"]);
  });

  it("ranking limitado a 5", () => {
    const muitos = Array.from({ length: 9 }, (_, i) => prato({ id: `p${i}`, name: `P${i}`, cmvPercentual: 10 + i, margemBruta: 5 + i }));
    expect(montarPainel(muitos).maioresCmv).toHaveLength(5);
    expect(montarPainel(muitos).maioresCmv[0].name).toBe("P8");
  });

  it("CMV por categoria, do maior para o menor, com 'Sem categoria' à parte", () => {
    const comSem = montarPainel([...lista, prato({ id: "8", name: "Solto", cmvPercentual: 60, margemBruta: 5 })]);
    expect(comSem.porCategoria.map((c) => [c.nome, Math.round(c.cmvMedio), c.pratos])).toEqual([
      ["Sem categoria", 60, 1], ["Buffet", 50, 1], ["A la carte", 28, 2]
    ]);
  });

  it("sem nenhum prato analisável não inventa média", () => {
    const vazio = montarPainel([prato({ itemsCount: 0, cmvPercentual: 0 })]);
    expect(vazio.cmvMedio).toBeNull();
    expect(vazio.margemMedia).toBeNull();
    expect(vazio.maioresCmv).toEqual([]);
    expect(veredito(vazio)).toBeNull();
  });

  it("lista vazia não divide por zero", () => {
    expect(montarPainel([])).toMatchObject({ ativos: 0, percentualComFicha: 0, cmvMedio: null });
  });
});

describe("veredito", () => {
  it("saudável, atenção e alto", () => {
    expect(veredito(montarPainel([prato({ cmvPercentual: 20 })]))?.tom).toBe("success");
    expect(veredito(montarPainel([prato({ cmvPercentual: 20 }), prato({ id: "b", cmvPercentual: 36 })]))?.tom).toBe("warning");
    expect(veredito(montarPainel([prato({ cmvPercentual: 20 }), prato({ id: "b", cmvPercentual: 45 })]))?.texto).toMatch(/1 prato com CMV acima de 40%/);
    expect(veredito(montarPainel([prato({ cmvPercentual: 45 })]))?.tom).toBe("danger");
  });
});
