import { describe, expect, it } from "vitest";
import { novoCenarioSchema, ordenadas, premissasSchema } from "../planejamento-cenario-schema.js";
import { premissasNeutras } from "../planejamento-projecao.js";

describe("premissasSchema", () => {
  it("aceita os 12 meses neutros", () => {
    expect(premissasSchema.safeParse(premissasNeutras()).success).toBe(true);
  });

  it("recusa lista incompleta, mês repetido e valores fora da faixa", () => {
    expect(premissasSchema.safeParse(premissasNeutras().slice(0, 11)).success).toBe(false);
    const repetido = premissasNeutras().map((p, i) => (i === 11 ? { ...p, mes: 1 } : p));
    expect(premissasSchema.safeParse(repetido).success).toBe(false);
    const queda = premissasNeutras().map((p, i) => (i === 0 ? { ...p, clientesAlmoco: -0.95 } : p));
    expect(premissasSchema.safeParse(queda).success).toBe(false);
    const cmv = premissasNeutras().map((p, i) => (i === 0 ? { ...p, cmv: 1.2 } : p));
    expect(premissasSchema.safeParse(cmv).success).toBe(false);
  });

  it("recusa número que não é número (NaN, texto)", () => {
    const texto = premissasNeutras().map((p, i) => (i === 0 ? { ...p, ticketJantar: "5%" } : p));
    expect(premissasSchema.safeParse(texto).success).toBe(false);
    const nan = premissasNeutras().map((p, i) => (i === 0 ? { ...p, ticketJantar: Number.NaN } : p));
    expect(premissasSchema.safeParse(nan).success).toBe(false);
  });
});

describe("novoCenarioSchema", () => {
  it("exige ano-base anterior ao ano projetado e nome", () => {
    expect(novoCenarioSchema.safeParse({ ano: 2027, anoBase: 2026, nome: "Base" }).success).toBe(true);
    expect(novoCenarioSchema.safeParse({ ano: 2027, anoBase: 2027, nome: "Base" }).success).toBe(false);
    expect(novoCenarioSchema.safeParse({ ano: 2027, anoBase: 2026, nome: "   " }).success).toBe(false);
  });
});

describe("ordenadas", () => {
  it("põe os meses em ordem sem alterar a lista original", () => {
    const embaralhada = [...premissasNeutras()].reverse();
    expect(ordenadas(embaralhada).map((p) => p.mes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(embaralhada[0].mes).toBe(12);
  });
});
