import { describe, expect, test } from "vitest";
import { formatPercent, maskMoney, moneyToMasked, numeroBr } from "../format";

describe("numeroBr", () => {
  test("le o que o usuario digitou sob mascara", () => {
    expect(numeroBr("54.562,79")).toBe(54562.79);
    expect(numeroBr("1.500,00")).toBe(1500);
    expect(numeroBr("0,05")).toBe(0.05);
  });

  test("le o formato canonico que vem da API", () => {
    expect(numeroBr("54562.79")).toBe(54562.79);
    expect(numeroBr("3575.03")).toBe(3575.03);
    expect(numeroBr(7150.07)).toBe(7150.07);
  });

  test("regressao: replace(',', '.') zerava a parcela mascarada", () => {
    // O codigo antigo fazia Number("54.562,79".replace(",", ".")) -> NaN -> 0,
    // e a parcela sumia da soma sem nenhum aviso na tela.
    expect(Number("54.562,79".replace(",", "."))).toBeNaN();
    expect(numeroBr("54.562,79")).toBe(54562.79);
  });

  test("vazio, nulo e lixo viram zero em vez de NaN", () => {
    for (const entrada of ["", "   ", null, undefined, "abc", "R$"]) {
      expect(numeroBr(entrada)).toBe(0);
    }
  });

  test("fecha o ciclo com a mascara do proprio ERP", () => {
    // O que maskMoney escreve, numeroBr tem que conseguir ler de volta.
    for (const digitado of ["150000", "5456279", "5", "100"]) {
      const mascarado = maskMoney(digitado);
      expect(numeroBr(mascarado)).toBe(Number(digitado) / 100);
    }
  });

  test("fecha o ciclo com moneyToMasked", () => {
    for (const valor of [7150.07, 3575.04, 0.01, 1234567.89]) {
      expect(numeroBr(moneyToMasked(valor))).toBe(valor);
    }
  });
});

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
