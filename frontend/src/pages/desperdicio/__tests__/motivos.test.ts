import { describe, expect, test } from "vitest";
import { MOTIVOS, erroDaQuantidade, quantidadeValida, somarDiasIso } from "../motivos";

describe("quantidadeValida", () => {
  test.each(["1", "2,5", "0.75", " 3 "])("aceita %s", (texto) => expect(quantidadeValida(texto)).toBe(true));
  test.each(["", "0", "0,0", "-1", "abc", "1,2,3", "1e3", "0,00001", "1,23456", "1.500"])("recusa %s", (texto) => expect(quantidadeValida(texto)).toBe(false));
});

describe("erroDaQuantidade", () => {
  test("distingue vazio, milhar ambíguo e inválido", () => {
    expect(erroDaQuantidade("")).toBe("VAZIA");
    expect(erroDaQuantidade("1.500")).toBe("MILHAR");
    expect(erroDaQuantidade("abc")).toBe("INVALIDA");
    expect(erroDaQuantidade("2,5")).toBeNull();
    expect(erroDaQuantidade("1,500")).toBeNull();
  });
});

describe("somarDiasIso", () => {
  test("atravessa mês e ano sem depender do fuso", () => {
    expect(somarDiasIso("2026-10-14", -29)).toBe("2026-09-15");
    expect(somarDiasIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(somarDiasIso("2028-02-28", 1)).toBe("2028-02-29");
  });
});

test("motivos têm valor e rótulo únicos", () => {
  expect(new Set(MOTIVOS.map((m) => m.value)).size).toBe(MOTIVOS.length);
  expect(MOTIVOS.every((m) => m.label.length > 2)).toBe(true);
});
