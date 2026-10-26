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
