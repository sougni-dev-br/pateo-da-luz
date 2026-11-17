import { describe, expect, test } from "vitest";
import { agruparMesesFaltando, lerValorBr } from "../variavel";

describe("lerValorBr", () => {
  test.each([
    ["638,16", 638.16], ["R$ 638,16", 638.16], ["1.234,50", 1234.5], ["638.16", 638.16], ["0", 0], ["438", 438],
  ])("lê %s", (t, n) => expect(lerValorBr(t)).toBe(n));
  test.each([[""], ["abc"], ["-5"], ["1,234,5"], ["12,345"], ["2000000"]])("recusa %s", (t) => expect(lerValorBr(t)).toBeNull());
});

describe("agruparMesesFaltando", () => {
  test("separa por motivo e ordena pelo calendário", () => {
    const r = agruparMesesFaltando([
      { mes: 11, motivo: "EM_ANDAMENTO" }, { mes: 5, motivo: "SEM_LANCAMENTO" }, { mes: 2, motivo: "SEM_APURACAO" }, { mes: 1, motivo: "SEM_APURACAO" },
    ]);
    expect(r).toEqual({ semApuracao: [1, 2], semLancamento: [5], emAndamento: [11] });
  });
  test("sem meses, tudo vazio", () => {
    expect(agruparMesesFaltando([])).toEqual({ semApuracao: [], semLancamento: [], emAndamento: [] });
  });
});
