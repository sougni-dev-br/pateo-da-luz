import { describe, expect, it } from "vitest";
import { formatProductCode, normalizeProductCode } from "../product-code.js";

describe("normalizeProductCode", () => {
  it("remove zeros a esquerda para chegar na forma canonica", () => {
    // PROD-02: "001185" e "1185" eram dois registros distintos para o @unique
    // de string, mas o mesmo numero para quem le a etiqueta.
    expect(normalizeProductCode("001185")).toBe("1185");
    expect(normalizeProductCode("000301")).toBe("301");
    expect(normalizeProductCode("0999")).toBe("999");
  });

  it("mantem intacto o codigo que ja esta na forma canonica", () => {
    expect(normalizeProductCode("301")).toBe("301");
    expect(normalizeProductCode("1230")).toBe("1230");
  });

  it("apara espacos", () => {
    expect(normalizeProductCode("  001185  ")).toBe("1185");
  });

  it("preserva o zero", () => {
    expect(normalizeProductCode("0")).toBe("0");
    expect(normalizeProductCode("0000")).toBe("0");
  });

  it("devolve null para ausente ou vazio", () => {
    expect(normalizeProductCode(null)).toBeNull();
    expect(normalizeProductCode(undefined)).toBeNull();
    expect(normalizeProductCode("")).toBeNull();
    expect(normalizeProductCode("   ")).toBeNull();
  });

  it("devolve o texto aparado quando nao e numerico", () => {
    // Codigo nao numerico nao e o padrao da casa, mas se existir na planilha
    // nao pode ser descartado em silencio.
    expect(normalizeProductCode("CARD-abc")).toBe("CARD-abc");
    expect(normalizeProductCode(" A-01 ")).toBe("A-01");
  });

  it("aceita numero", () => {
    expect(normalizeProductCode(1185)).toBe("1185");
  });
});

describe("formatProductCode", () => {
  it("gera o codigo sem padding", () => {
    expect(formatProductCode(1231)).toBe("1231");
    expect(formatProductCode(301)).toBe("301");
  });

  it("bate com a forma canonica de normalizeProductCode", () => {
    for (const value of [1, 42, 301, 1230, 99999]) {
      expect(normalizeProductCode(formatProductCode(value))).toBe(formatProductCode(value));
    }
  });
});
