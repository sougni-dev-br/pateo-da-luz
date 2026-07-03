import { describe, expect, test } from "vitest";
import { formatPercent } from "../format";

describe("formatPercent", () => {
  test("formato pt-BR usa virgula decimal", () => {
    expect(formatPercent(31.8)).toBe("31,8%");
    expect(formatPercent(0.5)).toBe("0,5%");
  });

  test("decimals customizavel", () => {
    expect(formatPercent(31.876, 2)).toBe("31,88%");
    expect(formatPercent(31.876, 0)).toBe("32%");
    expect(formatPercent(31.876, 3)).toBe("31,876%");
  });

  test("zero renderiza como 0,0%", () => {
    expect(formatPercent(0)).toBe("0,0%");
  });

  test("negativo preserva sinal com virgula", () => {
    expect(formatPercent(-4.2)).toBe("-4,2%");
  });

  test("null / undefined viram travessao em-dash", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  test("NaN e Infinity viram travessao", () => {
    expect(formatPercent(NaN)).toBe("—");
    expect(formatPercent(Infinity)).toBe("—");
    expect(formatPercent(-Infinity)).toBe("—");
  });

  test("decimal e sempre virgula (regressao do bug DRE / .toFixed)", () => {
    // Se alguem re-introduzir .toFixed() no lugar de toLocaleString, o
    // separador decimal viraria ponto e este teste quebra.
    // Nota: em pt-BR o ponto e usado como separador de MILHAR (1.234,5) —
    // por isso testamos o padrao "digito ponto digito %" (que seria decimal
    // errado), nao qualquer ponto.
    for (const v of [0.5, 31.8, 100, 0.001]) {
      expect(formatPercent(v)).not.toMatch(/\d\.\d+%/);
      expect(formatPercent(v, 3)).not.toMatch(/\d\.\d+%/);
    }
  });

  test("milhar usa ponto (pt-BR canonico)", () => {
    expect(formatPercent(1234.567)).toBe("1.234,6%");
    expect(formatPercent(12345.678, 2)).toBe("12.345,68%");
  });
});
