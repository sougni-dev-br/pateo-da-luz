import { describe, expect, it } from "vitest";
import { caixaSchema, gastosSchema, novoCenarioSchema, ordenadas, premissasSchema, servicoSchema } from "../planejamento-cenario-schema.js";
import { caixaPadrao } from "../planejamento-caixa.js";
import { linhasPadrao } from "../planejamento-gastos.js";
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

describe("gastosSchema e servicoSchema", () => {
  const linha = (sobre: Record<string, unknown> = {}) => ({ grupo: "OCUPACAO", nome: "Ocupação", modo: "FIXO", valores: Array(12).fill(1000), ...sobre });

  it("aceita as linhas padrão", () => {
    expect(gastosSchema.safeParse(linhasPadrao()).success).toBe(true);
  });

  it("recusa grupo desconhecido, mês faltando, valor negativo e percentual acima de 100%", () => {
    expect(gastosSchema.safeParse([linha({ grupo: "XYZ" })]).success).toBe(false);
    expect(gastosSchema.safeParse([linha({ valores: [1, 2] })]).success).toBe(false);
    expect(gastosSchema.safeParse([linha({ valores: Array(12).fill(-1) })]).success).toBe(false);
    expect(gastosSchema.safeParse([linha({ modo: "PERCENTUAL", valores: Array(12).fill(1.5) })]).success).toBe(false);
    expect(gastosSchema.safeParse([linha({ modo: "PERCENTUAL", valores: Array(12).fill(0.05) })]).success).toBe(true);
  });

  it("recusa nome repetido (sem diferenciar maiúsculas) e mais de 40 linhas", () => {
    expect(gastosSchema.safeParse([linha(), linha({ nome: "OCUPAÇÃO".toLowerCase() })]).success).toBe(false);
    const muitas = Array.from({ length: 41 }, (_, i) => linha({ nome: `Linha ${i}` }));
    expect(gastosSchema.safeParse(muitas).success).toBe(false);
  });

  it("serviço vai de 0% a 100% ou vazio", () => {
    expect(servicoSchema.safeParse(null).success).toBe(true);
    expect(servicoSchema.safeParse(0.1).success).toBe(true);
    expect(servicoSchema.safeParse(1.2).success).toBe(false);
    expect(servicoSchema.safeParse(-0.1).success).toBe(false);
  });
});

describe("caixaSchema e % pago no mês", () => {
  it("aceita o padrão de caixa", () => {
    expect(caixaSchema.safeParse(caixaPadrao()).success).toBe(true);
  });

  it("recusa mix que não soma 100%, forma repetida, prazo fora da faixa e taxa alta", () => {
    const p = caixaPadrao();
    expect(caixaSchema.safeParse({ ...p, formas: p.formas.map((f, i) => (i === 0 ? { ...f, mix: 0.5 } : f)) }).success).toBe(false);
    expect(caixaSchema.safeParse({ ...p, formas: p.formas.map((f, i) => (i === 4 ? { ...f, forma: "PIX" } : f)) }).success).toBe(false);
    expect(caixaSchema.safeParse({ ...p, formas: p.formas.map((f, i) => (i === 0 ? { ...f, prazoDias: 120 } : f)) }).success).toBe(false);
    expect(caixaSchema.safeParse({ ...p, formas: p.formas.map((f, i) => (i === 0 ? { ...f, taxa: 0.5 } : f)) }).success).toBe(false);
    expect(caixaSchema.safeParse({ ...p, comprasPrazoDias: -1 }).success).toBe(false);
  });

  it("herdado exige jan, fev e mar e não aceita negativo", () => {
    const p = caixaPadrao();
    expect(caixaSchema.safeParse({ ...p, herdado: { entradas: [1, 2], saidas: [0, 0, 0] } }).success).toBe(false);
    expect(caixaSchema.safeParse({ ...p, herdado: { entradas: [-1, 0, 0], saidas: [0, 0, 0] } }).success).toBe(false);
  });

  it("linha de gasto sem % pago no mês assume 100%; fora de 0–100% é recusada", () => {
    const base = { grupo: "OCUPACAO", nome: "Ocupação", modo: "FIXO", valores: Array(12).fill(1) };
    const sem = gastosSchema.safeParse([base]);
    expect(sem.success && sem.data[0].pagoNoMes).toBe(1);
    expect(gastosSchema.safeParse([{ ...base, pagoNoMes: 1.2 }]).success).toBe(false);
    expect(gastosSchema.safeParse([{ ...base, pagoNoMes: -0.1 }]).success).toBe(false);
  });
});
