import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { createCalendarDate, normalizeToCalendarDate } from "../../shared/utils/calendar-date.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import {
  closeMonthlyCmv,
  confirmInventorySnapshot,
  ensureCompetenceOpen,
  getInventorySnapshot,
  getMonthlyCmv,
  listInventorySnapshots,
  previewInventorySnapshot,
  reopenMonthlyCmv,
  saveMonthlyCmv,
  undoInventorySnapshot
} from "./monthly.service.js";
import { confirmRevenueImport, previewRevenueImport, undoRevenueImportBatch } from "./revenue-import.service.js";

const upload = multer({ dest: "uploads/" });
const uploadMemory = multer({ storage: multer.memoryStorage() });

export const monthlyRouter = Router();

function numberParam(value: unknown, fallback?: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback ?? 0;
}

function text(value: unknown) {
  const clean = String(value ?? "").trim();
  return clean || null;
}

function competenceFromDate(date: Date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function toCalendarDateKey(value: Date) {
  const normalized = normalizeToCalendarDate(value);
  return `${normalized.getUTCFullYear()}-${String(normalized.getUTCMonth() + 1).padStart(2, "0")}-${String(normalized.getUTCDate()).padStart(2, "0")}`;
}

async function persistUploadedSpreadsheet(originalName: string, buffer: Buffer) {
  const extension = path.extname(originalName).trim() || ".xlsx";
  const targetPath = path.resolve(os.tmpdir(), `cmv-loja-${crypto.randomUUID()}${extension}`);
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

monthlyRouter.post("/inventory/preview", upload.single("file"), async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  if (!request.file) {
    response.status(400).json({ message: "Arquivo nao enviado." });
    return;
  }
  try {
    response.json(await previewInventorySnapshot(request.file.path, request.file.originalname, text(request.body.sheetName)));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao processar inventario." });
  }
});

monthlyRouter.post("/inventory/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const countDate = parseDate(request.body.countDate) ?? new Date();
    response.json(await confirmInventorySnapshot({
      importFileId: String(request.body.importFileId ?? ""),
      originalFileName: text(request.body.originalFileName),
      sheetName: text(request.body.sheetName),
      competenceYear: numberParam(request.body.competenceYear, countDate.getFullYear()),
      competenceMonth: numberParam(request.body.competenceMonth, countDate.getMonth() + 1),
      type: String(request.body.type ?? "INVENTARIO_FINAL") as never,
      countDate,
      notes: text(request.body.notes),
      allowOverwrite: Boolean(request.body.allowOverwrite),
      overwriteReason: text(request.body.overwriteReason),
      userId: user.id,
      userRole: user.role,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao confirmar inventario." });
  }
});

monthlyRouter.get("/inventory", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await listInventorySnapshots(
    request.query.year ? numberParam(request.query.year) : undefined,
    request.query.month ? numberParam(request.query.month) : undefined
  ));
});

monthlyRouter.get("/inventory/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  try {
    response.json(await getInventorySnapshot(request.params.id));
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Inventario nao encontrado." });
  }
});

monthlyRouter.delete("/inventory/:id", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  try {
    response.json(await undoInventorySnapshot(request.params.id, {
      reason: String(request.body.reason ?? ""),
      userId: admin.id,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao desfazer inventario." });
  }
});

monthlyRouter.post("/revenue/import/preview", uploadMemory.single("file"), async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  if (!request.file?.buffer) {
    response.status(400).json({ message: "Arquivo nao enviado." });
    return;
  }
  const competenceYear = numberParam(request.body.competenceYear, new Date().getFullYear());
  const competenceMonth = numberParam(request.body.competenceMonth, new Date().getMonth() + 1);
  const requestedSheetName = text(request.body.sheetName);
  const defaultChannel = String(request.body.defaultChannel ?? "Salão").trim() || "Salão";
  const sheetName = defaultChannel === "Delivery" && (!requestedSheetName || requestedSheetName === "Planilha1")
    ? null
    : requestedSheetName ?? "Planilha1";
  try {
    const filePath = await persistUploadedSpreadsheet(request.file.originalname, request.file.buffer);
    response.json(
      await previewRevenueImport(
        filePath,
        request.file.originalname,
        sheetName,
        { competenceYear, competenceMonth, defaultChannel }
      )
    );
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao processar faturamento."
    });
  }
});

