import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { createSimplePdf } from "../../shared/utils/simple-pdf.js";
import { auditLog } from "../security/security-utils.js";

type CmvPeriodStatus = "OPEN" | "CLOSED";

export type CmvPeriodInput = {
  id?: string;
  name: string;
  dataInicial: Date;
  dataFinal: Date;
  estoqueInicialSnapshotId: string;
  estoqueFinalSnapshotId: string;
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
};

export type CmvPeriodSummary = {
  id: string;
  code: string | null;
  name: string;
  dataInicial: string;
  dataFinal: string;
  estoqueInicialSnapshotId: string | null;
  estoqueFinalSnapshotId: string | null;
  estoqueInicialSnapshotData: string | null;
  estoqueFinalSnapshotData: string | null;
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
  const { start, end } = periodRange(startDate, endDate);
  const [row] = await prisma.$queryRaw<Array<PurchaseTotalRow>>`
    SELECT COALESCE(SUM("totalAmount"), 0) AS "totalAmount",
           COUNT(*) AS "purchasesCount"
    FROM "Purchase"
    WHERE "status" <> 'CANCELLED'
      AND "purchaseDate" >= CAST(${start} AS timestamp)
      AND "purchaseDate" <= CAST(${end} AS timestamp)
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
  const { start, end } = periodRange(startDate, endDate);
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
      AND p."purchaseDate" >= CAST(${start} AS timestamp)
      AND p."purchaseDate" <= CAST(${end} AS timestamp)
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
  const { start, end } = periodRange(startDate, endDate);
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
      AND p."purchaseDate" >= CAST(${start} AS timestamp)
      AND p."purchaseDate" <= CAST(${end} AS timestamp)
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
    estoqueInicialSnapshotData: row.estoqueInicialSnapshotData ? toDateKey(toLocalDate(row.estoqueInicialSnapshotData)) : null,
    estoqueFinalSnapshotData: row.estoqueFinalSnapshotData ? toDateKey(toLocalDate(row.estoqueFinalSnapshotData)) : null,
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
      f."countDate" AS "estoqueFinalSnapshotData"
    FROM "CmvPeriod" p
    LEFT JOIN "User" u1 ON u1."id" = p."fechadoPor"
    LEFT JOIN "User" u2 ON u2."id" = p."reabertoPor"
    LEFT JOIN "InventorySnapshot" i ON i."id" = p."estoqueInicialSnapshotId"
    LEFT JOIN "InventorySnapshot" f ON f."id" = p."estoqueFinalSnapshotId"
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
  const [row] = await prisma.$queryRaw<Array<{ id: string; dataFinal: Date; estoqueFinalSnapshotId: string | null }>>`
    SELECT "id", "dataFinal", "estoqueFinalSnapshotId"
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
  const expectedSnapshot = previous.estoqueFinalSnapshotId ?? "";
  const breaksContinuity = actualStart !== expectedStart || input.estoqueInicialSnapshotId !== expectedSnapshot;
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
  await prisma.$executeRaw`
    INSERT INTO "CmvPeriod" (
      "id", "code", "name", "dataInicial", "dataFinal", "estoqueInicialSnapshotId", "estoqueFinalSnapshotId",
      "comprasTotal", "faturamentoTotal", "estoqueInicialTotal", "estoqueFinalTotal", "cmvReal", "cmvPercentual",
      "margemBruta", "status", "fechadoPor", "fechadoEm", "observacoes", "updatedAt"
    )
    VALUES (
      ${id}, ${code}, ${name}, ${input.dataInicial}, ${input.dataFinal},
      ${input.estoqueInicialSnapshotId}, ${input.estoqueFinalSnapshotId}, ${computation.comprasTotal},
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

export async function getCmvRealSuggestions() {
  const [lastPeriod, latestPeriod] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; dataFinal: Date; estoqueFinalSnapshotId: string | null }>>`
      SELECT "id", "dataFinal", "estoqueFinalSnapshotId"
      FROM "CmvPeriod"
      ORDER BY "dataFinal" DESC, "createdAt" DESC
      LIMIT 1
    `,
    prisma.$queryRaw<Array<{ id: string; dataInicial: Date; dataFinal: Date; status: CmvPeriodStatus; estoqueFinalSnapshotId: string | null }>>`
      SELECT "id", "dataInicial", "dataFinal", "status", "estoqueFinalSnapshotId"
      FROM "CmvPeriod"
      ORDER BY "dataFinal" DESC, "createdAt" DESC
      LIMIT 1
    `
  ]);
  const suggestedStartDate = lastPeriod[0]?.dataFinal
    ? (() => {
        const next = addDays(lastPeriod[0].dataFinal, 1);
        return toDateKey(next);
      })()
    : toDateKey(new Date());
  return {
    suggestedStartDate,
    suggestedInitialSnapshotId: lastPeriod[0]?.estoqueFinalSnapshotId ?? null,
    continuityLocked: Boolean(lastPeriod[0]),
    latestPeriod: latestPeriod[0]
      ? {
          ...latestPeriod[0],
          dataInicial: toDateKey(latestPeriod[0].dataInicial),
          dataFinal: toDateKey(latestPeriod[0].dataFinal),
          estoqueFinalSnapshotId: latestPeriod[0].estoqueFinalSnapshotId ?? null
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
      f."countDate" AS "estoqueFinalSnapshotData"
    FROM "CmvPeriod" p
    LEFT JOIN "User" u1 ON u1."id" = p."fechadoPor"
    LEFT JOIN "User" u2 ON u2."id" = p."reabertoPor"
    LEFT JOIN "InventorySnapshot" i ON i."id" = p."estoqueInicialSnapshotId"
    LEFT JOIN "InventorySnapshot" f ON f."id" = p."estoqueFinalSnapshotId"
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
  const resolvedId = await validateNoDuplicatePeriod(input);
  const nextInput = { ...input, id: resolvedId ?? input.id };
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
  const pdf = createSimplePdf("CMV Real", [
    {
      heading: "Periodo e formula",
      lines: [
        `Codigo: ${detail.code ?? "-"}`,
        `Periodo: ${new Date(detail.dataInicial).toLocaleDateString("pt-BR")} ate ${new Date(detail.dataFinal).toLocaleDateString("pt-BR")}`,
        `Formula: Estoque inicial + Compras - Estoque final = CMV Real`,
        `Estoque inicial: ${detail.estoqueInicialTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `Compras: ${detail.comprasTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `Estoque final: ${detail.estoqueFinalTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `CMV real: ${detail.cmvReal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `Faturamento: ${detail.faturamentoTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `CMV %: ${detail.cmvPercentual == null ? "-" : `${(detail.cmvPercentual * 100).toFixed(2)}%`}`,
        `Margem bruta: ${detail.margemBruta == null ? "-" : detail.margemBruta.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        `Status: ${detail.status}`
      ]
    },
    {
      heading: "Compras por categoria",
      table: {
        headers: ["Categoria", "Itens", "Total"],
        rows: detail.purchaseByCategory.map((row) => [row.categoryName, row.itemsCount, row.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })])
      }
    },
    {
      heading: "Compras por fornecedor",
      table: {
        headers: ["Fornecedor", "CNPJ/CPF", "Pedidos", "Total"],
        rows: detail.purchaseBySupplier.map((row) => [row.supplierName, row.supplierDocument ?? "-", row.purchasesCount, row.totalAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })])
      }
    },
    {
      heading: "Faturamento por canal",
      table: {
        headers: ["Canal", "Qtd.", "Bruto", "Liquido"],
        rows: detail.revenueByChannel.map((row) => [row.channel, row.count, row.grossAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), row.netAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })])
      }
    }
  ]);

  return pdf;
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
