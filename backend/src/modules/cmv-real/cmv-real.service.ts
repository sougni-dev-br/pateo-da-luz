import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { createCmvRealPdf } from "./cmv-real-pdf.js";
import { auditLog } from "../security/security-utils.js";

type CmvPeriodStatus = "OPEN" | "CLOSED";

export type CmvPeriodInput = {
  id?: string;
  name: string;
  dataInicial: Date;
  dataFinal: Date;
  estoqueInicialSnapshotId: string;
  estoqueFinalSnapshotId: string;
  estoqueInicialSessionId?: string | null;
  estoqueFinalSessionId?: string | null;
  observacoes?: string | null;
  userId: string;
  userRole?: string;
  continuityOverrideReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type SnapshotRow = {
  id: string;
  type: string;
  countDate: Date;
  totalValue: Prisma.Decimal | null;
  originalFileName: string | null;
  status: string;
};

export type CmvSessionOption = {
  sessionId: string;
  code: string;
  source: string;
  referenceDate: string;
  periodMonth: number | null;
  periodYear: number | null;
  isMonthEnd: boolean;
  totalItems: number;
  linkedSnapshotId: string | null;
  snapshotTotalValue: number | null;
  notes: string | null;
};

type SessionRow = {
  sessionId: string;
  code: string;
  source: string;
  referenceDate: Date;
  periodMonth: number | null;
  periodYear: number | null;
  isMonthEnd: boolean;
  totalItems: bigint | number;
  linkedSnapshotId: string | null;
  snapshotTotalValue: Prisma.Decimal | null;
  notes: string | null;
};

type StockCountSessionBaseRow = {
  id: string;
  code: string;
  status: string;
  source: string;
  referenceDate: Date;
  isMonthEnd: boolean;
  periodMonth: number | null;
  periodYear: number | null;
  linkedSnapshotId: string | null;
};

type SessionItemRow = {
  productId: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string;
  sectorSnapshot: string | null;
  categorySnapshot: string | null;
  subcategorySnapshot: string | null;
  unitSnapshot: string | null;
  countedQuantity: Prisma.Decimal | null;
  unitCost: Prisma.Decimal | null;
};

type RevenueRow = {
  grossAmount: Prisma.Decimal | null;
  serviceAmount: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
  daysCount: bigint | number | null;
};

type PurchaseTotalRow = {
  totalAmount: Prisma.Decimal | null;
  purchasesCount: bigint | number | null;
};

type CategoryBreakdownRow = {
  categoryName: string | null;
  totalAmount: Prisma.Decimal | null;
  itemsCount: bigint | number | null;
};

type SupplierBreakdownRow = {
  supplierId: string;
  supplierName: string;
  supplierDocument: string | null;
  totalAmount: Prisma.Decimal | null;
  purchasesCount: bigint | number | null;
};

type ChannelBreakdownRow = {
  channel: string | null;
  grossAmount: Prisma.Decimal | null;
  netAmount: Prisma.Decimal | null;
  count: bigint | number | null;
};

type CmvPeriodRow = {
  id: string;
  code: string | null;
  name: string;
  dataInicial: Date;
  dataFinal: Date;
  estoqueInicialSnapshotId: string | null;
  estoqueFinalSnapshotId: string | null;
  estoqueInicialSessionId: string | null;
  estoqueFinalSessionId: string | null;
  comprasTotal: Prisma.Decimal | null;
  faturamentoTotal: Prisma.Decimal | null;
  estoqueInicialTotal: Prisma.Decimal | null;
  estoqueFinalTotal: Prisma.Decimal | null;
  cmvReal: Prisma.Decimal | null;
  cmvPercentual: Prisma.Decimal | null;
  margemBruta: Prisma.Decimal | null;
  status: CmvPeriodStatus;
  fechadoPor: string | null;
  fechadoEm: Date | null;
  reabertoPor: string | null;
  reabertoEm: Date | null;
  motivoReabertura: string | null;
  observacoes: string | null;
  createdAt: Date;
  updatedAt: Date;
  fechadoPorNome: string | null;
  reabertoPorNome: string | null;
  estoqueInicialSnapshotData: Date | null;
  estoqueFinalSnapshotData: Date | null;
  estoqueInicialSessionCode: string | null;
  estoqueFinalSessionCode: string | null;
};

export type CmvPeriodSummary = {
  id: string;
  code: string | null;
  name: string;
  dataInicial: string;
  dataFinal: string;
  estoqueInicialSnapshotId: string | null;
  estoqueFinalSnapshotId: string | null;
  estoqueInicialSessionId: string | null;
  estoqueFinalSessionId: string | null;
  estoqueInicialSnapshotData: string | null;
  estoqueFinalSnapshotData: string | null;
  estoqueInicialSessionCode: string | null;
  estoqueFinalSessionCode: string | null;
  comprasTotal: number;
  faturamentoTotal: number;
  estoqueInicialTotal: number;
  estoqueFinalTotal: number;
  cmvReal: number;
  cmvPercentual: number | null;
  margemBruta: number | null;
  status: CmvPeriodStatus;
  fechadoPor: string | null;
  fechadoPorNome: string | null;
  fechadoEm: string | null;
  reabertoPor: string | null;
  reabertoPorNome: string | null;
  reabertoEm: string | null;
  motivoReabertura: string | null;
  observacoes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CmvPeriodDetail = CmvPeriodSummary & {
  purchasesGrossTotal: number;
  purchasesCount: number;
  revenueGrossTotal: number;
  revenueServiceTotal: number;
  revenueNetTotal: number;
  revenueDaysCount: number;
  purchaseByCategory: Array<{ categoryName: string; totalAmount: number; itemsCount: number }>;
  purchaseBySupplier: Array<{ supplierId: string; supplierName: string; supplierDocument: string | null; totalAmount: number; purchasesCount: number }>;
  revenueByChannel: Array<{ channel: string; grossAmount: number; netAmount: number; count: number }>;
};

type CmvComputation = {
  comprasTotal: number;
  purchasesCount: number;
  faturamentoTotal: number;
  revenueGrossTotal: number;
  revenueServiceTotal: number;
  revenueNetTotal: number;
  revenueDaysCount: number;
  estoqueInicialTotal: number;
  estoqueFinalTotal: number;
  cmvReal: number;
  cmvPercentual: number | null;
  margemBruta: number | null;
  purchaseByCategory: CmvPeriodDetail["purchaseByCategory"];
  purchaseBySupplier: CmvPeriodDetail["purchaseBySupplier"];
  revenueByChannel: CmvPeriodDetail["revenueByChannel"];
};

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDateKey(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toDateKey(date);
}

function toLocalDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function toNumber(value: Prisma.Decimal | bigint | number | string | null | undefined) {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function formatBrDate(value: Date) {
  return value.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function labelPeriod(startDate: Date, endDate: Date) {
  return `CMV ${formatBrDate(startDate)} a ${formatBrDate(endDate)}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function periodRange(startDate: Date, endDate: Date) {
  const startKey = formatDateKey(startDate) ?? toDateKey(startDate);
  const endKey = formatDateKey(endDate) ?? toDateKey(endDate);
  return {
    start: `${startKey} 00:00:00`,
    end: `${endKey} 23:59:59.999`
  };
}

async function getSnapshotOrThrow(id: string) {
  const [snapshot] = await prisma.$queryRaw<Array<SnapshotRow>>`
    SELECT "id", "type"::text AS "type", "countDate", "totalValue", "originalFileName", "status"
    FROM "InventorySnapshot"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  if (!snapshot) throw new Error("Inventario informado nao encontrado.");
  const allowedStatuses = new Set(["ACTIVE", "APPROVED", "APROVADO", "FECHADO", "CLOSED"]);
  if (!allowedStatuses.has(String(snapshot.status ?? "").toUpperCase())) {
    throw new Error("Para fechar o CMV deste periodo, e necessario usar inventario ativo, aprovado ou fechado.");
  }
  return snapshot;
}

async function ensureSnapshotMatchesDate(snapshotId: string, expectedDate: Date, label: string) {
  const snapshot = await getSnapshotOrThrow(snapshotId);
  if (formatDateKey(snapshot.countDate) !== formatDateKey(expectedDate)) {
    throw new Error(`O inventario ${label} precisa ser da data ${toDateKey(expectedDate)}.`);
  }
  return snapshot;
}

async function purchaseTotals(startDate: Date, endDate: Date) {
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;
  const [row] = await prisma.$queryRaw<Array<PurchaseTotalRow>>`
    SELECT COALESCE(SUM("totalAmount"), 0) AS "totalAmount",
           COUNT(*) AS "purchasesCount"
    FROM "Purchase"
    WHERE "status" <> 'CANCELLED'
      AND MAKE_DATE("competenceYear", "competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE("competenceYear", "competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
  `;
  return {
    total: toNumber(row?.totalAmount),
    count: toNumber(row?.purchasesCount)
  };
}

async function revenueTotals(startDate: Date, endDate: Date) {
  const { start, end } = periodRange(startDate, endDate);
  const [row] = await prisma.$queryRaw<Array<RevenueRow>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
           COALESCE(SUM("serviceAmount"), 0) AS "serviceAmount",
           COALESCE(SUM("netAmount"), 0) AS "netAmount",
           COUNT(DISTINCT DATE("date" AT TIME ZONE 'UTC')) AS "daysCount"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= CAST(${start} AS timestamp)
      AND "date" <= CAST(${end} AS timestamp)
  `;
  return {
    gross: toNumber(row?.grossAmount),
    service: toNumber(row?.serviceAmount),
    net: toNumber(row?.netAmount),
    daysCount: toNumber(row?.daysCount)
  };
}

async function inventoryTotal(snapshotId: string) {
  const snapshot = await getSnapshotOrThrow(snapshotId);
  return {
    value: toNumber(snapshot.totalValue),
    snapshot
  };
}

async function purchaseByCategory(startDate: Date, endDate: Date) {
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;
  const rows = await prisma.$queryRaw<Array<CategoryBreakdownRow>>`
    SELECT
      COALESCE(c."name", pi."rawCategory", 'Sem categoria') AS "categoryName",
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(*) AS "itemsCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    LEFT JOIN "Product" pr ON pr."id" = pi."productId"
    LEFT JOIN "Category" c ON c."id" = pr."categoryId"
    WHERE p."status" <> 'CANCELLED'
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
    GROUP BY COALESCE(c."name", pi."rawCategory", 'Sem categoria')
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    categoryName: String(row.categoryName ?? "Sem categoria"),
    totalAmount: toNumber(row.totalAmount),
    itemsCount: toNumber(row.itemsCount)
  }));
}

async function purchaseBySupplier(startDate: Date, endDate: Date) {
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth() + 1;
  const rows = await prisma.$queryRaw<Array<SupplierBreakdownRow>>`
    SELECT
      s."id" AS "supplierId",
      s."name" AS "supplierName",
      s."document" AS "supplierDocument",
      COALESCE(SUM(p."totalAmount"), 0) AS "totalAmount",
      COUNT(*) AS "purchasesCount"
    FROM "Purchase" p
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."status" <> 'CANCELLED'
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
    GROUP BY s."id", s."name", s."document"
    ORDER BY COALESCE(SUM(p."totalAmount"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierDocument: row.supplierDocument,
    totalAmount: toNumber(row.totalAmount),
    purchasesCount: toNumber(row.purchasesCount)
  }));
}

async function revenueByChannel(startDate: Date, endDate: Date) {
  const { start, end } = periodRange(startDate, endDate);
  const rows = await prisma.$queryRaw<Array<ChannelBreakdownRow>>`
    SELECT
      "channel",
      COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
      COALESCE(SUM("netAmount"), 0) AS "netAmount",
      COUNT(*) AS "count"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= CAST(${start} AS timestamp)
      AND "date" <= CAST(${end} AS timestamp)
    GROUP BY "channel"
    ORDER BY COALESCE(SUM("netAmount"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    channel: String(row.channel ?? "Outros"),
    grossAmount: toNumber(row.grossAmount),
    netAmount: toNumber(row.netAmount),
    count: toNumber(row.count)
  }));
}

