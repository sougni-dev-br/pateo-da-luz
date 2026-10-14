import { describe, expect, test } from "vitest";
import { formatarQuantidade, medidasDaMesmaGrandeza, opcoesDoLancamento, precisaInformar, previaDaConversao, unidadesDoLancamento } from "../quantidade";

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

  test("estoque em kg não tem conta a mostrar na própria unidade", () => {
    expect(previaDaConversao({ quantidade: "", unidade: "KG", unidadeDoEstoque: "KG", conversoes: [] })).toBeNull();
  });

  test("com o peso de 1 unidade informado na hora, a conta usa ele: 300 g de um item de 2 kg = 0,15 UN", () => {
    expect(previaDaConversao({ quantidade: "300", unidade: "G", unidadeDoEstoque: "UN", conversoes: [], pesoPorUnidade: { quantidade: "2", unidade: "KG" } }))
      .toEqual({ tipo: "CONVERTE", texto: "300 G = 0,15 UN" });
  });

  test("peso vazio, zero ou de outra grandeza não gera conta", () => {
    const base = { quantidade: "300", unidade: "G", unidadeDoEstoque: "UN", conversoes: [] };
    expect(previaDaConversao({ ...base, pesoPorUnidade: { quantidade: "", unidade: "KG" } })).toBeNull();
    expect(previaDaConversao({ ...base, pesoPorUnidade: { quantidade: "0", unidade: "KG" } })).toBeNull();
    expect(previaDaConversao({ ...base, pesoPorUnidade: { quantidade: "2", unidade: "L" } })).toBeNull();
  });

  test("o que já está cadastrado vale mais que o peso informado", () => {
    expect(previaDaConversao({ quantidade: "500", unidade: "G", unidadeDoEstoque: "UN", conversoes: arroz, pesoPorUnidade: { quantidade: "1", unidade: "G" } }))
      .toEqual({ tipo: "CONVERTE", texto: "500 G = 0,1 UN" });
  });
});

describe("formatarQuantidade", () => {
  test("até 6 casas em pt-BR", () => {
    expect(formatarQuantidade(0.00004)).toBe("0,00004");
    expect(formatarQuantidade(1234.5)).toBe("1.234,5");
    expect(formatarQuantidade(0.1)).toBe("0,1");
  });
});

describe("opcoesDoLancamento: g, kg, ml, l sempre à vista (as que não convertem pedem o peso)", () => {
  test("item em UN com peso conhecido: as que convertem e ml/l para informar", () => {
    expect(opcoesDoLancamento("UN", arroz)).toEqual([
      { value: "UN", label: "UN", informar: false },
      { value: "KG", label: "KG", informar: false },
      { value: "G", label: "G", informar: false },
      { value: "ML", label: "ML (informar)", informar: true },
      { value: "L", label: "L (informar)", informar: true },
    ]);
  });

  test("item em UN sem peso nem volume: só a própria unidade converte, as quatro medidas pedem o peso", () => {
    expect(opcoesDoLancamento("UN", []).map((o) => [o.value, o.informar])).toEqual([["UN", false], ["G", true], ["KG", true], ["ML", true], ["L", true]]);
  });

  test("embalagem (PCT, CX, MÇ) também aceita informar", () => {
    expect(opcoesDoLancamento("CX", []).filter((o) => o.informar).map((o) => o.value)).toEqual(["G", "KG", "ML", "L"]);
  });

  test("estoque em kg ou litro não ganha opções para informar (já é massa/volume)", () => {
    expect(opcoesDoLancamento("KG", []).map((o) => o.value)).toEqual(["KG", "G"]);
    expect(opcoesDoLancamento("L", []).map((o) => o.value)).toEqual(["L", "ML"]);
  });

  test("sem unidade do estoque não há o que oferecer", () => {
    expect(opcoesDoLancamento(null, [])).toEqual([]);
  });
});

describe("precisaInformar e medidasDaMesmaGrandeza", () => {
  test("só quem ainda não converte pede o peso", () => {
    expect(precisaInformar("G", "UN", [])).toBe(true);
    expect(precisaInformar("G", "UN", arroz)).toBe(false);
    expect(precisaInformar("UN", "UN", [])).toBe(false);
    expect(precisaInformar("G", "KG", [])).toBe(false);
  });

  test("o peso de 1 unidade se informa na mesma grandeza de quem se lança", () => {
    expect(medidasDaMesmaGrandeza("G")).toEqual(["G", "KG"]);
    expect(medidasDaMesmaGrandeza("kg")).toEqual(["G", "KG"]);
    expect(medidasDaMesmaGrandeza("ML")).toEqual(["ML", "L"]);
    expect(medidasDaMesmaGrandeza("l")).toEqual(["ML", "L"]);
  });
});