monthlyRouter.post("/revenue/import/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const importFileId = String(request.body.importFileId ?? "").trim();
  if (!importFileId) {
    response.status(400).json({ message: "importFileId nao informado." });
    return;
  }

  const allowOverwrite = Boolean(request.body.allowOverwrite);
  const overwriteReason = text(request.body.overwriteReason);
  if (allowOverwrite && !(user.role === "ADMIN" || await userHasPermission(user, "revenue", "admin"))) {
    response.status(403).json({ message: "Usuario sem permissao para sobrescrever faturamento existente." });
    return;
  }
  if (allowOverwrite && !overwriteReason) {
    response.status(400).json({ message: "Motivo para substituicao obrigatorio." });
    return;
  }

  try {
    response.json(
      await confirmRevenueImport({
        importFileId,
        originalFileName: text(request.body.originalFileName),
        sheetName: text(request.body.sheetName) ?? "Planilha1",
        competenceYear: numberParam(request.body.competenceYear, new Date().getFullYear()),
        competenceMonth: numberParam(request.body.competenceMonth, new Date().getMonth() + 1),
        defaultChannel: String(request.body.defaultChannel ?? "Salão").trim() || "Salão",
        notes: text(request.body.notes),
        allowOverwrite,
        overwriteReason,
        userId: user.id,
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      })
    );
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao confirmar importacao de faturamento."
    });
  }
});

monthlyRouter.delete("/revenue/import/:importBatchId", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  try {
    response.json(await undoRevenueImportBatch(request.params.importBatchId, {
      userId: admin.id,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao desfazer importacao de faturamento."
    });
  }
});

