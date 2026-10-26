import type { RevenueEntry } from "../api/client";

export type EntryGroup = {
  name: string;
  entries: RevenueEntry[];
  gross: number;
  net: number;
  tickets: number;
  firstDate: string;
  lastDate: string;
};

export type EntryRow =
  | { kind: "single"; entry: RevenueEntry }
  | { kind: "group"; group: EntryGroup };

const SEPARATOR = " — ";

/** "Congresso — Staff (8 × R$ 45,00)" -> "Congresso": o nome do evento vem antes do primeiro " — ". */
export function eventNameOf(description: string | null | undefined): string {
  const text = String(description ?? "").trim();
  const index = text.indexOf(SEPARATOR);
  return (index > 0 ? text.slice(0, index) : text).trim();
}

const day = (value: string) => String(value).slice(0, 10);

/**
 * Junta os lançamentos de um mesmo evento (canal de eventos, mesmo nome, 2 ou mais) numa linha só.
 * A ordem das linhas segue a primeira aparição, então a lista continua ordenada como veio do servidor.
 */
export function groupEventEntries(entries: RevenueEntry[], eventChannel: string): EntryRow[] {
  const byName = new Map<string, RevenueEntry[]>();
  for (const entry of entries) {
    const name = eventNameOf(entry.description);
    if (entry.channel !== eventChannel || !name) continue;
    byName.set(name.toLowerCase(), [...(byName.get(name.toLowerCase()) ?? []), entry]);
  }

  const rows: EntryRow[] = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    const key = eventNameOf(entry.description).toLowerCase();
    const members = entry.channel === eventChannel && key ? byName.get(key) : undefined;
    if (!members || members.length < 2) {
      rows.push({ kind: "single", entry });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const dates = members.map((member) => day(member.date)).sort();
    rows.push({
      kind: "group",
      group: {
        name: eventNameOf(members[0].description),
        entries: members,
        gross: members.reduce((sum, member) => sum + Number(member.grossAmount ?? 0), 0),
        net: members.reduce((sum, member) => sum + Number(member.netAmount ?? 0), 0),
        tickets: members.reduce((sum, member) => sum + Number(member.tickets ?? 0), 0),
        firstDate: dates[0],
        lastDate: dates[dates.length - 1]
      }
    });
  }
  return rows;
}

export type DaySeriesPoint = { date: string; total: number; byChannel: Record<string, number> };

/** Líquido por dia, separado por canal, em ordem cronológica — base do gráfico diário. */
export function buildDailySeries(entries: RevenueEntry[]): DaySeriesPoint[] {
  const map = new Map<string, DaySeriesPoint>();
  for (const entry of entries) {
    const date = day(entry.date);
    const net = Number(entry.netAmount ?? 0);
    const point = map.get(date) ?? { date, total: 0, byChannel: {} };
    point.total += net;
    point.byChannel[entry.channel] = (point.byChannel[entry.channel] ?? 0) + net;
    map.set(date, point);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Variação percentual contra o período anterior; sem base de comparação não há variação. */
export function deltaPercent(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** "2026-01" -> { year: 2025, month: 12 } */
export function previousCompetence(month: string): { year: number; month: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 1 ? { year: year - 1, month: 12 } : { year, month: monthNumber - 1 };
}
