import { describe, expect, test } from "vitest";
import { previaDaConversao } from "../embalagem";

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
