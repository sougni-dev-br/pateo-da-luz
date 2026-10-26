import { createCalendarDate, toCalendarDateKey } from "../../shared/utils/calendar-date.js";
import { parseDate } from "../../shared/utils/parse-date.js";

export const EVENT_REVENUE_CHANNEL = "Eventos / Empreitada";
export const MAX_EVENT_GROUP_ROWS = 60;

const MAX_DESCRIPTION = 200;
const MAX_SHORT_TEXT = 80;
const MAX_NOTES = 1000;
const CENT_TOLERANCE = 1;

export class EventGroupValidationError extends Error {}

export type EventGroupRow = {
  date: Date;
  dateKey: string;
  competenceYear: number;
  competenceMonth: number;
  channel: string;
  sourcePlatform: string | null;
  description: string;
  paymentMethod: string | null;
  notes: string | null;
  grossAmount: number;
  serviceAmount: number;
  netAmount: number;
  tickets: number;
  ticketAverage: number;
};

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

function fail(index: number, message: string): never {
  throw new EventGroupValidationError(`Linha ${index + 1}: ${message}`);
}

function optionalText(index: number, value: unknown, max: number, label: string): string | null {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  if (clean.length > max) fail(index, `${label} passa de ${max} caracteres.`);
  return clean;
}

function money(index: number, value: unknown, label: string, { allowZero }: { allowZero: boolean }): number {
  const raw = value === null || value === undefined || value === "" ? (allowZero ? 0 : NaN) : Number(value);
  if (!Number.isFinite(raw) || raw < 0 || (!allowZero && raw === 0)) {
    fail(index, `${label} inválido.`);
  }
  return toCents(raw);
}

function normalizeRow(input: unknown, index: number): EventGroupRow {
  if (typeof input !== "object" || input === null) fail(index, "lançamento inválido.");
  const body = input as Record<string, unknown>;

  const channel = String(body.channel ?? "").trim();
  if (channel && channel !== EVENT_REVENUE_CHANNEL) {
    fail(index, `canal deve ser "${EVENT_REVENUE_CHANNEL}".`);
  }

  const parsed = parseDate(body.date);
  if (!parsed) fail(index, "data obrigatória ou inválida.");
  const date = createCalendarDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());

  const description = String(body.description ?? "").trim();
  if (!description) fail(index, "descrição obrigatória.");
  if (description.length > MAX_DESCRIPTION) fail(index, `descrição passa de ${MAX_DESCRIPTION} caracteres.`);

  const grossCents = money(index, body.grossAmount, "valor bruto", { allowZero: false });
  const serviceCents = money(index, body.serviceAmount, "serviço", { allowZero: true });
  if (serviceCents > grossCents) fail(index, "serviço não pode ser maior que o valor bruto.");

  const expectedNetCents = grossCents - serviceCents;
  const informedNet = body.netAmount === null || body.netAmount === undefined || body.netAmount === "" ? null : money(index, body.netAmount, "líquido", { allowZero: true });
  if (informedNet !== null && Math.abs(informedNet - expectedNetCents) > CENT_TOLERANCE) {
    fail(index, "líquido não confere com bruto menos serviço.");
  }
  const netCents = informedNet ?? expectedNetCents;

  const tickets = Number(body.tickets);
  if (!Number.isInteger(tickets) || tickets < 1) fail(index, "número de pessoas deve ser um inteiro a partir de 1.");

  return {
    date,
    dateKey: toCalendarDateKey(date),
    competenceYear: date.getUTCFullYear(),
    competenceMonth: date.getUTCMonth() + 1,
    channel: EVENT_REVENUE_CHANNEL,
    sourcePlatform: optionalText(index, body.sourcePlatform, MAX_SHORT_TEXT, "tipo do evento"),
    description,
    paymentMethod: optionalText(index, body.paymentMethod, MAX_SHORT_TEXT, "forma de recebimento"),
    notes: optionalText(index, body.notes, MAX_NOTES, "observação"),
    grossAmount: fromCents(grossCents),
    serviceAmount: fromCents(serviceCents),
    netAmount: fromCents(netCents),
    tickets,
    ticketAverage: fromCents(Math.round(netCents / tickets))
  };
}

/** Valida e normaliza o corpo de POST /monthly/revenue/event-group. Ou todas as linhas passam, ou nenhuma. */
export function normalizeEventGroup(body: unknown): EventGroupRow[] {
  const entries = typeof body === "object" && body !== null ? (body as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new EventGroupValidationError("Informe pelo menos um lançamento do evento.");
  }
  if (entries.length > MAX_EVENT_GROUP_ROWS) {
    throw new EventGroupValidationError(`Um evento aceita no máximo ${MAX_EVENT_GROUP_ROWS} lançamentos por vez.`);
  }
  return entries.map(normalizeRow);
}
