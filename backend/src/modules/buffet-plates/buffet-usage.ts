// Acompanhamento dos pratos: a partir das impressões de plaquinhas, quais pratos saem sempre,
// quais estão repetindo demais e quais a cozinha deixou de fazer. Conta dias, não impressões:
// imprimir de novo a mesma plaquinha no mesmo dia não infla nada.

export type UsagePrint = { servedOn: string; itemIds: string[] };

export type UsageRow = {
  itemId: string;
  /** Dias do período em que o prato saiu. */
  days: number;
  /** Parte dos dias do período, de 0 a 1. */
  share: number;
  lastDay: string;
};

export type ForgottenRow = { itemId: string; daysInHistory: number; lastDay: string; daysSince: number };

export type UsageReport = {
  period: { start: string; end: string; windowDays: number; servedDays: number };
  ranking: UsageRow[];
  /** Sai em quase todo dia: é base do buffet, não alerta. */
  staples: string[];
  /** Sai com frequência, mas não todo dia: candidato a variar. */
  repeating: string[];
  forgotten: ForgottenRow[];
};

// Limiares escolhidos para um buffet que roda todo dia útil.
export const STAPLE_SHARE = 0.85;
export const REPEATING_SHARE = 0.4;
export const MIN_SERVED_DAYS_FOR_ALERTS = 5;
export const MIN_REPEATING_DAYS = 3;
export const HISTORY_DAYS = 90;
export const FORGOTTEN_AFTER_DAYS = 14;
export const MIN_FORGOTTEN_HISTORY = 3;
export const MAX_FORGOTTEN = 12;

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(toTime(day) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);

/** Dias de cada prato: { itemId → conjunto de datas }. */
function daysByItem(prints: UsagePrint[], from: string, to: string) {
  const map = new Map<string, Set<string>>();
  for (const p of prints) {
    if (p.servedOn < from || p.servedOn > to) continue;
    for (const id of p.itemIds) {
      const days = map.get(id) ?? new Set<string>();
      days.add(p.servedOn);
      map.set(id, days);
    }
  }
  return map;
}

function lastDayByItem(prints: UsagePrint[]) {
  const map = new Map<string, string>();
  for (const p of prints) for (const id of p.itemIds) if ((map.get(id) ?? "") < p.servedOn) map.set(id, p.servedOn);
  return map;
}

/**
 * `prints` deve trazer pelo menos os últimos HISTORY_DAYS dias (e pode trazer impressões
 * já feitas para dias à frente: um prato programado não está esquecido).
 */
export function buildUsageReport(prints: UsagePrint[], today: string, windowDays: number): UsageReport {
  const start = addDays(today, -(windowDays - 1));
  const servedDays = new Set(prints.filter((p) => p.servedOn >= start && p.servedOn <= today).map((p) => p.servedOn)).size;
  const lastDays = lastDayByItem(prints);

  const ranking = [...daysByItem(prints, start, today)]
    .map(([itemId, days]) => ({ itemId, days: days.size, share: servedDays ? days.size / servedDays : 0, lastDay: lastDays.get(itemId) ?? "" }))
    .sort((a, b) => b.days - a.days || b.lastDay.localeCompare(a.lastDay) || a.itemId.localeCompare(b.itemId));

  const enough = servedDays >= MIN_SERVED_DAYS_FOR_ALERTS;
  const staples = enough ? ranking.filter((r) => r.share >= STAPLE_SHARE).map((r) => r.itemId) : [];
  const repeating = enough
    ? ranking.filter((r) => r.share >= REPEATING_SHARE && r.share < STAPLE_SHARE && r.days >= MIN_REPEATING_DAYS).map((r) => r.itemId)
    : [];

  // Esquecido: saía com alguma regularidade nos últimos 90 dias e parou de sair.
  const history = daysByItem(prints, addDays(today, -(HISTORY_DAYS - 1)), today);
  const forgotten = [...history]
    .map(([itemId, days]) => {
      const lastDay = lastDays.get(itemId) ?? "";
      return { itemId, daysInHistory: days.size, lastDay, daysSince: daysBetween(lastDay, today) };
    })
    .filter((r) => r.daysInHistory >= MIN_FORGOTTEN_HISTORY && r.daysSince >= FORGOTTEN_AFTER_DAYS)
    .sort((a, b) => b.daysInHistory - a.daysInHistory || b.daysSince - a.daysSince)
    .slice(0, MAX_FORGOTTEN);

  return { period: { start, end: today, windowDays, servedDays }, ranking, staples, repeating, forgotten };
}
