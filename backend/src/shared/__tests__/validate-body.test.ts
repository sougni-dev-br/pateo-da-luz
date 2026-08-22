import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstValidationMessage } from "../validate-body.js";

const schema = z.object({
  name: z.string().trim().min(1, "descricao obrigatoria"),
  categoryId: z.string().trim().min(1, "categoria obrigatoria"),
  quantity: z.coerce.number().positive("informe uma quantidade maior que zero"),
  isActive: z.boolean().optional()
});

describe("firstValidationMessage", () => {
  it("aponta o campo e o motivo, em vez de um dump do schema", () => {
    const result = schema.safeParse({ name: "", categoryId: "abc", quantity: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = firstValidationMessage(result.error);
    expect(message).toContain("name");
    expect(message).toContain("descricao obrigatoria");
  });

  it("usa o primeiro erro quando ha varios", () => {
    const result = schema.safeParse({ name: "", categoryId: "", quantity: -1 });
    if (result.success) return;
    expect(firstValidationMessage(result.error)).toContain("name");
  });

  it("reporta campo ausente de forma util", () => {
    const result = schema.safeParse({ name: "Batata" });
    if (result.success) return;
    const message = firstValidationMessage(result.error);
    expect(message).toContain("categoryId");
  });

  it("reporta erro de campo aninhado com o caminho completo", () => {
    const aninhado = z.object({ items: z.array(z.object({ productId: z.string().min(1, "produto obrigatorio") })) });
    const result = aninhado.safeParse({ items: [{ productId: "ok" }, { productId: "" }] });
    if (result.success) return;
    expect(firstValidationMessage(result.error)).toContain("items.1.productId");
  });

  it("sempre devolve texto, mesmo sem detalhe util", () => {
    const result = z.string().safeParse(42);
    if (result.success) return;
    expect(firstValidationMessage(result.error).length).toBeGreaterThan(0);
  });
});
