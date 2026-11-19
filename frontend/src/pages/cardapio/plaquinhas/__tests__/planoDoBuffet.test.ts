import { describe, expect, test } from "vitest";
import type { BuffetAnalysisItem } from "../../../../api/client";
import { lerNumero, planejarBuffet } from "../planoDoBuffet";

const prato = (o: Partial<BuffetAnalysisItem>): BuffetAnalysisItem => ({
  itemId: "a", name: "Arroz", category: null, days: 5, daysWithLeftover: 5, daysForPerPerson: 5, producedG: 50000, leftoverG: 10000, consumedG: 40000, leftoverPct: 0.2,
  gPerPerson: 160, costPerKg: 8, leftoverCost: 80, consumedCost: 320, costPerPerson: 1.28, signals: [], ...o,
});

describe("planejar o próximo buffet", () => {
  test("gramas por pessoa × pessoas × folga, com custo previsto", () => {
    const p = planejarBuffet([prato({})], 100, 10);
    // 160 g × 100 × 1,10 = 17,6 kg; × R$ 8 = R$ 140,80
    expect(p.rows[0]).toMatchObject({ itemId: "a", gPerPerson: 160, kg: 17.6, cost: 140.8, canFallShort: false });
    expect(p).toMatchObject({ totalKg: 17.6, totalCost: 140.8, withCost: 1, left: [] });
  });

  test("sem folga é só o consumo médio", () => {
    expect(planejarBuffet([prato({})], 100, 0).rows[0].kg).toBe(16);
  });

  test("prato com poucos dias ou sem gramas por pessoa fica de fora e é listado", () => {
    const p = planejarBuffet([prato({ itemId: "novo", name: "Novo", daysForPerPerson: 2 }), prato({ itemId: "semPdv", name: "Sem PDV", gPerPerson: null }), prato({})], 50, 10);
    expect(p.rows.map((r) => r.itemId)).toEqual(["a"]);
    expect(p.left).toEqual([{ itemId: "novo", name: "Novo" }, { itemId: "semPdv", name: "Sem PDV" }]);
  });

  test("prato sem custo entra no plano em kg mas fora do total em R$", () => {
    const p = planejarBuffet([prato({}), prato({ itemId: "b", name: "Feijão", costPerKg: null, gPerPerson: 100 })], 100, 0);
    expect(p.rows).toHaveLength(2);
    expect(p).toMatchObject({ totalKg: 26, totalCost: 128, withCost: 1 });
    expect(p.rows.find((r) => r.itemId === "b")?.cost).toBeNull();
  });

  test("sem nenhum custo o total em R$ é nulo (e não zero)", () => {
    expect(planejarBuffet([prato({ costPerKg: null })], 100, 10).totalCost).toBeNull();
  });

  test("avisa quando o prato quase não sobra: o consumo medido pode estar cortado", () => {
    expect(planejarBuffet([prato({ signals: ["PODE_FALTAR"] })], 100, 10).rows[0].canFallShort).toBe(true);
  });

  test("ordena do que mais se produz para o que menos", () => {
    const p = planejarBuffet([prato({ itemId: "p", gPerPerson: 20 }), prato({ itemId: "g", gPerPerson: 300 })], 100, 0);
    expect(p.rows.map((r) => r.itemId)).toEqual(["g", "p"]);
  });

  test("folga negativa é tratada como zero", () => {
    expect(planejarBuffet([prato({})], 100, -50).rows[0].kg).toBe(16);
  });
});

describe("ler número digitado", () => {
  test.each([["120", 120], ["12,5", 12.5], [" 8.25 ", 8.25]])("lê %s", (t, n) => expect(lerNumero(t)).toBe(n));
  test.each(["", "abc", "-3", "1,2,3", "12 pessoas"])("recusa %j", (t) => expect(lerNumero(t)).toBeNull());
});
