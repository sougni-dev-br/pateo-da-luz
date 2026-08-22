import { describe, expect, it } from "vitest";
import { resolveProductNameConflict } from "../product-name-conflict.js";

const semConflito = {
  productId: null,
  productWithSameName: null,
  aliasOwner: null
};

describe("resolveProductNameConflict", () => {
  it("libera quando o nome esta livre", () => {
    expect(resolveProductNameConflict(semConflito)).toEqual({ ok: true });
  });

  describe("cadastro novo", () => {
    it("bloqueia nome ja usado por outro produto", () => {
      const result = resolveProductNameConflict({
        ...semConflito,
        productWithSameName: { id: "p1", name: "BATATA", externalCode: "301" }
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("DUPLICATE_NAME");
      expect(result.message).toContain("BATATA");
      expect(result.message).toContain("301");
    });

    it("bloqueia nome que ja e apelido de outro produto", () => {
      // PROD-06: sem isso o upsert de alias trocava o dono em silencio, e a
      // importacao de compras — que casa item por apelido — passava a jogar a
      // compra no produto errado.
      const result = resolveProductNameConflict({
        ...semConflito,
        aliasOwner: { productId: "p9", alias: "BATATA LAVADA", ownerName: "BATATA", ownerExternalCode: "301" }
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("ALIAS_TAKEN");
      expect(result.message).toContain("BATATA");
    });
  });

  describe("edicao", () => {
    it("libera quando o produto encontrado e ele mesmo", () => {
      const result = resolveProductNameConflict({
        productId: "p1",
        productWithSameName: { id: "p1", name: "BATATA", externalCode: "301" },
        aliasOwner: null
      });

      expect(result).toEqual({ ok: true });
    });

    it("libera quando o apelido ja pertence a ele mesmo", () => {
      const result = resolveProductNameConflict({
        productId: "p1",
        productWithSameName: null,
        aliasOwner: { productId: "p1", alias: "BATATA LAVADA", ownerName: "BATATA", ownerExternalCode: "301" }
      });

      expect(result).toEqual({ ok: true });
    });

    it("bloqueia nome de outro produto", () => {
      const result = resolveProductNameConflict({
        productId: "p1",
        productWithSameName: { id: "p2", name: "BATATA DOCE", externalCode: "302" },
        aliasOwner: null
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("DUPLICATE_NAME");
    });

    it("bloqueia apelido de outro produto", () => {
      const result = resolveProductNameConflict({
        productId: "p1",
        productWithSameName: null,
        aliasOwner: { productId: "p2", alias: "MOSTARDA CEPERA", ownerName: "MOSTARDA GALAO", ownerExternalCode: "700" }
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("ALIAS_TAKEN");
      expect(result.message).toContain("MOSTARDA GALAO");
    });
  });

  it("nome duplicado tem precedencia sobre apelido tomado", () => {
    const result = resolveProductNameConflict({
      productId: null,
      productWithSameName: { id: "p1", name: "BATATA", externalCode: "301" },
      aliasOwner: { productId: "p2", alias: "BATATA", ownerName: "OUTRO", ownerExternalCode: "999" }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("DUPLICATE_NAME");
  });
});
