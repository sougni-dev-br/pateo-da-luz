import { describe, expect, test } from "vitest";
import { formatarQuantidade, previaDaConversao, unidadesDoLancamento } from "../quantidade";

// ARROZ BRANCO T1 CAMIL PACOTE 5KG, estocado em UN: o peso vem do nome (1 UN = 5 KG).
const arroz = [
  { fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true },
  { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true },
];

describe("unidadesDoLancamento", () => {
  test("a do estoque vem primeiro e depois as que convertem", () => {
    expect(unidadesDoLancamento("UN", arroz)).toEqual(["UN", "KG", "G"]);
  });

  test("sem peso nem volume cadastrado só a do estoque", () => {
    expect(unidadesDoLancamento("UN", [])).toEqual(["UN"]);
  });

  test("estoque em kg oferece g por física, sem cadastro", () => {
    expect(unidadesDoLancamento("KG", [])).toEqual(["KG", "G"]);
    expect(unidadesDoLancamento("L", [])).toEqual(["L", "ML"]);
  });

  test("sem unidade do estoque não oferece nada", () => {
    expect(unidadesDoLancamento(null, arroz)).toEqual([]);
  });
});

describe("previaDaConversao", () => {
  test("mostra a conta: 500 G = 0,1 UN", () => {
    expect(previaDaConversao({ quantidade: "500", unidade: "G", unidadeDoEstoque: "UN", conversoes: arroz }))
      .toEqual({ tipo: "CONVERTE", texto: "500 G = 0,1 UN" });
  });

  test("aceita vírgula e mostra casas pequenas sem virar zero", () => {
    expect(previaDaConversao({ quantidade: "1,5", unidade: "G", unidadeDoEstoque: "UN", conversoes: arroz }))
      .toEqual({ tipo: "CONVERTE", texto: "1,5 G = 0,0003 UN" });
  });

  test("na unidade do estoque não há conta a mostrar", () => {
    expect(previaDaConversao({ quantidade: "2", unidade: "UN", unidadeDoEstoque: "UN", conversoes: arroz })).toBeNull();
  });

  test("quantidade ainda vazia ou inválida não mostra conta", () => {
    expect(previaDaConversao({ quantidade: "", unidade: "G", unidadeDoEstoque: "UN", conversoes: arroz })).toBeNull();
    expect(previaDaConversao({ quantidade: "abc", unidade: "G", unidadeDoEstoque: "UN", conversoes: arroz })).toBeNull();
  });

  test("item que só aceita a unidade do estoque avisa como mudar isso", () => {
    const r = previaDaConversao({ quantidade: "", unidade: "UN", unidadeDoEstoque: "UN", conversoes: [] });
    expect(r?.tipo).toBe("SO_ESTOQUE");
    expect(r?.texto).toMatch(/só aceita UN/);
    expect(r?.texto).toMatch(/ficha técnica/);
  });

  test("estoque em kg não precisa do aviso (já aceita g)", () => {
    expect(previaDaConversao({ quantidade: "", unidade: "KG", unidadeDoEstoque: "KG", conversoes: [] })).toBeNull();
  });
});

describe("formatarQuantidade", () => {
  test("até 6 casas em pt-BR", () => {
    expect(formatarQuantidade(0.00004)).toBe("0,00004");
    expect(formatarQuantidade(1234.5)).toBe("1.234,5");
    expect(formatarQuantidade(0.1)).toBe("0,1");
  });
});
