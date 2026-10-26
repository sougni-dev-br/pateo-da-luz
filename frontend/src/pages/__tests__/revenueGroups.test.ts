import { describe, expect, it } from "vitest";
import type { RevenueEntry } from "../../api/client";
import { buildDailySeries, deltaPercent, eventNameOf, groupEventEntries, previousCompetence } from "../revenueGroups";

const EVENT = "Eventos / Empreitada";

function entry(partial: Partial<RevenueEntry> & { id: string }): RevenueEntry {
  return {
    date: "2026-10-14T12:00:00.000Z",
    channel: EVENT,
    description: null,
    netAmount: 0,
    grossAmount: 0,
    tickets: 0,
    status: "ACTIVE",
    ...partial
  } as RevenueEntry;
}

describe("revenueGroups", () => {
  it("extrai o nome do evento antes do primeiro travessão", () => {
    expect(eventNameOf("Congresso — Staff (8 × R$ 45,00)")).toBe("Congresso");
    expect(eventNameOf("Casamento Silva")).toBe("Casamento Silva");
    expect(eventNameOf(null)).toBe("");
  });

  it("agrupa lançamentos do mesmo evento e mantém os avulsos", () => {
    const rows = groupEventEntries(
      [
        entry({ id: "1", description: "Congresso — Staff (8 × R$ 45,00)", netAmount: 360, grossAmount: 360, tickets: 8, date: "2026-10-17T12:00:00.000Z" }),
        entry({ id: "2", description: "Casamento Silva", netAmount: 5000 }),
        entry({ id: "3", description: "Congresso — Convidados (14 × R$ 89,00)", netAmount: 1246, grossAmount: 1246, tickets: 14 }),
        entry({ id: "4", channel: "Salão", description: "Congresso — almoço", netAmount: 10 })
      ],
      EVENT
    );
    expect(rows.map((row) => row.kind)).toEqual(["group", "single", "single"]);
    const group = rows[0];
    if (group.kind !== "group") throw new Error("esperava grupo");
    expect(group.group).toMatchObject({ name: "Congresso", net: 1606, tickets: 22, firstDate: "2026-10-14", lastDate: "2026-10-17" });
    expect(group.group.entries.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("não agrupa um evento com um único lançamento", () => {
    const rows = groupEventEntries([entry({ id: "1", description: "Congresso — Staff" })], EVENT);
    expect(rows).toEqual([{ kind: "single", entry: expect.objectContaining({ id: "1" }) }]);
  });

  it("monta a série diária por canal em ordem cronológica", () => {
    const series = buildDailySeries([
      entry({ id: "1", date: "2026-10-15T12:00:00.000Z", netAmount: 100, channel: "Salão" }),
      entry({ id: "2", date: "2026-10-14T12:00:00.000Z", netAmount: 40, channel: "Salão" }),
      entry({ id: "3", date: "2026-10-15T12:00:00.000Z", netAmount: 60, channel: EVENT })
    ]);
    expect(series.map((point) => point.date)).toEqual(["2026-10-14", "2026-10-15"]);
    expect(series[1]).toEqual({ date: "2026-10-15", total: 160, byChannel: { Salão: 100, [EVENT]: 60 } });
  });

  it("calcula a variação e ignora base zero ou ausente", () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(10, 0)).toBeNull();
    expect(deltaPercent(10, null)).toBeNull();
  });

  it("volta de janeiro para dezembro do ano anterior", () => {
    expect(previousCompetence("2026-01")).toEqual({ year: 2025, month: 12 });
    expect(previousCompetence("2026-10")).toEqual({ year: 2026, month: 9 });
  });
});
