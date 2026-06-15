import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import { prisma } from "../../config/database.js";
import { createCalendarDate, normalizeToCalendarDate, toCalendarDateKey } from "../../shared/utils/calendar-date.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { parseMoney } from "../../shared/utils/parse-money.js";
import { createSimplePdf } from "../../shared/utils/simple-pdf.js";
import { auditLog } from "../security/security-utils.js";

type RevenuePreviewRow = {
  rowNumber: number;
  date: string;
  dayOfWeek: string | null;
  channel: string;
  sourcePlatform: string | null;
  grossAmount: number;
  serviceAmount: number;
  tickets: number;
  ticketAverage: number;
  repiqueAmount: number;
  salesFirstShift: number;
  ticketsFirstShift: number;
  salesSecondShift: number;
  ticketsSecondShift: number;
  salesTables: number;
  ticketsTables: number;
  accumulatedAmount: number;
  delivery?: {
    orders99Food: number;
    earnings99Food: number;
    ordersIfood: number;
    earningsIfood: number;
    ordersKeeta: number;
    earningsKeeta: number;
  };
  status: "NEW" | "EXISTS";
  existingRevenueEntryId: string | null;
};

export type RevenueImportPreview = {
  importKind: "SALON" | "DELIVERY";
  sheetName: string | null;
  importFileId: string;
  originalFileName: string | null;
  totalRows: number;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  validation: {
    dailyRows: number;
    ignoredRows: number;
    totalGross: number;
    totalService: number;
    totalTickets: number;
    totalFirstShift: number;
    totalSecondShift: number;
    totalTables: number;
    totalRepique: number;
    total99Food: number;
    totalIfood: number;
    totalKeeta: number;
    firstDate: string | null;
    lastDate: string | null;
    ticketAverageGeneral: number;
    existingRows: number;
  };
  warnings: Array<{ rowNumber: number; message: string }>;
  previewRows: RevenuePreviewRow[];
};

export type RevenueImportReport = {
  importBatchId: string;
  importedRows: number;
  createdRows: number;
  updatedRows: number;
  ignoredRows: number;
  spreadsheetTotal: number;
  importedTotal: number;
  totalGross: number;
  totalService: number;
  totalTickets: number;
  ticketAverageGeneral: number;
  existingRows: number;
  overwrittenRows: number;
  warnings: Array<{ rowNumber: number; message: string }>;
  errors: Array<{ rowNumber: number; message: string }>;
};

type RevenueImportInput = {
  importFileId: string;
  originalFileName: string | null;
  sheetName: string | null;
  competenceYear: number;
  competenceMonth: number;
  defaultChannel: string;
  notes: string | null;
  allowOverwrite: boolean;
  overwriteReason: string | null;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type RevenueImportChangeSnapshot = {
  id: string;
  date: string;
  competenceYear: number;
  competenceMonth: number;
  channel: string;
  sourcePlatform: string | null;
  description: string | null;
  grossAmount: number;
  discounts: number;
  platformFees: number;
  netAmount: number;
  serviceAmount: number;
  tickets: number;
  ticketAverage: number | null;
  salesFirstShift: number;
  ticketsFirstShift: number;
  salesSecondShift: number;
  ticketsSecondShift: number;
  repiqueAmount: number;
  salesTables: number;
  ticketsTables: number;
  accumulatedAmount: number | null;
  weekdayName: string | null;
  paymentMethod: string | null;
  cashAmount: number;
  pixAmount: number;
  debitAmount: number;
  creditAmount: number;
  voucherAmount: number;
  notes: string | null;
  status: string;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdByUserId: string | null;
  importBatchId: string | null;
};

type RevenueSourceRow = {
  rowNumber: number;
  day: number;
  repiqueAmount: number;
  salesFirstShift: number;
  ticketsFirstShift: number;
  salesSecondShift: number;
  ticketsSecondShift: number;
  salesTables: number;
  ticketsTables: number;
  grossAmount: number;
  ticketAverage: number;
  serviceAmount: number;
  percentSales: number;
  totalTickets: number;
  accumulatedAmount: number;
  dayOfWeek: string | null;
};

type DeliveryPlatform = "99Food" | "iFood" | "Keeta";

type DeliverySourceRow = {
  rowNumber: number;
  date: Date;
  dayOfWeek: string | null;
  orders99Food: number;
  earnings99Food: number;
  ordersIfood: number;
  earningsIfood: number;
  ordersKeeta: number;
  earningsKeeta: number;
};

type ParsedRevenueSpreadsheet =
  | { kind: "salon"; sheetName: string; rows: RevenueSourceRow[]; warnings: Array<{ rowNumber: number; message: string }>; totalRows: number }
  | { kind: "delivery"; sheetName: string; rows: DeliverySourceRow[]; warnings: Array<{ rowNumber: number; message: string }>; totalRows: number };

type RevenueLayout = "grouped" | "turnTotals" | "flat";
type PreferredRevenueKind = "salon" | "delivery";

function safeUploadPath(importFileId: string): string {
  const baseName = path.basename(importFileId);
  const tempPath = path.resolve(os.tmpdir(), baseName);
  if (existsSync(tempPath)) return tempPath;
  const uploadPath = path.resolve("uploads", baseName);
  if (existsSync(uploadPath)) return uploadPath;
  return uploadPath;
}

function resolveCellValue(value: unknown): unknown {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.result !== undefined && record.result !== null) return resolveCellValue(record.result);
    if (record.text !== undefined && record.text !== null) return resolveCellValue(record.text);
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => String((part as Record<string, unknown>).text ?? "")).join("");
    }
  }
  return value;
}

