import { describe, expect, test } from "vitest";
import { empresaParaEnvio, valorBr, valorNoCampo } from "../fichaFormato";

describe("valor em reais digitado pelo RH", () => {
  test("entende o jeito brasileiro de escrever", () => {
    expect(valorBr("1.500")).toBe(1500);
    expect(valorBr("1.500,50")).toBe(1500.5);
    expect(valorBr("2.800,00")).toBe(2800);
    expect(valorBr("R$ 12.345,67")).toBe(12345.67);
    expect(valorBr("1500,5")).toBe(1500.5);
    expect(valorBr("1500")).toBe(1500);
    expect(valorBr("1500.50")).toBe(1500.5);
    expect(valorBr(2500)).toBe(2500);
  });

  test("vazio é nada; o que não dá para entender não vira número", () => {
    expect(valorBr("")).toBeNull();
    expect(valorBr(null)).toBeNull();
    expect(valorBr("1.50.0")).toBeUndefined();
    expect(valorBr("mil")).toBeUndefined();
    expect(valorBr("1,500,00")).toBeUndefined();
  });

  test("número gravado aparece no formato brasileiro no campo", () => {
    expect(valorNoCampo(1500)).toBe("1.500,00");
    expect(valorNoCampo("1.5")).toBe("1.5");
    expect(valorNoCampo(null)).toBe("");
  });

  test("envio converte salário e VT, e recusa valor sem sentido com mensagem", () => {
    expect(empresaParaEnvio({ salario: "1.500", valorVt: "250,00", funcao: "Copeira" })).toEqual({ salario: 1500, valorVt: 250, funcao: "Copeira" });
    expect(() => empresaParaEnvio({ salario: "1.50.0" })).toThrow("Salário");
    expect(() => empresaParaEnvio({ salario: 1500, valorVt: "x" })).toThrow("VT");
  });
});
