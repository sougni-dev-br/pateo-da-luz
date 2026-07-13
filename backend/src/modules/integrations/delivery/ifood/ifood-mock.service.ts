import crypto from "node:crypto";
import type {
  IfoodDailySalesRow,
  IfoodFeeBreakdownRow,
  IfoodPeriodSummary,
  IfoodSettlementRow
} from "./ifood.types.js";

// Gera dados fake DETERMINÍSTICOS por (storeId, ano, mês).
// A mesma combinação sempre devolve os mesmos números — isso deixa a UI
// previsível pra Eli validar. Quando a Fase 2 chegar, esse arquivo some
// e o service real (chamada à Financial API do iFood) toma o lugar.

function seededRandom(seed: string): () => number {
  const hash = crypto.createHash("sha256").update(seed).digest();
  let state = hash.readUInt32BE(0);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDaily(storeId: string, year: number, month: number): IfoodDailySalesRow[] {
  const rng = seededRandom(`ifood-daily:${storeId}:${year}-${month}`);
  const total = daysInMonth(year, month);
  const rows: IfoodDailySalesRow[] = [];
  for (let day = 1; day <= total; day += 1) {
    const orders = Math.floor(20 + rng() * 60);
    const ticket = 55 + rng() * 30;
    const gross = round2(orders * ticket);
    const ifoodFee = round2(gross * (0.18 + rng() * 0.05));
    const promo = round2(gross * (0.03 + rng() * 0.04));
    const deliveryFee = round2(orders * (4.5 + rng() * 3));
    const net = round2(gross - ifoodFee - promo - deliveryFee);
    rows.push({
      date: formatDate(year, month, day),
      orders,
      grossAmount: gross,
      ifoodFeeAmount: ifoodFee,
      promotionAmount: promo,
      deliveryFeeAmount: deliveryFee,
      netAmount: net
    });
  }
  return rows;
}

function buildFees(storeId: string, year: number, month: number, gross: number): IfoodFeeBreakdownRow[] {
  // Comissão iFood já sai em ifoodFeeAmount na daily — não repetir aqui pra não
  // subtrair duas vezes do líquido. Este bloco é só para taxas ADICIONAIS.
  const rng = seededRandom(`ifood-fees:${storeId}:${year}-${month}`);
  return [
    { feeType: "MARKETING", description: "Investimento em Super Restaurante", amount: round2(gross * (0.02 + rng() * 0.02)) },
    { feeType: "MANUTENCAO", description: "Taxa de manutenção mensal", amount: round2(150 + rng() * 100) },
    { feeType: "ANTECIPACAO", description: "Antecipação de repasse", amount: round2(gross * (0.008 + rng() * 0.004)) }
  ];
}

function buildSettlements(storeId: string, year: number, month: number, gross: number, totalFees: number): IfoodSettlementRow[] {
  const rng = seededRandom(`ifood-settle:${storeId}:${year}-${month}`);
  const rows: IfoodSettlementRow[] = [];
  const total = daysInMonth(year, month);
  const chunks = 4;
  const chunkSize = Math.ceil(total / chunks);
  for (let i = 0; i < chunks; i += 1) {
    const startDay = i * chunkSize + 1;
    const endDay = Math.min((i + 1) * chunkSize, total);
    if (startDay > total) break;
    const share = 0.20 + rng() * 0.10;
    const chunkGross = round2(gross * share);
    const chunkFees = round2(totalFees * share);
    const chunkNet = round2(chunkGross - chunkFees);
    rows.push({
      id: `mock-settle-${storeId}-${year}${String(month).padStart(2, "0")}-${i + 1}`,
      externalId: `IFD-${year}${String(month).padStart(2, "0")}-${i + 1}-${storeId.slice(-6).toUpperCase()}`,
      periodStart: formatDate(year, month, startDay),
      periodEnd: formatDate(year, month, endDay),
      grossAmount: chunkGross,
      totalFees: chunkFees,
      netAmount: chunkNet,
      paidAt: formatDate(year, month, Math.min(endDay + 2, total)),
      status: i === chunks - 1 ? "PENDING" : "PAID"
    });
  }
  return rows;
}

type SummaryInput = {
  storeId: string;
  storeLabel: string;
  year: number;
  month: number;
};

export function buildMockSummary(input: SummaryInput): IfoodPeriodSummary {
  const daily = buildDaily(input.storeId, input.year, input.month);
  const totals = daily.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orders,
      grossAmount: acc.grossAmount + row.grossAmount,
      ifoodFeeAmount: acc.ifoodFeeAmount + row.ifoodFeeAmount,
      promotionAmount: acc.promotionAmount + row.promotionAmount,
      deliveryFeeAmount: acc.deliveryFeeAmount + row.deliveryFeeAmount,
      netAmount: acc.netAmount + row.netAmount
    }),
    { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0 }
  );
  const fees = buildFees(input.storeId, input.year, input.month, totals.grossAmount);
  const otherFees = round2(fees.reduce((sum, fee) => sum + fee.amount, 0));
  const totalFeesForSettlement = round2(totals.ifoodFeeAmount + totals.deliveryFeeAmount + otherFees);
  const settlements = buildSettlements(input.storeId, input.year, input.month, totals.grossAmount, totalFeesForSettlement);
  return {
    period: { year: input.year, month: input.month },
    storeId: input.storeId,
    storeLabel: input.storeLabel,
    totals: {
      orders: totals.orders,
      grossAmount: round2(totals.grossAmount),
      ifoodFeeAmount: round2(totals.ifoodFeeAmount),
      promotionAmount: round2(totals.promotionAmount),
      deliveryFeeAmount: round2(totals.deliveryFeeAmount),
      netAmount: round2(totals.netAmount - otherFees),
      otherFees
    },
    daily,
    fees,
    settlements,
    isMock: true
  };
}

