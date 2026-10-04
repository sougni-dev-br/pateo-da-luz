import { describe, expect, test } from "vitest";
import { addDays, buildUsageReport, type UsagePrint } from "../buffet-usage.js";

// Hoje = 30/10. Um buffet por dia nos últimos 20 dias (11 a 30/10).
const HOJE = "2026-10-30";
const dias = (n: number) => Array.from({ length: n }, (_, i) => addDays(HOJE, -i));

function buffet(pratosPorDia: (dia: string, i: number) => string[]): UsagePrint[] {
  return dias(20).map((dia, i) => ({ servedOn: dia, itemIds: pratosPorDia(dia, i) }));
}

describe("acompanhamento dos pratos", () => {
  test("conta dias, não impressões: reimprimir no mesmo dia não infla", () => {
    const prints = [
      { servedOn: HOJE, itemIds: ["arroz", "penne"] },
      { servedOn: HOJE, itemIds: ["penne"] },
      { servedOn: addDays(HOJE, -1), itemIds: ["arroz"] },
    ];
    const r = buildUsageReport(prints, HOJE, 7);
    expect(r.period.servedDays).toBe(2);
    expect(r.ranking).toEqual([
      { itemId: "arroz", days: 2, share: 1, lastDay: HOJE },
      { itemId: "penne", days: 1, share: 0.5, lastDay: HOJE },
    ]);
  });

  test("separa o que é base do buffet do que está repetindo demais", () => {
    // arroz todo dia; penne 1 dia sim, 1 não (50%); risoto a cada 5 dias (20%).
    const r = buildUsageReport(buffet((_, i) => ["arroz", ...(i % 2 === 0 ? ["penne"] : []), ...(i % 5 === 0 ? ["risoto"] : [])]), HOJE, 30);
    expect(r.period.servedDays).toBe(20);
    expect(r.staples).toEqual(["arroz"]);
    expect(r.repeating).toEqual(["penne"]);
    expect(r.ranking.map((x) => x.itemId)).toEqual(["arroz", "penne", "risoto"]);
  });

  test("prato que saía e parou há duas semanas vira esquecido; o programado para frente não", () => {
    const antigos = [20, 25, 30, 35].map((n) => ({ servedOn: addDays(HOJE, -n), itemIds: ["lasanha", "estrogonofe"] }));
    const prints = [...antigos, { servedOn: addDays(HOJE, 2), itemIds: ["estrogonofe"] }, { servedOn: HOJE, itemIds: ["arroz"] }];
    const r = buildUsageReport(prints, HOJE, 30);
    expect(r.forgotten).toEqual([{ itemId: "lasanha", daysInHistory: 4, lastDay: addDays(HOJE, -20), daysSince: 20 }]);
  });

  test("prato que saiu uma ou duas vezes não é cobrado como esquecido", () => {
    const prints = [{ servedOn: addDays(HOJE, -30), itemIds: ["paella"] }, { servedOn: addDays(HOJE, -40), itemIds: ["paella"] }];
    expect(buildUsageReport(prints, HOJE, 30).forgotten).toEqual([]);
  });

  test("com poucos dias registrados não acusa repetição nem base", () => {
    const prints = dias(3).map((d) => ({ servedOn: d, itemIds: ["arroz", "penne"] }));
    const r = buildUsageReport(prints, HOJE, 30);
    expect(r.staples).toEqual([]);
    expect(r.repeating).toEqual([]);
    expect(r.ranking).toHaveLength(2);
  });

  test("impressão fora do período não entra no ranking", () => {
    const r = buildUsageReport([{ servedOn: addDays(HOJE, -10), itemIds: ["penne"] }], HOJE, 7);
    expect(r.ranking).toEqual([]);
    expect(r.period).toEqual({ start: addDays(HOJE, -6), end: HOJE, windowDays: 7, servedDays: 0 });
  });
});
