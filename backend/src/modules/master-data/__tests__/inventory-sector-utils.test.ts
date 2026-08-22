import { describe, expect, it } from "vitest";
import {
  BEVERAGE_SECTORS,
  beverageSectorName,
  normalizeInventorySectorInput
} from "../inventory-sector-utils.js";

describe("normalizeInventorySectorInput", () => {
  it("aceita setor novo que nao existe em nenhuma lista fixa", () => {
    // CAD-03: o cadastro manda. Antes, qualquer nome fora dos 8 oficiais
    // era descartado na leitura e o setor sumia da tela.
    expect(normalizeInventorySectorInput("CONGELADOS")).toBe("CONGELADOS");
    expect(normalizeInventorySectorInput("NAO BATER EST")).toBe("NAO BATER EST");
    expect(normalizeInventorySectorInput("Praca de alimentacao")).toBe("Praca de alimentacao");
  });

  it("preserva a grafia informada, apenas aparando espacos", () => {
    expect(normalizeInventorySectorInput("  Camara Fria  ")).toBe("Camara Fria");
  });

  it("rejeita vazio e lixo conhecido", () => {
    expect(normalizeInventorySectorInput("")).toBeNull();
    expect(normalizeInventorySectorInput("   ")).toBeNull();
    expect(normalizeInventorySectorInput(null)).toBeNull();
    expect(normalizeInventorySectorInput(undefined)).toBeNull();
    expect(normalizeInventorySectorInput("[object Object]")).toBeNull();
    expect(normalizeInventorySectorInput("undefined")).toBeNull();
    expect(normalizeInventorySectorInput("null")).toBeNull();
    expect(normalizeInventorySectorInput("Sem setor")).toBeNull();
  });

  it("rejeita valor nao textual", () => {
    expect(normalizeInventorySectorInput({})).toBeNull();
    expect(normalizeInventorySectorInput([])).toBeNull();
  });
});

describe("beverageSectorName", () => {
  it("reconhece os setores de bebida usados pela auditoria, ignorando grafia", () => {
    expect(beverageSectorName("adega")).toBe("ADEGA");
    expect(beverageSectorName("ADEGA")).toBe("ADEGA");
    expect(beverageSectorName(" Bar ")).toBe("BAR");
  });

  it("devolve null para qualquer outro setor", () => {
    expect(beverageSectorName("ESTOQUE")).toBeNull();
    expect(beverageSectorName("CONGELADOS")).toBeNull();
    expect(beverageSectorName("")).toBeNull();
  });

  it("expoe a lista usada na sugestao de reclassificacao", () => {
    expect([...BEVERAGE_SECTORS]).toEqual(["ADEGA", "BAR"]);
  });
});