monthlyRouter.get("/revenue", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const year = numberParam(request.query.year, new Date().getFullYear());
  const month = numberParam(request.query.month, new Date().getMonth() + 1);
  const startDate = request.query.startDate ? parseDate(request.query.startDate) : null;
  const endDate = request.query.endDate ? parseDate(request.query.endDate) : null;
  const channel = String(request.query.channel ?? "").trim();
  if (endDate) endDate.setHours(23, 59, 59, 999);
  const dateFilters = Prisma.sql`
    ${startDate ? Prisma.sql`AND "date" >= ${startDate}` : Prisma.empty}
    ${endDate ? Prisma.sql`AND "date" <= ${endDate}` : Prisma.empty}
  `;
  const competenceFilter = !startDate && !endDate
    ? Prisma.sql`AND "competenceYear" = ${year} AND "competenceMonth" = ${month}`
    : Prisma.empty;
  const channelFilter = channel
    ? Prisma.sql`AND "channel" = ${channel}`
    : Prisma.empty;
  const entries = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      ${dateFilters}
      ${competenceFilter}
      ${channelFilter}
    ORDER BY "date" DESC, "createdAt" DESC
  `;
  const byChannel = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "channel", SUM("grossAmount") AS "grossAmount", SUM("serviceAmount") AS "serviceAmount",
           SUM("repiqueAmount") AS "repiqueAmount",
           SUM("discounts") AS "discounts", SUM("platformFees") AS "platformFees",
           SUM("netAmount") AS "netAmount", SUM("tickets") AS "tickets", COUNT(*) AS "count",
           SUM("salesFirstShift") AS "salesFirstShift", SUM("salesSecondShift") AS "salesSecondShift",
           SUM("salesTables") AS "salesTables"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      ${dateFilters}
      ${competenceFilter}
      ${channelFilter}
    GROUP BY "channel"
    ORDER BY SUM("netAmount") DESC
  `;
  const byDay = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT DATE("date" AT TIME ZONE 'UTC') AS "date", MAX("weekdayName") AS "weekdayName",
           SUM("netAmount") AS "netAmount", SUM("grossAmount") AS "grossAmount",
           SUM("serviceAmount") AS "serviceAmount", SUM("repiqueAmount") AS "repiqueAmount",
           SUM("tickets") AS "tickets",
           SUM("salesFirstShift") AS "salesFirstShift", SUM("salesSecondShift") AS "salesSecondShift",
           SUM("salesTables") AS "salesTables", SUM("ticketsFirstShift") AS "ticketsFirstShift",
           SUM("ticketsSecondShift") AS "ticketsSecondShift", SUM("ticketsTables") AS "ticketsTables"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      ${dateFilters}
      ${competenceFilter}
      ${channelFilter}
    GROUP BY DATE("date" AT TIME ZONE 'UTC')
    ORDER BY DATE("date" AT TIME ZONE 'UTC')
  `;
  const byPlatform = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COALESCE("sourcePlatform", 'Sem plataforma') AS "sourcePlatform",
      COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
      COALESCE(SUM("netAmount"), 0) AS "netAmount",
      COALESCE(SUM("tickets"), 0) AS "tickets",
      COUNT(*) AS "count"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" = 'Delivery'
      ${dateFilters}
      ${competenceFilter}
    GROUP BY COALESCE("sourcePlatform", 'Sem plataforma')
    ORDER BY COALESCE(SUM("grossAmount"), 0) DESC
  `;
  const normalizedByChannel = byChannel.map((row) => ({
    ...row,
    grossAmount: Number(row.grossAmount ?? 0),
    serviceAmount: Number(row.serviceAmount ?? 0),
    repiqueAmount: Number(row.repiqueAmount ?? 0),
    discounts: Number(row.discounts ?? 0),
    platformFees: Number(row.platformFees ?? 0),
    netAmount: Number(row.netAmount ?? 0),
    tickets: Number(row.tickets ?? 0),
    salesFirstShift: Number(row.salesFirstShift ?? 0),
    salesSecondShift: Number(row.salesSecondShift ?? 0),
    salesTables: Number(row.salesTables ?? 0),
    count: Number(row.count ?? 0)
  }));
  const normalizedByDay = byDay.map((row) => ({
    ...row,
    weekdayName: row.weekdayName == null ? null : String(row.weekdayName),
    date: row.date instanceof Date ? toCalendarDateKey(row.date) : String(row.date ?? ""),
    netAmount: Number(row.netAmount ?? 0),
    grossAmount: Number(row.grossAmount ?? 0),
    serviceAmount: Number(row.serviceAmount ?? 0),
    repiqueAmount: Number(row.repiqueAmount ?? 0),
    tickets: Number(row.tickets ?? 0),
    salesFirstShift: Number(row.salesFirstShift ?? 0),
    salesSecondShift: Number(row.salesSecondShift ?? 0),
    salesTables: Number(row.salesTables ?? 0),
    ticketsFirstShift: Number(row.ticketsFirstShift ?? 0),
    ticketsSecondShift: Number(row.ticketsSecondShift ?? 0),
    ticketsTables: Number(row.ticketsTables ?? 0)
  }));
  response.json({
    entries,
    summary: {
      grossAmount: entries.reduce((sum, entry) => sum + Number(entry.grossAmount ?? 0), 0),
      serviceAmount: entries.reduce((sum, entry) => sum + Number(entry.serviceAmount ?? 0), 0),
      repiqueAmount: entries.reduce((sum, entry) => sum + Number(entry.repiqueAmount ?? 0), 0),
      discounts: entries.reduce((sum, entry) => sum + Number(entry.discounts ?? 0), 0),
      platformFees: entries.reduce((sum, entry) => sum + Number(entry.platformFees ?? 0), 0),
      netAmount: entries.reduce((sum, entry) => sum + Number(entry.netAmount ?? 0), 0),
      tickets: entries.reduce((sum, entry) => sum + Number(entry.tickets ?? 0), 0),
      salesFirstShift: entries.reduce((sum, entry) => sum + Number(entry.salesFirstShift ?? 0), 0),
      salesSecondShift: entries.reduce((sum, entry) => sum + Number(entry.salesSecondShift ?? 0), 0),
      salesTables: entries.reduce((sum, entry) => sum + Number(entry.salesTables ?? 0), 0),
      ticketsFirstShift: entries.reduce((sum, entry) => sum + Number(entry.ticketsFirstShift ?? 0), 0),
      ticketsSecondShift: entries.reduce((sum, entry) => sum + Number(entry.ticketsSecondShift ?? 0), 0),
      ticketsTables: entries.reduce((sum, entry) => sum + Number(entry.ticketsTables ?? 0), 0),
      ticketAverageGeneral: entries.reduce((sum, entry) => sum + Number(entry.tickets ?? 0), 0) > 0
        ? entries.reduce((sum, entry) => sum + Number(entry.grossAmount ?? 0), 0) / entries.reduce((sum, entry) => sum + Number(entry.tickets ?? 0), 0)
        : 0,
      byChannel: normalizedByChannel,
      byPlatform: byPlatform.map((row) => ({
        sourcePlatform: String(row.sourcePlatform ?? "Sem plataforma"),
        grossAmount: Number(row.grossAmount ?? 0),
        netAmount: Number(row.netAmount ?? 0),
        tickets: Number(row.tickets ?? 0),
        count: Number(row.count ?? 0)
      })),
      byDay: normalizedByDay
    }
  });
});

