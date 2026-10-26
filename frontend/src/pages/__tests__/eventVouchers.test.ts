import { describe, expect, it } from "vitest";
import { buildVoucherEntries, defaultVoucherCategories, voucherTotals, type VoucherDay } from "../eventVouchers";

const days: VoucherDay[] = [
  { date: "2026-10-14", qty: { convidados: "14", staff: "5" } },
  { date: "2026-10-15", qty: { convidados: "56", staff: "6" } },
  { date: "2026-10-16", qty: { convidados: "57", staff: "5" } },
  { date: "2026-10-17", qty: { convidados: "23", staff: "8" } }
];

const base = {
  channel: "Eventos / Empreitada",
  eventType: "Evento — Centro de Convenções",
  eventName: "Congresso",
  categories: defaultVoucherCategories,
  days,
  includeService: false,
  paymentMethod: "A receber",
  notes: ""
};

describe("vouchers de evento", () => {
  it("soma pessoas e valor bruto dos quatro dias", () => {
    const totals = voucherTotals(defaultVoucherCategories, days);
    expect(totals.people).toBe(14 + 5 + 56 + 6 + 57 + 5 + 23 + 8);
    expect(totals.gross).toBe((14 + 56 + 57 + 23) * 89 + (5 + 6 + 5 + 8) * 45);
  });

  it("gera um lançamento por dia e categoria com quantidade x preço", () => {
    const entries = buildVoucherEntries(base);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toMatchObject({
      date: "2026-10-14",
      competenceMonth: 10,
      tickets: 14,
      grossAmount: 1246,
      netAmount: 1246,
      ticketAverage: 89
    });
    expect(entries[1]).toMatchObject({ tickets: 5, grossAmount: 225, ticketAverage: 45 });
  });

  it("ignora categoria sem quantidade e dia sem data", () => {
    const entries = buildVoucherEntries({
      ...base,
      days: [{ date: "2026-10-14", qty: { convidados: "3", staff: "" } }, { date: "", qty: { staff: "9" } }]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].tickets).toBe(3);
  });

  it("aplica taxa de serviço de 10% quando marcada", () => {
    const [first] = buildVoucherEntries({ ...base, includeService: true });
    expect(first.serviceAmount).toBe(124.6);
    expect(first.netAmount).toBe(1121.4);
  });
});
