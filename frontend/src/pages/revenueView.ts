import type { PeriodState } from "../utils/period";

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

/** Dia da semana pela data civil (YYYY-MM-DD...), sem depender do fuso do navegador. */
export function weekdayFromIso(value: string): string {
  const ymd = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" })
    .format(new Date(`${ymd}T12:00:00Z`))
    .toUpperCase();
}

/** Verdadeiro se algum valor da coluna é diferente de zero — coluna toda zerada não precisa aparecer. */
export function hasAnyValue(values: Array<number | string | null | undefined>): boolean {
  return values.some((value) => Number(value ?? 0) !== 0);
}

/** "2026-10" ou (2026, 10) -> "outubro de 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? month} de ${year}`;
}

function brDate(ymd: string): string {
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
}

export function describeAppliedFilter(input: { month: string; period: PeriodState; channel: string }) {
  const { month, period, channel } = input;
  const usesCompetence = period.preset === "currentMonth" || period.preset === "previousMonth";
  const [year, monthNumber] = month.split("-").map(Number);
  const periodLabel = usesCompetence
    ? `${MONTH_NAMES[(monthNumber ?? 1) - 1] ?? month} de ${year}`
    : `${brDate(period.startDate)} a ${brDate(period.endDate)}`;
  const channelLabel = channel || "Todos os canais";
  return { periodLabel, channelLabel, month, isCompetence: usesCompetence, key: `${periodLabel}|${channelLabel}|${month}|${period.startDate}|${period.endDate}` };
}

type DayTotal = { date: string; netAmount: number };

/** Só marca melhor/pior dia quando há dias suficientes para a comparação fazer sentido. */
export function pickBestAndWorstDay(days: DayTotal[]): { best: string | null; worst: string | null } {
  if (days.length < 3) return { best: null, worst: null };
  const sorted = [...days].sort((a, b) => b.netAmount - a.netAmount);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best.netAmount === worst.netAmount) return { best: null, worst: null };
  return { best: best.date, worst: worst.date };
}

const MAX_DELTA = 999;

/** "+12,3%", "−5,0%"; variação acima de 999% vira "+999% ou mais" (base pequena demais para o número dizer algo). */
export function formatDeltaText(delta: number): string {
  const sign = delta >= 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (abs > MAX_DELTA) return `${sign}${MAX_DELTA}% ou mais`;
  return `${sign}${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function deltaDirection(delta: number): "up" | "down" | "flat" {
  if (Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "up" : "down";
}

export type AppliedFilter = ReturnType<typeof describeAppliedFilter>;