monthlyRouter.get("/revenue/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const [entry] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT *
    FROM "RevenueEntry"
    WHERE "id" = ${request.params.id}
    LIMIT 1
  `;
  if (!entry) {
    response.status(404).json({ message: "Faturamento nao encontrado." });
    return;
  }
  response.json(entry);
});

monthlyRouter.post("/revenue", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const date = parseDate(request.body.date) ?? new Date();
    const calendarDate = createCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    const { year, month } = competenceFromDate(date);
    const competenceYear = numberParam(request.body.competenceYear, year);
    const competenceMonth = numberParam(request.body.competenceMonth, month);
    await ensureCompetenceOpen(competenceYear, competenceMonth);
    const grossAmount = numberParam(request.body.grossAmount, 0);
    const discounts = numberParam(request.body.discounts, 0);
    const platformFees = numberParam(request.body.platformFees, 0);
    const netAmount = request.body.netAmount == null || request.body.netAmount === ""
      ? grossAmount - discounts - platformFees
      : numberParam(request.body.netAmount, 0);
    const serviceAmount = numberParam(request.body.serviceAmount, 0);
    const tickets = Math.trunc(numberParam(request.body.tickets, 0));
    const ticketAverage = request.body.ticketAverage == null || request.body.ticketAverage === ""
      ? (tickets > 0 ? netAmount / tickets : null)
      : numberParam(request.body.ticketAverage, 0);
    const salesFirstShift = numberParam(request.body.salesFirstShift, 0);
    const ticketsFirstShift = Math.trunc(numberParam(request.body.ticketsFirstShift, 0));
    const salesSecondShift = numberParam(request.body.salesSecondShift, 0);
    const ticketsSecondShift = Math.trunc(numberParam(request.body.ticketsSecondShift, 0));
    const repiqueAmount = numberParam(request.body.repiqueAmount, 0);
    const salesTables = numberParam(request.body.salesTables, 0);
    const ticketsTables = Math.trunc(numberParam(request.body.ticketsTables, 0));
    const cashAmount = numberParam(request.body.cashAmount, 0);
    const pixAmount = numberParam(request.body.pixAmount, 0);
    const debitAmount = numberParam(request.body.debitAmount, 0);
    const creditAmount = numberParam(request.body.creditAmount, 0);
    const voucherAmount = numberParam(request.body.voucherAmount, 0);
    const accumulatedAmount = request.body.accumulatedAmount == null || request.body.accumulatedAmount === ""
      ? null
      : numberParam(request.body.accumulatedAmount, 0);
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "RevenueEntry" (
        "id", "date", "competenceYear", "competenceMonth", "channel", "sourcePlatform", "description", "grossAmount",
        "discounts", "platformFees", "netAmount", "serviceAmount", "tickets", "ticketAverage",
        "salesFirstShift", "ticketsFirstShift", "salesSecondShift", "ticketsSecondShift", "repiqueAmount", "salesTables",
        "ticketsTables", "accumulatedAmount", "weekdayName", "paymentMethod", "cashAmount", "pixAmount",
        "debitAmount", "creditAmount", "voucherAmount", "notes", "createdByUserId", "updatedAt"
      )
      VALUES (
        ${id}, ${calendarDate}, ${competenceYear}, ${competenceMonth}, ${String(request.body.channel ?? "Outros")},
        ${text(request.body.sourcePlatform)}, ${text(request.body.description)}, ${grossAmount}, ${discounts}, ${platformFees}, ${netAmount},
        ${serviceAmount}, ${tickets}, ${ticketAverage}, ${salesFirstShift}, ${ticketsFirstShift}, ${salesSecondShift},
        ${ticketsSecondShift}, ${repiqueAmount}, ${salesTables}, ${ticketsTables}, ${accumulatedAmount}, ${text(request.body.weekdayName)},
        ${text(request.body.paymentMethod)}, ${cashAmount}, ${pixAmount}, ${debitAmount}, ${creditAmount}, ${voucherAmount},
        ${text(request.body.notes)}, ${user.id}, CURRENT_TIMESTAMP
      )
    `;
    await auditLog({
      userId: user.id,
      action: "CREATE_REVENUE_ENTRY",
      entity: "RevenueEntry",
      entityId: id,
      newValue: request.body,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(201).json({ id });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao salvar faturamento." });
  }
});