function asText(value: unknown): string | null {
  const text = String(resolveCellValue(value) ?? "").trim();
  return text || null;
}

function cellText(row: ExcelJS.Row, index: number): string | null {
  const cell = row.getCell(index);
  const text = String(cell.text ?? "").trim();
  if (text) return text;
  return asText(cell.value);
}

function cellNumber(row: ExcelJS.Row, index: number): number {
  const cell = row.getCell(index);
  const resolved = resolveCellValue(cell.value);
  if (typeof resolved === "number") return Number.isFinite(resolved) ? resolved : 0;
  const text = String(cell.text ?? "").trim();
  if (text) return parseMoney(text);
  return parseMoney(resolved);
}

function cellInt(row: ExcelJS.Row, index: number): number {
  return Math.trunc(cellNumber(row, index));
}

function detectRevenueLayout(worksheet: ExcelJS.Worksheet): RevenueLayout {
  const row1 = worksheet.getRow(1);
  const row2 = worksheet.getRow(2);
  const row1Col1 = normalizeCellText(row1.getCell(1).value);
  const row2Col1 = normalizeCellText(row2.getCell(1).value);
  const row1Col8 = normalizeCellText(row1.getCell(8).value);
  const row2Col8 = normalizeCellText(row2.getCell(8).value);
  if (row2Col1 === "DIAS" && row1Col8 === "TOTAL" && row2Col8.includes("SERVICO")) return "turnTotals";
  if (row2Col1 === "DIAS") return "grouped";
  if (row1Col1 === "DIAS") return "flat";
  if (row1Col1.includes("TURNO") || row1Col1.includes("MESAS")) return "grouped";
  return "flat";
}

function isDeliveryWorksheet(worksheet: ExcelJS.Worksheet) {
  const row1 = worksheet.getRow(1);
  const row2 = worksheet.getRow(2);
  return normalizeCellText(row1.getCell(3).value).includes("99FOOD")
    && normalizeCellText(row1.getCell(6).value).includes("IFOOD")
    && normalizeCellText(row1.getCell(9).value).includes("KEETA")
    && normalizeCellText(row2.getCell(1).value).includes("DATA")
    && normalizeCellText(row2.getCell(3).value).includes("PEDIDOS")
    && normalizeCellText(row2.getCell(4).value).includes("GANHOS");
}

function normalizeCellText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isDeliveryChannel(value: string) {
  return normalizeCellText(value) === "DELIVERY";
}