export function consolidateSummaries(summaries: IfoodPeriodSummary[], year: number, month: number): IfoodPeriodSummary {
  if (summaries.length === 0) {
    return {
      period: { year, month },
      storeId: null,
      storeLabel: "Consolidado",
      totals: { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 },
      daily: [],
      fees: [],
      settlements: [],
      isMock: true
    };
  }
  const dailyMap = new Map<string, IfoodDailySalesRow>();
  const feesMap = new Map<string, IfoodFeeBreakdownRow>();
  const settlements: IfoodSettlementRow[] = [];
  const totals = { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 };

  for (const summary of summaries) {
    totals.orders += summary.totals.orders;
    totals.grossAmount += summary.totals.grossAmount;
    totals.ifoodFeeAmount += summary.totals.ifoodFeeAmount;
    totals.promotionAmount += summary.totals.promotionAmount;
    totals.deliveryFeeAmount += summary.totals.deliveryFeeAmount;
    totals.netAmount += summary.totals.netAmount;
    totals.otherFees += summary.totals.otherFees;

    for (const row of summary.daily) {
      const prev = dailyMap.get(row.date);
      if (!prev) {
        dailyMap.set(row.date, { ...row });
        continue;
      }
      dailyMap.set(row.date, {
        date: row.date,
        orders: prev.orders + row.orders,
        grossAmount: round2(prev.grossAmount + row.grossAmount),
        ifoodFeeAmount: round2(prev.ifoodFeeAmount + row.ifoodFeeAmount),
        promotionAmount: round2(prev.promotionAmount + row.promotionAmount),
        deliveryFeeAmount: round2(prev.deliveryFeeAmount + row.deliveryFeeAmount),
        netAmount: round2(prev.netAmount + row.netAmount)
      });
    }

    for (const fee of summary.fees) {
      const prev = feesMap.get(fee.feeType);
      feesMap.set(fee.feeType, {
        feeType: fee.feeType,
        description: fee.description,
        amount: round2((prev?.amount ?? 0) + fee.amount)
      });
    }

    settlements.push(...summary.settlements);
  }

  return {
    period: { year, month },
    storeId: null,
    storeLabel: "Consolidado",
    totals: {
      orders: totals.orders,
      grossAmount: round2(totals.grossAmount),
      ifoodFeeAmount: round2(totals.ifoodFeeAmount),
      promotionAmount: round2(totals.promotionAmount),
      deliveryFeeAmount: round2(totals.deliveryFeeAmount),
      netAmount: round2(totals.netAmount),
      otherFees: round2(totals.otherFees)
    },
    daily: Array.from(dailyMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    fees: Array.from(feesMap.values()).sort((a, b) => b.amount - a.amount),
    settlements: settlements.sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1)),
    isMock: true
  };
}
