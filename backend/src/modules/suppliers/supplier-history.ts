import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { excludeAggregatorsSql } from "../purchases/purchase-aggregators.js";
import { summarizeTitle, type TitleState, type TitleSummary } from "./supplier-history-title.js";

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;
const MAX_EXPORT_ROWS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_FILTERS = ["open", "overdue", "paid", "none"] as const;

export type TitleFilter = (typeof TITLE_FILTERS)[number];

export type SupplierHistoryQuery = {
  from: Date | null;
  /** Primeiro instante FORA do período (o fim informado é inclusivo). */
  toExclusive: Date | null;
  page: number;
  pageSize: number;
  search: string | null;
  includeCancelled: boolean;
  titleFilter: TitleFilter | null;
  /** Traz todas as compras do filtro numa resposta só (exportação), sem paginar. */
  all: boolean;
};

function parseIsoDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  // 2026-02-31 passa na regex e o Date "rola" para março: rejeita comparando de volta.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** Lê e saneia a query string: valor inválido nunca quebra a tela, só cai no padrão. */
export function parseSupplierHistoryQuery(query: Record<string, unknown>): SupplierHistoryQuery {
  let from = parseIsoDay(query.from);
  let to = parseIsoDay(query.to);
  if (from && to && from.getTime() > to.getTime()) [from, to] = [to, from];
  const toExclusive = to ? new Date(to.getTime() + DAY_MS) : null;
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const titleFilter = TITLE_FILTERS.find((filter) => filter === query.titleState) ?? null;

  return {
    from,
    toExclusive,
    page: parsePositiveInt(query.page, 1, 100_000),
    pageSize: parsePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    search: search || null,
    includeCancelled: query.includeCancelled === "true",
    titleFilter,
    all: query.all === "true"
  };
}

/** Hoje no fuso do restaurante, como meia-noite UTC (as datas de vencimento são dias UTC). */
export function restaurantToday(now: Date = new Date()): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  return new Date(`${day}T00:00:00.000Z`);
}

type PurchaseRow = {
  id: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  purchaseDate: Date;
  totalAmount: string;
  status: string;
  paymentMethod: string | null;
};

export type SupplierHistoryPurchase = PurchaseRow & { title: TitleSummary };

type TitleBucket = { count: number; amount: number };

export type SupplierHistoryResult = {
  period: { from: string | null; to: string | null };
  periodTotal: number;
  purchaseCount: number;
  lastPurchase: { id: string; purchaseDate: Date; totalAmount: string; purchaseNumber: string | null; invoiceNumber: string | null } | null;
  averagePaymentTermDays: number | null;
  /** `truncated`: no modo `all`, havia mais compras do que o teto de exportação. */
  purchases: { items: SupplierHistoryPurchase[]; total: number; page: number; pageSize: number; truncated: boolean };
  /** Compras do filtro atual (período, busca, canceladas) por situação do título, antes do filtro de situação. */
  titleBuckets: Record<"all" | "open" | "overdue" | "paid" | "none", TitleBucket>;
  paymentMethods: Array<{ name: string; count: number; total: string }>;
};

function periodSql(query: SupplierHistoryQuery): Prisma.Sql {
  return Prisma.sql`
    ${query.from ? Prisma.sql`AND pu."purchaseDate" >= ${query.from}` : Prisma.empty}
    ${query.toExclusive ? Prisma.sql`AND pu."purchaseDate" < ${query.toExclusive}` : Prisma.empty}`;
}

/**
 * Título de cada compra. Compra de fornecedor de ciclo não gera título própria: quem gera é o
 * fechamento do ciclo (a Purchase agregadora). Ela aponta para esse título; se o ciclo ainda
 * não fechou, não há título e a linha fica "sem título", marcada como de ciclo.
 */
async function loadTitles(purchases: PurchaseRow[], today: Date): Promise<Map<string, TitleSummary>> {
  const live = purchases.filter((purchase) => purchase.status !== "CANCELLED");
  const result = new Map<string, TitleSummary>();
  if (live.length === 0) return result;

  const ids = live.map((purchase) => purchase.id);
  const cycleLinks = await prisma.$queryRaw<Array<{ purchaseId: string; generatedPurchaseId: string | null }>>`
    SELECT ci."purchaseId", cy."generatedPurchaseId"
    FROM "SupplierBillingCycleItem" ci
    JOIN "SupplierBillingCycle" cy ON cy."id" = ci."cycleId"
    WHERE ci."purchaseId" IN (${Prisma.join(ids)})`;
  const cycleByPurchase = new Map(cycleLinks.map((link) => [link.purchaseId, link.generatedPurchaseId]));
  const ownerOf = (purchaseId: string): string | null => (cycleByPurchase.has(purchaseId) ? cycleByPurchase.get(purchaseId) ?? null : purchaseId);

  const ownerIds = [...new Set(ids.flatMap((id) => ownerOf(id) ?? []))];
  const installments = ownerIds.length === 0 ? [] : await prisma.paymentInstallment.findMany({
    where: { purchaseId: { in: ownerIds } },
    select: { purchaseId: true, installment: true, status: true, dueDate: true, paidDate: true, amount: true, paidAmount: true }
  });
  const byOwner = new Map<string, typeof installments>();
  for (const installment of installments) byOwner.set(installment.purchaseId, [...(byOwner.get(installment.purchaseId) ?? []), installment]);

  for (const id of ids) {
    const owner = ownerOf(id);
    const rows = (owner ? byOwner.get(owner) ?? [] : []).map((row) => ({
      installment: row.installment,
      status: row.status,
      dueDate: row.dueDate,
      paidDate: row.paidDate,
      amount: row.amount === null ? null : Number(row.amount),
      paidAmount: row.paidAmount === null ? null : Number(row.paidAmount)
    }));
    result.set(id, summarizeTitle(rows, today, cycleByPurchase.has(id)));
  }
  return result;
}

