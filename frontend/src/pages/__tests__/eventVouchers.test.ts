import { describe, expect, it } from "vitest";
import {
  applyRememberedPrices,
  buildVoucherEntries,
  defaultVoucherCategories,
  parsePastedDays,
  voucherTotals,
  type VoucherDay
} from "../eventVouchers";

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

describe("preços lembrados", () => {
  it("aplica o preço guardado por categoria e mantém o padrão onde não há nada", () => {
    const result = applyRememberedPrices(defaultVoucherCategories, { convidados: "95.5" });
    expect(result.map((cat) => cat.price)).toEqual(["95.5", "45"]);
  });

  it("ignora lixo guardado: tipo errado, preço zero ou negativo", () => {
    expect(applyRememberedPrices(defaultVoucherCategories, null)).toEqual(defaultVoucherCategories);
    expect(applyRememberedPrices(defaultVoucherCategories, "x")).toEqual(defaultVoucherCategories);
    const result = applyRememberedPrices(defaultVoucherCategories, { convidados: "0", staff: -3, outro: "10" });
    expect(result.map((cat) => cat.price)).toEqual(["89", "45"]);
  });
});

describe("parsePastedDays", () => {
  const cats = defaultVoucherCategories;

  it("lê linhas separadas por tab, com data dd/mm e a quantidade de cada público na ordem das colunas", () => {
    const { days: parsed, ignored } = parsePastedDays("14/10\t14\t5\n15/10\t56\t6", cats, 2026);
    expect(ignored).toBe(0);
    expect(parsed).toEqual([
      { date: "2026-10-14", qty: { convidados: "14", staff: "5" } },
      { date: "2026-10-15", qty: { convidados: "56", staff: "6" } }
    ]);
  });

  it("aceita dd/mm/aaaa, aaaa-mm-dd, ponto e vírgula e espaços", () => {
    const { days: parsed } = parsePastedDays("16/10/2026;57;5\n2026-10-17 23 8", cats, 2026);
    expect(parsed.map((day) => day.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(parsed[1].qty).toEqual({ convidados: "23", staff: "8" });
  });

  it("pula cabeçalho e linhas sem data válida, contando o que ignorou", () => {
    const text = "Dia\tConvidados\tStaff\n14/10\t14\t5\n31/02\t1\t1\nTotal\t70\t10";
    const { days: parsed, ignored } = parsePastedDays(text, cats, 2026);
    expect(parsed).toHaveLength(1);
    expect(ignored).toBe(3);
  });

  it("quantidade ausente ou inválida vira vazio e não quebra", () => {
    expect(parsePastedDays("14/10\t14", cats, 2026).days[0].qty).toEqual({ convidados: "14", staff: "" });
    expect(parsePastedDays("14/10\tabc\t-2", cats, 2026).days[0].qty).toEqual({ convidados: "", staff: "" });
  });

  it("texto vazio não gera dias", () => {
    expect(parsePastedDays("  \n ", cats, 2026)).toEqual({ days: [], ignored: 0 });
  });
});
