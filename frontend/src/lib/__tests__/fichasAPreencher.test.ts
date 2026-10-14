import { describe, expect, test } from "vitest";
import type { BuffetDish, DishListItem } from "../../api/client";
import { filtrarAPreencher, montarFilaAPreencher } from "../fichasAPreencher";
import { folhaDoBuffet } from "../folhaDaFicha";

const prato = (parcial: Partial<DishListItem> & { id: string; name: string }): DishListItem => ({
  code: null, menu: "CARDAPIO", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN", isActive: true, itemsCount: 2, listingsCount: 0,
  listingPriceMin: null, listingPriceMax: null, calculatedCost: 10, custoPorcao: 10, margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial,
});

const buffet = (parcial: Partial<BuffetDish> & { id: string; name: string }): BuffetDish => ({
  unit: "KG", pending: true, pendingSince: "2026-10-05T12:00:00.000Z", completedAt: null, requestedBy: null, notes: null, wasteEntries: 0, wasteQuantity: 0, lastWasteOn: null, ...parcial,
});

describe("montarFilaAPreencher", () => {
  const pratos = [
    prato({ id: "a", name: "Zebra ao molho", itemsCount: 0 }),
    prato({ id: "b", name: "Arroz especial", itemsCount: 0, category: { id: "c", name: "Arroz", parentId: null, parentName: null, menu: "CARDAPIO" } }),
    prato({ id: "c", name: "Risoto de funghi", custoIncompleto: true }),
    prato({ id: "d", name: "Feijoada", itemsCount: 5 }),
    prato({ id: "e", name: "Prato antigo", itemsCount: 0, isActive: false }),
    prato({ id: "f", name: "Pizza de delivery", itemsCount: 0, menu: "DELIVERY" }),
  ];

  test("separa pratos sem ficha e fichas incompletas, ignora pronto e inativo", () => {
    const fila = montarFilaAPreencher(pratos, []);
    expect(fila["sem-ficha"].map((i) => i.nome)).toEqual(["Arroz especial", "Pizza de delivery", "Zebra ao molho"]);
    expect(fila.incompleta.map((i) => i.nome)).toEqual(["Risoto de funghi"]);
    expect(fila.total).toBe(4);
  });

  test("o contexto diz o cardápio e a categoria", () => {
    const fila = montarFilaAPreencher(pratos, []);
    expect(fila["sem-ficha"].find((i) => i.id === "b")?.detalhe).toBe("Cardápio · Arroz");
    expect(fila["sem-ficha"].find((i) => i.id === "a")?.detalhe).toBe("Cardápio · Sem categoria");
    expect(fila["sem-ficha"].find((i) => i.id === "f")?.detalhe).toMatch(/^Delivery/);
  });

  test("o que o desperdício criou vem à frente, o que mais saiu primeiro; pronto fica de fora da contagem", () => {
    const fila = montarFilaAPreencher([], [
      buffet({ id: "x", name: "Farofa", wasteEntries: 1, wasteQuantity: 2 }),
      buffet({ id: "y", name: "Purê", wasteEntries: 4, wasteQuantity: 9.5, requestedBy: "Beto" }),
      buffet({ id: "z", name: "Arroz de forno", pending: false, completedAt: "2026-10-09T12:00:00.000Z" }),
    ]);
    expect(fila.aguardando.map((i) => i.nome)).toEqual(["Purê", "Farofa"]);
    expect(fila.aguardando[0].detalhe).toBe("4 lançamentos · 9,5 KG perdidos · pedido por Beto");
    expect(fila.buffetComFicha.map((p) => p.name)).toEqual(["Arroz de forno"]);
    expect(fila.total).toBe(2);
  });

  test("cada item traz a folha pronta para imprimir, com o nome já escrito", () => {
    const fila = montarFilaAPreencher(pratos, [buffet({ id: "y", name: "Purê", notes: "batata e leite" })]);
    expect(fila.aguardando[0].folha).toMatchObject({ prato: "Purê", unidadeDoRendimento: "KG", categoria: "Buffet", observacoes: "Leva, segundo quem lançou o desperdício: batata e leite" });
    expect(fila["sem-ficha"][0].folha).toMatchObject({ prato: "Arroz especial", menu: "CARDAPIO" });
  });

  test("busca sem acento e sem caixa", () => {
    const fila = montarFilaAPreencher([prato({ id: "a", name: "Purê de batata", itemsCount: 0 })], []);
    expect(filtrarAPreencher(fila["sem-ficha"], "PURE").map((i) => i.nome)).toEqual(["Purê de batata"]);
    expect(filtrarAPreencher(fila["sem-ficha"], "xyz")).toEqual([]);
    expect(filtrarAPreencher(fila["sem-ficha"], "  ")).toHaveLength(1);
  });
});

describe("folhaDoBuffet", () => {
  test("sem o que leva, a observação fica em branco", () => {
    expect(folhaDoBuffet({ name: "Farofa", unit: "KG", notes: null }).observacoes).toBe("");
  });

  test("tem o número de linhas pedido e nenhum ingrediente preenchido", () => {
    const folha = folhaDoBuffet({ name: "Farofa", unit: "UN", notes: null }, 12);
    expect(folha.linhas).toBe(12);
    expect(folha.ingredientes).toEqual([]);
    expect(folha.unidadeDoRendimento).toBe("UN");
  });
});