const STATE_TO_FILTER: Record<TitleState, TitleFilter> = { OPEN: "open", OVERDUE: "overdue", PAID: "paid", NONE: "none" };

/**
 * Tudo o que o modal soma sai da MESMA base: compras do fornecedor no período, sem cancelada
 * e sem agregador de ciclo/fatura/reembolso (que repetiria a despesa das compras que ele
 * agrupa). A lista pode incluir canceladas quando o usuário pede, e a "última compra" é do
 * histórico todo.
 */
export async function loadSupplierHistory(supplierId: string, query: SupplierHistoryQuery, now: Date = new Date()): Promise<SupplierHistoryResult> {
  const period = periodSql(query);
  const today = restaurantToday(now);
  const realPurchase = Prisma.sql`pu."supplierId" = ${supplierId} AND pu."status" <> 'CANCELLED' AND ${excludeAggregatorsSql("pu")}`;
  const search = query.search ? `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const listStatus = query.includeCancelled ? Prisma.empty : Prisma.sql`AND pu."status" <> 'CANCELLED'`;
  const listSearch = search ? Prisma.sql`AND (pu."invoiceNumber" ILIKE ${search} OR pu."purchaseNumber" ILIKE ${search})` : Prisma.empty;
  const listWhere = Prisma.sql`pu."supplierId" = ${supplierId} AND ${excludeAggregatorsSql("pu")} ${listStatus} ${listSearch} ${period}`;

  const [summary, lastPurchase, scopePurchases, paymentMethods, averageTerm] = await Promise.all([
    prisma.$queryRaw<Array<{ total: string | null; count: number }>>`
      SELECT SUM(pu."totalAmount")::text AS "total", COUNT(*)::int AS "count"
      FROM "Purchase" pu WHERE ${realPurchase} ${period}`,
    prisma.$queryRaw<Array<{ id: string; purchaseDate: Date; totalAmount: string; purchaseNumber: string | null; invoiceNumber: string | null }>>`
      SELECT pu."id", pu."purchaseDate", pu."totalAmount"::text AS "totalAmount", pu."purchaseNumber", pu."invoiceNumber"
      FROM "Purchase" pu WHERE ${realPurchase}
      ORDER BY pu."purchaseDate" DESC, pu."createdAt" DESC LIMIT 1`,
    prisma.$queryRaw<PurchaseRow[]>`
      SELECT pu."id", pu."purchaseNumber", pu."invoiceNumber", pu."purchaseDate",
             pu."totalAmount"::text AS "totalAmount", pu."status", pu."paymentMethod"
      FROM "Purchase" pu WHERE ${listWhere}
      ORDER BY pu."purchaseDate" DESC, pu."createdAt" DESC`,
    prisma.$queryRaw<SupplierHistoryResult["paymentMethods"]>`
      SELECT COALESCE(pu."paymentMethod", 'Sem pagamento') AS "name", COUNT(*)::int AS "count", SUM(pu."totalAmount")::text AS "total"
      FROM "Purchase" pu WHERE ${realPurchase} ${period}
      GROUP BY COALESCE(pu."paymentMethod", 'Sem pagamento')
      ORDER BY SUM(pu."totalAmount") DESC`,
    prisma.$queryRaw<Array<{ days: string | null }>>`
      -- Parcela que vence antes da compra (pago na hora) conta como à vista, não como prazo negativo.
      SELECT AVG(GREATEST(0, EXTRACT(DAY FROM pi."dueDate" - pu."purchaseDate")))::text AS "days"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" pu ON pu."id" = pi."purchaseId"
      WHERE ${realPurchase} AND pi."dueDate" IS NOT NULL AND pi."status" <> 'CANCELLED' ${period}`
  ]);

  const titles = await loadTitles(scopePurchases, today);
  const withTitle: SupplierHistoryPurchase[] = scopePurchases.map((purchase) => ({
    ...purchase,
    title: titles.get(purchase.id) ?? summarizeTitle([], today, false)
  }));

  const titleBuckets: SupplierHistoryResult["titleBuckets"] = {
    all: { count: 0, amount: 0 }, open: { count: 0, amount: 0 }, overdue: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 }, none: { count: 0, amount: 0 }
  };
  for (const purchase of withTitle) {
    if (purchase.status === "CANCELLED") continue;
    for (const key of ["all", STATE_TO_FILTER[purchase.title.state]] as const) {
      titleBuckets[key].count += 1;
      titleBuckets[key].amount += Number(purchase.totalAmount);
    }
  }

  const filtered = query.titleFilter
    ? withTitle.filter((purchase) => purchase.status !== "CANCELLED" && STATE_TO_FILTER[purchase.title.state] === query.titleFilter)
    : withTitle;
  const pageSize = query.all ? MAX_EXPORT_ROWS : query.pageSize;
  const offset = query.all ? 0 : (query.page - 1) * query.pageSize;
  const inclusiveTo = query.toExclusive ? new Date(query.toExclusive.getTime() - DAY_MS) : null;

  return {
    period: { from: query.from?.toISOString().slice(0, 10) ?? null, to: inclusiveTo?.toISOString().slice(0, 10) ?? null },
    periodTotal: Number(summary[0]?.total ?? 0),
    purchaseCount: summary[0]?.count ?? 0,
    lastPurchase: lastPurchase[0] ?? null,
    averagePaymentTermDays: averageTerm[0]?.days ? Number(averageTerm[0].days) : null,
    purchases: {
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page: query.all ? 1 : query.page,
      pageSize,
      truncated: query.all && filtered.length > MAX_EXPORT_ROWS
    },
    titleBuckets,
    paymentMethods
  };
}
