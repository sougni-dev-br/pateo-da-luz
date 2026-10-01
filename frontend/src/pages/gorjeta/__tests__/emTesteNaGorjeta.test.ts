import { describe, expect, test } from "vitest";
import { emTesteNaGorjeta } from "../emTesteNaGorjeta";

// Selo "em teste (fora da gorjeta)" na Equipe: participa no cadastro, mas a entrada na
// gorjeta está vazia ou é futura.
describe("emTesteNaGorjeta", () => {
  const HOJE = "2026-10-01";
  test("participa sem data: em teste", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: null }, HOJE)).toBe(true);
  });
  test("participa com data futura: em teste", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: "2026-10-02T00:00:00.000Z" }, HOJE)).toBe(true);
  });
  test("data de hoje ou passada: na gorjeta", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: "2026-10-01T00:00:00.000Z" }, HOJE)).toBe(false);
    expect(emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: "2025-01-01" }, HOJE)).toBe(false);
  });
  test("não participa: sem selo de teste", () => {
    expect(emTesteNaGorjeta({ participaGorjeta: false, inicioGorjeta: null }, HOJE)).toBe(false);
  });
});
