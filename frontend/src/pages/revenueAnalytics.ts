import type { RevenueEntry, RevenueSummary } from "../api/client";
import { buildDailySeries, type DaySeriesPoint } from "./revenueGroups";
import { weekdayFromIso } from "./revenueView";

export const REVENUE_CHANNELS = ["Salão", "Delivery", "Eventos / Empreitada", "Outros"];

export type DailyRow = {
  date: string;
  weekdayName: string;
  grossAmount: number;
  serviceAmount: number;
  netAmount: number;
  tickets: number;
  salesFirstShift: number;
  salesSecondShift: number;
};

export type WeekdayRow = {
  weekdayName: string;
  grossAmount: number;
  serviceAmount: number;
  netAmount: number;
  tickets: number;
};

export type ChannelRow = {
  channel: string;
  gross: number;
  service: number;
  net: number;
  tickets: number;
  average: number;
};

export type PlatformRow = { sourcePlatform: string; gross: number; net: number; tickets: number; average: number };

export type RevenueAnalytics = {
  dailyRows: DailyRow[];
  weekdayRows: WeekdayRow[];
  /** Só canais com movimento, do maior líquido para o menor. */
  channelRows: ChannelRow[];
  idleChannels: string[];
  channelNetTotal: number;
  platformRows: PlatformRow[];
  series: DaySeriesPoint[];
};

const safeDivide = (value: number, divisor: number) => (divisor > 0 ? value / divisor : 0);

function buildDailyRows(entries: RevenueEntry[]): DailyRow[] {
  const map = new Map<string, DailyRow>();
  for (const entry of entries) {
    const date = String(entry.date).slice(0, 10);
    const row = map.get(date) ?? {
      date,
      weekdayName: (entry.weekdayName ?? weekdayFromIso(entry.date)).toUpperCase(),
      grossAmount: 0,
      serviceAmount: 0,
      netAmount: 0,
      tickets: 0,
      salesFirstShift: 0,
      salesSecondShift: 0
    };
    row.grossAmount += Number(entry.grossAmount ?? 0);
    row.serviceAmount += Number(entry.serviceAmount ?? 0);
    row.netAmount += Number(entry.netAmount ?? 0);
    row.tickets += Number(entry.tickets ?? 0);
    row.salesFirstShift += Number(entry.salesFirstShift ?? 0);
    row.salesSecondShift += Number(entry.salesSecondShift ?? 0);
    map.set(date, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildWeekdayRows(dailyRows: DailyRow[]): WeekdayRow[] {
  const map = new Map<string, WeekdayRow>();
  for (const day of dailyRows) {
    const row = map.get(day.weekdayName) ?? { weekdayName: day.weekdayName, grossAmount: 0, serviceAmount: 0, netAmount: 0, tickets: 0 };
    row.grossAmount += day.grossAmount;
    row.serviceAmount += day.serviceAmount;
    row.netAmount += day.netAmount;
    row.tickets += day.tickets;
    map.set(day.weekdayName, row);
  }
  return [...map.values()].sort((a, b) => b.netAmount - a.netAmount);
}

function buildChannelRows(summary: RevenueSummary["summary"] | undefined) {
  const byChannel = new Map<string, Record<string, string | number | null>>();
  for (const row of summary?.byChannel ?? []) byChannel.set(String(row.channel ?? ""), row);

  const all: ChannelRow[] = REVENUE_CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    const net = Number(row?.netAmount ?? 0);
    const tickets = Number(row?.tickets ?? 0);
    return {
      channel,
      gross: Number(row?.grossAmount ?? 0),
      service: Number(row?.serviceAmount ?? 0),
      net,
      tickets,
      average: safeDivide(net, tickets)
    };
  });
  const active = all.filter((row) => row.gross !== 0 || row.net !== 0 || row.tickets !== 0);
  return {
    channelRows: [...active].sort((a, b) => b.net - a.net),
    idleChannels: all.filter((row) => !active.includes(row)).map((row) => row.channel),
    channelNetTotal: active.reduce((sum, row) => sum + row.net, 0)
  };
}

function buildPlatformRows(summary: RevenueSummary["summary"] | undefined): PlatformRow[] {
  return (summary?.byPlatform ?? []).map((row) => {
    const gross = Number(row.grossAmount ?? 0);
    const tickets = Number(row.tickets ?? 0);
    return {
      sourcePlatform: String(row.sourcePlatform ?? "Sem plataforma"),
      gross,
      net: Number(row.netAmount ?? 0),
      tickets,
      average: safeDivide(gross, tickets)
    };
  });
}

export function buildRevenueAnalytics(summary: RevenueSummary | null): RevenueAnalytics {
  const entries = summary?.entries ?? [];
  const dailyRows = buildDailyRows(entries);
  return {
    dailyRows,
    weekdayRows: buildWeekdayRows(dailyRows),
    ...buildChannelRows(summary?.summary),
    platformRows: buildPlatformRows(summary?.summary),
    series: buildDailySeries(entries)
  };
}