async function computePeriod(startDate: Date, endDate: Date, initialSnapshotId: string, finalSnapshotId: string): Promise<CmvComputation> {
  const [initialSnapshot, finalSnapshot, purchasesTotal, revenue, categories, suppliers, channels] = await Promise.all([
    inventoryTotal(initialSnapshotId),
    inventoryTotal(finalSnapshotId),
    purchaseTotals(startDate, endDate),
    revenueTotals(startDate, endDate),
    purchaseByCategory(startDate, endDate),
    purchaseBySupplier(startDate, endDate),
    revenueByChannel(startDate, endDate)
  ]);

  const cmvReal = initialSnapshot.value + purchasesTotal.total - finalSnapshot.value;
  const cmvPercentual = revenue.net > 0 ? cmvReal / revenue.net : null;
  const margemBruta = revenue.net - cmvReal;

  return {
    comprasTotal: purchasesTotal.total,
    purchasesCount: purchasesTotal.count,
    faturamentoTotal: revenue.net,
    revenueGrossTotal: revenue.gross,
    revenueServiceTotal: revenue.service,
    revenueNetTotal: revenue.net,
    revenueDaysCount: revenue.daysCount,
    estoqueInicialTotal: initialSnapshot.value,
    estoqueFinalTotal: finalSnapshot.value,
    cmvReal,
    cmvPercentual,
    margemBruta,
    purchaseByCategory: categories,
    purchaseBySupplier: suppliers,
    revenueByChannel: channels
  };
}

