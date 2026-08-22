import { describe, expect, it } from "vitest";
import { calculateDishCost, resolveUnitFactor } from "../dish-cost.js";

describe("resolveUnitFactor", () => {
  it("mesma unidade nao converte nada", () => {
    expect(resolveUnitFactor("KG", "KG", [])).toBe(1);
    expect(resolveUnitFactor("kg", "KG", [])).toBe(1);
  });

  it("converte massa e volume sem depender de cadastro", () => {
    // Grama para quilo e fisica, nao cadastro: nao faz sentido exigir que
    // alguem cadastre essa conversao produto a produto.
    expect(resolveUnitFactor("G", "KG", [])).toBeCloseTo(0.001);
    expect(resolveUnitFactor("KG", "G", [])).toBe(1000);
    expect(resolveUnitFactor("ML", "L", [])).toBeCloseTo(0.001);
    expect(resolveUnitFactor("L", "ML", [])).toBe(1000);
  });

  it("usa a conversao cadastrada do produto", () => {
    const conversoes = [{ fromUnit: "CX", toUnit: "UN", factor: 12 }];
    expect(resolveUnitFactor("CX", "UN", conversoes)).toBe(12);
  });

  it("aceita a conversao cadastrada no sentido inverso", () => {
    const conversoes = [{ fromUnit: "CX", toUnit: "UN", factor: 12 }];
    expect(resolveUnitFactor("UN", "CX", conversoes)).toBeCloseTo(1 / 12);
  });

  it("a conversao do produto tem precedencia sobre a universal", () => {
    // Um produto pode ter peso de embalagem proprio: "1 PCT = 0,7 KG".
    const conversoes = [{ fromUnit: "PCT", toUnit: "KG", factor: 0.7 }];
    expect(resolveUnitFactor("PCT", "KG", conversoes)).toBe(0.7);
  });

  it("devolve null quando nao ha como converter", () => {
    // FICHA-08: sem isso o custo saia calculado errado em silencio.
    expect(resolveUnitFactor("CX", "KG", [])).toBeNull();
    expect(resolveUnitFactor("KG", "ML", [])).toBeNull();
    expect(resolveUnitFactor("", "KG", [])).toBeNull();
  });
});

describe("calculateDishCost", () => {
  const produtoKg = { unit: "KG", averageCost: 20, conversions: [] };

  it("converte a unidade do ingrediente antes de multiplicar", () => {
    // 200 G de um produto que custa R$ 20/KG = R$ 4,00.
    // A versao anterior fazia 200 * 20 = R$ 4.000,00.
    const resultado = calculateDishCost({
      yieldQty: 1,
      salePrice: null,
      items: [{ quantity: 200, unit: "G", wasteFactor: 0, product: produtoKg }]
    });

    expect(resultado.items[0].itemCost).toBeCloseTo(4);
    expect(resultado.totalCost).toBeCloseTo(4);
    expect(resultado.hasUnresolvedUnit).toBe(false);
  });

  it("aplica o fator de perda sobre a quantidade convertida", () => {
    const resultado = calculateDishCost({
      yieldQty: 1,
      salePrice: null,
      items: [{ quantity: 500, unit: "G", wasteFactor: 0.1, product: produtoKg }]
    });
    expect(resultado.totalCost).toBeCloseTo(11);
  });

  it("divide o custo pelo rendimento para achar o custo por porcao", () => {
    // Receita de 10 porcoes: o preco de venda e por porcao, entao comparar
    // com o custo do rendimento inteiro dava margem negativa falsa.
    const resultado = calculateDishCost({
      yieldQty: 10,
      salePrice: 8,
      items: [{ quantity: 2, unit: "KG", wasteFactor: 0, product: produtoKg }]
    });

    expect(resultado.totalCost).toBeCloseTo(40);
    expect(resultado.costPerServing).toBeCloseTo(4);
    expect(resultado.margemBruta).toBeCloseTo(4);
    expect(resultado.cmvPercentual).toBeCloseTo(50);
  });

  it("rendimento invalido nao divide por zero", () => {
    const resultado = calculateDishCost({
      yieldQty: 0,
      salePrice: 10,
      items: [{ quantity: 1, unit: "KG", wasteFactor: 0, product: produtoKg }]
    });
    expect(resultado.costPerServing).toBeCloseTo(20);
  });

  it("marca o item que nao converte, sem inventar custo", () => {
    const resultado = calculateDishCost({
      yieldQty: 1,
      salePrice: null,
      items: [
        { quantity: 1, unit: "KG", wasteFactor: 0, product: produtoKg },
        { quantity: 3, unit: "CX", wasteFactor: 0, product: produtoKg }
      ]
    });

    expect(resultado.items[0].itemCost).toBeCloseTo(20);
    expect(resultado.items[1].itemCost).toBeNull();
    expect(resultado.items[1].issue).toContain("CX");
    expect(resultado.hasUnresolvedUnit).toBe(true);
    // O total soma so o que da para calcular, e o sinalizador avisa que esta
    // incompleto — melhor um numero honestamente parcial que um errado.
    expect(resultado.totalCost).toBeCloseTo(20);
  });

  it("produto sem custo medio nao vira custo zero silencioso", () => {
    const resultado = calculateDishCost({
      yieldQty: 1,
      salePrice: null,
      items: [{ quantity: 1, unit: "KG", wasteFactor: 0, product: { unit: "KG", averageCost: null, conversions: [] } }]
    });

    expect(resultado.items[0].itemCost).toBeNull();
    expect(resultado.items[0].issue).toMatch(/custo/i);
    expect(resultado.hasMissingCost).toBe(true);
  });

  it("ficha sem itens tem custo zero e nenhuma margem", () => {
    const resultado = calculateDishCost({ yieldQty: 1, salePrice: 10, items: [] });
    expect(resultado.totalCost).toBe(0);
    expect(resultado.cmvPercentual).toBe(0);
  });

  it("sem preco de venda nao calcula margem", () => {
    const resultado = calculateDishCost({
      yieldQty: 1,
      salePrice: null,
      items: [{ quantity: 1, unit: "KG", wasteFactor: 0, product: produtoKg }]
    });
    expect(resultado.margemBruta).toBeNull();
    expect(resultado.cmvPercentual).toBeNull();
  });
});
