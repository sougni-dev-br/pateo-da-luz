import { describe, expect, test } from "vitest";
import { looksLikeMoneyString, parseMoney } from "../parseMoney";

describe("parseMoney", () => {
  test("parseia R$ inteiro positivo", () => {
    expect(parseMoney("R$ 128.450")).toBe(128450);
  });

  test("parseia R$ com centavos", () => {
    expect(parseMoney("R$ 1.234,56")).toBe(1234.56);
  });

  test("parseia negativo com en-dash", () => {
    expect(parseMoney("– R$ 820")).toBe(-820);
  });

  test("parseia negativo com hifen ascii", () => {
    expect(parseMoney("- R$ 820")).toBe(-820);
  });

  test("tolera espacos ao redor", () => {
    expect(parseMoney("  R$  1.500  ")).toBe(1500);
  });

  test("retorna null para string sem R$", () => {
    expect(parseMoney("128.450")).toBeNull();
  });

  test("retorna null para string malformada", () => {
    expect(parseMoney("R$ abc")).toBeNull();
  });
});

describe("looksLikeMoneyString", () => {
  test("true para strings iniciadas em R$", () => {
    expect(looksLikeMoneyString("R$ 100")).toBe(true);
    expect(looksLikeMoneyString("– R$ 100")).toBe(true);
    expect(looksLikeMoneyString("  R$ 100")).toBe(true);
  });

  test("false para nao-strings", () => {
    expect(looksLikeMoneyString(100)).toBe(false);
    expect(looksLikeMoneyString(null)).toBe(false);
    expect(looksLikeMoneyString(undefined)).toBe(false);
  });

  test("false para strings sem R$", () => {
    expect(looksLikeMoneyString("100")).toBe(false);
    expect(looksLikeMoneyString("Ativo")).toBe(false);
  });
});
