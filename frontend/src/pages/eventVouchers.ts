export type VoucherCategory = { id: string; label: string; price: string };
export type VoucherDay = { date: string; qty: Record<string, string> };

export const defaultVoucherCategories: VoucherCategory[] = [
  { id: "convidados", label: "Convidados / Palestrantes", price: "89" },
  { id: "staff", label: "Staff", price: "45" }
];

export type VoucherEntryPayload = {
  date: string;
  competenceYear: number;
  competenceMonth: number;
  channel: string;
  sourcePlatform: string;
  description: string;
  grossAmount: number;
  discounts: number;
  platformFees: number;
  serviceAmount: number;
  netAmount: number;
  tickets: number;
  ticketAverage: number | null;
  paymentMethod: string | null;
  notes: string | null;
};

type BuildInput = {
  channel: string;
  eventType: string;
  eventName: string;
  categories: VoucherCategory[];
  days: VoucherDay[];
  includeService: boolean;
  paymentMethod: string;
  notes: string;
};

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

export function parseQty(value: string | undefined): number {
  const n = Math.floor(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parsePrice(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function voucherTotals(categories: VoucherCategory[], days: VoucherDay[]) {
  let people = 0;
  let cents = 0;
  for (const day of days) {
    for (const cat of categories) {
      const qty = parseQty(day.qty[cat.id]);
      people += qty;
      cents += qty * toCents(parsePrice(cat.price));
    }
  }
  return { people, gross: fromCents(cents) };
}

// Um lançamento por dia e por categoria: o ticket médio de cada público fica correto
// e o dia pode ser cancelado/conferido isoladamente.
export function buildVoucherEntries(input: BuildInput): VoucherEntryPayload[] {
  const entries: VoucherEntryPayload[] = [];
  for (const day of input.days) {
    if (!day.date) continue;
    const [year, month] = day.date.split("-").map(Number);
    for (const cat of input.categories) {
      const qty = parseQty(day.qty[cat.id]);
      const price = parsePrice(cat.price);
      if (qty === 0 || price === 0) continue;
      const grossCents = qty * toCents(price);
      const serviceCents = input.includeService ? Math.round(grossCents * 0.1) : 0;
      entries.push({
        date: day.date,
        competenceYear: year,
        competenceMonth: month,
        channel: input.channel,
        sourcePlatform: input.eventType,
        description: `${input.eventName.trim()} — ${cat.label} (${qty} × ${brl(price)})`,
        grossAmount: fromCents(grossCents),
        discounts: 0,
        platformFees: 0,
        serviceAmount: fromCents(serviceCents),
        netAmount: fromCents(grossCents - serviceCents),
        tickets: qty,
        ticketAverage: fromCents(Math.round((grossCents - serviceCents) / qty)),
        paymentMethod: input.paymentMethod || null,
        notes: input.notes.trim() || null
      });
    }
  }
  return entries;
}

const PRICES_STORAGE_KEY = "pateo_revenue_voucher_prices";

/** Preço guardado do último evento por categoria; valor inválido (zero, negativo, tipo errado) é ignorado. */
export function applyRememberedPrices(categories: VoucherCategory[], stored: unknown): VoucherCategory[] {
  if (typeof stored !== "object" || stored === null) return categories;
  const prices = stored as Record<string, unknown>;
  return categories.map((cat) => {
    const raw = prices[cat.id];
    const price = typeof raw === "number" || typeof raw === "string" ? parsePrice(String(raw)) : 0;
    return price > 0 ? { ...cat, price: String(raw) } : cat;
  });
}

export function loadRememberedPrices(categories: VoucherCategory[]): VoucherCategory[] {
  try {
    const raw = localStorage.getItem(PRICES_STORAGE_KEY);
    return raw ? applyRememberedPrices(categories, JSON.parse(raw)) : categories;
  } catch {
    // Armazenamento bloqueado ou JSON corrompido: segue com os preços padrão.
    return categories;
  }
}

export function rememberPrices(categories: VoucherCategory[]): void {
  try {
    const prices = Object.fromEntries(categories.filter((cat) => parsePrice(cat.price) > 0).map((cat) => [cat.id, cat.price]));
    localStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(prices));
  } catch {
    // Não guardar o preço não pode impedir o lançamento.
  }
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

function parseCellDate(cell: string, defaultYear: number): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cell);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const br = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(cell);
  if (!br) return null;
  const year = br[3] ? (br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3])) : defaultYear;
  return toIsoDate(year, Number(br[2]), Number(br[1]));
}

/**
 * Lê dias colados de uma planilha: cada linha é "data, qtd. da 1ª categoria, qtd. da 2ª...", separados por
 * tab, ponto e vírgula, vírgula ou espaços. Linha sem data válida (cabeçalho, total) é pulada e contada.
 */
export function parsePastedDays(text: string, categories: VoucherCategory[], defaultYear: number): { days: VoucherDay[]; ignored: number } {
  const days: VoucherDay[] = [];
  let ignored = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.trim().split(/[\t;,]+|\s+/).filter(Boolean);
    const date = parseCellDate(cells[0], defaultYear);
    if (!date) {
      ignored += 1;
      continue;
    }
    const qty: Record<string, string> = {};
    categories.forEach((cat, index) => {
      const quantity = parseQty(cells[index + 1]);
      qty[cat.id] = quantity > 0 ? String(quantity) : "";
    });
    days.push({ date, qty });
  }
  return { days, ignored };
}