function isRevenueDay(value: unknown) {
  const normalized = normalizeCellText(value);
  if (!normalized) return false;
  if (["TOTAL", "RESUMO", "ACUMULADO"].some((marker) => normalized.includes(marker))) return false;
  const day = Number(normalized);
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

function toNumber(value: unknown): number {
  const resolved = resolveCellValue(value);
  if (typeof resolved === "number") return Number.isFinite(resolved) ? resolved : 0;
  return parseMoney(resolved);
}

function toInt(value: unknown): number {
  const parsed = Math.trunc(toNumber(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: unknown): Date | null {
  return parseDate(value);
}

function calendarDateFromValue(value: unknown) {
  const parsed = toDate(value);
  if (!parsed) return null;
  return createCalendarDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function readRevenueRow(row: ExcelJS.Row, layout: RevenueLayout): RevenueSourceRow | null {
  const day = cellInt(row, 1);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const groupedLayout = layout === "grouped";
  const turnTotalsLayout = layout === "turnTotals";
  const firstShiftSalesIndex = 2;
  const firstShiftTicketsIndex = groupedLayout || turnTotalsLayout ? 4 : 3;
  const secondShiftSalesIndex = groupedLayout || turnTotalsLayout ? 5 : 4;
  const secondShiftTicketsIndex = groupedLayout || turnTotalsLayout ? 7 : 5;
  const repiqueAmountIndex = groupedLayout ? 8 : null;
  const ticketsTablesIndex = groupedLayout ? 9 : null;
  const salesTablesIndex = groupedLayout ? 10 : null;
  const serviceAmountIndex = turnTotalsLayout ? 8 : groupedLayout ? 12 : 9;
  const accumulatedIndex = groupedLayout ? 15 : 13;
  const dayOfWeekIndex = groupedLayout ? 16 : 14;
  const salesFirstShift = cellNumber(row, firstShiftSalesIndex);
  const ticketsFirstShift = cellInt(row, firstShiftTicketsIndex);
  const salesSecondShift = cellNumber(row, secondShiftSalesIndex);
  const ticketsSecondShift = cellInt(row, secondShiftTicketsIndex);
  const salesTables = salesTablesIndex ? cellNumber(row, salesTablesIndex) : 0;
  const grossAmount = salesFirstShift + salesSecondShift;
  const serviceAmount = cellNumber(row, serviceAmountIndex);
  const totalTickets = ticketsFirstShift + ticketsSecondShift;
  const ticketAverage = totalTickets > 0 ? grossAmount / totalTickets : 0;

  return {
    rowNumber: row.number,
    day,
    repiqueAmount: repiqueAmountIndex ? cellNumber(row, repiqueAmountIndex) : 0,
    salesFirstShift,
    ticketsFirstShift,
    salesSecondShift,
    ticketsSecondShift,
    salesTables,
    ticketsTables: ticketsTablesIndex ? cellInt(row, ticketsTablesIndex) : 0,
    grossAmount,
    ticketAverage,
    serviceAmount,
    percentSales: groupedLayout ? cellNumber(row, 13) : 0,
    totalTickets,
    accumulatedAmount: 0,
    dayOfWeek: cellText(row, dayOfWeekIndex)
  };
}

function readDeliveryRow(row: ExcelJS.Row): DeliverySourceRow | null {
  const date = calendarDateFromValue(row.getCell(1).value ?? row.getCell(1).text);
  if (!date) return null;

  return {
    rowNumber: row.number,
    date,
    dayOfWeek: cellText(row, 2),
    orders99Food: cellInt(row, 3),
    earnings99Food: cellNumber(row, 4),
    ordersIfood: cellInt(row, 6),
    earningsIfood: cellNumber(row, 7),
    ordersKeeta: cellInt(row, 9),
    earningsKeeta: cellNumber(row, 10)
  };
}

async function parseRevenueSpreadsheet(filePath: string, sheetName?: string | null, preferredKind?: PreferredRevenueKind): Promise<ParsedRevenueSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const requestedSheet = preferredKind === "delivery" ? null : sheetName ? workbook.getWorksheet(sheetName) : null;
  const deliverySheet = workbook.worksheets.find(isDeliveryWorksheet) ?? null;

  if (preferredKind === "delivery" && !deliverySheet) {
    throw new Error("Layout Delivery nao encontrado. Selecione uma planilha com Data, Dia da semana, 99Food, iFood e Keeta.");
  }

  if (preferredKind === "salon" && requestedSheet && isDeliveryWorksheet(requestedSheet)) {
    throw new Error("Esta e uma planilha de Delivery. Selecione o canal Delivery para importar este arquivo.");
  }

  const worksheet = preferredKind === "delivery"
    ? deliverySheet
    : requestedSheet ?? workbook.getWorksheet("Planilha1") ?? workbook.worksheets[0];
  if (!worksheet) throw new Error("Planilha de faturamento nao encontrada.");

  if (isDeliveryWorksheet(worksheet)) {
    const rows: DeliverySourceRow[] = [];
    const warnings: Array<{ rowNumber: number; message: string }> = [];
    const totalRows = worksheet.rowCount;

    for (let rowNumber = 3; rowNumber <= totalRows; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const parsed = readDeliveryRow(row);
      if (!parsed) {
        const hasContent = Array.from({ length: Math.max(row.cellCount, 11) }, (_, index) => row.getCell(index + 1).value)
          .some((value) => normalizeCellText(value));
        if (hasContent) warnings.push({ rowNumber, message: "Linha ignorada por nao possuir DATA valida." });
        continue;
      }
      const totalOrders = parsed.orders99Food + parsed.ordersIfood + parsed.ordersKeeta;
      const totalGross = parsed.earnings99Food + parsed.earningsIfood + parsed.earningsKeeta;
      if (totalOrders <= 0 && totalGross <= 0) {
        warnings.push({ rowNumber, message: "Linha ignorada por nao possuir pedidos ou ganhos." });
        continue;
      }
      rows.push(parsed);
    }

    return {
      kind: "delivery",
      sheetName: worksheet.name,
      rows,
      warnings,
      totalRows
    };
  }

  const layout = detectRevenueLayout(worksheet);

  const rows: RevenueSourceRow[] = [];
  const warnings: Array<{ rowNumber: number; message: string }> = [];
  const totalRows = worksheet.rowCount;
  const dataStartRow = layout === "grouped" || layout === "turnTotals" ? 3 : 2;

  for (let rowNumber = dataStartRow; rowNumber <= totalRows; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const dayValue = row.getCell(1).value ?? row.getCell(1).text;
    if (!isRevenueDay(dayValue)) {
      const hasContent = Array.from({ length: Math.max(row.cellCount, 17) }, (_, index) => row.getCell(index + 1).value)
        .some((value) => normalizeCellText(value));
      if (hasContent) {
        warnings.push({ rowNumber, message: "Linha ignorada por nao possuir DIA valido." });
      }
      continue;
    }

    const parsed = readRevenueRow(row, layout);
    if (!parsed) {
      warnings.push({ rowNumber, message: "Linha ignorada por nao possuir DIA valido." });
      continue;
    }
    rows.push(parsed);
  }

  return {
    kind: "salon",
    sheetName: worksheet.name,
    rows,
    warnings,
    totalRows
  };
}
async function loadExistingEntries(competenceYear: number, competenceMonth: number, channel: string) {
  const startDate = new Date(competenceYear, competenceMonth - 1, 1);
  const endDate = new Date(competenceYear, competenceMonth, 0, 23, 59, 59, 999);
  const rows = await prisma.$queryRaw<Array<{ id: string; date: Date; sourcePlatform: string | null }>>`
    SELECT "id", "date", "sourcePlatform"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= ${startDate}
      AND "date" <= ${endDate}
      AND "channel" = ${channel}
  `;
  const existingMap = new Map<string, string>();
  for (const row of rows) {
    const dateKey = toCalendarDateKey(normalizeToCalendarDate(new Date(row.date)));
    existingMap.set(dateKey, row.id);
    existingMap.set(`${dateKey}|${row.sourcePlatform ?? ""}`, row.id);
  }
  return existingMap;
}

function snapshotRevenueEntry(row: Record<string, unknown>): RevenueImportChangeSnapshot {
  return {
    id: String(row.id ?? ""),
    date: row.date instanceof Date ? row.date.toISOString() : String(row.date ?? ""),
    competenceYear: Number(row.competenceYear ?? 0),
    competenceMonth: Number(row.competenceMonth ?? 0),
    channel: String(row.channel ?? ""),
    sourcePlatform: row.sourcePlatform == null ? null : String(row.sourcePlatform),
    description: row.description == null ? null : String(row.description),
    grossAmount: toNumber(row.grossAmount),
    discounts: toNumber(row.discounts),
    platformFees: toNumber(row.platformFees),
    netAmount: toNumber(row.netAmount),
    serviceAmount: toNumber(row.serviceAmount),
    tickets: toInt(row.tickets),
    ticketAverage: row.ticketAverage == null ? null : toNumber(row.ticketAverage),
    salesFirstShift: toNumber(row.salesFirstShift),
    ticketsFirstShift: toInt(row.ticketsFirstShift),
    salesSecondShift: toNumber(row.salesSecondShift),
    ticketsSecondShift: toInt(row.ticketsSecondShift),
    repiqueAmount: toNumber(row.repiqueAmount),
    salesTables: toNumber(row.salesTables),
    ticketsTables: toInt(row.ticketsTables),
    accumulatedAmount: row.accumulatedAmount == null ? null : toNumber(row.accumulatedAmount),
    weekdayName: row.weekdayName == null ? null : String(row.weekdayName),
    paymentMethod: row.paymentMethod == null ? null : String(row.paymentMethod),
    cashAmount: toNumber(row.cashAmount),
    pixAmount: toNumber(row.pixAmount),
    debitAmount: toNumber(row.debitAmount),
    creditAmount: toNumber(row.creditAmount),
    voucherAmount: toNumber(row.voucherAmount),
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status ?? "ACTIVE"),
    cancelledAt: row.cancelledAt instanceof Date ? row.cancelledAt.toISOString() : row.cancelledAt == null ? null : String(row.cancelledAt),
    cancelledByUserId: row.cancelledByUserId == null ? null : String(row.cancelledByUserId),
    cancellationReason: row.cancellationReason == null ? null : String(row.cancellationReason),
    createdByUserId: row.createdByUserId == null ? null : String(row.createdByUserId),
    importBatchId: row.importBatchId == null ? null : String(row.importBatchId)
  };
}

function restoreRevenueEntryData(snapshot: RevenueImportChangeSnapshot) {
  return {
    date: new Date(snapshot.date),
    competenceYear: snapshot.competenceYear,
    competenceMonth: snapshot.competenceMonth,
    channel: snapshot.channel,
    sourcePlatform: snapshot.sourcePlatform,
    description: snapshot.description,
    grossAmount: snapshot.grossAmount,
    discounts: snapshot.discounts,
    platformFees: snapshot.platformFees,
    netAmount: snapshot.netAmount,
    serviceAmount: snapshot.serviceAmount,
    tickets: snapshot.tickets,
    ticketAverage: snapshot.ticketAverage,
    salesFirstShift: snapshot.salesFirstShift,
    ticketsFirstShift: snapshot.ticketsFirstShift,
    salesSecondShift: snapshot.salesSecondShift,
    ticketsSecondShift: snapshot.ticketsSecondShift,
    repiqueAmount: snapshot.repiqueAmount,
    salesTables: snapshot.salesTables,
    ticketsTables: snapshot.ticketsTables,
    accumulatedAmount: snapshot.accumulatedAmount,
    weekdayName: snapshot.weekdayName,
    paymentMethod: snapshot.paymentMethod,
    cashAmount: snapshot.cashAmount,
    pixAmount: snapshot.pixAmount,
    debitAmount: snapshot.debitAmount,
    creditAmount: snapshot.creditAmount,
    voucherAmount: snapshot.voucherAmount,
    notes: snapshot.notes,
    status: snapshot.status,
    cancelledAt: snapshot.cancelledAt ? new Date(snapshot.cancelledAt) : null,
    cancelledByUserId: snapshot.cancelledByUserId,
    cancellationReason: snapshot.cancellationReason,
    createdByUserId: snapshot.createdByUserId,
    importBatchId: snapshot.importBatchId
  };
}

function rowToPayload(
  row: RevenuePreviewRow,
  input: RevenueImportInput
) {
  const date = new Date(row.date);
  return {
    id: crypto.randomUUID(),
    date: normalizeToCalendarDate(date),
    competenceYear: input.competenceYear,
    competenceMonth: input.competenceMonth,
    channel: input.defaultChannel,
    sourcePlatform: row.sourcePlatform,
    description: row.dayOfWeek ? `Importacao ${row.dayOfWeek}` : `Importacao dia ${date.getDate()}`,
    grossAmount: row.grossAmount,
    discounts: 0,
    platformFees: 0,
    netAmount: row.grossAmount - row.serviceAmount,
    serviceAmount: row.serviceAmount,
    tickets: row.tickets || (row.ticketsFirstShift + row.ticketsSecondShift),
    ticketAverage: row.ticketAverage ?? null,
    repiqueAmount: row.repiqueAmount,
    salesFirstShift: row.salesFirstShift,
    ticketsFirstShift: row.ticketsFirstShift,
    salesSecondShift: row.salesSecondShift,
    ticketsSecondShift: row.ticketsSecondShift,
    salesTables: row.salesTables,
    ticketsTables: row.ticketsTables,
    accumulatedAmount: row.accumulatedAmount ?? null,
    weekdayName: row.dayOfWeek,
    paymentMethod: null,
    cashAmount: 0,
    pixAmount: 0,
    debitAmount: 0,
    creditAmount: 0,
    voucherAmount: 0,
    notes: input.notes,
    status: "ACTIVE",
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    createdByUserId: input.userId,
    importBatchId: null
  };
}

function deliveryPlatformPayload(row: RevenuePreviewRow, input: RevenueImportInput, platform: DeliveryPlatform, orders: number, earnings: number) {
  const date = new Date(row.date);
  const ticketAverage = orders > 0 ? earnings / orders : 0;
  return {
    ...rowToPayload(
      {
        ...row,
        sourcePlatform: platform,
        grossAmount: earnings,
        serviceAmount: 0,
        tickets: orders,
        ticketAverage,
        repiqueAmount: 0,
        salesFirstShift: 0,
        ticketsFirstShift: 0,
        salesSecondShift: 0,
        ticketsSecondShift: 0,
        salesTables: 0,
        ticketsTables: 0,
        accumulatedAmount: 0
      },
      input
    ),
    description: row.dayOfWeek ? `Delivery ${platform} - ${row.dayOfWeek}` : `Delivery ${platform} - dia ${date.getDate()}`
  };
}

function rowToPayloads(row: RevenuePreviewRow, input: RevenueImportInput) {
  if (!row.delivery) return [rowToPayload(row, input)];
  return [
    deliveryPlatformPayload(row, input, "99Food", row.delivery.orders99Food, row.delivery.earnings99Food),
    deliveryPlatformPayload(row, input, "iFood", row.delivery.ordersIfood, row.delivery.earningsIfood),
    deliveryPlatformPayload(row, input, "Keeta", row.delivery.ordersKeeta, row.delivery.earningsKeeta)
  ];
}

function buildPreviewRowsFromParsed(
  parsed: ParsedRevenueSpreadsheet,
  input: { competenceYear: number; competenceMonth: number; defaultChannel: string },
  existingEntries: Map<string, string>,
  warnings: Array<{ rowNumber: number; message: string }>
) {
  const previewRows: RevenuePreviewRow[] = [];

  if (parsed.kind === "delivery") {
    for (const row of parsed.rows) {
      const dateKey = toCalendarDateKey(row.date);
      const existingRevenueEntryId = existingEntries.get(dateKey) ?? null;
      const grossAmount = row.earnings99Food + row.earningsIfood + row.earningsKeeta;
      const totalTickets = row.orders99Food + row.ordersIfood + row.ordersKeeta;
      const previewRow: RevenuePreviewRow = {
        rowNumber: row.rowNumber,
        date: dateKey,
        dayOfWeek: row.dayOfWeek ?? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(row.date).toUpperCase(),
        channel: "Delivery",
        sourcePlatform: null,
        grossAmount,
        serviceAmount: 0,
        tickets: totalTickets,
        ticketAverage: totalTickets > 0 ? grossAmount / totalTickets : 0,
        repiqueAmount: 0,
        salesFirstShift: 0,
        ticketsFirstShift: 0,
        salesSecondShift: 0,
        ticketsSecondShift: 0,
        salesTables: 0,
        ticketsTables: 0,
        accumulatedAmount: 0,
        delivery: {
          orders99Food: row.orders99Food,
          earnings99Food: row.earnings99Food,
          ordersIfood: row.ordersIfood,
          earningsIfood: row.earningsIfood,
          ordersKeeta: row.ordersKeeta,
          earningsKeeta: row.earningsKeeta
        },
        status: existingRevenueEntryId ? "EXISTS" : "NEW",
        existingRevenueEntryId
      };

      if (previewRow.status === "EXISTS") {
        warnings.push({ rowNumber: previewRow.rowNumber, message: `Dia ${previewRow.date} ja possui faturamento para o canal Delivery.` });
      }

      previewRows.push(previewRow);
    }
    return previewRows;
  }

  for (const row of parsed.rows) {
    const date = createCalendarDate(input.competenceYear, input.competenceMonth, row.day);
    const existingRevenueEntryId = existingEntries.get(toCalendarDateKey(date)) ?? null;
    const previewRow: RevenuePreviewRow = {
      rowNumber: row.rowNumber,
      date: toCalendarDateKey(date),
      dayOfWeek: row.dayOfWeek ?? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date).toUpperCase(),
      channel: input.defaultChannel,
      sourcePlatform: null,
      grossAmount: row.grossAmount,
      serviceAmount: row.serviceAmount,
      tickets: row.totalTickets,
      ticketAverage: row.ticketAverage,
      repiqueAmount: row.repiqueAmount,
      salesFirstShift: row.salesFirstShift,
      ticketsFirstShift: row.ticketsFirstShift,
      salesSecondShift: row.salesSecondShift,
      ticketsSecondShift: row.ticketsSecondShift,
      salesTables: row.salesTables,
      ticketsTables: row.ticketsTables,
      accumulatedAmount: row.accumulatedAmount,
      status: existingRevenueEntryId ? "EXISTS" : "NEW",
      existingRevenueEntryId
    };

    if (previewRow.status === "EXISTS") {
      warnings.push({ rowNumber: previewRow.rowNumber, message: `Dia ${previewRow.date} ja possui faturamento para o canal ${input.defaultChannel}.` });
    }

    previewRows.push(previewRow);
  }

  return previewRows;
}

export async function previewRevenueImport(filePath: string, originalFileName: string | null, sheetName: string | null, input: { competenceYear: number; competenceMonth: number; defaultChannel: string }) {
  const preferredKind: PreferredRevenueKind = isDeliveryChannel(input.defaultChannel) ? "delivery" : "salon";
  const parsed = await parseRevenueSpreadsheet(filePath, sheetName ?? "Planilha1", preferredKind);
  const effectiveChannel = parsed.kind === "delivery" ? "Delivery" : input.defaultChannel;
  const existingEntries = await loadExistingEntries(input.competenceYear, input.competenceMonth, effectiveChannel);
  const warnings: Array<{ rowNumber: number; message: string }> = [...parsed.warnings];
  const previewRows = buildPreviewRowsFromParsed(parsed, { ...input, defaultChannel: effectiveChannel }, existingEntries, warnings);
  if (previewRows.length === 0) {
    if (parsed.kind === "delivery") {
      throw new Error("Planilha Delivery reconhecida, mas nenhuma data valida foi importada. Verifique as colunas A: Data, C/D: 99Food, F/G: iFood e I/J: Keeta.");
    }
    throw new Error("Planilha de Salao reconhecida, mas nenhum dia valido foi importado. Verifique se o arquivo selecionado e do modelo Salao/Caixa.");
  }

  const totalGross = previewRows.reduce((sum, row) => sum + row.grossAmount, 0);
  const totalService = previewRows.reduce((sum, row) => sum + row.serviceAmount, 0);
  const totalTickets = previewRows.reduce((sum, row) => sum + row.tickets, 0);
  const totalFirstShift = previewRows.reduce((sum, row) => sum + row.salesFirstShift, 0);
  const totalSecondShift = previewRows.reduce((sum, row) => sum + row.salesSecondShift, 0);
  const totalTables = 0;
  const totalRepique = previewRows.reduce((sum, row) => sum + row.repiqueAmount, 0);
  const total99Food = previewRows.reduce((sum, row) => sum + (row.delivery?.earnings99Food ?? 0), 0);
  const totalIfood = previewRows.reduce((sum, row) => sum + (row.delivery?.earningsIfood ?? 0), 0);
  const totalKeeta = previewRows.reduce((sum, row) => sum + (row.delivery?.earningsKeeta ?? 0), 0);
  const firstDate = previewRows[0]?.date ?? null;
  const lastDate = previewRows.at(-1)?.date ?? null;
  const ticketAverageGeneral = totalTickets > 0 ? totalGross / totalTickets : 0;

  return {
    importKind: parsed.kind === "delivery" ? "DELIVERY" : "SALON",
    sheetName: parsed.sheetName,
    importFileId: filePath.split(/[\\/]/).at(-1) ?? filePath,
    originalFileName,
    totalRows: parsed.totalRows,
    detectedColumns: {
      ...(parsed.kind === "delivery" ? {
        date: "A",
        weekday: "B",
        orders99Food: "C",
        earnings99Food: "D",
        ticketAverage99Food: "E",
        ordersIfood: "F",
        earningsIfood: "G",
        ticketAverageIfood: "H",
        ordersKeeta: "I",
        earningsKeeta: "J",
        ticketAverageKeeta: "K"
      } : {
      day: "A",
      salesFirstShift: "B",
      ticketsFirstShift: "D",
      salesSecondShift: "E",
      ticketsSecondShift: "G",
      repiqueAmount: "H",
      ignoredTablesTickets: "I",
      ignoredTablesSales: "J",
      ignoredTotalAverage: "K",
      serviceAmount: "L",
      ignoredPercentSales: "M",
      ignoredTotalTickets: "N",
      ignoredTotalSales: "O",
      ignoredAccumulatedSales: "Q",
      dayOfWeek: "O/P"
      })
    },
    unrecognizedColumns: [],
    validation: {
      dailyRows: previewRows.length,
      ignoredRows: Math.max(parsed.totalRows - previewRows.length, 0),
      totalGross,
      totalService,
      totalTickets,
      totalFirstShift,
      totalSecondShift,
      totalTables,
      totalRepique,
      total99Food,
      totalIfood,
      totalKeeta,
      firstDate,
      lastDate,
      ticketAverageGeneral,
      existingRows: previewRows.filter((row) => row.status === "EXISTS").length
    },
    warnings,
    previewRows
  } satisfies RevenueImportPreview;
}

export async function confirmRevenueImport(input: RevenueImportInput): Promise<RevenueImportReport> {
  const filePath = safeUploadPath(input.importFileId);
  const preferredKind: PreferredRevenueKind = isDeliveryChannel(input.defaultChannel) ? "delivery" : "salon";
  const parsed = await parseRevenueSpreadsheet(filePath, input.sheetName ?? "Planilha1", preferredKind);
  const effectiveInput = { ...input, defaultChannel: parsed.kind === "delivery" ? "Delivery" : input.defaultChannel };
  const existingEntries = await loadExistingEntries(input.competenceYear, input.competenceMonth, effectiveInput.defaultChannel);
  const warnings: Array<{ rowNumber: number; message: string }> = [...parsed.warnings];
  const errors: Array<{ rowNumber: number; message: string }> = [];
  const previewRows = buildPreviewRowsFromParsed(parsed, effectiveInput, existingEntries, warnings);
  if (previewRows.length === 0) {
    throw new Error(parsed.kind === "delivery"
      ? "Planilha Delivery reconhecida, mas nenhuma data valida foi importada."
      : "Planilha de Salao reconhecida, mas nenhum dia valido foi importado.");
  }

  const duplicates = previewRows.filter((row) => row.status === "EXISTS");
  if (duplicates.length > 0 && !input.allowOverwrite) {
    const duplicateDates = duplicates.map((row) => row.date).join(", ");
    throw new Error(`Existem ${duplicates.length} dia(s) ja importados para o canal ${effectiveInput.defaultChannel}: ${duplicateDates}. Ative a substituicao para prosseguir.`);
  }

  const batchId = crypto.randomUUID();
  let createdRows = 0;
  let updatedRows = 0;
  let overwrittenRows = 0;
  const ignoredSourceRows = Math.max(parsed.totalRows - previewRows.length, 0);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "RevenueImportBatch" (
        "id", "importFileId", "originalFileName", "sheetName", "competenceYear", "competenceMonth",
        "defaultChannel", "notes", "totalRows", "importedRows", "ignoredRows", "overwrittenRows", "createdAt"
      )
      VALUES (
        ${batchId}, ${input.importFileId}, ${input.originalFileName}, ${input.sheetName},
        ${input.competenceYear}, ${input.competenceMonth}, ${effectiveInput.defaultChannel}, ${input.notes},
        ${parsed.totalRows}, 0, ${parsed.totalRows}, 0, CURRENT_TIMESTAMP
      )
    `;

    for (const row of previewRows) {
      const payloads = rowToPayloads(row, effectiveInput);
      for (const payload of payloads) {
      const existingId = existingEntries.get(`${row.date}|${payload.sourcePlatform ?? ""}`) ?? (!row.delivery ? row.existingRevenueEntryId : null);
      if (existingId) {
        const previous = await tx.$queryRaw<Array<Record<string, unknown>>>`
          SELECT *
          FROM "RevenueEntry"
          WHERE "id" = ${existingId}
          LIMIT 1
        `;
        if (!previous[0]) {
          warnings.push({ rowNumber: row.rowNumber, message: `Registro existente nao encontrado para atualizar no dia ${row.date}.` });
          continue;
        }

        const previousSnapshot = snapshotRevenueEntry(previous[0]);
        await tx.$executeRaw`
          UPDATE "RevenueEntry"
          SET "date" = ${payload.date},
              "competenceYear" = ${payload.competenceYear},
              "competenceMonth" = ${payload.competenceMonth},
              "channel" = ${payload.channel},
              "sourcePlatform" = ${payload.sourcePlatform},
              "description" = ${payload.description},
              "grossAmount" = ${payload.grossAmount},
              "discounts" = ${payload.discounts},
              "platformFees" = ${payload.platformFees},
              "netAmount" = ${payload.netAmount},
              "serviceAmount" = ${payload.serviceAmount},
              "tickets" = ${payload.tickets},
              "ticketAverage" = ${payload.ticketAverage},
              "salesFirstShift" = ${payload.salesFirstShift},
              "ticketsFirstShift" = ${payload.ticketsFirstShift},
              "salesSecondShift" = ${payload.salesSecondShift},
              "ticketsSecondShift" = ${payload.ticketsSecondShift},
              "salesTables" = ${payload.salesTables},
              "ticketsTables" = ${payload.ticketsTables},
              "accumulatedAmount" = ${payload.accumulatedAmount},
              "weekdayName" = ${payload.weekdayName},
              "paymentMethod" = ${payload.paymentMethod},
              "cashAmount" = ${payload.cashAmount},
              "pixAmount" = ${payload.pixAmount},
              "debitAmount" = ${payload.debitAmount},
              "creditAmount" = ${payload.creditAmount},
              "voucherAmount" = ${payload.voucherAmount},
              "notes" = ${payload.notes},
              "status" = 'ACTIVE',
              "cancelledAt" = NULL,
              "cancelledByUserId" = NULL,
              "cancellationReason" = NULL,
              "importBatchId" = ${batchId},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existingId}
        `;

        await tx.$executeRaw`
          INSERT INTO "RevenueImportChange" (
            "id", "batchId", "action", "entryId", "rowNumber", "previousData", "newData", "createdAt"
          )
          VALUES (
            ${crypto.randomUUID()}, ${batchId}, 'UPDATED', ${existingId}, ${row.rowNumber},
            ${JSON.stringify(previousSnapshot)}::jsonb, ${JSON.stringify(payload)}::jsonb, CURRENT_TIMESTAMP
          )
        `;
        updatedRows += 1;
        overwrittenRows += 1;
      } else {
        await tx.$executeRaw`
          INSERT INTO "RevenueEntry" (
            "id", "date", "competenceYear", "competenceMonth", "channel", "sourcePlatform", "description", "grossAmount",
            "discounts", "platformFees", "netAmount", "serviceAmount", "tickets", "ticketAverage",
            "salesFirstShift", "ticketsFirstShift", "salesSecondShift", "ticketsSecondShift", "repiqueAmount",
            "salesTables", "ticketsTables", "accumulatedAmount", "weekdayName", "paymentMethod", "cashAmount",
            "pixAmount", "debitAmount", "creditAmount", "voucherAmount", "notes", "status",
            "createdByUserId", "importBatchId", "createdAt", "updatedAt"
          )
          VALUES (
            ${payload.id}, ${payload.date}, ${payload.competenceYear}, ${payload.competenceMonth}, ${payload.channel}, ${payload.sourcePlatform},
            ${payload.description}, ${payload.grossAmount}, ${payload.discounts}, ${payload.platformFees}, ${payload.netAmount},
            ${payload.serviceAmount}, ${payload.tickets}, ${payload.ticketAverage}, ${payload.salesFirstShift},
            ${payload.ticketsFirstShift}, ${payload.salesSecondShift}, ${payload.ticketsSecondShift}, ${payload.repiqueAmount},
            ${payload.salesTables}, ${payload.ticketsTables}, ${payload.accumulatedAmount}, ${payload.weekdayName}, ${payload.paymentMethod},
            ${payload.cashAmount}, ${payload.pixAmount}, ${payload.debitAmount}, ${payload.creditAmount}, ${payload.voucherAmount},
            ${payload.notes}, ${payload.status}, ${payload.createdByUserId}, ${batchId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
        await tx.$executeRaw`
          INSERT INTO "RevenueImportChange" (
            "id", "batchId", "action", "entryId", "rowNumber", "previousData", "newData", "createdAt"
          )
          VALUES (
            ${crypto.randomUUID()}, ${batchId}, 'CREATED', ${payload.id}, ${row.rowNumber},
            NULL, ${JSON.stringify(payload)}::jsonb, CURRENT_TIMESTAMP
          )
        `;
        createdRows += 1;
      }
      }
    }

    await tx.$executeRaw`
      UPDATE "RevenueImportBatch"
      SET "importedRows" = ${createdRows + updatedRows},
          "ignoredRows" = ${ignoredSourceRows},
          "overwrittenRows" = ${overwrittenRows}
      WHERE "id" = ${batchId}
    `;
  });

  const importedRows = createdRows + updatedRows;
  const ignoredRows = ignoredSourceRows;

  await auditLog({
    userId: input.userId,
    action: "IMPORT_REVENUE_EXCEL",
    entity: "RevenueImportBatch",
    entityId: batchId,
    newValue: {
      importFileId: input.importFileId,
      originalFileName: input.originalFileName,
      sheetName: input.sheetName,
      competenceYear: input.competenceYear,
      competenceMonth: input.competenceMonth,
      defaultChannel: effectiveInput.defaultChannel,
      notes: input.notes,
      importedRows,
      createdRows,
      updatedRows,
      overwrittenRows,
      warnings,
      errors
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });

  const totalGross = previewRows.reduce((sum, row) => sum + row.grossAmount, 0);
  const totalService = previewRows.reduce((sum, row) => sum + row.serviceAmount, 0);
  const totalTickets = previewRows.reduce((sum, row) => sum + row.tickets, 0);
  const ticketAverageGeneral = totalTickets > 0 ? totalGross / totalTickets : 0;
  return {
    importBatchId: batchId,
    importedRows,
    createdRows,
    updatedRows,
    ignoredRows,
    spreadsheetTotal: parsed.totalRows,
    importedTotal: importedRows,
    totalGross,
    totalService,
    totalTickets,
    ticketAverageGeneral,
    existingRows: duplicates.length,
    overwrittenRows,
    warnings,
    errors
  };
}

