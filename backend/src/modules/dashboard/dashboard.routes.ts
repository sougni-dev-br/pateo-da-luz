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

// ─────────────────────────────────────────────
// GET /dashboard/summary?year=YYYY&month=MM
// Resumo financeiro consolidado do período:
// faturamento, compras, pequenos gastos, CMV Real, resultado estimado
// ─────────────────────────────────────────────

dashboardRouter.get("/summary", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const now = new Date();
  const year = Number(request.query.year ?? now.getFullYear());
  const month = Number(request.query.month ?? now.getMonth() + 1);

  const previousMonthDate = new Date(year, month - 2, 1);
  const prevYear = previousMonthDate.getFullYear();
  const prevMonth = previousMonthDate.getMonth() + 1;

  // ── Buscar tudo em paralelo ──
  const [
    revRow,
    prevRevRow,
    purchasesRow,
    prevPurchasesRow,
    smallExpRow,
    prevSmallExpRow,
    monthlyCmv,
  ] = await Promise.all([
    // Faturamento período atual (por competência)
    prisma.$queryRaw<Array<{ grossAmount: unknown; netAmount: unknown; serviceAmount: unknown; tickets: unknown; count: unknown }>>`
      SELECT
        COALESCE(SUM("grossAmount"), 0)   AS "grossAmount",
        COALESCE(SUM("netAmount"), 0)     AS "netAmount",
        COALESCE(SUM("serviceAmount"), 0) AS "serviceAmount",
        COALESCE(SUM("tickets"), 0)       AS "tickets",
        COUNT(*)                          AS "count"
      FROM "RevenueEntry"
      WHERE "competenceYear" = ${year}
        AND "competenceMonth" = ${month}
        AND "status" <> 'CANCELLED'
    `,
    // Faturamento mês anterior
    prisma.$queryRaw<Array<{ netAmount: unknown; grossAmount: unknown }>>`
      SELECT
        COALESCE(SUM("netAmount"), 0)   AS "netAmount",
        COALESCE(SUM("grossAmount"), 0) AS "grossAmount"
      FROM "RevenueEntry"
      WHERE "competenceYear" = ${prevYear}
        AND "competenceMonth" = ${prevMonth}
        AND "status" <> 'CANCELLED'
    `,
    // Compras regulares período atual (sem pequenos gastos)
    prisma.$queryRaw<Array<{ total: unknown; cnt: unknown }>>`
      SELECT COALESCE(SUM("totalAmount"), 0) AS total, COUNT(*) AS cnt
      FROM "Purchase"
      WHERE "competenceYear" = ${year}
        AND "competenceMonth" = ${month}
        AND "status" = 'ACTIVE'
        AND ("isSmallExpense" = false OR "isSmallExpense" IS NULL)
    `,
    // Compras regulares mês anterior
    prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM("totalAmount"), 0) AS total
      FROM "Purchase"
      WHERE "competenceYear" = ${prevYear}
        AND "competenceMonth" = ${prevMonth}
        AND "status" = 'ACTIVE'
        AND ("isSmallExpense" = false OR "isSmallExpense" IS NULL)
    `,
    // Pequenos gastos período atual
    prisma.$queryRaw<Array<{ total: unknown; cnt: unknown }>>`
      SELECT COALESCE(SUM("totalAmount"), 0) AS total, COUNT(*) AS cnt
      FROM "Purchase"
      WHERE "competenceYear" = ${year}
        AND "competenceMonth" = ${month}
        AND "status" = 'ACTIVE'
        AND "isSmallExpense" = true
    `,
    // Pequenos gastos mês anterior
    prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM("totalAmount"), 0) AS total
      FROM "Purchase"
      WHERE "competenceYear" = ${prevYear}
        AND "competenceMonth" = ${prevMonth}
        AND "status" = 'ACTIVE'
        AND "isSmallExpense" = true
    `,
    // CMV Real (fechamento mensal)
    prisma.monthlyCmv.findFirst({
      where: { competenceYear: year, competenceMonth: month },
      select: {
        status: true,
        realCmvValue: true,
        cmvPercent: true,
        estimatedGrossMargin: true,
        revenueNetValue: true,
        purchasesValue: true,
      }
    }),
  ]);

  // ── Extrair valores ──
  const revNet       = Number(revRow[0]?.netAmount    ?? 0);
  const revGross     = Number(revRow[0]?.grossAmount  ?? 0);
  const revService   = Number(revRow[0]?.serviceAmount ?? 0);
  const revTickets   = Number(revRow[0]?.tickets      ?? 0);
  const revCount     = Number(revRow[0]?.count        ?? 0);
  const prevRevNet   = Number(prevRevRow[0]?.netAmount   ?? 0);
  const prevRevGross = Number(prevRevRow[0]?.grossAmount ?? 0);

  const purchasesTotal     = Number(purchasesRow[0]?.total     ?? 0);
  const purchasesCount     = Number(purchasesRow[0]?.cnt       ?? 0);
  const prevPurchasesTotal = Number(prevPurchasesRow[0]?.total ?? 0);

  const smallExpTotal     = Number(smallExpRow[0]?.total     ?? 0);
  const smallExpCount     = Number(smallExpRow[0]?.cnt       ?? 0);
  const prevSmallExpTotal = Number(prevSmallExpRow[0]?.total ?? 0);

  const cmvStatus: "closed" | "pending" | "missing" =
    monthlyCmv?.status === "CLOSED" ? "closed" :
    monthlyCmv           ? "pending" :
                           "missing";
  const cmvRealValue = cmvStatus === "closed" ? Number(monthlyCmv!.realCmvValue ?? 0) : null;
  const cmvPercent   = cmvStatus === "closed" ? Number(monthlyCmv!.cmvPercent   ?? 0) : null;

  // Resultado estimado = faturamento líquido - compras - pequenos gastos
  const estimatedResult = revNet - purchasesTotal - smallExpTotal;
  const estimatedMargin = revNet > 0 ? (estimatedResult / revNet) * 100 : null;

  const delta = (current: number, previous: number) =>
    previous > 0 ? ((current - previous) / previous) * 100 : null;

  response.json({
    year,
    month,
    revenue: {
      grossAmount: revGross,
      netAmount: revNet,
      serviceAmount: revService,
      tickets: revTickets,
      count: revCount,
      ticketAverage: revTickets > 0 ? revGross / revTickets : 0,
      prev: { grossAmount: prevRevGross, netAmount: prevRevNet },
      deltaPercent: delta(revNet, prevRevNet),
    },
    purchases: {
      total: purchasesTotal,
      count: purchasesCount,
      prev: { total: prevPurchasesTotal },
      deltaPercent: delta(purchasesTotal, prevPurchasesTotal),
    },
    smallExpenses: {
      total: smallExpTotal,
      count: smallExpCount,
      prev: { total: prevSmallExpTotal },
      deltaPercent: delta(smallExpTotal, prevSmallExpTotal),
    },
    cmvReal: {
      status: cmvStatus,
      value: cmvRealValue,
      percent: cmvPercent,
    },
    estimatedResult: {
      value: estimatedResult,
      marginPercent: estimatedMargin,
    },
  });
});

