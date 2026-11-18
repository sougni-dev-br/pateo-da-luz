import { describe, expect, test } from "vitest";
import { summarizeDay } from "../buffet-weighing-summary.js";

describe("resumo do dia de pesagem", () => {
  test("soma produção e reposição e abate a sobra", () => {
    const r = summarizeDay([
      { itemId: "a", phase: "PRODUCAO", netG: 8000 },
      { itemId: "a", phase: "PRODUCAO", netG: 4000 },
      { itemId: "a", phase: "SOBRA", netG: 2500 },
    ]);
    expect(r.items).toEqual([{ itemId: "a", producedG: 12000, leftoverG: 2500, consumedG: 9500, inconsistent: false }]);
    expect(r).toMatchObject({ producedG: 12000, leftoverG: 2500, consumedG: 9500 });
  });

  test("sobra maior que a produção é marcada e o consumo não fica negativo", () => {
    const [i] = summarizeDay([{ itemId: "a", phase: "PRODUCAO", netG: 1000 }, { itemId: "a", phase: "SOBRA", netG: 1500 }]).items;
    expect(i).toMatchObject({ consumedG: 0, inconsistent: true });
  });

  test("sobra sem produção pesada não vira consumo nem entra no total consumido", () => {
    const r = summarizeDay([{ itemId: "a", phase: "SOBRA", netG: 900 }, { itemId: "b", phase: "PRODUCAO", netG: 3000 }]);
    expect(r.items.find((i) => i.itemId === "a")).toMatchObject({ consumedG: null, inconsistent: true });
    expect(r.consumedG).toBe(3000);
  });

  test("dia sem pesagem fica zerado", () => {
    expect(summarizeDay([])).toEqual({ items: [], producedG: 0, leftoverG: 0, consumedG: 0 });
  });
});
