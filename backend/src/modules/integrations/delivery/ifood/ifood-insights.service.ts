import { prisma } from "../../../../config/database.js";
import { buildMockSummary } from "./ifood-mock.service.js";
import type { IfoodPeriodSummary } from "./ifood.types.js";

// Thresholds fixos (v1). Se Eli quiser configurável, viram tabela no banco.
const ALERT_THRESHOLDS = {
  IFOOD_FEE_PERCENT_WARN: 25,           // taxa iFood > 25% do bruto
  PROMO_PERCENT_WARN: 8,                // promoção custeada > 8% do bruto
  MOM_DROP_DANGER: -15,                 // queda > 15% vs mês anterior
  NET_MARGIN_WARN: 55                   // líquido < 55% do bruto
};

export type PainelDonoInsights = {
  period: { year: number; month: number; todayDay: number; daysInMonth: number };
  current: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
  };
  previousMonth: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
    deltaGrossPercent: number;
    deltaNetPercent: number;
  };
  lastYear: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
    deltaGrossPercent: number;
    deltaNetPercent: number;
  };
  projection: {
    grossAmount: number;
    netAmount: number;
    daysElapsed: number;
    daysRemaining: number;
    note: string;
  };
  ranking: Array<{
    storeId: string;
    storeLabel: string;
    netAmount: number;
    grossAmount: number;
    sharePercent: number;
    deltaVsPreviousMonthPercent: number;
  }>;
  breakdown: {
    ifoodFeePercent: number;
    promotionPercent: number;
    deliveryFeePercent: number;
    otherFeesPercent: number;
    netPercent: number;
  };
  weekday: Array<{
    dow: number;
    label: string;
    avgNet: number;
    avgOrders: number;
  }>;
  ticketByStore: Array<{
    storeId: string;
    storeLabel: string;
    ticket: number;
    deltaPercent: number;
  }>;
  alerts: Array<{
    severity: "info" | "warn" | "danger";
    title: string;
    message: string;
    storeId: string | null;
  }>;
  isMock: boolean;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(value: number, base: number): number {
  if (base === 0) return 0;
  return round2((value / base) * 100);
}

