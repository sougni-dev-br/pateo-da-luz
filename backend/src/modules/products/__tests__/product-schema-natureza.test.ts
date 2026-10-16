import { describe, expect, it } from "vitest";
import { productSchema } from "../product.schemas.js";

describe("productSchema.nature", () => {
  it("aceita cada natureza conhecida", () => {
    for (const nature of ["INSUMO", "EMBALAGEM", "CONSUMO", "DURAVEL", "SERVICO"]) {
      expect(productSchema.safeParse({ name: "Item", nature }).success).toBe(true);
    }
  });

  it("aceita ausencia e null (cliente antigo e produto sem natureza)", () => {
    expect(productSchema.safeParse({ name: "Item" }).success).toBe(true);
    expect(productSchema.safeParse({ name: "Item", nature: null }).success).toBe(true);
  });

  it("rejeita natureza desconhecida", () => {
    const resultado = productSchema.safeParse({ name: "Item", nature: "OUTRA" });
    expect(resultado.success).toBe(false);
  });
});
