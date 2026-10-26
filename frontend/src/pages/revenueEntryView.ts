import type { RevenueEntry } from "../api/client";
import { weekdayFromIso } from "./revenueView";

const EVENT_CHANNEL = "Eventos / Empreitada";

// Mesmos nomes que o backend usa em normalizePlatform (revenue-channels.ts).
const ORIGIN_NAMES: Record<string, string> = {
  NOVENTA_NOVE: "99Food",
  "99FOOD": "99Food",
  IFOOD: "iFood",
  KEETA: "Keeta",
  AGILE_PDV: "Agile PDV"
};

const MANUAL = "Manual";

/** De onde o lançamento veio, no nome que a equipe usa. Sem plataforma gravada é lançamento manual. */
export function entryOrigin(entry: RevenueEntry): string {
  const raw = String(entry.sourcePlatform ?? "").trim();
  if (!raw) return MANUAL;
  if (entry.channel === EVENT_CHANNEL) return raw;
  return ORIGIN_NAMES[raw.toUpperCase()] ?? raw;
}

const AUTO_DESCRIPTIONS = [/^agile pdv\s*-\s*/i, /^faturamento\s+sal[aã]o$/i, /^delivery confirmado sem faturamento$/i];

/** Descrição que alguém escreveu. Texto automático que só repete origem, dia da semana ou canal não aparece. */
export function visibleDescription(entry: RevenueEntry): string | null {
  const text = String(entry.description ?? "").trim();
  if (!text) return null;
  return AUTO_DESCRIPTIONS.some((pattern) => pattern.test(text)) ? null : text;
}

const num = (value: unknown) => Number(value ?? 0);

/** Marcador sem valor (ex.: "delivery confirmado sem faturamento"): existe para dizer que o dia foi conferido. */
export function isZeroMarker(entry: RevenueEntry): boolean {
  return (
    num(entry.grossAmount) === 0 &&
    num(entry.netAmount) === 0 &&
    num(entry.tickets) === 0 &&
    num(entry.salesFirstShift) === 0 &&
    num(entry.salesSecondShift) === 0 &&
    num(entry.serviceAmount) === 0
  );
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function brDate(value: string) {
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** Busca por descrição, canal, origem, data (dd/mm/aaaa) e dia da semana, sem diferenciar acento nem caixa. */
export function matchesSearch(entry: RevenueEntry, term: string): boolean {
  const needle = normalize(term.trim());
  if (!needle) return true;
  const haystack = normalize(
    [entry.description, entry.channel, entryOrigin(entry), brDate(entry.date), weekdayFromIso(entry.date)].filter(Boolean).join(" ")
  );
  return haystack.includes(needle);
}

export type EntryDetail = { label: string; kind: "money" | "text"; value: number | string };

/** O que a linha não mostra: turnos, serviço, forma de recebimento, observações. Só entra o que tem valor. */
export function entryDetails(entry: RevenueEntry): EntryDetail[] {
  const details: EntryDetail[] = [];
  const money = (label: string, value: unknown) => {
    if (num(value) !== 0) details.push({ label, kind: "money", value: num(value) });
  };
  const text = (label: string, value: unknown) => {
    const clean = String(value ?? "").trim();
    if (clean) details.push({ label, kind: "text", value: clean });
  };
  money("1º turno", entry.salesFirstShift);
  money("2º turno", entry.salesSecondShift);
  money("Serviço", entry.serviceAmount);
  money("Acumulado", entry.accumulatedAmount);
  text("Forma de recebimento", entry.paymentMethod);
  text("Observações", entry.notes);
  return details;
}
