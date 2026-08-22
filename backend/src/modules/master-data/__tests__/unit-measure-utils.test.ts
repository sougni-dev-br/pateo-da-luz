import { describe, expect, it } from "vitest";
import { normalizeUnitCode, unitMatchKey } from "../unit-measure-utils.js";

describe("normalizeUnitCode", () => {
  it("padroniza para maiusculas sem espacos", () => {
    expect(normalizeUnitCode("kg")).toBe("KG");
    expect(normalizeUnitCode(" un ")).toBe("UN");
    expect(normalizeUnitCode("p c t")).toBe("PCT");
  });

  it("preserva acento do codigo em uso", () => {
    expect(normalizeUnitCode("mç")).toBe("MÇ");
  });

  it("recusa vazio", () => {
    expect(normalizeUnitCode("")).toBeNull();
    expect(normalizeUnitCode("   ")).toBeNull();
    expect(normalizeUnitCode(null)).toBeNull();
    expect(normalizeUnitCode(undefined)).toBeNull();
  });
});

describe("unitMatchKey", () => {
  it("iguala grafias que so diferem por caixa, acento ou espaco", () => {
    // Sem isso, "Maço" e "MACO" entram como duas unidades diferentes e a
    // lista volta a encher de sinonimo.
    expect(unitMatchKey("Maço")).toBe(unitMatchKey("MACO"));
    expect(unitMatchKey("Pacote")).toBe(unitMatchKey(" pacote "));
    expect(unitMatchKey("Duzia")).toBe(unitMatchKey("dúzia"));
  });

  it("mantem distintas as unidades que sao de fato diferentes", () => {
    expect(unitMatchKey("Litro")).not.toBe(unitMatchKey("Lata"));
    expect(unitMatchKey("KG")).not.toBe(unitMatchKey("G"));
    expect(unitMatchKey("Balde")).not.toBe(unitMatchKey("Bandeja"));
  });

  it("recusa vazio", () => {
    expect(unitMatchKey("")).toBeNull();
    expect(unitMatchKey(null)).toBeNull();
  });
});
