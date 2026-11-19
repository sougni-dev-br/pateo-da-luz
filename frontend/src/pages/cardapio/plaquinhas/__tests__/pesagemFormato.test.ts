import { describe, expect, test } from "vitest";
import { kgCampo, kgTexto, lerKg } from "../pesagemFormato";

describe("pesos do buffet", () => {
  test.each([["12,35", 12350], ["12.35", 12350], [" 8 ", 8000], ["0,005", 5], ["200", 200000]])("lê %s como %i g", (t, g) => {
    expect(lerKg(t)).toBe(g);
  });

  test.each(["", "0", "0,000", "-3", "abc", "1,2345", "200,001", "1,2,3", "12 kg"])("recusa %j", (t) => {
    expect(lerKg(t)).toBeNull();
  });

  test("mostra em kg com vírgula", () => {
    expect(kgTexto(12350)).toBe("12,35 kg");
    expect(kgTexto(500)).toBe("0,5 kg");
    expect(kgCampo(12350)).toBe("12,35");
    expect(kgCampo(2000)).toBe("2");
  });
});
