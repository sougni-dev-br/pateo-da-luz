import { describe, expect, it } from "vitest";
import { parseDecimalInput } from "../parse-decimal.js";

describe("parseDecimalInput", () => {
  it("devolve null para valor ausente ou vazio", () => {
    expect(parseDecimalInput(null)).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
  });

  it("aceita numero JSON sem alterar a escala", () => {
    expect(parseDecimalInput(1.5)).toBe(1.5);
    expect(parseDecimalInput(0.5)).toBe(0.5);
    expect(parseDecimalInput(0)).toBe(0);
    expect(parseDecimalInput(-2.25)).toBe(-2.25);
    expect(parseDecimalInput(1000)).toBe(1000);
  });

  it("trata virgula como separador decimal (pt-BR)", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput("0,001")).toBe(0.001);
    expect(parseDecimalInput("1.234,56")).toBe(1234.56);
    expect(parseDecimalInput("12.345.678,9")).toBe(12345678.9);
  });

  it("trata ponto como separador decimal quando nao ha agrupamento de milhar", () => {
    expect(parseDecimalInput("1.5")).toBe(1.5);
    expect(parseDecimalInput("0.5")).toBe(0.5);
    expect(parseDecimalInput("0.75")).toBe(0.75);
    expect(parseDecimalInput("10.25")).toBe(10.25);
    expect(parseDecimalInput("1.2345")).toBe(1.2345);
  });

  it("trata ponto como separador de milhar quando o agrupamento e exato", () => {
    expect(parseDecimalInput("1.234")).toBe(1234);
    expect(parseDecimalInput("12.345.678")).toBe(12345678);
  });

  it("aceita inteiros e sinal", () => {
    expect(parseDecimalInput("2")).toBe(2);
    expect(parseDecimalInput("-3")).toBe(-3);
    expect(parseDecimalInput("-1,5")).toBe(-1.5);
    expect(parseDecimalInput("+4,5")).toBe(4.5);
  });

  it("ignora espacos e prefixo de moeda", () => {
    expect(parseDecimalInput(" 1,5 ")).toBe(1.5);
    expect(parseDecimalInput("R$ 1.234,56")).toBe(1234.56);
  });

  it("devolve null para texto que nao e numero", () => {
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("--")).toBeNull();
    expect(parseDecimalInput(",")).toBeNull();
    expect(parseDecimalInput(".")).toBeNull();
    expect(parseDecimalInput(Number.NaN)).toBeNull();
    expect(parseDecimalInput(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("nao confunde valor ja decimal com agrupamento de milhar", () => {
    // Regressao PROD-01: a versao antiga removia todos os pontos e
    // devolvia 15 para "1.5" e 5 para 0.5.
    expect(parseDecimalInput("1.5")).not.toBe(15);
    expect(parseDecimalInput(0.5)).not.toBe(5);
  });
});
