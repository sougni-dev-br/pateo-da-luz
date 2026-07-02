import { describe, expect, it } from "vitest";
import {
  productErrors,
  resolveSupplierAction,
  supplierErrors,
  type SupplierLookupEntry
} from "../catalog-import.service.js";
import { normalizeText } from "../../../shared/utils/normalize-text.js";

const emptySupplierRow = {
  rowNumber: 2,
  code: null,
  document: null,
  name: "",
  registrationDate: null
};

describe("supplierErrors", () => {
  it("reports error only when BOTH code and name are missing", () => {
    const errors = supplierErrors([
      { ...emptySupplierRow, rowNumber: 2, code: null, name: "" }
    ]);

    expect(errors).toEqual([
      { rowNumber: 2, message: "Codigo e nome do fornecedor ausentes." }
    ]);
  });

  it("does NOT error when only code is missing (name-match fallback path)", () => {
    const errors = supplierErrors([
      { ...emptySupplierRow, rowNumber: 3, code: null, name: "Fornecedor Sem Codigo" }
    ]);

    expect(errors).toEqual([]);
  });

  it("does NOT error when only name is missing (code-match path)", () => {
    const errors = supplierErrors([
      { ...emptySupplierRow, rowNumber: 4, code: "F001", name: "" }
    ]);

    expect(errors).toEqual([]);
  });

  it("returns no errors when code and name are present", () => {
    const errors = supplierErrors([
      { ...emptySupplierRow, rowNumber: 5, code: "F002", name: "Fornecedor OK" }
    ]);

    expect(errors).toEqual([]);
  });
});

describe("resolveSupplierAction", () => {
  const supplierA: SupplierLookupEntry = { id: "id-A", externalCode: "25201", name: "GIV ONLINE - WBL GRAFICA E EDITORA LTDA" };
  const supplierB: SupplierLookupEntry = { id: "id-B", externalCode: "25212", name: "L.ANGELUCI PRODUTOS DE PANIFICACAO LTDA" };
  const supplierC: SupplierLookupEntry = { id: "id-C", externalCode: "99999", name: "OUTRO FORNECEDOR" };

  function buildCaches(entries: SupplierLookupEntry[]) {
    const byCode = new Map<string, SupplierLookupEntry>();
    const byNormalizedName = new Map<string, SupplierLookupEntry>();
    for (const entry of entries) {
      if (entry.externalCode) byCode.set(entry.externalCode, entry);
      const key = normalizeText(entry.name);
      if (key) byNormalizedName.set(key, entry);
    }
    return { byCode, byNormalizedName };
  }

  it("case (b/f): matched by code → update-by-code (name updates via later write)", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierB]);
    const action = resolveSupplierAction(
      { rowNumber: 112, code: "25212", document: null, name: "NOME NOVO PARA 25212", registrationDate: null },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({ type: "update-by-code", targetId: "id-B" });
  });

  it("case (d): matched by name with a new code → update-by-name (existing code will be overwritten)", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA]);
    const action = resolveSupplierAction(
      {
        rowNumber: 99,
        code: "26999",
        document: null,
        name: "GIV ONLINE - WBL GRAFICA E EDITORA LTDA",
        registrationDate: null
      },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({ type: "update-by-name", targetId: "id-A" });
  });

  it("case (e): code matches supplierC AND name matches supplierA → structured ambiguity error", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA, supplierC]);
    const action = resolveSupplierAction(
      {
        rowNumber: 99,
        code: "99999",
        document: null,
        name: "GIV ONLINE - WBL GRAFICA E EDITORA LTDA",
        registrationDate: null
      },
      byCode,
      byNormalizedName
    );
    expect(action.type).toBe("error");
    if (action.type !== "error") throw new Error("expected error");
    expect(action.motivo).toContain("99999");
    expect(action.motivo).toContain("OUTRO FORNECEDOR");
    expect(action.motivo).toContain("GIV ONLINE");
  });

  it("case (e-runtime): matched by name only, new code not yet in cache but exists at DB → P2002 handled by service layer", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA]);
    const action = resolveSupplierAction(
      {
        rowNumber: 99,
        code: "99999",
        document: null,
        name: "GIV ONLINE - WBL GRAFICA E EDITORA LTDA",
        registrationDate: null
      },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({ type: "update-by-name", targetId: "id-A" });
  });

  it("no code, no name → structured error", () => {
    const { byCode, byNormalizedName } = buildCaches([]);
    const action = resolveSupplierAction(
      { rowNumber: 5, code: null, document: null, name: "", registrationDate: null },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({
      type: "error",
      motivo: "Codigo e nome do fornecedor ausentes."
    });
  });

  it("brand-new supplier (no matches) → insert", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA]);
    const action = resolveSupplierAction(
      { rowNumber: 200, code: "NEW1", document: null, name: "Fornecedor Novo", registrationDate: null },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({ type: "insert" });
  });

  it("row without code, name doesn't match anything → error (cannot insert nameless via code-only)", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA]);
    const action = resolveSupplierAction(
      { rowNumber: 200, code: "F1", document: null, name: "", registrationDate: null },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({
      type: "error",
      motivo: "Nome do fornecedor ausente para criar novo cadastro."
    });
  });

  it("name normalization: strips accents, case, and collapses spaces", () => {
    const { byCode, byNormalizedName } = buildCaches([supplierA]);
    const action = resolveSupplierAction(
      {
        rowNumber: 99,
        code: null,
        document: null,
        name: "  giv online - wbl grafica e editora ltda  ",
        registrationDate: null
      },
      byCode,
      byNormalizedName
    );
    expect(action).toEqual({ type: "update-by-name", targetId: "id-A" });
  });
});

describe("productErrors", () => {
  const baseRow = {
    rowNumber: 2,
    code: "P001",
    description: "Produto A",
    categoryName: null,
    subcategoryName: null,
    unit: null,
    sectorName: null,
    storageLocation: null,
    storageCorridor: null,
    storageShelf: null,
    storagePosition: null,
    storageNotes: null,
    accountType: null,
    controlsStock: true,
    missingSector: false,
    countableInGeneral: true,
    countableInSectoral: false,
    countabilityReasons: [] as string[]
  };

  it("reports missing product code as an error", () => {
    const errors = productErrors([{ ...baseRow, code: null }]);

    expect(errors).toEqual([
      { rowNumber: 2, message: "Codigo do produto (cod_produto) ausente." }
    ]);
  });

  it("reports missing description when code is present", () => {
    const errors = productErrors([{ ...baseRow, description: "" }]);

    expect(errors).toEqual([
      { rowNumber: 2, message: "Descricao do produto ausente." }
    ]);
  });

  it("returns no errors when required fields are present", () => {
    const errors = productErrors([baseRow]);
    expect(errors).toEqual([]);
  });
});
