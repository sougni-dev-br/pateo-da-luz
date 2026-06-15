import { Router } from "express";
import { prisma } from "../../config/database.js";
import { requireRole } from "../security/security-utils.js";

export const dashboardRouter = Router();

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: unknown, fallback: Date) {
  const raw = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return dateKey(fallback);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

dashboardRouter.get("/purchases", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const now = new Date();
  const year = Number(request.query.year ?? now.getFullYear());
  const month = request.query.month ? Number(request.query.month) : now.getMonth() + 1;
  const startKey = parseDateKey(request.query.startDate, new Date(year, month - 1, 1));
  const endKey = parseDateKey(request.query.endDate, new Date(year, month, 0));
  const startDate = `${startKey} 00:00:00`;
  const endDate = `${endKey} 23:59:59.999`;
  const isMonthFilter = !request.query.startDate && !request.query.endDate && Number.isFinite(year) && Number.isFinite(month);
  const [startYear, startMonth] = startKey.split("-").map(Number);
  const previousMonthDate = new Date(startYear, startMonth - 2, 1);
  const previousYear = previousMonthDate.getFullYear();
  const previousMonth = previousMonthDate.getMonth() + 1;

  const purchaseIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Purchase"
    WHERE (
        ("purchaseDate" >= CAST(${startDate} AS timestamp)
          AND "purchaseDate" <= CAST(${endDate} AS timestamp))
        OR (${isMonthFilter} AND "competenceYear" = ${year} AND "competenceMonth" = ${month})
      )
      AND "status" = 'ACTIVE'
  `;

  const previousIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Purchase"
    WHERE "competenceYear" = ${previousYear}
      AND "competenceMonth" = ${previousMonth}
      AND "status" = 'ACTIVE'
  `;

  const [revenue] = await prisma.$queryRaw<Array<{
    grossAmount: unknown;
    serviceAmount: unknown;
    netAmount: unknown;
    tickets: unknown;
    count: unknown;
  }>>`
    SELECT
      COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
      COALESCE(SUM("serviceAmount"), 0) AS "serviceAmount",
      COALESCE(SUM("netAmount"), 0) AS "netAmount",
      COALESCE(SUM("tickets"), 0) AS "tickets",
      COUNT(*) AS "count"
    FROM "RevenueEntry"
    WHERE "date" >= CAST(${startDate} AS timestamp)
      AND "date" <= CAST(${endDate} AS timestamp)
      AND "status" <> 'CANCELLED'
  `;

  const revenueByChannel = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      "channel",
      COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
      COALESCE(SUM("netAmount"), 0) AS "netAmount",
      COALESCE(SUM("tickets"), 0) AS "tickets",
      COUNT(*) AS "count"
    FROM "RevenueEntry"
    WHERE "date" >= CAST(${startDate} AS timestamp)
      AND "date" <= CAST(${endDate} AS timestamp)
      AND "status" <> 'CANCELLED'
    GROUP BY "channel"
    ORDER BY SUM("netAmount") DESC
  `;

  const [purchases, previousPurchases] = await Promise.all([
    prisma.purchase.findMany({
      where: { id: { in: purchaseIds.map((row) => row.id) } },
      include: { supplier: true, items: { include: { product: { include: { category: true } } } } },
      orderBy: { purchaseDate: "desc" }
    }),
    prisma.purchase.findMany({
      where: { id: { in: previousIds.map((row) => row.id) } },
      select: { totalAmount: true }
    })
  ]);

  const totalAmount = purchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0);
  const previousTotalAmount = previousPurchases.reduce(
    (sum, purchase) => sum + Number(purchase.totalAmount),
    0
  );
  const byCategory = new Map<string, number>();
  const bySupplier = new Map<string, number>();
  const byProduct = new Map<string, { total: number; quantity: number }>();

  for (const purchase of purchases) {
    bySupplier.set(
      purchase.supplier.name,
      (bySupplier.get(purchase.supplier.name) ?? 0) + Number(purchase.totalAmount)
    );

    for (const item of purchase.items) {
      const category = item.rawCategory ?? item.product.category?.name ?? "Sem categoria";
      byCategory.set(category, (byCategory.get(category) ?? 0) + Number(item.totalPrice));

      const product = item.product.name;
      const current = byProduct.get(product) ?? { total: 0, quantity: 0 };
      current.total += Number(item.totalPrice);
      current.quantity += Number(item.quantity);
      byProduct.set(product, current);
    }
  }

  const sortTotal = <T extends { total: number }>(items: T[]) =>
    items.sort((a, b) => b.total - a.total);

  response.json({
    year,
    month,
    startDate: startKey,
    endDate: endKey,
    totalAmount,
    previousMonth,
    previousYear,
    previousTotalAmount,
    comparisonAmount: totalAmount - previousTotalAmount,
    comparisonPercent:
      previousTotalAmount > 0 ? ((totalAmount - previousTotalAmount) / previousTotalAmount) * 100 : null,
    revenue: {
      grossAmount: Number(revenue?.grossAmount ?? 0),
      serviceAmount: Number(revenue?.serviceAmount ?? 0),
      netAmount: Number(revenue?.netAmount ?? 0),
      tickets: Number(revenue?.tickets ?? 0),
      ticketAverageGeneral: Number(revenue?.tickets ?? 0) > 0
        ? Number(revenue?.grossAmount ?? 0) / Number(revenue?.tickets ?? 0)
        : 0,
      count: Number(revenue?.count ?? 0),
      byChannel: revenueByChannel.map((row) => ({
        channel: String(row.channel ?? "-"),
        grossAmount: Number(row.grossAmount ?? 0),
        netAmount: Number(row.netAmount ?? 0),
        tickets: Number(row.tickets ?? 0),
        count: Number(row.count ?? 0)
      }))
    },
    bySupplier: sortTotal(
      [...bySupplier.entries()].map(([name, total]) => ({ name, total }))
    ).slice(0, 10),
    byCategory: sortTotal(
      [...byCategory.entries()].map(([name, total]) => ({ name, total }))
    ).slice(0, 10),
    byProduct: sortTotal(
      [...byProduct.entries()].map(([name, values]) => ({ name, ...values }))
    ).slice(0, 10),
    recentPurchases: purchases.slice(0, 20)
  });
});
