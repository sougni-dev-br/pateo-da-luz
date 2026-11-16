import { describe, expect, test } from "vitest";
import { combinadoAposReajuste, comCombinadoAcompanhando } from "../cadastro-historico.js";

// Valores FICTÍCIOS: o repositório é público.
describe("combinadoAposReajuste", () => {
  test("base sobe: o combinado sobe o mesmo valor e a diferença se mantém", () => {
    const novo = combinadoAposReajuste(3000, 3150.5, 4500)!;
    expect(novo).toBe(4650.5);
    expect(novo - 3150.5).toBe(4500 - 3000);
  });
  test("aceita Decimal/texto do banco", () => {
    expect(combinadoAposReajuste("3000.00", "3100.00", "4500.00")).toBe(4600);
  });
  test("sem combinado, sem base ou base igual: nada a ajustar", () => {
    expect(combinadoAposReajuste(3000, 3100, null)).toBeNull();
    expect(combinadoAposReajuste(null, 3100, 4500)).toBeNull();
    expect(combinadoAposReajuste(3000, null, 4500)).toBeNull();
    expect(combinadoAposReajuste(3000, 3000, 4500)).toBeNull();
  });
  test("base reduzida também acompanha", () => {
    expect(combinadoAposReajuste(3100, 3000, 4600)).toBe(4500);
  });
  test("valores inválidos não ajustam", () => {
    expect(combinadoAposReajuste(Number.NaN, 3100, 4500)).toBeNull();
    expect(combinadoAposReajuste(3000, "abc", 4500)).toBeNull();
    expect(combinadoAposReajuste(3000, 3100, "")).toBeNull();
  });
  test("conta em centavos, sem ruído de ponto flutuante", () => {
    expect(combinadoAposReajuste(0.1, 0.3, 0.2)).toBe(0.4);
  });
});

describe("comCombinadoAcompanhando", () => {
  const antes = { baseSalary: 3000, salarioCombinado: 4500, salarioCombinadoMotivo: "Acordo" };
  test("ajusta e anota o motivo", () => {
    expect(comCombinadoAcompanhando(antes, { baseSalary: 3100 })).toEqual({
      dados: { baseSalary: 3100, salarioCombinado: 4600, salarioCombinadoMotivo: "Acordo · Acompanhou o reajuste do salário base (+R$ 100,00)" },
    });
  });
  test("diferença de meio centavo digitada na tela não suprime o ajuste", () => {
    const r = comCombinadoAcompanhando(antes, { baseSalary: 3100, salarioCombinado: 4500.004 }) as { dados: { salarioCombinado: number } };
    expect(r.dados.salarioCombinado).toBe(4600);
  });
  test("motivo nunca passa de 300 caracteres", () => {
    const r = comCombinadoAcompanhando({ ...antes, salarioCombinadoMotivo: "x".repeat(300) }, { baseSalary: 3100 }) as { dados: { salarioCombinadoMotivo: string } };
    expect(r.dados.salarioCombinadoMotivo.length).toBeLessThanOrEqual(300);
    expect(r.dados.salarioCombinadoMotivo).toContain("Acompanhou");
  });
  test("resultado fora de (0, 100000] é erro", () => {
    expect("erro" in comCombinadoAcompanhando({ ...antes, salarioCombinado: 99000 }, { baseSalary: 9000 })).toBe(true);
    expect("erro" in comCombinadoAcompanhando({ baseSalary: 3000, salarioCombinado: 100 }, { baseSalary: 1000 })).toBe(true);
  });
  test("sem combinado: devolve os dados como vieram", () => {
    const dados = { baseSalary: 3100 };
    expect(comCombinadoAcompanhando({ baseSalary: 3000, salarioCombinado: null }, dados)).toEqual({ dados });
  });
});
