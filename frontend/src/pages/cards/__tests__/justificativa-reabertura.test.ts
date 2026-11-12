import { describe, expect, it } from "vitest";
import { ajudaDaJustificativa, justificativaValida } from "../justificativa-reabertura";

describe("justificativa da reabertura", () => {
  it("recusa vazio, só espaços e texto curto", () => {
    expect(justificativaValida("")).toBe(false);
    expect(justificativaValida("          ")).toBe(false);
    expect(justificativaValida("erro")).toBe(false);
  });
  it("aceita um motivo de verdade, ignorando espaços nas pontas", () => {
    expect(justificativaValida("Valor da compra divergente do banco")).toBe(true);
    expect(justificativaValida("  abcdefghij  ")).toBe(true);
  });
  it("recusa texto acima de 500 caracteres", () => {
    expect(justificativaValida("a".repeat(501))).toBe(false);
    expect(justificativaValida("a".repeat(500))).toBe(true);
  });
  it("a ajuda diz quantos caracteres faltam e some quando basta", () => {
    expect(ajudaDaJustificativa("abc")).toContain("7");
    expect(ajudaDaJustificativa("abcdefghij")).toBe("");
  });
});