function delta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return round2(((current - previous) / previous) * 100);
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export async function getPainelDonoInsights(params: {
  year: number;
  month: number;
}): Promise<PainelDonoInsights> {
  const activeStores = await prisma.deliveryStore.findMany({
    where: { platform: "IFOOD", active: true },
    orderBy: { createdAt: "asc" }
  });

  const buildForPeriod = (year: number, month: number): IfoodPeriodSummary[] =>
    activeStores.map((store) =>
      buildMockSummary({ storeId: store.id, storeLabel: store.nickname, year, month })
    );

  const currentPerStore = buildForPeriod(params.year, params.month);
  const prev = shiftMonth(params.year, params.month, -1);
  const prevPerStore = buildForPeriod(prev.year, prev.month);
  const lastYearRef = shiftMonth(params.year, params.month, -12);
  const lastYearPerStore = buildForPeriod(lastYearRef.year, lastYearRef.month);

  const sumTotals = (rows: IfoodPeriodSummary[]) =>
    rows.reduce(
      (acc, row) => ({
        orders: acc.orders + row.totals.orders,
        grossAmount: acc.grossAmount + row.totals.grossAmount,
        ifoodFeeAmount: acc.ifoodFeeAmount + row.totals.ifoodFeeAmount,
        promotionAmount: acc.promotionAmount + row.totals.promotionAmount,
        deliveryFeeAmount: acc.deliveryFeeAmount + row.totals.deliveryFeeAmount,
        netAmount: acc.netAmount + row.totals.netAmount,
        otherFees: acc.otherFees + row.totals.otherFees
      }),
      { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 }
    );

  const cur = sumTotals(currentPerStore);
  const prevT = sumTotals(prevPerStore);
  const yearT = sumTotals(lastYearPerStore);

  const now = new Date();
  const isCurrentMonth = now.getFullYear() === params.year && now.getMonth() + 1 === params.month;
  const daysInMonth = new Date(params.year, params.month, 0).getDate();
  const todayDay = isCurrentMonth ? now.getDate() : daysInMonth;
  const daysElapsed = isCurrentMonth ? todayDay : daysInMonth;

  // Como o mock já tem 1 mês inteiro, "current" mostra o mês todo simulado.
  // A projeção só faz sentido quando o mês ainda está em curso (dados reais parciais).
  // Aqui deixamos igual ao total pra Fase 1; na Fase 2 vai casar com dias parciais reais.
  const projection = {
    grossAmount: round2(cur.grossAmount),
    netAmount: round2(cur.netAmount),
    daysElapsed,
    daysRemaining: daysInMonth - daysElapsed,
    note: isCurrentMonth
      ? `Projeção com base em ${daysElapsed} dia(s) do ranking histórico do mês.`
      : "Mês fechado — valores refletem o total do período."
  };

  const ranking = currentPerStore.map((row, idx) => {
    const prevRow = prevPerStore[idx];
    return {
      storeId: row.storeId ?? "",
      storeLabel: row.storeLabel,
      netAmount: round2(row.totals.netAmount),
      grossAmount: round2(row.totals.grossAmount),
      sharePercent: pct(row.totals.netAmount, cur.netAmount),
      deltaVsPreviousMonthPercent: delta(row.totals.netAmount, prevRow?.totals.netAmount ?? 0)
    };
  }).sort((a, b) => b.netAmount - a.netAmount);

  const breakdown = {
    ifoodFeePercent: pct(cur.ifoodFeeAmount, cur.grossAmount),
    promotionPercent: pct(cur.promotionAmount, cur.grossAmount),
    deliveryFeePercent: pct(cur.deliveryFeeAmount, cur.grossAmount),
    otherFeesPercent: pct(cur.otherFees, cur.grossAmount),
    netPercent: pct(cur.netAmount, cur.grossAmount)
  };

  // Weekday: consolidar todas as lojas por dia da semana
  const weekdayMap = new Map<number, { totalNet: number; totalOrders: number; count: number }>();
  for (const store of currentPerStore) {
    for (const row of store.daily) {
      const dow = new Date(row.date + "T12:00:00").getDay();
      const prev = weekdayMap.get(dow) ?? { totalNet: 0, totalOrders: 0, count: 0 };
      weekdayMap.set(dow, {
        totalNet: prev.totalNet + row.netAmount,
        totalOrders: prev.totalOrders + row.orders,
        count: prev.count + 1
      });
    }
  }
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const bucket = weekdayMap.get(dow) ?? { totalNet: 0, totalOrders: 0, count: 1 };
    return {
      dow,
      label: WEEKDAY_LABELS[dow],
      avgNet: round2(bucket.totalNet / Math.max(1, bucket.count)),
      avgOrders: Math.round(bucket.totalOrders / Math.max(1, bucket.count))
    };
  });

  const ticketByStore = currentPerStore.map((row, idx) => {
    const prevRow = prevPerStore[idx];
    const curTicket = row.totals.orders > 0 ? row.totals.grossAmount / row.totals.orders : 0;
    const prevTicket = prevRow && prevRow.totals.orders > 0
      ? prevRow.totals.grossAmount / prevRow.totals.orders
      : 0;
    return {
      storeId: row.storeId ?? "",
      storeLabel: row.storeLabel,
      ticket: round2(curTicket),
      deltaPercent: delta(curTicket, prevTicket)
    };
  });

  const alerts: PainelDonoInsights["alerts"] = [];
  if (breakdown.ifoodFeePercent > ALERT_THRESHOLDS.IFOOD_FEE_PERCENT_WARN) {
    alerts.push({
      severity: "warn",
      title: "Taxa iFood alta",
      message: `Taxa iFood consumindo ${breakdown.ifoodFeePercent.toFixed(1)}% do bruto (limite saudável: ${ALERT_THRESHOLDS.IFOOD_FEE_PERCENT_WARN}%). Verifique plano contratado.`,
      storeId: null
    });
  }
  if (breakdown.promotionPercent > ALERT_THRESHOLDS.PROMO_PERCENT_WARN) {
    alerts.push({
      severity: "warn",
      title: "Promoções custeadas altas",
      message: `Promoção custeada pela loja em ${breakdown.promotionPercent.toFixed(1)}% do bruto. Avalie se está gerando pedidos incrementais.`,
      storeId: null
    });
  }
  if (breakdown.netPercent < ALERT_THRESHOLDS.NET_MARGIN_WARN) {
    alerts.push({
      severity: "danger",
      title: "Margem líquida baixa",
      message: `Líquido em ${breakdown.netPercent.toFixed(1)}% do bruto (alerta abaixo de ${ALERT_THRESHOLDS.NET_MARGIN_WARN}%). Custos totais estão consumindo muito.`,
      storeId: null
    });
  }
  for (const store of ranking) {
    if (store.deltaVsPreviousMonthPercent < ALERT_THRESHOLDS.MOM_DROP_DANGER) {
      alerts.push({
        severity: "danger",
        title: `${store.storeLabel} caiu`,
        message: `Líquido caiu ${Math.abs(store.deltaVsPreviousMonthPercent).toFixed(1)}% vs mês anterior. Investigue avaliações, tempo de entrega, cancelamentos.`,
        storeId: store.storeId
      });
    }
  }

  const currentTicket = cur.orders > 0 ? cur.grossAmount / cur.orders : 0;
  const prevTicket = prevT.orders > 0 ? prevT.grossAmount / prevT.orders : 0;
  const yearTicket = yearT.orders > 0 ? yearT.grossAmount / yearT.orders : 0;

  return {
    period: { year: params.year, month: params.month, todayDay, daysInMonth },
    current: {
      orders: cur.orders,
      grossAmount: round2(cur.grossAmount),
      netAmount: round2(cur.netAmount),
      ticketAverage: round2(currentTicket)
    },
    previousMonth: {
      orders: prevT.orders,
      grossAmount: round2(prevT.grossAmount),
      netAmount: round2(prevT.netAmount),
      ticketAverage: round2(prevTicket),
      deltaGrossPercent: delta(cur.grossAmount, prevT.grossAmount),
      deltaNetPercent: delta(cur.netAmount, prevT.netAmount)
    },
    lastYear: {
      orders: yearT.orders,
      grossAmount: round2(yearT.grossAmount),
      netAmount: round2(yearT.netAmount),
      ticketAverage: round2(yearTicket),
      deltaGrossPercent: delta(cur.grossAmount, yearT.grossAmount),
      deltaNetPercent: delta(cur.netAmount, yearT.netAmount)
    },
    projection,
    ranking,
    breakdown,
    weekday,
    ticketByStore,
    alerts,
    isMock: true
  };
}
