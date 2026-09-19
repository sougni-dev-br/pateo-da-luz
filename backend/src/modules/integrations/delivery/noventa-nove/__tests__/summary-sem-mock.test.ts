import { describe, expect, test } from "vitest";
import { consolidateSummaries } from "../noventa-nove-mock.service.js";
import type { NoventaNovePeriodSummary } from "../noventa-nove.types.js";

function resumo(rotulo: string, bruto: number, pedidos: number, isMock: boolean): NoventaNovePeriodSummary {
  return {
    period: { year: 2026, month: 6 },
    storeId: rotulo,
    storeLabel: rotulo,
    totals: {
      orders: pedidos,
      grossAmount: bruto,
      noventaNoveFeeAmount: 0,
      promotionAmount: 0,
      deliveryFeeAmount: 0,
      netAmount: bruto,
      otherFees: 0
    },
    daily: [{ date: "2026-06-01", orders: pedidos, grossAmount: bruto, noventaNoveFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: bruto }],
    fees: [],
    settlements: [],
    isMock
  };
}

describe("consolidado nao mistura numero inventado com numero real", () => {
  // Caso REAL (auditoria de 18/09/2026): a loja PEPOSO-FREI-CANECA esta ativa,
  // nunca vendeu — o CNPJ novo nao foi liberado pela 99 — e por isso caia no
  // mock TODO mes. O consolidado somava: junho mostrava 2.250 pedidos e
  // R$ 108.930,59 quando o real era 1.400 e R$ 63.353,14. R$ 400.764,05
  // inventados entre abril e setembro.
  test("loja em mock nao entra na soma quando ha loja real", () => {
    const r = consolidateSummaries(
      [resumo("real-a", 63_353.14, 1400, false), resumo("mock-peposo", 45_577.45, 850, true)],
      2026,
      6
    );
    expect(r.totals.grossAmount).toBe(63_353.14);
    expect(r.totals.orders).toBe(1400);
  });

  test("o dia tambem fica limpo — o mock nao entra na serie diaria", () => {
    const r = consolidateSummaries(
      [resumo("real-a", 100, 2, false), resumo("mock-b", 900, 30, true)],
      2026,
      6
    );
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0].grossAmount).toBe(100);
  });

  test("varias lojas reais somam normalmente", () => {
    const r = consolidateSummaries(
      [resumo("a", 10, 1, false), resumo("b", 25, 3, false)],
      2026,
      6
    );
    expect(r.totals.grossAmount).toBe(35);
    expect(r.totals.orders).toBe(4);
  });
});

describe("isMock do consolidado descreve o que ele contem", () => {
  // Antes era `isMock: true` FIXO. O aviso "Dados de demonstracao — numeros
  // ficticios" aparecia sempre na visao consolidada, inclusive com dados 100%
  // reais, o que ensina o usuario a ignorar o unico aviso que existe.
  test("so real -> false", () => {
    expect(consolidateSummaries([resumo("a", 10, 1, false)], 2026, 6).isMock).toBe(false);
  });

  test("real + mock -> false, porque o mock foi descartado", () => {
    expect(consolidateSummaries([resumo("a", 10, 1, false), resumo("b", 90, 9, true)], 2026, 6).isMock).toBe(false);
  });

  test("so mock -> true", () => {
    expect(consolidateSummaries([resumo("a", 10, 1, true)], 2026, 6).isMock).toBe(true);
  });

  test("nenhuma loja -> true (nao ha o que mostrar)", () => {
    expect(consolidateSummaries([], 2026, 6).isMock).toBe(true);
  });
});
