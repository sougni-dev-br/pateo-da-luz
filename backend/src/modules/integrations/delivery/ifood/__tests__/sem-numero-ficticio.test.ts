import { describe, expect, test } from "vitest";
import { resumoSemDados, somarResumos } from "../ifood-sem-dados.js";
import type { IfoodPeriodSummary } from "../ifood.types.js";

function resumo(rotulo: string, bruto: number, pedidos: number, semDados: boolean): IfoodPeriodSummary {
  return {
    period: { year: 2026, month: 9 },
    storeId: rotulo,
    storeLabel: rotulo,
    totals: {
      orders: pedidos,
      grossAmount: bruto,
      ifoodFeeAmount: 0,
      promotionAmount: 0,
      deliveryFeeAmount: 0,
      netAmount: bruto,
      otherFees: 0
    },
    daily: [],
    fees: [],
    settlements: [],
    isMock: semDados
  };
}

describe("loja sem venda devolve ZERO, nunca numero inventado", () => {
  // O que a tela mostrava em 18/09/2026 para setembro: R$ 425.119 e 6.138
  // pedidos de iFood, com TODAS as tabelas do iFood vazias — zero credencial,
  // zero venda, zero repasse, e as 4 lojas ainda em PENDENTE-*. Cem por cento
  // inventado, e o aviso ficava em letra pequena ao lado dos cartoes.
  test("todos os totais sao zero", () => {
    const r = resumoSemDados("loja-1", "Pateo da Luz", 2026, 9);
    expect(r.totals.grossAmount).toBe(0);
    expect(r.totals.orders).toBe(0);
    expect(r.totals.ifoodFeeAmount).toBe(0);
    expect(r.totals.promotionAmount).toBe(0);
    expect(r.totals.deliveryFeeAmount).toBe(0);
    expect(r.totals.netAmount).toBe(0);
    expect(r.totals.otherFees).toBe(0);
  });

  test("nao inventa serie diaria, taxa nem repasse", () => {
    const r = resumoSemDados("loja-1", "Pateo da Luz", 2026, 9);
    expect(r.daily).toEqual([]);
    expect(r.fees).toEqual([]);
    expect(r.settlements).toEqual([]);
  });

  test("fica marcado como sem dados, para a tela poder avisar", () => {
    expect(resumoSemDados("loja-1", "Pateo da Luz", 2026, 9).isMock).toBe(true);
  });

  test("preserva loja e periodo pedidos", () => {
    const r = resumoSemDados("loja-7", "Peposo", 2026, 4);
    expect(r.storeId).toBe("loja-7");
    expect(r.storeLabel).toBe("Peposo");
    expect(r.period).toEqual({ year: 2026, month: 4 });
  });
});

describe("consolidado do iFood nao mistura sem-dados com real", () => {
  test("loja sem dados nao contamina a soma", () => {
    const r = somarResumos([resumo("a", 1000, 10, false), resumo("b", 0, 0, true)], 2026, 9);
    expect(r.totals.grossAmount).toBe(1000);
    expect(r.totals.orders).toBe(10);
    expect(r.isMock).toBe(false);
  });

  test("todas sem dados -> zero e marcado", () => {
    const r = somarResumos([resumo("a", 0, 0, true), resumo("b", 0, 0, true)], 2026, 9);
    expect(r.totals.grossAmount).toBe(0);
    expect(r.isMock).toBe(true);
  });

  test("nenhuma loja -> zero e marcado", () => {
    const r = somarResumos([], 2026, 9);
    expect(r.totals.grossAmount).toBe(0);
    expect(r.isMock).toBe(true);
  });

  test("varias lojas reais somam", () => {
    const r = somarResumos([resumo("a", 10, 1, false), resumo("b", 25, 3, false)], 2026, 9);
    expect(r.totals.grossAmount).toBe(35);
    expect(r.totals.orders).toBe(4);
  });
});
