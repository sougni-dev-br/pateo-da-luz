import { describe, expect, test } from "vitest";
import { valoresMudaram } from "../payroll.routes.js";

const base = { bruto: 846.77, salario: 659.97, gorjeta: 186.8, vales: 20, vtDesconto: 0, outroDesconto: 0, liquido: 826.77 };

describe("ajuste da rescisão lançada", () => {
  test("os mesmos valores não contam como ajuste", () => {
    expect(valoresMudaram(base, { ...base })).toBe(false);
  });
  test("um centavo a mais em qualquer parte já é ajuste", () => {
    expect(valoresMudaram(base, { ...base, gorjeta: 186.81, bruto: 846.78, liquido: 826.78 })).toBe(true);
    expect(valoresMudaram(base, { ...base, vtDesconto: 10, liquido: 816.77 })).toBe(true);
  });
  test("lançada antes da separação (sem salário/gorjeta) e agora separada conta como mudança", () => {
    expect(valoresMudaram({ ...base, salario: null, gorjeta: null }, base)).toBe(true);
  });
});
