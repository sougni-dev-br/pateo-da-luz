import { describe, expect, test } from "vitest";
import { montarFaturamento, sobraNaoExplicada } from "../faturamento-do-mes.js";

// Numeros reais de junho/2026 em producao, lidos do razao em 18/09/2026.
const JUNHO = {
  total: { grossAmount: 299_030.58, netAmount: 272_344.13 },
  parcelas: [
    { rotulo: "Salão", grossAmount: 235_677.44, netAmount: 214_823.77, tickets: 1115 },
    { rotulo: "99 Food", grossAmount: 63_353.14, netAmount: 57_520.36, tickets: 1400 }
  ]
};

describe("o total do mes vem do razao, nao da soma das partes", () => {
  test("junho/2026 fecha nos R$ 299.030,58 do razao", () => {
    const f = montarFaturamento(JUNHO.total, JUNHO.parcelas);
    expect(f.total.grossAmount).toBe(299_030.58);
  });

  // A regressao que motivou tudo: somar `salon` (que ja continha o delivery)
  // com `noventaNove` dava R$ 362.383,72 na tela.
  test("o total NAO e a soma de um salao que ja contem delivery mais o delivery de novo", () => {
    const salaoContaminado = 299_030.58; // o que o SELECT sem filtro devolvia
    const noventaNove = 63_353.14;
    const totalErrado = salaoContaminado + noventaNove;
    expect(totalErrado).toBeCloseTo(362_383.72, 2);

    const f = montarFaturamento(JUNHO.total, JUNHO.parcelas);
    expect(f.total.grossAmount).not.toBeCloseTo(totalErrado, 2);
    expect(totalErrado - f.total.grossAmount).toBeCloseTo(63_353.14, 2);
  });

  test("as parcelas explicam o total inteiro", () => {
    expect(sobraNaoExplicada(montarFaturamento(JUNHO.total, JUNHO.parcelas))).toBe(0);
  });

  test("origem esquecida na consulta aparece como sobra, em vez de sumir em silencio", () => {
    const semA99 = montarFaturamento(JUNHO.total, [JUNHO.parcelas[0]]);
    expect(sobraNaoExplicada(semA99)).toBe(63_353.14);
  });

  test("mes sem faturamento nenhum nao quebra", () => {
    const f = montarFaturamento({ grossAmount: 0, netAmount: 0 }, []);
    expect(f.total.grossAmount).toBe(0);
    expect(sobraNaoExplicada(f)).toBe(0);
  });

  test("arredonda a 2 casas — Decimal do Postgres chega com cauda", () => {
    const f = montarFaturamento({ grossAmount: 10.005, netAmount: 9.994 }, [
      { rotulo: "x", grossAmount: 10.004_9, netAmount: 9.994, tickets: 1 }
    ]);
    expect(f.total.grossAmount).toBe(10.01);
    expect(f.parcelas[0].grossAmount).toBe(10);
  });
});