monthlyRouter.post("/revenue/daily-close", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const date = parseDate(request.body.date);
  if (!date) {
    response.status(400).json({ message: "Data do fechamento obrigatoria." });
    return;
  }
  const calendarDate = createCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const rows = await prisma.$queryRaw<Array<{ channel: string; entries: bigint | number; grossAmount: unknown }>>`
    SELECT "channel", COUNT(*) AS "entries", COALESCE(SUM("grossAmount"), 0) AS "grossAmount"
    FROM "RevenueEntry"
    WHERE DATE("date") = DATE(${calendarDate})
      AND "status" <> 'CANCELLED'
      AND "channel" IN ('Salao', 'Delivery')
    GROUP BY "channel"
  `;
  const hasSalon = rows.some((row) => row.channel === "Salao");
  const hasDelivery = rows.some((row) => row.channel === "Delivery");
  if (!hasSalon || !hasDelivery) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_DAILY_REVENUE_CLOSE",
      entity: "RevenueEntry",
      newValue: { date: calendarDate, hasSalon, hasDelivery },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(400).json({
      message: `Nao e possivel fechar o dia. ${!hasSalon ? "Salao pendente. " : ""}${!hasDelivery ? "Delivery pendente." : ""}`.trim(),
      hasSalon,
      hasDelivery
    });
    return;
  }
  await auditLog({
    userId: user.id,
    action: "CLOSE_DAILY_REVENUE",
    entity: "RevenueEntry",
    newValue: { date: calendarDate, rows },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ date: calendarDate, hasSalon, hasDelivery, status: "CLOSED" });
});

