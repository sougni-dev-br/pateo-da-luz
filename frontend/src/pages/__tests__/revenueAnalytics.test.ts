import { describe, expect, it } from "vitest";
import type { RevenueEntry, RevenueSummary } from "../../api/client";
import { buildRevenueAnalytics } from "../revenueAnalytics";

function entry(partial: Partial<RevenueEntry> & { id: string }): RevenueEntry {
  return {
    date: "2026-10-14T12:00:00.000Z",
    channel: "Eventos / Empreitada",
    grossAmount: 0,
    netAmount: 0,
    serviceAmount: 0,
    tickets: 0,
    status: "ACTIVE",
    ...partial
  } as RevenueEntry;
}

function summaryOf(entries: RevenueEntry[], byChannel: Array<Record<string, string | number | null>> = []): RevenueSummary {
  return { entries, summary: { byChannel, byPlatform: [] } } as unknown as RevenueSummary;
}

describe("buildRevenueAnalytics", () => {
  it("sem dados devolve tudo vazio e todos os canais como sem movimento", () => {
    const result = buildRevenueAnalytics(null);
    expect(result.dailyRows).toEqual([]);
    expect(result.channelRows).toEqual([]);
    expect(result.idleChannels).toEqual(["Salão", "Delivery", "Eventos / Empreitada", "Outros"]);
  });

  it("soma por dia e deriva o dia da semana pela data", () => {
    const { dailyRows } = buildRevenueAnalytics(
      summaryOf([
        entry({ id: "1", netAmount: 100, grossAmount: 100, tickets: 2 }),
        entry({ id: "2", netAmount: 50, grossAmount: 50, tickets: 1 }),
        entry({ id: "3", date: "2026-10-15T12:00:00.000Z", netAmount: 10, grossAmount: 10, tickets: 1 })
      ])
    );
    expect(dailyRows).toHaveLength(2);
    expect(dailyRows[0]).toMatchObject({ date: "2026-10-14", weekdayName: "QUARTA-FEIRA", netAmount: 150, tickets: 3 });
  });

  it("agrupa por dia da semana, do maior líquido para o menor", () => {
    const { weekdayRows } = buildRevenueAnalytics(
      summaryOf([
        entry({ id: "1", netAmount: 10 }),
        entry({ id: "2", date: "2026-10-15T12:00:00.000Z", netAmount: 90 })
      ])
    );
    expect(weekdayRows.map((row) => row.weekdayName)).toEqual(["QUINTA-FEIRA", "QUARTA-FEIRA"]);
  });

  it("ordena canais com movimento pelo líquido e lista os parados", () => {
    const { channelRows, idleChannels, channelNetTotal } = buildRevenueAnalytics(
      summaryOf([], [
        { channel: "Delivery", grossAmount: 300, netAmount: 280, serviceAmount: 0, tickets: 14 },
        { channel: "Eventos / Empreitada", grossAmount: 900, netAmount: 900, serviceAmount: 0, tickets: 10 }
      ])
    );
    expect(channelRows.map((row) => row.channel)).toEqual(["Eventos / Empreitada", "Delivery"]);
    expect(channelRows[0].average).toBe(90);
    expect(idleChannels).toEqual(["Salão", "Outros"]);
    expect(channelNetTotal).toBe(1180);
  });
});
