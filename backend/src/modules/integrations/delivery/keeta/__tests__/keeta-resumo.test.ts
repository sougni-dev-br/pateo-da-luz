import { describe, expect, test } from "vitest";
import { mesAnterior, montarResumo, somarTotais, type KeetaDia } from "../keeta-resumo.js";

// Dias reais de agosto/2026 em producao (import do portal da Keeta).
const AGOSTO: KeetaDia[] = [
  { date: "2026-08-01", orders: 56, grossAmount: 3302.64, netAmount: 2515.99 },
  { date: "2026-08-02", orders: 48, grossAmount: 3103.5, netAmount: 2389.65 },
  { date: "2026-08-03", orders: 87, grossAmount: 5080.71, netAmount: 3880.5 }
];

describe("somarTotais", () => {
  test("deducao e a diferenca entre bruto e liquido, nao um campo a parte", () => {
    const t = somarTotais(AGOSTO);
    expect(t.grossAmount).toBeCloseTo(11_486.85, 2);
    expect(t.netAmount).toBeCloseTo(8_786.14, 2);
    expect(t.deductionAmount).toBeCloseTo(2_700.71, 2);
    expect(t.netAmount + t.deductionAmount).toBeCloseTo(t.grossAmount, 2);
  });

  test("percentuais fecham em 100", () => {
    const t = somarTotais(AGOSTO);
    expect(t.deductionPercent + t.netPercent).toBeCloseTo(100, 1);
  });

  test("ticket medio sobre o bruto", () => {
    const t = somarTotais(AGOSTO);
    expect(t.orders).toBe(191);
    expect(t.ticketAverage).toBeCloseTo(60.14, 2);
  });

  // Mes sem linha nenhuma e o caso de jun-set antes do import de 19/09: a tela
  // precisa poder dizer "sem dados" em vez de desenhar zeros como se fossem fato.
  test("mes vazio nao estoura e nao inventa percentual", () => {
    const t = somarTotais([]);
    expect(t).toMatchObject({ orders: 0, grossAmount: 0, netAmount: 0, deductionAmount: 0 });
    expect(t.ticketAverage).toBe(0);
    expect(t.deductionPercent).toBe(0);
  });
});

describe("mesAnterior", () => {
  test("volta um mes", () => {
    expect(mesAnterior(2026, 8)).toEqual({ year: 2026, month: 7 });
  });

  test("atravessa a virada do ano", () => {
    expect(mesAnterior(2026, 1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("montarResumo", () => {
  test("marca semDados quando o mes nao tem linha", () => {
    const r = montarResumo({ year: 2026, month: 3, dias: [], diasAnteriores: [] });
    expect(r.semDados).toBe(true);
  });

  // A Keeta so tem dado desde abril/2026. Comparar abril com marco cai em base
  // zero, e o painel do iFood chamava isso de +100% — ver painel-dono-calculo.
  test("sem mes anterior a comparacao nao e comparavel, e nao vira +100%", () => {
    const r = montarResumo({ year: 2026, month: 4, dias: AGOSTO, diasAnteriores: [] });
    expect(r.previousMonth.deltaGross.comparavel).toBe(false);
    expect(r.previousMonth.deltaGross.percentual).toBe(0);
  });

  test("com mes anterior, compara bruto, liquido e pedidos", () => {
    const anterior: KeetaDia[] = [{ date: "2026-07-01", orders: 100, grossAmount: 10_000, netAmount: 8_000 }];
    const atual: KeetaDia[] = [{ date: "2026-08-01", orders: 150, grossAmount: 12_000, netAmount: 9_000 }];
    const r = montarResumo({ year: 2026, month: 8, dias: atual, diasAnteriores: anterior });
    expect(r.previousMonth.deltaGross.percentual).toBeCloseTo(20, 2);
    expect(r.previousMonth.deltaNet.percentual).toBeCloseTo(12.5, 2);
    expect(r.previousMonth.deltaOrders.percentual).toBeCloseTo(50, 2);
    expect(r.previousMonth.month).toBe(7);
  });

  test("os dias saem ordenados, independente da ordem que chegaram", () => {
    const r = montarResumo({
      year: 2026, month: 8,
      dias: [AGOSTO[2], AGOSTO[0], AGOSTO[1]],
      diasAnteriores: []
    });
    expect(r.daily.map((d) => d.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });
});
