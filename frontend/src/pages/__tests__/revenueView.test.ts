import { describe, expect, it } from "vitest";
import { deltaDirection, describeAppliedFilter, formatDeltaText, hasAnyValue, pickBestAndWorstDay, weekdayFromIso } from "../revenueView";

const period = (preset: string, startDate: string, endDate: string) =>
  ({ preset, startDate, endDate }) as Parameters<typeof describeAppliedFilter>[0]["period"];

describe("revenueView", () => {
  it("deriva o dia da semana da data, ignorando o fuso", () => {
    expect(weekdayFromIso("2026-10-14T12:00:00.000Z")).toBe("QUARTA-FEIRA");
    expect(weekdayFromIso("2026-10-17")).toBe("SÁBADO");
    expect(weekdayFromIso("")).toBe("");
  });

  it("detecta coluna toda zerada", () => {
    expect(hasAnyValue([0, "0", null, undefined])).toBe(false);
    expect(hasAnyValue([0, "12.5"])).toBe(true);
  });

  it("descreve o filtro aplicado por mês de competência", () => {
    const filter = describeAppliedFilter({ month: "2026-10", period: period("currentMonth", "2026-10-01", "2026-10-31"), channel: "" });
    expect(filter.periodLabel).toBe("outubro de 2026");
    expect(filter.channelLabel).toBe("Todos os canais");
  });

  it("descreve o filtro por intervalo e canal", () => {
    const filter = describeAppliedFilter({ month: "2026-10", period: period("custom", "2026-10-14", "2026-10-17"), channel: "Delivery" });
    expect(filter.periodLabel).toBe("14/10/2026 a 17/10/2026");
    expect(filter.channelLabel).toBe("Delivery");
  });

  it("muda a chave quando qualquer filtro muda", () => {
    const base = { month: "2026-10", period: period("currentMonth", "2026-10-01", "2026-10-31"), channel: "" };
    expect(describeAppliedFilter(base).key).not.toBe(describeAppliedFilter({ ...base, channel: "Salão" }).key);
  });

  it("marca melhor e pior dia só com 3 dias ou mais e valores diferentes", () => {
    expect(pickBestAndWorstDay([{ date: "a", netAmount: 1 }, { date: "b", netAmount: 2 }])).toEqual({ best: null, worst: null });
    expect(pickBestAndWorstDay([{ date: "a", netAmount: 5 }, { date: "b", netAmount: 5 }, { date: "c", netAmount: 5 }])).toEqual({ best: null, worst: null });
    expect(
      pickBestAndWorstDay([{ date: "a", netAmount: 10 }, { date: "b", netAmount: 90 }, { date: "c", netAmount: 50 }])
    ).toEqual({ best: "b", worst: "a" });
  });
});

describe("variação", () => {
  it("formata com sinal e uma casa decimal", () => {
    expect(formatDeltaText(12.34)).toBe("+12,3%");
    expect(formatDeltaText(-5)).toBe("−5,0%");
    expect(formatDeltaText(0)).toBe("+0,0%");
  });

  it("limita variação acima de 999%", () => {
    expect(formatDeltaText(2828.7)).toBe("+999% ou mais");
    expect(formatDeltaText(-1500)).toBe("−999% ou mais");
    expect(formatDeltaText(999)).toBe("+999,0%");
  });

  it("diz a direção, tratando variação desprezível como estável", () => {
    expect(deltaDirection(3)).toBe("up");
    expect(deltaDirection(-3)).toBe("down");
    expect(deltaDirection(0.02)).toBe("flat");
  });
});
