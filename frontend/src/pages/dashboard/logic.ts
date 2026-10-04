// Regras puras do Dashboard — sem React, para serem testadas sozinhas.
import type { DashboardAlert } from "../../api/client";

export const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Faixa aceita no seletor e na URL: o input de mês deixa digitar "0002-10" no
// meio da edição, e cada tecla viraria uma requisição.
export const MIN_YEAR = 2020;
export const MAX_YEAR = 2100;

/** "YYYY-MM" de uma data local. */
export function competenceOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidCompetence(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** Desloca a competência em `delta` meses ("2026-01", -1 → "2025-12"). */
export function shiftCompetence(competence: string, delta: number): string {
  const [y, m] = competence.split("-").map(Number);
  return competenceOf(new Date(y, m - 1 + delta, 1));
}

export type MonthInfo = {
  year: number;
  month: number;
  /** "Outubro 2026" */
  label: string;
  /** "out/2026" */
  shortLabel: string;
  daysInMonth: number;
  isCurrent: boolean;
  isFuture: boolean;
  /** Dia de hoje se o mês está em andamento; senão o último dia. */
  elapsedDays: number;
};

export function monthInfo(competence: string, today: Date): MonthInfo {
  const [year, month] = competence.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const current = competenceOf(today);
  const isCurrent = competence === current;
  const isFuture = competence > current;
  return {
    year,
    month,
    label: `${MONTHS[month - 1]} ${year}`,
    shortLabel: `${MONTHS_SHORT[month - 1]}/${year}`,
    daysInMonth,
    isCurrent,
    isFuture,
    elapsedDays: isCurrent ? today.getDate() : isFuture ? 0 : daysInMonth,
  };
}

export function monthShortLabel(competence: string): string {
  const [year, month] = competence.split("-").map(Number);
  return `${MONTHS_SHORT[month - 1]}/${year}`;
}

// ── Comparação ──────────────────────────────────────────────

export function safePct(current: number, previous: number): number | null {
  if (previous === 0 || current === 0) return null;
  return ((current - previous) / previous) * 100;
}

export type DeltaTone = "success" | "warning" | "neutral";
export type DeltaDirection = "up" | "down" | "flat";
export type Delta = { pct: number; tone: DeltaTone; direction: DeltaDirection; against: string };

/** A seta segue o sinal; a cor segue o julgamento (compra subindo é ruim). */
export function buildDelta(pct: number | null, higherIsGood: boolean, against: string): Delta | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  const direction: DeltaDirection = rounded === 0 ? "flat" : rounded > 0 ? "up" : "down";
  const tone: DeltaTone =
    direction === "flat" ? "neutral"
    : (direction === "up") === higherIsGood ? "success"
    : "warning";
  return { pct, tone, direction, against };
}

export type RevenueDay = { day: number; grossAmount: number; netAmount: number; serviceAmount: number };
export type RevenueKey = "grossAmount" | "netAmount" | "serviceAmount";

/** Último dia com faturamento lançado (0 se nenhum). */
export function lastRevenueDay(days: RevenueDay[]): number {
  return days.reduce((max, d) => (d.grossAmount !== 0 && d.day > max ? d.day : max), 0);
}

export function sumThroughDay(days: RevenueDay[], key: RevenueKey, throughDay: number): number {
  return days.reduce((sum, d) => (d.day <= throughDay ? sum + d[key] : sum), 0);
}

export type RevenueComparison = {
  current: number;
  previous: number;
  pct: number | null;
  /** Quando o mês está em andamento, a comparação é do mesmo trecho: 1..throughDay. */
  throughDay: number | null;
};

/**
 * Mês em andamento compara o mesmo trecho do mês anterior (1 a D, D = último
 * dia lançado). Mês fechado compara mês inteiro com mês inteiro. Comparar o
 * acumulado de 4 dias com 30 dias dava sempre "−87%".
 */
export function compareRevenue(
  current: RevenueDay[],
  previous: RevenueDay[],
  key: RevenueKey,
  isInProgress: boolean,
): RevenueComparison {
  if (!isInProgress) {
    const cur = sumThroughDay(current, key, 31);
    const prev = sumThroughDay(previous, key, 31);
    return { current: cur, previous: prev, pct: safePct(cur, prev), throughDay: null };
  }
  const throughDay = lastRevenueDay(current);
  if (throughDay === 0) return { current: 0, previous: 0, pct: null, throughDay: null };
  const cur = sumThroughDay(current, key, throughDay);
  const prev = sumThroughDay(previous, key, throughDay);
  return { current: cur, previous: prev, pct: safePct(cur, prev), throughDay };
}

export type CumulativePoint = { day: number; value: number };

/** Acumulado dia a dia de 1 até `untilDay`, preenchendo dias sem lançamento. */
export function cumulative(days: RevenueDay[], key: RevenueKey, untilDay: number): CumulativePoint[] {
  const byDay = new Map(days.map((d) => [d.day, d[key]]));
  const points: CumulativePoint[] = [];
  let running = 0;
  for (let day = 1; day <= untilDay; day += 1) {
    running += byDay.get(day) ?? 0;
    points.push({ day, value: running });
  }
  return points;
}

// ── Alertas ─────────────────────────────────────────────────

export type AlertBucket = "urgent" | "attention" | "waiting";

export type ClassifiedAlert = DashboardAlert & { bucket: AlertBucket };

const URGENT_CODES = new Set(["OVERDUE_PAYABLES", "DUE_SOON_PAYABLES"]);
const END_OF_MONTH_CODES = new Set(["CMV_NO_INVENTORY", "CMV_PENDING_CLOSE"]);

/**
 * Separa o que pede ação agora do que só acontece no fim do mês. No dia 4,
 * "inventário final não registrado" não é pendência — é o calendário. Alarme
 * sempre aceso é alarme que ninguém lê (mesma regra do Fechamento Mensal).
 */
export function classifyAlerts(
  alerts: DashboardAlert[],
  ctx: { isInProgress: boolean; hasRevenue: boolean; hasAnyData: boolean },
): ClassifiedAlert[] {
  const order: Record<AlertBucket, number> = { urgent: 0, attention: 1, waiting: 2 };
  return alerts
    .filter((a) => {
      if (a.code === "MISSING_REVENUE_DAYS" && !ctx.hasRevenue) return false;
      if (END_OF_MONTH_CODES.has(a.code) && !ctx.hasAnyData) return false;
      return true;
    })
    .map((a): ClassifiedAlert => {
      const bucket: AlertBucket =
        URGENT_CODES.has(a.code) || a.type === "danger" ? "urgent"
        : END_OF_MONTH_CODES.has(a.code) && ctx.isInProgress ? "waiting"
        : "attention";
      return { ...a, bucket };
    })
    .sort((a, b) => order[a.bucket] - order[b.bucket]);
}

// ── Rankings ────────────────────────────────────────────────

export type RankingRow = { name: string; total: number; isRemainder?: boolean };

/**
 * Acrescenta a linha "Demais" com o que ficou fora do top exibido, para as
 * barras somarem o total do período e o leitor ver quanto não está na lista.
 */
export function withRemainder(rows: RankingRow[], total: number | undefined, label = "Demais"): RankingRow[] {
  if (total === undefined) return rows;
  const shown = rows.reduce((s, r) => s + r.total, 0);
  const rest = total - shown;
  if (rest < 1) return rows;
  return [...rows, { name: label, total: rest, isRemainder: true }];
}