function mapRow(row: CmvPeriodRow): CmvPeriodSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    dataInicial: toDateKey(toLocalDate(row.dataInicial)),
    dataFinal: toDateKey(toLocalDate(row.dataFinal)),
    estoqueInicialSnapshotId: row.estoqueInicialSnapshotId,
    estoqueFinalSnapshotId: row.estoqueFinalSnapshotId,
    estoqueInicialSessionId: row.estoqueInicialSessionId,
    estoqueFinalSessionId: row.estoqueFinalSessionId,
    estoqueInicialSnapshotData: row.estoqueInicialSnapshotData ? toDateKey(toLocalDate(row.estoqueInicialSnapshotData)) : null,
    estoqueFinalSnapshotData: row.estoqueFinalSnapshotData ? toDateKey(toLocalDate(row.estoqueFinalSnapshotData)) : null,
    estoqueInicialSessionCode: row.estoqueInicialSessionCode,
    estoqueFinalSessionCode: row.estoqueFinalSessionCode,
    comprasTotal: toNumber(row.comprasTotal),
    faturamentoTotal: toNumber(row.faturamentoTotal),
    estoqueInicialTotal: toNumber(row.estoqueInicialTotal),
    estoqueFinalTotal: toNumber(row.estoqueFinalTotal),
    cmvReal: toNumber(row.cmvReal),
    cmvPercentual: row.cmvPercentual == null ? null : toNumber(row.cmvPercentual),
    margemBruta: row.margemBruta == null ? null : toNumber(row.margemBruta),
    status: row.status,
    fechadoPor: row.fechadoPor,
    fechadoPorNome: row.fechadoPorNome,
    fechadoEm: row.fechadoEm ? toLocalDate(row.fechadoEm).toISOString() : null,
    reabertoPor: row.reabertoPor,
    reabertoPorNome: row.reabertoPorNome,
    reabertoEm: row.reabertoEm ? toLocalDate(row.reabertoEm).toISOString() : null,
    motivoReabertura: row.motivoReabertura,
    observacoes: row.observacoes,
    createdAt: toLocalDate(row.createdAt).toISOString(),
    updatedAt: toLocalDate(row.updatedAt).toISOString()
  };
}

function applyComputation(period: CmvPeriodSummary, computation: CmvComputation): CmvPeriodSummary {
  return {
    ...period,
    comprasTotal: computation.comprasTotal,
    faturamentoTotal: computation.faturamentoTotal,
    estoqueInicialTotal: computation.estoqueInicialTotal,
    estoqueFinalTotal: computation.estoqueFinalTotal,
    cmvReal: computation.cmvReal,
    cmvPercentual: computation.cmvPercentual,
    margemBruta: computation.margemBruta
  };
}

async function loadPeriodRow(id: string) {
  const [row] = await prisma.$queryRaw<Array<CmvPeriodRow>>`
    SELECT
      p.*,
      u1."name" AS "fechadoPorNome",
      u2."name" AS "reabertoPorNome",
      i."countDate" AS "estoqueInicialSnapshotData",
      f."countDate" AS "estoqueFinalSnapshotData",
      si."code" AS "estoqueInicialSessionCode",
      sf."code" AS "estoqueFinalSessionCode"
    FROM "CmvPeriod" p
    LEFT JOIN "User" u1 ON u1."id" = p."fechadoPor"
    LEFT JOIN "User" u2 ON u2."id" = p."reabertoPor"
    LEFT JOIN "InventorySnapshot" i ON i."id" = p."estoqueInicialSnapshotId"
    LEFT JOIN "InventorySnapshot" f ON f."id" = p."estoqueFinalSnapshotId"
    LEFT JOIN "StockCountSession" si ON si."id" = p."estoqueInicialSessionId"
    LEFT JOIN "StockCountSession" sf ON sf."id" = p."estoqueFinalSessionId"
    WHERE p."id" = ${id}
    LIMIT 1
  `;
  if (!row) throw new Error("Apuracao de CMV nao encontrada.");
  return row;
}