monthlyRouter.put("/revenue/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "RevenueEntry" WHERE "id" = ${request.params.id}`;
    if (!previous) throw new Error("Faturamento nao encontrado.");
    await ensureCompetenceOpen(Number(previous.competenceYear), Number(previous.competenceMonth));
    const grossAmount = numberParam(request.body.grossAmount, 0);
    const discounts = numberParam(request.body.discounts, 0);
    const platformFees = numberParam(request.body.platformFees, 0);
    const netAmount = request.body.netAmount == null || request.body.netAmount === ""
      ? grossAmount - discounts - platformFees
      : numberParam(request.body.netAmount, 0);
    const serviceAmount = numberParam(request.body.serviceAmount, 0);
    const tickets = Math.trunc(numberParam(request.body.tickets, 0));
    const ticketAverage = request.body.ticketAverage == null || request.body.ticketAverage === ""
      ? (tickets > 0 ? netAmount / tickets : null)
      : numberParam(request.body.ticketAverage, 0);
    const salesFirstShift = numberParam(request.body.salesFirstShift, 0);
    const ticketsFirstShift = Math.trunc(numberParam(request.body.ticketsFirstShift, 0));
    const salesSecondShift = numberParam(request.body.salesSecondShift, 0);
    const ticketsSecondShift = Math.trunc(numberParam(request.body.ticketsSecondShift, 0));
    const repiqueAmount = numberParam(request.body.repiqueAmount, 0);
    const salesTables = numberParam(request.body.salesTables, 0);
    const ticketsTables = Math.trunc(numberParam(request.body.ticketsTables, 0));
    const cashAmount = numberParam(request.body.cashAmount, 0);
    const pixAmount = numberParam(request.body.pixAmount, 0);
    const debitAmount = numberParam(request.body.debitAmount, 0);
    const creditAmount = numberParam(request.body.creditAmount, 0);
    const voucherAmount = numberParam(request.body.voucherAmount, 0);
    const accumulatedAmount = request.body.accumulatedAmount == null || request.body.accumulatedAmount === ""
      ? null
      : numberParam(request.body.accumulatedAmount, 0);
    const date = parseDate(request.body.date) ?? parseDate(previous.date) ?? new Date();
    const calendarDate = createCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    await prisma.$executeRaw`
      UPDATE "RevenueEntry"
      SET "date" = ${calendarDate},
          "channel" = ${String(request.body.channel ?? previous.channel)},
          "sourcePlatform" = ${text(request.body.sourcePlatform)},
          "description" = ${text(request.body.description)},
          "grossAmount" = ${grossAmount},
          "discounts" = ${discounts},
          "platformFees" = ${platformFees},
          "netAmount" = ${netAmount},
          "serviceAmount" = ${serviceAmount},
          "tickets" = ${tickets},
          "ticketAverage" = ${ticketAverage},
          "salesFirstShift" = ${salesFirstShift},
          "ticketsFirstShift" = ${ticketsFirstShift},
          "salesSecondShift" = ${salesSecondShift},
          "ticketsSecondShift" = ${ticketsSecondShift},
          "repiqueAmount" = ${repiqueAmount},
          "salesTables" = ${salesTables},
          "ticketsTables" = ${ticketsTables},
          "accumulatedAmount" = ${accumulatedAmount},
          "weekdayName" = ${text(request.body.weekdayName)},
          "paymentMethod" = ${text(request.body.paymentMethod)},
          "cashAmount" = ${cashAmount},
          "pixAmount" = ${pixAmount},
          "debitAmount" = ${debitAmount},
          "creditAmount" = ${creditAmount},
          "voucherAmount" = ${voucherAmount},
          "notes" = ${text(request.body.notes)},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({ userId: user.id, action: "UPDATE_REVENUE_ENTRY", entity: "RevenueEntry", entityId: request.params.id, previousValue: previous, newValue: request.body, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
    response.json({ id: request.params.id });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao atualizar faturamento." });
  }
});

monthlyRouter.delete("/revenue/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "RevenueEntry" WHERE "id" = ${request.params.id}`;
    if (!previous) throw new Error("Faturamento nao encontrado.");
    await ensureCompetenceOpen(Number(previous.competenceYear), Number(previous.competenceMonth));
    const reason = String(request.body.reason ?? "").trim();
    if (!reason) throw new Error("Motivo obrigatorio.");
    await prisma.$executeRaw`
      UPDATE "RevenueEntry"
      SET "status" = 'CANCELLED',
          "cancelledAt" = CURRENT_TIMESTAMP,
          "cancelledByUserId" = ${user.id},
          "cancellationReason" = ${reason}
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({ userId: user.id, action: "CANCEL_REVENUE_ENTRY", entity: "RevenueEntry", entityId: request.params.id, previousValue: previous, newValue: { reason }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
    response.json({ id: request.params.id, status: "CANCELLED" });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao cancelar faturamento." });
  }
});

monthlyRouter.get("/cmv", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await getMonthlyCmv(numberParam(request.query.year, new Date().getFullYear()), numberParam(request.query.month, new Date().getMonth() + 1)));
});

monthlyRouter.post("/cmv/calculate", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    response.json(await saveMonthlyCmv(numberParam(request.body.year), numberParam(request.body.month), user.id, user.role));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao calcular CMV." });
  }
});

monthlyRouter.post("/cmv/close", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    response.json(await closeMonthlyCmv(numberParam(request.body.year), numberParam(request.body.month), user.id, user.role));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao fechar competencia." });
  }
});

monthlyRouter.post("/cmv/reopen", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  try {
    response.json(await reopenMonthlyCmv(numberParam(request.body.year), numberParam(request.body.month), {
      userId: admin.id,
      reason: String(request.body.reason ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao reabrir competencia." });
  }
});
