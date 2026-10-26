import { describe, expect, it } from "vitest";
import { validarFinais } from "../cadastro-do-cartao";

describe("validarFinais", () => {
  it("aceita um físico e vários virtuais", () => {
    const r = validarFinais([
      { label: "Físico", last4Digits: "1111", kind: "PHYSICAL" },
      { label: "Virtual loja", last4Digits: "2222", kind: "VIRTUAL" },
      { label: "Virtual app", last4Digits: "3333", kind: "VIRTUAL", isActive: false }
    ]);
    expect("erro" in r).toBe(false);
    if ("finais" in r) expect(r.finais).toHaveLength(3);
  });

  it("usa um nome padrão quando o apelido vem em branco", () => {
    const r = validarFinais([{ label: "  ", last4Digits: "1111", kind: "VIRTUAL" }]);
    if ("finais" in r) expect(r.finais[0].label).toBe("Cartão virtual");
    else throw new Error(r.erro);
  });

  it("recusa final que não tem 4 números", () => {
    expect(validarFinais([{ label: "x", last4Digits: "12a4", kind: "PHYSICAL" }])).toEqual({
      erro: "Os 4 últimos dígitos de cada cartão devem ser só números (4 dígitos)."
    });
  });

  it("recusa dois cartões com o mesmo final", () => {
    const r = validarFinais([
      { label: "a", last4Digits: "1111", kind: "PHYSICAL" },
      { label: "b", last4Digits: "1111", kind: "VIRTUAL" }
    ]);
    expect(r).toEqual({ erro: "Há dois cartões com o final 1111 nesta conta." });
  });

  it("recusa mais de um físico ativo", () => {
    const r = validarFinais([
      { label: "a", last4Digits: "1111", kind: "PHYSICAL" },
      { label: "b", last4Digits: "2222", kind: "PHYSICAL" }
    ]);
    expect(r).toEqual({ erro: "A conta só pode ter um cartão físico ativo; os demais devem ser virtuais." });
  });

  it("físico inativo não conta para o limite", () => {
    const r = validarFinais([
      { label: "velho", last4Digits: "1111", kind: "PHYSICAL", isActive: false },
      { label: "novo", last4Digits: "2222", kind: "PHYSICAL" }
    ]);
    expect("finais" in r).toBe(true);
  });

  it("recusa tipo desconhecido e lista inválida", () => {
    expect("erro" in validarFinais([{ label: "x", last4Digits: "1111", kind: "OUTRO" }])).toBe(true);
    expect("erro" in validarFinais("nada")).toBe(true);
  });
});