export async function undoRevenueImportBatch(importBatchId: string, input: { userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const [batch] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RevenueImportBatch"
    WHERE "id" = ${importBatchId}
       OR "importFileId" = ${importBatchId}
    LIMIT 1
  `;
  if (!batch) throw new Error("Lote de importacao nao encontrado.");
  const resolvedBatchId = batch.id;

  const changes = await prisma.$queryRaw<Array<{
    id: string;
    action: string;
    entryId: string;
    previousData: unknown;
    createdAt: Date;
  }>>`
    SELECT "id", "action", "entryId", "previousData", "createdAt"
    FROM "RevenueImportChange"
    WHERE "batchId" = ${resolvedBatchId}
    ORDER BY "createdAt" DESC
  `;

  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      if (change.action === "CREATED") {
        await tx.$executeRaw`
          DELETE FROM "RevenueEntry"
          WHERE "id" = ${change.entryId}
        `;
      } else if (change.action === "UPDATED" && change.previousData) {
        const previous = change.previousData as RevenueImportChangeSnapshot;
        const restored = restoreRevenueEntryData(previous);
        await tx.$executeRaw`
          UPDATE "RevenueEntry"
          SET "date" = ${restored.date},
              "competenceYear" = ${restored.competenceYear},
              "competenceMonth" = ${restored.competenceMonth},
              "channel" = ${restored.channel},
              "sourcePlatform" = ${restored.sourcePlatform},
              "description" = ${restored.description},
              "grossAmount" = ${restored.grossAmount},
              "discounts" = ${restored.discounts},
              "platformFees" = ${restored.platformFees},
              "netAmount" = ${restored.netAmount},
              "serviceAmount" = ${restored.serviceAmount},
              "tickets" = ${restored.tickets},
              "ticketAverage" = ${restored.ticketAverage},
              "salesFirstShift" = ${restored.salesFirstShift},
              "ticketsFirstShift" = ${restored.ticketsFirstShift},
              "salesSecondShift" = ${restored.salesSecondShift},
              "ticketsSecondShift" = ${restored.ticketsSecondShift},
              "salesTables" = ${restored.salesTables},
              "ticketsTables" = ${restored.ticketsTables},
              "accumulatedAmount" = ${restored.accumulatedAmount},
              "weekdayName" = ${restored.weekdayName},
              "paymentMethod" = ${restored.paymentMethod},
              "cashAmount" = ${restored.cashAmount},
              "pixAmount" = ${restored.pixAmount},
              "debitAmount" = ${restored.debitAmount},
              "creditAmount" = ${restored.creditAmount},
              "voucherAmount" = ${restored.voucherAmount},
              "notes" = ${restored.notes},
              "status" = ${restored.status},
              "cancelledAt" = ${restored.cancelledAt},
              "cancelledByUserId" = ${restored.cancelledByUserId},
              "cancellationReason" = ${restored.cancellationReason},
              "createdByUserId" = ${restored.createdByUserId},
              "importBatchId" = ${restored.importBatchId},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${change.entryId}
        `;
      }
    }

    await tx.$executeRaw`
      DELETE FROM "RevenueImportChange"
      WHERE "batchId" = ${resolvedBatchId}
    `;
    await tx.$executeRaw`
      DELETE FROM "RevenueImportBatch"
      WHERE "id" = ${resolvedBatchId}
    `;
  });

  await auditLog({
    userId: input.userId,
    action: "UNDO_REVENUE_IMPORT_BATCH",
    entity: "RevenueImportBatch",
    entityId: resolvedBatchId,
    newValue: { importBatchId: resolvedBatchId },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });

  return {
    importBatchId: resolvedBatchId,
    status: "DELETED"
  };
}
