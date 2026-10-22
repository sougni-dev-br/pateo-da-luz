import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { IfoodPeriodSummary } from "../ifood.types.js";
import { dadosSaoMensais, montarProjecao, podeAlertarQueda, semanaSemDados } from "../ifood-insights-regras.js";

const lerResumoDaLoja = vi.fn();

vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    deliveryStore: {
      findMany: vi.fn(async () => [{ id: "loja-a", nickname: "Loja A" }])
    }
  }
}));
vi.mock("../ifood.service.js", () => ({ lerResumoDaLoja: (...args: unknown[]) => lerResumoDaLoja(...args) }));

import { getPainelDonoInsights } from "../ifood-insights.service.js";

function resumo(ano: number, mes: number, liquido: number, extra: Partial<IfoodPeriodSummary> = {}): IfoodPeriodSummary {
  return {
    period: { year: ano, month: mes },
    storeId: "loja-a",
    storeLabel: "Loja A",
    totals: { orders: 10, grossAmount: liquido * 2, ifoodFeeAmount: liquido, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: liquido, otherFees: 0 },
    daily: [{ date: `${ano}-${String(mes).padStart(2, "0")}-28`, orders: 10, grossAmount: liquido * 2, ifoodFeeAmount: liquido, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: liquido }],
    fees: [],
    settlements: [],
    isMock: false,
    ...extra
  };
}

// Setembro cheio (1.000) e outubro parcial (100): queda de 90% que é só artefato.
function configurar(granularidade?: "mensal") {
  lerResumoDaLoja.mockImplementation(async (_id: string, _nome: string, ano: number, mes: number) => {
    if (ano === 2026 && mes === 10) return resumo(2026, 10, 100, { granularidade });
    if (ano === 2026 && mes === 9) return resumo(2026, 9, 1000, { granularidade });
    return null;
  });
}

describe("regras puras", () => {
  test("dadosSaoMensais só conta resumo real marcado como mensal", () => {
    expect(dadosSaoMensais([resumo(2026, 9, 1, { granularidade: "mensal" })])).toBe(true);
    expect(dadosSaoMensais([resumo(2026, 9, 1)])).toBe(false);
    expect(dadosSaoMensais([resumo(2026, 9, 1, { granularidade: "mensal", isMock: true })])).toBe(false);
  });

  test("semana sem dados tem 7 linhas zeradas (compatível com a tela antiga)", () => {
    const s = semanaSemDados();
    expect(s).toHaveLength(7);
    expect(s.every((d) => d.avgNet === 0 && d.avgOrders === 0)).toBe(true);
    expect(s[0]!.label).toBe("Seg");
    expect(s[6]!.label).toBe("Dom");
  });

  test("projeção mensal em mês em curso diz que não há projeção", () => {
    const p = montarProjecao({ mensal: true, isCurrentMonth: true, daysElapsed: 22, daysInMonth: 31, grossAmount: 10, netAmount: 5 });
    expect(p.note).toMatch(/não há projeção/);
    expect(p.note).not.toMatch(/Projeção com base/);
  });

  test("projeção diária continua igual ao comportamento antigo", () => {
    expect(montarProjecao({ mensal: false, isCurrentMonth: true, daysElapsed: 22, daysInMonth: 31, grossAmount: 10, netAmount: 5 }).note).toBe("Projeção com base em 22 dia(s) do ranking histórico do mês.");
    expect(montarProjecao({ mensal: false, isCurrentMonth: false, daysElapsed: 30, daysInMonth: 30, grossAmount: 10, netAmount: 5 }).note).toBe("Mês fechado — valores refletem o total do período.");
  });

  test("queda só é alertada com o mês fechado", () => {
    expect(podeAlertarQueda(true)).toBe(false);
    expect(podeAlertarQueda(false)).toBe(true);
  });
});

describe("getPainelDonoInsights com dado mensal do portal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lerResumoDaLoja.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  test("mês em curso: sem semana, sem projeção e SEM alerta de queda", async () => {
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    configurar("mensal");
    const r = await getPainelDonoInsights({ year: 2026, month: 10 });
    expect(r.granularidade).toBe("mensal");
    expect(r.weekday.every((d) => d.avgNet === 0)).toBe(true);
    expect(r.projection.note).toMatch(/não há projeção/);
    expect(r.alerts.some((a) => a.title.includes("caiu"))).toBe(false);
    // os números reais continuam lá
    expect(r.current.netAmount).toBe(100);
  });

  test("mês já fechado: o alerta de queda volta a valer", async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 12));
    configurar("mensal");
    const r = await getPainelDonoInsights({ year: 2026, month: 10 });
    expect(r.granularidade).toBe("mensal");
    expect(r.alerts.some((a) => a.title === "Loja A caiu")).toBe(true);
    expect(r.projection.note).toMatch(/Dados mensais do portal/);
  });

  test("dado diário: semana calculada pelos dias e projeção antiga preservadas", async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 12));
    configurar(undefined);
    const r = await getPainelDonoInsights({ year: 2026, month: 10 });
    expect(r.granularidade).toBe("diaria");
    expect(r.weekday.some((d) => d.avgNet > 0)).toBe(true);
    expect(r.projection.note).toBe("Mês fechado — valores refletem o total do período.");
  });
});
