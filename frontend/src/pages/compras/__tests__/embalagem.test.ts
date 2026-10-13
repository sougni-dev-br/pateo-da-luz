import { describe, expect, test } from "vitest";
import { avisoDePreco, previaDaConversao } from "../embalagem";

const forminha = { unit: "UN", stockUnit: "UN", unitConversions: [{ fromUnit: "PCT", toUnit: "UN", factor: "50", isActive: true }] };

describe("previaDaConversao", () => {
  test("pacote vira unidades de contagem", () => {
    expect(previaDaConversao(forminha, "PCT", 10)).toEqual({ tipo: "converte", quantidade: 500, unidade: "UN", fator: 50 });
    expect(previaDaConversao(forminha, "pcte", 2)).toEqual({ tipo: "converte", quantidade: 100, unidade: "UN", fator: 50 });
  });

  test("mesma unidade da contagem nao mostra nada", () => {
    expect(previaDaConversao(forminha, "UN", 10)).toBeNull();
    expect(previaDaConversao(forminha, "UNI", 10)).toBeNull();
  });

  test("embalagem sem cadastro avisa", () => {
    expect(previaDaConversao(forminha, "CX", 1)).toEqual({ tipo: "sem_conversao", unidade: "UN" });
  });

  test("usa a conversao inversa", () => {
    const queijo = { unit: "KG", unitConversions: [{ fromUnit: "KG", toUnit: "PCT", factor: 4 }] };
    expect(previaDaConversao(queijo, "PCT", 2)).toEqual({ tipo: "converte", quantidade: 0.5, unidade: "KG", fator: 0.25 });
  });
});

describe("avisoDePreco", () => {
  const normal = { precoNormal: 0.0704, unidade: "UN" };

  test("pacote lancado como UN avisa", () => {
    expect(avisoDePreco(forminha, "UN", 2.99, normal)).toEqual({ precoPorUnidade: 2.99, precoNormal: 0.0704, unidade: "UN" });
  });

  test("com PCT escolhido divide pelo fator e nao avisa", () => {
    expect(avisoDePreco(forminha, "PCT", 2.99, normal)).toBeNull();
  });

  test("preco normal ou sem historico nao avisa", () => {
    expect(avisoDePreco(forminha, "UN", 0.08, normal)).toBeNull();
    expect(avisoDePreco(forminha, "UN", 2.99, undefined)).toBeNull();
    expect(avisoDePreco(forminha, "UN", 2.99, { precoNormal: null, unidade: "UN" })).toBeNull();
  });

  test("embalagem sem conversao cadastrada nao avisa por preco (ja avisa a conversao)", () => {
    expect(avisoDePreco(forminha, "CX", 300, normal)).toBeNull();
  });
});