async function nextCmvPeriodCode(startDate: Date) {
  const year = startDate.getFullYear();
  const [row] = await prisma.$queryRaw<Array<{ nextSequence: bigint | number | null }>>`
    SELECT COALESCE(MAX(SUBSTRING("code" FROM ${`^CMV-${year}-(\\d+)$`})::int), 0) + 1 AS "nextSequence"
    FROM "CmvPeriod"
    WHERE "code" LIKE ${`CMV-${year}-%`}
  `;
  return `CMV-${year}-${String(Number(row?.nextSequence ?? 1)).padStart(4, "0")}`;
}

async function findPeriodsByDateRange(startDate: Date, endDate: Date, excludeId?: string | null) {
  const startKey = formatDateKey(startDate) ?? toDateKey(startDate);
  const endKey = formatDateKey(endDate) ?? toDateKey(endDate);
  return prisma.$queryRaw<Array<{ id: string; status: CmvPeriodStatus; createdAt: Date }>>`
    SELECT "id", "status"::text AS "status", "createdAt"
    FROM "CmvPeriod"
    WHERE DATE("dataInicial") = CAST(${startKey} AS date)
      AND DATE("dataFinal") = CAST(${endKey} AS date)
      ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}` : Prisma.empty}
    ORDER BY "createdAt" DESC
  `;
}

async function latestPreviousPeriod(startDate: Date, excludeId?: string | null) {
  const startKey = formatDateKey(startDate) ?? toDateKey(startDate);
  const [row] = await prisma.$queryRaw<Array<{
    id: string;
    dataFinal: Date;
    estoqueFinalSnapshotId: string | null;
    estoqueFinalSessionId: string | null;
  }>>`
    SELECT "id", "dataFinal", "estoqueFinalSnapshotId", "estoqueFinalSessionId"
    FROM "CmvPeriod"
    WHERE DATE("dataFinal") < CAST(${startKey} AS date)
      ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}` : Prisma.empty}
    ORDER BY "dataFinal" DESC, "createdAt" DESC
    LIMIT 1
  `;
  return row ?? null;
}

async function validateNoDuplicatePeriod(input: CmvPeriodInput) {
  const duplicates = await findPeriodsByDateRange(input.dataInicial, input.dataFinal, input.id);
  if (duplicates.length > 1) {
    throw new Error("Existem apuracoes duplicadas para este periodo. Remova a duplicada antes de salvar.");
  }
  if (duplicates.length === 1) {
    if (!input.id && duplicates[0].status === "OPEN") return duplicates[0].id;
    throw new Error("Ja existe apuracao cadastrada para este periodo. Abra a apuracao existente para editar.");
  }
  return input.id ?? null;
}

async function validatePeriodContinuity(input: CmvPeriodInput) {
  const previous = await latestPreviousPeriod(input.dataInicial, input.id);
  if (!previous) return;

  const expectedStart = toDateKey(addDays(previous.dataFinal, 1));
  const actualStart = toDateKey(input.dataInicial);

  // Session-aware continuity: prefer session comparison when both sides have sessions.
  // Falls back to snapshot comparison for legacy periods without session IDs.
  let breaksContinuity: boolean;
  if (previous.estoqueFinalSessionId && input.estoqueInicialSessionId) {
    // Both session-based: compare sessions directly
    breaksContinuity = actualStart !== expectedStart || input.estoqueInicialSessionId !== previous.estoqueFinalSessionId;
  } else if (previous.estoqueFinalSessionId && !input.estoqueInicialSessionId && input.estoqueInicialSnapshotId) {
    // Previous has session, new has snapshot: compare the new snapshot against the
    // snapshot that the previous session is linked to
    const [prevSessionSnap] = await prisma.$queryRaw<Array<{ linkedSnapshotId: string | null }>>`
      SELECT "linkedSnapshotId" FROM "StockCountSession" WHERE "id" = ${previous.estoqueFinalSessionId} LIMIT 1
    `;
    const expectedSnap = prevSessionSnap?.linkedSnapshotId ?? previous.estoqueFinalSnapshotId ?? "";
    breaksContinuity = actualStart !== expectedStart || input.estoqueInicialSnapshotId !== expectedSnap;
  } else {
    // Legacy fallback: compare snapshot IDs
    const expectedSnapshot = previous.estoqueFinalSnapshotId ?? "";
    breaksContinuity = actualStart !== expectedStart || input.estoqueInicialSnapshotId !== expectedSnapshot;
  }

  if (!breaksContinuity) return;

  if (input.userRole === "ADMIN") {
    if (!input.continuityOverrideReason?.trim()) {
      throw new Error("Motivo obrigatorio para alterar a continuidade da apuracao.");
    }
    return;
  }

  throw new Error(`A proxima apuracao deve iniciar em ${expectedStart}, pois a ultima apuracao terminou em ${toDateKey(previous.dataFinal)}. O inventario inicial sera herdado automaticamente do inventario final da apuracao anterior.`);
}

