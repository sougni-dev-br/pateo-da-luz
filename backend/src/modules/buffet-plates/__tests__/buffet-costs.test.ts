import { describe, expect, test } from "vitest";
import { custoDoPrato, valorizarDia, type CustoDoPrato, type FichaParaCusto } from "../buffet-costs.js";
import { summarizeDay } from "../buffet-weighing-summary.js";

const ficha = (o: Partial<FichaParaCusto> = {}): FichaParaCusto => ({
  id: "d1", name: "Arroz", yieldUnit: "KG", custoPorcao: 8, custoIncompleto: false, portionWeightG: null, fichaPendente: false, ...o,
});

describe("custo por kg pela ficha", () => {
  test("ficha que rende em kg vale como está", () => {
    expect(custoDoPrato(ficha())).toMatchObject({ state: "OK", costPerKg: 8, dishId: "d1" });
  });

  test("rendimento em gramas vira kg", () => {
    expect(custoDoPrato(ficha({ yieldUnit: "G", custoPorcao: 0.008 })).costPerKg).toBeCloseTo(8, 6);
  });

  test("porção só converte quando a ficha informa o peso dela", () => {
    expect(custoDoPrato(ficha({ yieldUnit: "UN", custoPorcao: 2, portionWeightG: 250 })).costPerKg).toBeCloseTo(8, 6);
    expect(custoDoPrato(ficha({ yieldUnit: "UN", custoPorcao: 2 }))).toMatchObject({ state: "SEM_PESO", costPerKg: null });
    expect(custoDoPrato(ficha({ yieldUnit: "UN", custoPorcao: 2, portionWeightG: 0 })).state).toBe("SEM_PESO");
  });

  test("sem ficha, pendente e incompleta não viram custo parcial", () => {
    expect(custoDoPrato(null)).toMatchObject({ state: "SEM_FICHA", costPerKg: null, dishId: null });
    expect(custoDoPrato(ficha({ fichaPendente: true }))).toMatchObject({ state: "PENDENTE", costPerKg: null });
    expect(custoDoPrato(ficha({ custoIncompleto: true }))).toMatchObject({ state: "INCOMPLETA", costPerKg: null });
    expect(custoDoPrato(ficha({ custoPorcao: 0 })).state).toBe("INCOMPLETA");
  });

  test("pendente vem antes de incompleta (a ficha nem foi montada)", () => {
    expect(custoDoPrato(ficha({ fichaPendente: true, custoIncompleto: true })).state).toBe("PENDENTE");
  });
});

describe("valor do dia de pesagem", () => {
  const ok = (costPerKg: number): CustoDoPrato => ({ state: "OK", dishId: "d", dishName: "x", costPerKg, reason: null });
  const sem: CustoDoPrato = { state: "SEM_FICHA", dishId: null, dishName: null, costPerKg: null, reason: "x" };

  test("valoriza produzido, sobra e consumido pelo custo por kg", () => {
    const { items } = summarizeDay([
      { itemId: "a", phase: "PRODUCAO", netG: 12000 }, { itemId: "a", phase: "SOBRA", netG: 2500 },
    ]);
    const v = valorizarDia(items, new Map([["a", ok(8)]]));
    expect(v.items[0]).toEqual({ itemId: "a", producedCost: 96, leftoverCost: 20, consumedCost: 76 });
    expect(v).toMatchObject({ producedCost: 96, leftoverCost: 20, consumedCost: 76, itemsWithCost: 1, itemsTotal: 1 });
  });

  test("prato sem custo fica fora do total e a cobertura mostra quantos faltam", () => {
    const { items } = summarizeDay([
      { itemId: "a", phase: "PRODUCAO", netG: 10000 }, { itemId: "b", phase: "PRODUCAO", netG: 5000 },
    ]);
    const v = valorizarDia(items, new Map([["a", ok(10)], ["b", sem]]));
    expect(v.items.find((i) => i.itemId === "b")).toEqual({ itemId: "b", producedCost: null, leftoverCost: null, consumedCost: null });
    expect(v).toMatchObject({ producedCost: 100, itemsWithCost: 1, itemsTotal: 2 });
  });

  test("sobra sem produção pesada valoriza a sobra mas não inventa consumo", () => {
    const { items } = summarizeDay([{ itemId: "a", phase: "SOBRA", netG: 1000 }]);
    const v = valorizarDia(items, new Map([["a", ok(8)]]));
    expect(v.items[0]).toMatchObject({ leftoverCost: 8, consumedCost: null });
    expect(v.consumedCost).toBe(0);
  });

  test("arredonda em centavos", () => {
    const { items } = summarizeDay([{ itemId: "a", phase: "PRODUCAO", netG: 333 }]);
    expect(valorizarDia(items, new Map([["a", ok(10)]])).items[0].producedCost).toBe(3.33);
  });
});
