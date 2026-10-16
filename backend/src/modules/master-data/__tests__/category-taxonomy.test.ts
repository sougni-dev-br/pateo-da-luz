import { describe, expect, it } from "vitest";
import { categorySchema } from "../master-data.schemas.js";

describe("categorySchema: natureza e DRE padrão", () => {
  it("aceita cada natureza conhecida e a categoria DRE usual", () => {
    for (const nature of ["INSUMO", "EMBALAGEM", "CONSUMO", "DURAVEL", "SERVICO"]) {
      const resultado = categorySchema.safeParse({ name: "CATEGORIA FICTICIA", nature, defaultDreCategoryId: "dre-1" });
      expect(resultado.success).toBe(true);
    }
  });

  it("cliente antigo não manda os campos: ficam indefinidos, o que significa não mexer", () => {
    const resultado = categorySchema.safeParse({ name: "CATEGORIA FICTICIA" });
    expect(resultado.success).toBe(true);
    if (!resultado.success) return;
    expect(resultado.data.nature).toBeUndefined();
    expect(resultado.data.defaultDreCategoryId).toBeUndefined();
  });

  it("null limpa a natureza e string vazia limpa a categoria DRE usual", () => {
    const resultado = categorySchema.safeParse({ name: "CATEGORIA FICTICIA", nature: null, defaultDreCategoryId: "" });
    expect(resultado.success).toBe(true);
    if (!resultado.success) return;
    expect(resultado.data.nature).toBeNull();
    expect(resultado.data.defaultDreCategoryId).toBeNull();
  });

  it("rejeita natureza desconhecida", () => {
    expect(categorySchema.safeParse({ name: "CATEGORIA FICTICIA", nature: "OUTRA" }).success).toBe(false);
  });
});
