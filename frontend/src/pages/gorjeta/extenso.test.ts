import { describe, expect, test } from "vitest";
import { valorPorExtenso } from "./extenso";

describe("valor por extenso", () => {
  test.each([
    [150, "cento e cinquenta reais"],
    [100, "cem reais"],
    [101, "cento e um reais"],
    [1, "um real"],
    [0.5, "cinquenta centavos"],
    [0.01, "um centavo"],
    [21.01, "vinte e um reais e um centavo"],
    [370.93, "trezentos e setenta reais e noventa e três centavos"],
    [1200, "mil e duzentos reais"],
    [1050, "mil e cinquenta reais"],
    [1234.56, "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"],
    [2594.17, "dois mil quinhentos e noventa e quatro reais e dezessete centavos"],
    [15000, "quinze mil reais"],
    [2_000_000, "dois milhões de reais"],
    [1_000_001, "um milhão e um reais"],
  ])("%s → %s", (valor, esperado) => {
    expect(valorPorExtenso(valor)).toBe(esperado);
  });
});
