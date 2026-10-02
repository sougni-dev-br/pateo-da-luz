import { afterEach, describe, expect, test, vi } from "vitest";
import { hojeLocal, mesLocal } from "./gorjetaUtils";
import { agrupar } from "./Pendencias";

describe("datas no fuso de quem usa", () => {
  afterEach(() => vi.useRealTimers());

  test("às 22h de 28/09 ainda é 28/09 (não o dia seguinte do UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 22, 30)); // horário local
    expect(hojeLocal()).toBe("2026-09-28");
    expect(mesLocal()).toBe("2026-09");
  });

  test("meses para trás atravessam a virada do ano", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 12, 0));
    expect(mesLocal(1)).toBe("2025-12");
    expect(mesLocal(11)).toBe("2025-02");
  });
});

describe("pendências agrupadas", () => {
  test("saídas sem valor viram um item; o resto continua como veio", () => {
    const r = agrupar([
      "Fulana de Jesus Lima: saiu em 16/09 e falta o valor da rescisão. Em \"Rescisões do período\", digite…",
      "Paulo Henrique: saiu em 14/09 e falta o valor da rescisão. Em \"Rescisões do período\", digite…",
      "As cotas fixas passam do líquido.",
    ]);
    expect(r.saidas).toEqual([{ nome: "Fulana de Jesus Lima", dia: "16/09" }, { nome: "Paulo Henrique", dia: "14/09" }]);
    expect(r.outras).toEqual(["As cotas fixas passam do líquido."]);
  });
});