async function persistPeriod(input: CmvPeriodInput, status: CmvPeriodStatus, closedFields?: { fechadoPor?: string | null; fechadoEm?: Date | null }) {
  const computation = await computePeriod(input.dataInicial, input.dataFinal, input.estoqueInicialSnapshotId, input.estoqueFinalSnapshotId);
  const id = input.id ?? crypto.randomUUID();
  const current = input.id ? await loadPeriodRow(input.id).catch(() => null) : null;
  const code = current?.code ?? await nextCmvPeriodCode(input.dataInicial);
  const name = labelPeriod(input.dataInicial, input.dataFinal);
  const inicialSessionId = input.estoqueInicialSessionId ?? null;
  const finalSessionId = input.estoqueFinalSessionId ?? null;

  await prisma.$executeRaw`
    INSERT INTO "CmvPeriod" (
      "id", "code", "name", "dataInicial", "dataFinal",
      "estoqueInicialSnapshotId", "estoqueFinalSnapshotId",
      "estoqueInicialSessionId", "estoqueFinalSessionId",
      "comprasTotal", "faturamentoTotal", "estoqueInicialTotal", "estoqueFinalTotal", "cmvReal", "cmvPercentual",
      "margemBruta", "status", "fechadoPor", "fechadoEm", "observacoes", "updatedAt"
    )
    VALUES (
      ${id}, ${code}, ${name}, ${input.dataInicial}, ${input.dataFinal},
      ${input.estoqueInicialSnapshotId}, ${input.estoqueFinalSnapshotId},
      ${inicialSessionId}, ${finalSessionId},
      ${computation.comprasTotal},
      ${computation.faturamentoTotal}, ${computation.estoqueInicialTotal}, ${computation.estoqueFinalTotal},
      ${computation.cmvReal}, ${computation.cmvPercentual}, ${computation.margemBruta}, CAST(${status} AS "CmvPeriodStatus"),
      ${closedFields?.fechadoPor ?? null}, ${closedFields?.fechadoEm ?? null}, ${input.observacoes ?? null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "code" = COALESCE("CmvPeriod"."code", EXCLUDED."code"),
      "name" = EXCLUDED."name",
      "dataInicial" = EXCLUDED."dataInicial",
      "dataFinal" = EXCLUDED."dataFinal",
      "estoqueInicialSnapshotId" = EXCLUDED."estoqueInicialSnapshotId",
      "estoqueFinalSnapshotId" = EXCLUDED."estoqueFinalSnapshotId",
      "estoqueInicialSessionId" = EXCLUDED."estoqueInicialSessionId",
      "estoqueFinalSessionId" = EXCLUDED."estoqueFinalSessionId",
      "comprasTotal" = EXCLUDED."comprasTotal",
      "faturamentoTotal" = EXCLUDED."faturamentoTotal",
      "estoqueInicialTotal" = EXCLUDED."estoqueInicialTotal",
      "estoqueFinalTotal" = EXCLUDED."estoqueFinalTotal",
      "cmvReal" = EXCLUDED."cmvReal",
      "cmvPercentual" = EXCLUDED."cmvPercentual",
      "margemBruta" = EXCLUDED."margemBruta",
      "status" = EXCLUDED."status",
      "fechadoPor" = EXCLUDED."fechadoPor",
      "fechadoEm" = EXCLUDED."fechadoEm",
      "observacoes" = EXCLUDED."observacoes",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  return loadPeriodRow(id);
}

// ─── Session → Snapshot bridge ────────────────────────────────────────────────

export async function ensureSnapshotForSession(
  sessionId: string,
  snapshotType: "INVENTARIO_INICIAL" | "INVENTARIO_FINAL"
): Promise<string> {
  // 1. Load and validate session
  const [session] = await prisma.$queryRaw<Array<StockCountSessionBaseRow>>`
    SELECT "id", "code", "status", "source", "referenceDate", "isMonthEnd",
           "periodMonth", "periodYear", "linkedSnapshotId"
    FROM "StockCountSession"
    WHERE "id" = ${sessionId}
    LIMIT 1
  `;
  if (!session) throw new Error(`Contagem nao encontrada: ${sessionId}`);
  if (session.status !== "CONCLUIDA") {
    throw new Error(`Contagem ${session.code} nao esta concluida (status: ${session.status}). Apenas contagens concluidas podem ser usadas como inventario.`);
  }

  // 2. If already has a valid linked snapshot → reuse (idempotency)
  if (session.linkedSnapshotId) {
    const [existing] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "InventorySnapshot"
      WHERE "id" = ${session.linkedSnapshotId}
      LIMIT 1
    `;
    if (existing && !["CANCELLED", "CANCELADO"].includes(String(existing.status).toUpperCase())) {
      return existing.id;
    }
  }

  // 3. Validate that session has items
  const [itemCount] = await prisma.$queryRaw<Array<{ cnt: bigint | number }>>`
    SELECT COUNT(*) AS cnt FROM "StockCountSessionItem"
    WHERE "stockCountSessionId" = ${sessionId}
  `;
  if (toNumber(itemCount?.cnt) === 0) {
    throw new Error(`Contagem ${session.code} nao possui itens. Nao e possivel gerar inventario a partir de uma contagem vazia.`);
  }

  // 4. Load items with last-purchase unit cost for each product
  const items = await prisma.$queryRaw<Array<SessionItemRow>>`
    SELECT
      i."productId",
      i."productCodeSnapshot",
      i."productNameSnapshot",
      i."sectorSnapshot",
      i."categorySnapshot",
      i."subcategorySnapshot",
      i."unitSnapshot",
      i."countedQuantity",
      (
        SELECT pi."unitPrice"
        FROM "PurchaseItem" pi
        JOIN "Purchase" p ON p."id" = pi."purchaseId"
        WHERE pi."productId" = i."productId"
          AND p."status" <> 'CANCELLED'
        ORDER BY p."purchaseDate" DESC
        LIMIT 1
      ) AS "unitCost"
    FROM "StockCountSessionItem" i
    WHERE i."stockCountSessionId" = ${sessionId}
    ORDER BY i."productNameSnapshot"
  `;

  // 5. Calculate totalValue (items without pricing contribute 0 — honest about gaps)
  let totalValue = 0;
  for (const item of items) {
    const qty = toNumber(item.countedQuantity);
    const cost = toNumber(item.unitCost);
    totalValue += Math.round(qty * cost * 100) / 100;
  }

  // 6. Determine snapshot source
  const snapshotSource = session.source === "IMPORTACAO_PLANILHA" ? "IMPORTACAO_PLANILHA" : "SISTEMA";
  const competenceYear = session.periodYear ?? new Date(session.referenceDate).getFullYear();
  const competenceMonth = session.periodMonth ?? (new Date(session.referenceDate).getMonth() + 1);

  // 7. Create InventorySnapshot
  const snapshotId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "InventorySnapshot" (
      "id", "competenceYear", "competenceMonth", "type", "countDate",
      "status", "totalItems", "totalValue", "source", "updatedAt"
    )
    VALUES (
      ${snapshotId}, ${competenceYear}, ${competenceMonth},
      CAST(${snapshotType} AS "InventorySnapshotType"),
      ${new Date(session.referenceDate)},
      'ACTIVE', ${items.length}, ${totalValue}, ${snapshotSource}, CURRENT_TIMESTAMP
    )
  `;

  // 8. Create InventorySnapshotItems
  for (const item of items) {
    const qty = toNumber(item.countedQuantity);
    const cost = toNumber(item.unitCost);
    const totalCost = Math.round(qty * cost * 100) / 100;
    const itemId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "InventorySnapshotItem" (
        "id", "snapshotId", "productId", "productCode", "productName",
        "sectorName", "categoryName", "subcategoryName", "unit",
        "quantity", "unitCost", "totalCost", "resolutionStatus", "createdAt"
      )
      VALUES (
        ${itemId}, ${snapshotId},
        ${item.productId ?? null},
        ${item.productCodeSnapshot ?? null},
        ${item.productNameSnapshot},
        ${item.sectorSnapshot ?? null},
        ${item.categorySnapshot ?? null},
        ${item.subcategorySnapshot ?? null},
        ${item.unitSnapshot ?? null},
        ${qty},
        ${cost > 0 ? cost : null},
        ${totalCost > 0 ? totalCost : null},
        'MATCHED', CURRENT_TIMESTAMP
      )
    `;
  }

  // 9. Link snapshot back to session (idempotency key for future calls)
  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "linkedSnapshotId" = ${snapshotId}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${sessionId}
      AND ("linkedSnapshotId" IS NULL OR "linkedSnapshotId" = '')
  `;

  return snapshotId;
}

export async function listCmvSessions(): Promise<CmvSessionOption[]> {
  const rows = await prisma.$queryRaw<Array<SessionRow>>`
    SELECT
      s."id"                  AS "sessionId",
      s."code",
      s."source",
      s."referenceDate",
      s."periodMonth",
      s."periodYear",
      s."isMonthEnd",
      s."notes",
      s."linkedSnapshotId",
      COUNT(i."id")           AS "totalItems",
      snap."totalValue"       AS "snapshotTotalValue"
    FROM "StockCountSession" s
    LEFT JOIN "StockCountSessionItem" i ON i."stockCountSessionId" = s."id"
    LEFT JOIN "InventorySnapshot" snap
      ON snap."id" = s."linkedSnapshotId"
      AND snap."status" NOT IN ('CANCELLED', 'CANCELADO')
    WHERE s."status" = 'CONCLUIDA'
    GROUP BY s."id", snap."totalValue"
    ORDER BY s."referenceDate" DESC
  `;
  return rows.map((row) => ({
    sessionId: row.sessionId,
    code: row.code,
    source: row.source,
    referenceDate: toDateKey(toLocalDate(row.referenceDate)),
    periodMonth: row.periodMonth,
    periodYear: row.periodYear,
    isMonthEnd: row.isMonthEnd,
    totalItems: toNumber(row.totalItems),
    linkedSnapshotId: row.linkedSnapshotId,
    snapshotTotalValue: row.snapshotTotalValue != null ? toNumber(row.snapshotTotalValue) : null,
    notes: row.notes
  }));
}

// ──────────────────────────────────────────────────────────────────────────────

export async function getCmvRealSuggestions() {
  const [lastPeriodRows, latestPeriodRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string;
      dataFinal: Date;
      estoqueFinalSnapshotId: string | null;
      estoqueFinalSessionId: string | null;
    }>>`
      SELECT "id", "dataFinal", "estoqueFinalSnapshotId", "estoqueFinalSessionId"
      FROM "CmvPeriod"
      ORDER BY "dataFinal" DESC, "createdAt" DESC
      LIMIT 1
    `,
    prisma.$queryRaw<Array<{
      id: string;
      dataInicial: Date;
      dataFinal: Date;
      status: CmvPeriodStatus;
      estoqueFinalSnapshotId: string | null;
      estoqueFinalSessionId: string | null;
    }>>`
      SELECT "id", "dataInicial", "dataFinal", "status", "estoqueFinalSnapshotId", "estoqueFinalSessionId"
      FROM "CmvPeriod"
      ORDER BY "dataFinal" DESC, "createdAt" DESC
      LIMIT 1
    `
  ]);

  const lastPeriod = lastPeriodRows[0] ?? null;
  const latestPeriod = latestPeriodRows[0] ?? null;

  const suggestedStartDate = lastPeriod?.dataFinal
    ? toDateKey(addDays(lastPeriod.dataFinal, 1))
    : toDateKey(new Date());

  // Find the session that was the final of the last period (for suggestions)
  let suggestedInitialSessionId: string | null = null;
  if (lastPeriod?.estoqueFinalSessionId) {
    suggestedInitialSessionId = lastPeriod.estoqueFinalSessionId;
  } else if (lastPeriod?.estoqueFinalSnapshotId) {
    // Legacy: try to find a session linked to the final snapshot
    const [sessionRow] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "StockCountSession"
      WHERE "linkedSnapshotId" = ${lastPeriod.estoqueFinalSnapshotId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    suggestedInitialSessionId = sessionRow?.id ?? null;
  }

  return {
    suggestedStartDate,
    suggestedInitialSnapshotId: lastPeriod?.estoqueFinalSnapshotId ?? null,
    suggestedInitialSessionId,
    continuityLocked: Boolean(lastPeriod),
    latestPeriod: latestPeriod
      ? {
          id: latestPeriod.id,
          dataInicial: toDateKey(latestPeriod.dataInicial),
          dataFinal: toDateKey(latestPeriod.dataFinal),
          status: latestPeriod.status,
          estoqueFinalSnapshotId: latestPeriod.estoqueFinalSnapshotId ?? null,
          estoqueFinalSessionId: latestPeriod.estoqueFinalSessionId ?? null
        }
      : null
  };
}

export async function listCmvPeriods() {
  const rows = await prisma.$queryRaw<Array<CmvPeriodRow>>`
    SELECT
      p.*,
      u1."name" AS "fechadoPorNome",
      u2."name" AS "reabertoPorNome",
      i."countDate" AS "estoqueInicialSnapshotData",
      f."countDate" AS "estoqueFinalSnapshotData",
      si."code" AS "estoqueInicialSessionCode",
      sf."code" AS "estoqueFinalSessionCode"
    FROM "CmvPeriod" p
    LEFT JOIN "User" u1 ON u1."id" = p."fechadoPor"
    LEFT JOIN "User" u2 ON u2."id" = p."reabertoPor"
    LEFT JOIN "InventorySnapshot" i ON i."id" = p."estoqueInicialSnapshotId"
    LEFT JOIN "InventorySnapshot" f ON f."id" = p."estoqueFinalSnapshotId"
    LEFT JOIN "StockCountSession" si ON si."id" = p."estoqueInicialSessionId"
    LEFT JOIN "StockCountSession" sf ON sf."id" = p."estoqueFinalSessionId"
    ORDER BY p."dataFinal" DESC, p."createdAt" DESC
  `;
  return Promise.all(rows.map(async (row) => applyComputation(
    mapRow(row),
    await computePeriod(row.dataInicial, row.dataFinal, row.estoqueInicialSnapshotId ?? "", row.estoqueFinalSnapshotId ?? "")
  )));
}

export async function getCmvPeriod(id: string) {
  const row = await loadPeriodRow(id);
  const [period, computation] = await Promise.all([Promise.resolve(mapRow(row)), computePeriod(row.dataInicial, row.dataFinal, row.estoqueInicialSnapshotId ?? "", row.estoqueFinalSnapshotId ?? "")]);
  return {
    ...applyComputation(period, computation),
    purchasesGrossTotal: computation.comprasTotal,
    purchasesCount: computation.purchasesCount,
    revenueGrossTotal: computation.revenueGrossTotal,
    revenueServiceTotal: computation.revenueServiceTotal,
    revenueNetTotal: computation.revenueNetTotal,
    revenueDaysCount: computation.revenueDaysCount,
    purchaseByCategory: computation.purchaseByCategory,
    purchaseBySupplier: computation.purchaseBySupplier,
    revenueByChannel: computation.revenueByChannel
  } satisfies CmvPeriodDetail;
}

export async function saveCmvPeriod(input: CmvPeriodInput) {
  // If session IDs provided but snapshot IDs are empty → generate snapshots idempotently.
  // Determine snapshotType from isMonthEnd on the session (inicial → never month-end by convention).
  let resolvedInput = { ...input };
  if (input.estoqueInicialSessionId && !input.estoqueInicialSnapshotId) {
    resolvedInput.estoqueInicialSnapshotId = await ensureSnapshotForSession(
      input.estoqueInicialSessionId,
      "INVENTARIO_INICIAL"
    );
  }
  if (input.estoqueFinalSessionId && !input.estoqueFinalSnapshotId) {
    resolvedInput.estoqueFinalSnapshotId = await ensureSnapshotForSession(
      input.estoqueFinalSessionId,
      "INVENTARIO_FINAL"
    );
  }

  const resolvedId = await validateNoDuplicatePeriod(resolvedInput);
  const nextInput = { ...resolvedInput, id: resolvedId ?? resolvedInput.id };
  await validatePeriodContinuity(nextInput);
  if (nextInput.id) {
    const current = await loadPeriodRow(nextInput.id);
    if (current.status === "CLOSED") throw new Error("Apuracao fechada. Reabra antes de alterar dados.");
  }
  const row = await persistPeriod(nextInput, "OPEN");
  await auditLog({
    userId: nextInput.userId,
    action: nextInput.id ? "UPDATE_CMV_PERIOD" : "CREATE_CMV_PERIOD",
    entity: "CmvPeriod",
    entityId: row.id,
    newValue: {
      code: row.code,
      name: row.name,
      dataInicial: nextInput.dataInicial,
      dataFinal: nextInput.dataFinal,
      estoqueInicialSnapshotId: nextInput.estoqueInicialSnapshotId,
      estoqueFinalSnapshotId: nextInput.estoqueFinalSnapshotId,
      estoqueInicialSessionId: nextInput.estoqueInicialSessionId ?? null,
      estoqueFinalSessionId: nextInput.estoqueFinalSessionId ?? null,
      observacoes: nextInput.observacoes,
      continuityOverrideReason: nextInput.continuityOverrideReason ?? null
    },
    ipAddress: nextInput.ipAddress ?? null,
    userAgent: nextInput.userAgent ?? null
  });
  return getCmvPeriod(row.id);
}

export async function recalculateCmvPeriod(id: string, input: { userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const current = await loadPeriodRow(id);
  if (current.status === "CLOSED") throw new Error("Apuracao fechada. Reabra antes de recalcular.");
  const updated = await persistPeriod({
    id,
    name: current.name,
    dataInicial: current.dataInicial,
    dataFinal: current.dataFinal,
    estoqueInicialSnapshotId: current.estoqueInicialSnapshotId ?? "",
    estoqueFinalSnapshotId: current.estoqueFinalSnapshotId ?? "",
    observacoes: current.observacoes,
    userId: input.userId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  }, "OPEN");
  await auditLog({
    userId: input.userId,
    action: "CALCULATE_CMV_PERIOD",
    entity: "CmvPeriod",
    entityId: updated.id,
    newValue: { id: updated.id, code: updated.code },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
  return getCmvPeriod(updated.id);
}

export async function closeCmvPeriod(id: string, input: { userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const current = await loadPeriodRow(id);
  const updated = await persistPeriod({
    id,
    name: current.name,
    dataInicial: current.dataInicial,
    dataFinal: current.dataFinal,
    estoqueInicialSnapshotId: current.estoqueInicialSnapshotId ?? "",
    estoqueFinalSnapshotId: current.estoqueFinalSnapshotId ?? "",
    observacoes: current.observacoes,
    userId: input.userId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  }, "CLOSED", { fechadoPor: input.userId, fechadoEm: new Date() });
  await auditLog({
    userId: input.userId,
    action: "CLOSE_CMV_PERIOD",
    entity: "CmvPeriod",
    entityId: updated.id,
    newValue: { id: updated.id, code: updated.code },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
  return getCmvPeriod(updated.id);
}

export async function reopenCmvPeriod(id: string, input: { userId: string; reason: string; ipAddress?: string | null; userAgent?: string | null }) {
  const current = await loadPeriodRow(id);
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio.");
  await prisma.$executeRaw`
    UPDATE "CmvPeriod"
    SET "status" = 'OPEN',
        "reabertoPor" = ${input.userId},
        "reabertoEm" = CURRENT_TIMESTAMP,
        "motivoReabertura" = ${input.reason},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `;
  await auditLog({
    userId: input.userId,
    action: "REOPEN_CMV_PERIOD",
    entity: "CmvPeriod",
    entityId: id,
    previousValue: { status: current.status },
    newValue: { reason: input.reason },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
  return getCmvPeriod(id);
}

export async function deleteCmvPeriod(id: string, input: { userId: string; reason?: string | null; ipAddress?: string | null; userAgent?: string | null }) {
  const current = await loadPeriodRow(id);
  if (current.status === "CLOSED" && !input.reason?.trim()) {
    throw new Error("Motivo obrigatorio para excluir apuracao fechada.");
  }
  const linkedNext = await prisma.$queryRaw<Array<{ id: string; dataInicial: Date; dataFinal: Date }>>`
    SELECT "id", "dataInicial", "dataFinal"
    FROM "CmvPeriod"
    WHERE "estoqueInicialSnapshotId" = ${current.estoqueFinalSnapshotId ?? ""}
      AND "id" <> ${id}
    ORDER BY "dataInicial"
  `;
  await prisma.$executeRaw`
    DELETE FROM "CmvPeriod"
    WHERE "id" = ${id}
  `;
  await auditLog({
    userId: input.userId,
    action: "DELETE_CMV_PERIOD",
    entity: "CmvPeriod",
    entityId: id,
    previousValue: {
      id: current.id,
      code: current.code,
      name: current.name,
      dataInicial: current.dataInicial,
      dataFinal: current.dataFinal,
      status: current.status,
      comprasTotal: toNumber(current.comprasTotal),
      faturamentoTotal: toNumber(current.faturamentoTotal),
      estoqueInicialTotal: toNumber(current.estoqueInicialTotal),
      estoqueFinalTotal: toNumber(current.estoqueFinalTotal),
      cmvReal: toNumber(current.cmvReal),
      cmvPercentual: current.cmvPercentual == null ? null : toNumber(current.cmvPercentual),
      margemBruta: current.margemBruta == null ? null : toNumber(current.margemBruta),
      linkedNextPeriods: linkedNext.map((period) => ({
        id: period.id,
        dataInicial: toDateKey(period.dataInicial),
        dataFinal: toDateKey(period.dataFinal)
      }))
    },
    newValue: {
      reason: input.reason ?? null,
      code: current.code,
      period: `${toDateKey(current.dataInicial)} a ${toDateKey(current.dataFinal)}`,
      status: current.status
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
  return { id, status: "DELETED", linkedNextPeriods: linkedNext.length };
}

export async function getCmvPeriodPdf(id: string) {
  const detail = await getCmvPeriod(id);
  return createCmvRealPdf({
    code: detail.code ?? "-",
    dataInicial: new Date(detail.dataInicial),
    dataFinal: new Date(detail.dataFinal),
    estoqueInicialTotal: Number(detail.estoqueInicialTotal),
    comprasTotal: Number(detail.comprasTotal),
    estoqueFinalTotal: Number(detail.estoqueFinalTotal),
    cmvReal: Number(detail.cmvReal),
    faturamentoTotal: Number(detail.faturamentoTotal),
    cmvPercentual: detail.cmvPercentual == null ? null : Number(detail.cmvPercentual),
    margemBruta: detail.margemBruta == null ? null : Number(detail.margemBruta),
    status: detail.status,
    generatedAt: new Date(),
    purchaseByCategory: detail.purchaseByCategory.map((row) => ({
      categoryName: row.categoryName,
      itemsCount: Number(row.itemsCount),
      totalAmount: Number(row.totalAmount),
    })),
    purchaseBySupplier: detail.purchaseBySupplier.map((row) => ({
      supplierName: row.supplierName,
      supplierDocument: row.supplierDocument ?? null,
      purchasesCount: Number(row.purchasesCount),
      totalAmount: Number(row.totalAmount),
    })),
    revenueByChannel: detail.revenueByChannel.map((row) => ({
      channel: row.channel,
      count: Number(row.count),
      grossAmount: Number(row.grossAmount),
      netAmount: Number(row.netAmount),
    })),
  });
}

export async function getCmvPeriodByDateRange(startDate: Date, endDate: Date) {
  const [period] = await prisma.$queryRaw<Array<{ id: string; dataInicial: Date; dataFinal: Date }>>`
    SELECT "id", "dataInicial", "dataFinal"
    FROM "CmvPeriod"
    WHERE "dataInicial" = ${startDate}
      AND "dataFinal" = ${endDate}
    LIMIT 1
  `;
  return period ?? null;
}