// ─────────────────────────────────────────────
// GET /dashboard/alerts?competence=YYYY-MM
// ─────────────────────────────────────────────

dashboardRouter.get("/alerts", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const now = new Date();
  const competence = String(request.query.competence ?? "");
  const match = /^(\d{4})-(\d{2})$/.exec(competence);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;

  // Midnight UTC — garante resultado idêntico ao CURRENT_DATE do Postgres,
  // independente do timezone da máquina (local, Render, CI).
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  // ── 1. Parcelas vencidas (global, não filtrado por competência) ──
  const overdueRows = await prisma.$queryRaw<Array<{ cnt: unknown; total: unknown }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
    FROM "PaymentInstallment"
    WHERE status = 'OPEN'
      AND "dueDate" IS NOT NULL
      AND "dueDate" < ${today}
      AND "paidDate" IS NULL
  `;
  const overdueCount = Number(overdueRows[0]?.cnt ?? 0);
  const overdueAmount = Number(overdueRows[0]?.total ?? 0);

  // ── 2. Parcelas a vencer em 7 dias (global) ──
  const dueSoonRows = await prisma.$queryRaw<Array<{ cnt: unknown; total: unknown }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
    FROM "PaymentInstallment"
    WHERE status = 'OPEN'
      AND "dueDate" IS NOT NULL
      AND "dueDate" >= ${today}
      AND "dueDate" <= ${in7Days}
      AND "paidDate" IS NULL
  `;
  const dueSoonCount = Number(dueSoonRows[0]?.cnt ?? 0);
  const dueSoonAmount = Number(dueSoonRows[0]?.total ?? 0);

  // ── 3. Compras a prazo sem parcelas vinculadas (competência) ──
  const unpaidRows = await prisma.$queryRaw<Array<{ cnt: unknown; total: unknown }>>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(p."totalAmount"), 0) AS total
    FROM "Purchase" p
    WHERE p."competenceYear" = ${year}
      AND p."competenceMonth" = ${month}
      AND p."status" = 'ACTIVE'
      AND p."paymentRegime" = 'ACCRUAL'
      AND NOT EXISTS (
        SELECT 1 FROM "PaymentInstallment" pi WHERE pi."purchaseId" = p.id
      )
  `;
  const unpaidCount = Number(unpaidRows[0]?.cnt ?? 0);
  const unpaidAmount = Number(unpaidRows[0]?.total ?? 0);

  // ── 4. Dias sem lançamento de faturamento (competência, até ontem) ──
  // Usa ontem como limite para não acusar o dia atual como "faltante" quando a importação ainda não ocorreu.
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month
  const rangeEnd = yesterday < monthEnd ? yesterday : monthEnd;

  let missingRevenueDays = 0;
  if (monthStart <= rangeEnd) {
    const startStr = `${year}-${String(month).padStart(2, "0")}-01 00:00:00`;
    const endStr = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, "0")}-${String(rangeEnd.getDate()).padStart(2, "0")} 23:59:59`;
    const coveredRows = await prisma.$queryRaw<Array<{ d: Date }>>`
      SELECT DISTINCT CAST("date" AS DATE) AS d
      FROM "RevenueEntry"
      WHERE "date" >= CAST(${startStr} AS timestamp)
        AND "date" <= CAST(${endStr} AS timestamp)
        AND status <> 'CANCELLED'
    `;
    const coveredDates = new Set(
      coveredRows.map((r) => {
        const d = new Date(r.d);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      })
    );
    let cursor = new Date(monthStart);
    while (cursor <= rangeEnd) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (!coveredDates.has(key)) missingRevenueDays++;
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  // ── 5. Status do CMV / inventário final (competência) ──
  const [finalSnapshot, monthlyCmv] = await Promise.all([
    prisma.inventorySnapshot.findFirst({
      where: { competenceYear: year, competenceMonth: month, type: "INVENTARIO_FINAL", status: "ACTIVE" },
      select: { id: true }
    }),
    prisma.monthlyCmv.findFirst({
      where: { competenceYear: year, competenceMonth: month },
      select: { status: true }
    })
  ]);

  let cmvStatus: "closed" | "pending" | "missing" | "unknown";
  if (monthlyCmv?.status === "CLOSED") {
    cmvStatus = "closed";
  } else if (finalSnapshot || monthlyCmv) {
    cmvStatus = "pending";
  } else {
    cmvStatus = "missing";
  }

  // ── Montar lista de alertas ──
  type AlertType = "danger" | "warning" | "info" | "success";
  const alerts: Array<{
    type: AlertType;
    code: string;
    title: string;
    description: string;
    count?: number;
    amount?: number;
    actionLabel?: string;
    actionPath?: string;
  }> = [];

  // Alertas globais (independentes da competência — refletem situação atual do financeiro)
  if (overdueCount > 0) {
    alerts.push({
      type: "danger",
      code: "OVERDUE_PAYABLES",
      title: "Pendências financeiras — contas vencidas",
      description: `${overdueCount} parcela${overdueCount !== 1 ? "s" : ""} vencida${overdueCount !== 1 ? "s" : ""} até hoje sem pagamento registrado.`,
      count: overdueCount,
      amount: overdueAmount,
      actionLabel: "Ver contas a pagar",
      actionPath: "/financeiro/contas-a-pagar"
    });
  }

  if (dueSoonCount > 0) {
    alerts.push({
      type: "warning",
      code: "DUE_SOON_PAYABLES",
      title: "Pendências financeiras — a vencer",
      description: `${dueSoonCount} parcela${dueSoonCount !== 1 ? "s" : ""} vence${dueSoonCount !== 1 ? "m" : ""} nos próximos 7 dias.`,
      count: dueSoonCount,
      amount: dueSoonAmount,
      actionLabel: "Ver contas a pagar",
      actionPath: "/financeiro/contas-a-pagar"
    });
  }

  // Alertas da competência selecionada
  if (unpaidCount > 0) {
    alerts.push({
      type: "warning",
      code: "PURCHASES_WITHOUT_INSTALLMENTS",
      title: "Compras sem parcelamento identificado",
      description: `${unpaidCount} compra${unpaidCount !== 1 ? "s" : ""} a prazo sem parcelas registradas nesta competência.`,
      count: unpaidCount,
      amount: unpaidAmount,
      actionLabel: "Ver compras",
      actionPath: "/compras"
    });
  }

  if (missingRevenueDays > 0) {
    alerts.push({
      type: "warning",
      code: "MISSING_REVENUE_DAYS",
      title: "Faturamento com dias em aberto",
      description: `${missingRevenueDays} dia${missingRevenueDays !== 1 ? "s" : ""} sem lançamento de faturamento até ontem nesta competência.`,
      count: missingRevenueDays,
      actionLabel: "Ver faturamento",
      actionPath: "/financeiro/faturamento"
    });
  }

  if (cmvStatus === "missing") {
    alerts.push({
      type: "info",
      code: "CMV_NO_INVENTORY",
      title: "Inventário final não registrado",
      description: "Nenhum inventário final registrado para esta competência.",
      actionLabel: "Ver fechamento",
      actionPath: "/cmv/fechamento-mensal"
    });
  } else if (cmvStatus === "pending") {
    alerts.push({
      type: "info",
      code: "CMV_PENDING_CLOSE",
      title: "Fechamento mensal em aberto",
      description: "Inventário final registrado, mas fechamento do CMV ainda não concluído.",
      actionLabel: "Ver fechamento",
      actionPath: "/cmv/fechamento-mensal"
    });
  }

  response.json({
    competence: `${year}-${String(month).padStart(2, "0")}`,
    alerts,
    summary: {
      overduePayablesCount: overdueCount,
      overduePayablesAmount: overdueAmount,
      dueSoonPayablesCount: dueSoonCount,
      dueSoonPayablesAmount: dueSoonAmount,
      unpaidPurchasesCount: unpaidCount,
      unpaidPurchasesAmount: unpaidAmount,
      missingRevenueDays,
      cmvStatus
    }
  });
});
