import { describe, expect, test } from "vitest";
import { quantityToApi, sanitizeQuantityInput } from "../shared";

// Regressao do incidente de 02/09/2026: os campos de contagem sao <input> de
// texto (inputMode="decimal"). A virgula do teclado pt-BR seguia crua ate a API
// e virava zero no backend. Estes helpers fecham a borda de saida e precisam
// concordar com backend/src/shared/utils/parse-decimal.ts.

describe("sanitizeQuantityInput", () => {
  test("preserva a virgula enquanto o usuario digita", () => {
    expect(sanitizeQuantityInput("16,5")).toBe("16,5");
  });

  test("preserva o ponto decimal e o de milhar", () => {
    expect(sanitizeQuantityInput("16.5")).toBe("16.5");
    expect(sanitizeQuantityInput("1.234,5")).toBe("1.234,5");
  });

  test("remove letras e simbolos", () => {
    expect(sanitizeQuantityInput("16,5kg")).toBe("16,5");
    expect(sanitizeQuantityInput("R$ 12")).toBe("12");
  });

  test("nao atrapalha a digitacao em andamento", () => {
    expect(sanitizeQuantityInput("16,")).toBe("16,");
    expect(sanitizeQuantityInput("")).toBe("");
  });
});

describe("quantityToApi", () => {
  test("converte virgula em ponto para a API", () => {
    expect(quantityToApi("16,5")).toBe("16.5");
  });

  test("mantem valor ja com ponto", () => {
    expect(quantityToApi("16.5")).toBe("16.5");
  });

  test("le milhar com virgula decimal igual ao backend", () => {
    expect(quantityToApi("1.234,5")).toBe("1234.5");
  });

  test("ponto de milhar sem virgula segue a leitura pt-BR do backend", () => {
    expect(quantityToApi("1.234")).toBe("1234");
  });

  test("campo vazio vira string vazia (pendente, nao zero)", () => {
    expect(quantityToApi("")).toBe("");
    expect(quantityToApi("   ")).toBe("");
  });

  test("zero digitado continua zero", () => {
    expect(quantityToApi("0")).toBe("0");
  });

  test("texto ilegivel retorna undefined para bloquear o envio", () => {
    expect(quantityToApi("abc")).toBeUndefined();
    expect(quantityToApi("16,5kg")).toBeUndefined();
  });
});
