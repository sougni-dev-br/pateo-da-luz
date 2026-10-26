import { describe, expect, test } from "vitest";
import { lerExigencia } from "../exigencia-input.js";

describe("lerExigencia", () => {
  test("aceita nome e produto, sem espaços nas pontas", () => {
    expect(lerExigencia({ label: "  Condomínio do mês ", productId: " t1 " })).toEqual({
      ok: true,
      valor: { label: "Condomínio do mês", productId: "t1" }
    });
  });

  test("nome é obrigatório", () => {
    const r = lerExigencia({ label: "   ", productId: "t1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/nome/i);
  });

  test("produto é obrigatório", () => {
    const r = lerExigencia({ label: "Acordo", productId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/produto/i);
  });

  test("nome longo demais é recusado", () => {
    expect(lerExigencia({ label: "x".repeat(81), productId: "t1" }).ok).toBe(false);
    expect(lerExigencia({ label: "x".repeat(80), productId: "t1" }).ok).toBe(true);
  });

  test("corpo vazio, nulo ou de tipo errado não quebra", () => {
    expect(lerExigencia(undefined).ok).toBe(false);
    expect(lerExigencia(null).ok).toBe(false);
    expect(lerExigencia("texto").ok).toBe(false);
    expect(lerExigencia({ label: 5, productId: {} }).ok).toBe(false);
  });

  test("modo parcial (PATCH): só valida o que veio", () => {
    expect(lerExigencia({ label: "Novo nome" }, { parcial: true })).toEqual({ ok: true, valor: { label: "Novo nome" } });
    expect(lerExigencia({ productId: "t2" }, { parcial: true })).toEqual({ ok: true, valor: { productId: "t2" } });
    expect(lerExigencia({}, { parcial: true }).ok).toBe(false);
    expect(lerExigencia({ label: "" }, { parcial: true }).ok).toBe(false);
  });
});
