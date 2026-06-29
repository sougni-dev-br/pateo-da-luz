import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { createOperationalInventoryPdf } from "./operational-inventory-pdf.js";
import { auditLog, requestIp, requireRole, type SessionUser } from "../security/security-utils.js";

export const inventoryRouter = Router();

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function sanitizeDisplayText(value: unknown) {
  const text = asText(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized === "[object object]" || normalized === "undefined" || normalized === "null") {
    return null;
  }
  return text;
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function queryDateRange(query: { startDate?: unknown; endDate?: unknown }) {
  const startDate = query.startDate ? new Date(String(query.startDate)) : null;
  const endDate = query.endDate ? new Date(String(query.endDate)) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

function isCostAllowed(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "GESTAO_COMPLETA";
}

function movementQuantitySign(type: string, quantity: number) {
  if (["PURCHASE_IN", "POSITIVE_ADJUSTMENT", "RETURN"].includes(type)) return quantity;
  if (["ADJUSTMENT"].includes(type)) return quantity;
  return -quantity;
}

function requiresMovementNotes(type: string) {
  return ["BREAKAGE", "LOSS", "EMPLOYEE_PURCHASE", "NEGATIVE_ADJUSTMENT"].includes(type);
}

function dateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value: unknown) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateOnly(new Date(text));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const accentChars = "áàãâäéèêëíìîïóòõôöúùûüç";
const plainChars = "aaaaaeeeeiiiiooooouuuuc";

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

function ruleMatchesDate(rule: { dayOfWeek: number | null; frequency: string }, date: Date, lastDay: number) {
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  const weekOfMonth = Math.floor((dayOfMonth - 1) / 7);
  const frequency = String(rule.frequency ?? "WEEKLY").toUpperCase();

  if (frequency === "DAILY") return true;
  if (frequency === "LAST_DAY") return dayOfMonth === lastDay;
  if (frequency === "MONTHLY") return dayOfMonth === 1 || dayOfMonth === lastDay;
  if (frequency === "BIWEEKLY") return rule.dayOfWeek === dayOfWeek && weekOfMonth % 2 === 0;
  return rule.dayOfWeek === dayOfWeek;
}

async function ensureDefaultAgendaRules() {
  const [count] = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS "total" FROM "InventoryAgendaRule"
  `;
  if (Number(count?.total ?? 0) > 0) return;

  const defaults = [
    { dayOfWeek: 1, sectorName: "ADEGA", frequency: "WEEKLY", notes: "Contagem semanal da adega." },
    { dayOfWeek: 2, sectorName: "BAR", frequency: "WEEKLY", notes: "Contagem semanal do bar." },
    { dayOfWeek: 3, sectorName: "CAMARA FRIA", frequency: "WEEKLY", notes: "Contagem semanal da camara fria." },
    { dayOfWeek: 4, sectorName: "ESTOQUE", frequency: "WEEKLY", notes: "Contagem semanal do estoque." },
    { dayOfWeek: 5, sectorName: "CORREDORES", frequency: "WEEKLY", notes: "Contagem semanal dos corredores." },
    { dayOfWeek: 6, sectorName: "Revisao/Pendencias", frequency: "WEEKLY", notes: "Revisao de pendencias da semana." },
    { dayOfWeek: null, sectorName: "INVENTARIO GERAL", frequency: "LAST_DAY", notes: "Contagem geral para fechamento do mes e estoque inicial do mes seguinte." }
  ];

  for (const rule of defaults) {
    const [sector] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "InventorySector" ("id", "name", "normalizedName", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${rule.sectorName}, ${rule.sectorName.toLowerCase()}, CURRENT_TIMESTAMP)
      ON CONFLICT ("normalizedName") DO UPDATE SET "name" = EXCLUDED."name"
      RETURNING "id"
    `;
    await prisma.$executeRaw`
      INSERT INTO "InventoryAgendaRule" ("id", "dayOfWeek", "sectorId", "sectorName", "categoryName", "frequency", "notes", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${rule.dayOfWeek}, ${sector?.id ?? null}, ${rule.sectorName}, ${rule.sectorName}, ${rule.frequency}, ${rule.notes}, CURRENT_TIMESTAMP)
    `;
  }
}

async function ensureAgendaForMonth(year: number, month: number) {
  await ensureDefaultAgendaRules();
  const { start, end } = monthBounds(year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const rules = await prisma.$queryRaw<
    Array<{
      id: string;
      dayOfWeek: number | null;
      sectorId: string | null;
      sectorName: string | null;
      categoryId: string | null;
      categoryName: string;
      frequency: string;
      defaultResponsibleUserId: string | null;
      notes: string | null;
    }>
  >`
    SELECT "id", "dayOfWeek", "sectorId", "sectorName", "categoryId", "categoryName", "frequency", "defaultResponsibleUserId", "notes"
    FROM "InventoryAgendaRule"
    WHERE "isActive" = true
  `;

  for (let day = new Date(start); day < end; day.setDate(day.getDate() + 1)) {
    for (const rule of rules) {
      if (!ruleMatchesDate(rule, day, lastDay)) continue;
      await prisma.$executeRaw`
        INSERT INTO "InventoryAgendaItem" (
          "id", "scheduledDate", "sectorId", "sectorName", "categoryId", "categoryName", "responsibleUserId", "notes", "updatedAt"
        )
        VALUES (
          ${crypto.randomUUID()}, ${dateOnly(day)}, ${rule.sectorId}, ${rule.sectorName}, ${rule.categoryId}, ${rule.categoryName},
          ${rule.defaultResponsibleUserId}, ${rule.notes}, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("scheduledDate", "categoryName") DO NOTHING
      `;
    }
  }
}

async function markLateAgendaItems(userId: string | null) {
  const today = dateOnly(new Date());
  const lateItems = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"
    FROM "InventoryAgendaItem"
    WHERE "scheduledDate" < ${today}
      AND "status" IN ('PENDING', 'IN_PROGRESS')
  `;
  if (!lateItems.length) return;

  await prisma.$executeRaw`
    UPDATE "InventoryAgendaItem"
    SET "status" = 'LATE', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" IN (${Prisma.join(lateItems.map((item) => item.id))})
  `;

  await auditLog({
    userId,
    action: "MARK_STOCK_COUNT_LATE",
    entity: "InventoryAgendaItem",
    newValue: { ids: lateItems.map((item) => item.id) }
  });
}

async function upsertStock(input: {
  productId: string;
  quantityDelta: number;
  unit: string | null;
  unitMeasureId: string | null;
  unitCost: number | null;
  totalCost: number | null;
}) {
  const [current] = await prisma.$queryRaw<Array<{ currentQuantity: Prisma.Decimal; averageCost: Prisma.Decimal }>>`
    SELECT "currentQuantity", "averageCost"
    FROM "InventoryStock"
    WHERE "productId" = ${input.productId}
    LIMIT 1
  `;

  const currentQuantity = Number(current?.currentQuantity ?? 0);
  const currentAverageCost = Number(current?.averageCost ?? 0);
  const nextQuantity = currentQuantity + input.quantityDelta;
  const incomingCost = input.totalCost ?? (input.unitCost ? input.unitCost * Math.abs(input.quantityDelta) : 0);
  const nextAverageCost =
    input.quantityDelta > 0 && nextQuantity > 0
      ? (currentQuantity * currentAverageCost + incomingCost) / nextQuantity
      : currentAverageCost;
  const costPerKg = input.unit?.toUpperCase() === "KG" ? nextAverageCost : null;
  const costPerBox = ["CX", "CAIXA"].includes(input.unit?.toUpperCase() ?? "") ? nextAverageCost : null;
  const costPerUnit = ["UN", "UNI", "UNIDADE"].includes(input.unit?.toUpperCase() ?? "") ? nextAverageCost : null;

  await prisma.$executeRaw`
    INSERT INTO "InventoryStock" (
      "id",
      "productId",
      "unitMeasureId",
      "currentQuantity",
      "averageCost",
      "costPerKg",
      "costPerBox",
      "costPerUnit",
      "lastMovementAt",
      "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${input.productId},
      ${input.unitMeasureId},
      ${nextQuantity},
      ${nextAverageCost},
      ${costPerKg},
      ${costPerBox},
      ${costPerUnit},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("productId") DO UPDATE SET
      "unitMeasureId" = COALESCE(EXCLUDED."unitMeasureId", "InventoryStock"."unitMeasureId"),
      "currentQuantity" = ${nextQuantity},
      "averageCost" = ${nextAverageCost},
      "costPerKg" = COALESCE(EXCLUDED."costPerKg", "InventoryStock"."costPerKg"),
      "costPerBox" = COALESCE(EXCLUDED."costPerBox", "InventoryStock"."costPerBox"),
      "costPerUnit" = COALESCE(EXCLUDED."costPerUnit", "InventoryStock"."costPerUnit"),
      "lastMovementAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function recordPurchaseInventoryEntry(input: {
  productId: string;
  purchaseItemId: string;
  quantity: number;
  unit: string | null;
  unitMeasureId: string | null;
  totalCost: number;
}) {
  const [product] = await prisma.$queryRaw<Array<{ controlsStock: boolean }>>`
    SELECT "controlsStock"
    FROM "Product"
    WHERE "id" = ${input.productId}
    LIMIT 1
  `;
  if (!product?.controlsStock) return null;

  const quantity = input.quantity > 0 ? input.quantity : 0;
  if (!quantity) return null;
  const unitCost = input.totalCost / quantity;
  const movementId = crypto.randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "InventoryMovement" (
      "id",
      "productId",
      "type",
      "quantity",
      "unit",
      "unitMeasureId",
      "unitCost",
      "totalCost",
      "sourcePurchaseItemId",
      "notes"
    )
    VALUES (
      ${movementId},
      ${input.productId},
      'PURCHASE_IN',
      ${quantity},
      ${input.unit},
      ${input.unitMeasureId},
      ${unitCost},
      ${input.totalCost},
      ${input.purchaseItemId},
      'Entrada gerada automaticamente pela importacao de compra.'
    )
  `;
  await upsertStock({
    productId: input.productId,
    quantityDelta: quantity,
    unit: input.unit,
    unitMeasureId: input.unitMeasureId,
    unitCost,
    totalCost: input.totalCost
  });
  return movementId;
}

type OperationalInventoryRow = {
  id: string;
  code: string;
  date: Date;
  name: string;
  type: string;
  status: string;
  sectorId: string | null;
  sectorName: string | null;
  responsibleUserId: string | null;
  responsibleName?: string | null;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  closedByUserId: string | null;
  canceledByUserId: string | null;
  sentToReviewAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  closedAt: Date | null;
  canceledAt: Date | null;
  notes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  inventorySnapshotId: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalItems?: number | bigint;
  countedItems?: number | bigint;
  pendingItems?: number | bigint;
  divergentItems?: number | bigint;
  zeroItems?: number | bigint;
};

type OperationalInventoryItemRow = {
  id: string;
  inventoryId: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  location: string | null;
  unit: string | null;
  expectedQuantity: Prisma.Decimal | number | string;
  countedQuantity: Prisma.Decimal | number | string | null;
  differenceQuantity: Prisma.Decimal | number | string | null;
  status: string;
  notes: string | null;
  countedByUserId: string | null;
  countedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StockCountSessionRow = {
  id: string;
  code: string;
  type: string;
  status: string;
  referenceDate: Date;
  periodMonth: number | null;
  periodYear: number | null;
  isMonthEnd: boolean;
  sectorId: string | null;
  sectorName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  inventoryAgendaItemId: string | null;
  responsibleUserId: string | null;
  responsibleName?: string | null;
  notes: string | null;
  concludedAt: Date | null;
  reopenedAt: Date | null;
  canceledAt: Date | null;
  canceledByUserId: string | null;
  cancelReason: string | null;
  generatedInventoryId: string | null;
  generatedInventoryCode?: string | null;
  source: string | null;
  linkedSnapshotId: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalItems?: number | bigint;
  countedItems?: number | bigint;
  pendingItems?: number | bigint;
  divergentItems?: number | bigint;
  zeroItems?: number | bigint;
};

type StockCountSessionItemRow = {
  id: string;
  stockCountSessionId: string;
  productId: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string;
  sectorSnapshot: string | null;
  categorySnapshot: string | null;
  subcategorySnapshot: string | null;
  locationSnapshot: string | null;
  unitSnapshot: string | null;
  expectedQuantity: Prisma.Decimal | number | string;
  countedQuantity: Prisma.Decimal | number | string | null;
  differenceQuantity: Prisma.Decimal | number | string | null;
  status: string;
  notes: string | null;
  countedByUserId: string | null;
  countedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const finalOperationalInventoryStatuses = new Set(["APROVADO", "FECHADO"]);
const editableOperationalInventoryStatuses = new Set(["RASCUNHO", "REJEITADO"]);
const editableStockCountSessionStatuses = new Set(["ABERTA", "EM_ANDAMENTO"]);
const cancelableStockCountSessionStatuses = new Set(["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"]);

function isInventoryManager(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "GESTAO_COMPLETA";
}

function canCancelStockCountSession(session: StockCountSessionRow, user: SessionUser) {
  if (!cancelableStockCountSessionStatuses.has(session.status)) return false;
  if (session.generatedInventoryId) return false;
  return isInventoryManager(user);
}

function inventoryTypeLabel(type: string, sectorName?: string | null) {
  if (type === "FINAL_CMV") return "Final CMV";
  if (type === "SETORIAL") return sectorName ? `Setorial ${sectorName}` : "Setorial";
  if (type === "CONFERENCIA") return "Conferencia";
  return "Geral";
}

function operationalInventoryStatusLabel(status: string) {
  if (status === "RASCUNHO") return "Rascunho";
  if (status === "EM_REVISAO") return "Em revisao";
  if (status === "APROVADO") return "Aprovado";
  if (status === "REJEITADO") return "Rejeitado";
  if (status === "FECHADO") return "Fechado";
  if (status === "CANCELADO") return "Cancelado";
  return status;
}

function brDate(date: Date) {
  return isoDate(date).split("-").reverse().join("/");
}

function brDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatMoney(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeOperationalInventory(row: OperationalInventoryRow) {
  return {
    ...row,
    totalItems: Number(row.totalItems ?? 0),
    countedItems: Number(row.countedItems ?? 0),
    pendingItems: Number(row.pendingItems ?? 0),
    divergentItems: Number(row.divergentItems ?? 0),
    zeroItems: Number(row.zeroItems ?? 0)
  };
}

function normalizeOperationalInventoryItem(row: OperationalInventoryItemRow) {
  return {
    ...row,
    expectedQuantity: Number(row.expectedQuantity ?? 0),
    countedQuantity: row.countedQuantity == null ? null : Number(row.countedQuantity),
    differenceQuantity: row.differenceQuantity == null ? null : Number(row.differenceQuantity)
  };
}

function normalizeStockCountSession(row: StockCountSessionRow) {
  return {
    ...row,
    totalItems: Number(row.totalItems ?? 0),
    countedItems: Number(row.countedItems ?? 0),
    pendingItems: Number(row.pendingItems ?? 0),
    divergentItems: Number(row.divergentItems ?? 0),
    zeroItems: Number(row.zeroItems ?? 0)
  };
}

function normalizeStockCountSessionItem(row: StockCountSessionItemRow) {
  return {
    ...row,
    productNameSnapshot: sanitizeDisplayText(row.productNameSnapshot) ?? "Produto sem nome",
    sectorSnapshot: sanitizeDisplayText(row.sectorSnapshot),
    categorySnapshot: sanitizeDisplayText(row.categorySnapshot),
    subcategorySnapshot: sanitizeDisplayText(row.subcategorySnapshot),
    unitSnapshot: sanitizeDisplayText(row.unitSnapshot),
    status: sanitizeDisplayText(row.status) ?? "PENDENTE",
    expectedQuantity: Number(row.expectedQuantity ?? 0),
    countedQuantity: row.countedQuantity == null ? null : Number(row.countedQuantity),
    differenceQuantity: row.differenceQuantity == null ? null : Number(row.differenceQuantity)
  };
}

function countedStatus(countedQuantity: number | null, expectedQuantity: number) {
  if (countedQuantity == null) return { status: "PENDENTE", differenceQuantity: null as number | null };
  const differenceQuantity = countedQuantity - expectedQuantity;
  if (countedQuantity === 0) return { status: "ZERO", differenceQuantity };
  if (Math.abs(differenceQuantity) > 0.0001) return { status: "DIVERGENTE", differenceQuantity };
  return { status: "CONTADO", differenceQuantity };
}

function stockCountSessionItemStatus(countedQuantity: number | null, expectedQuantity: number) {
  if (countedQuantity == null) return { status: "PENDENTE", differenceQuantity: null as number | null };
  return { status: "CONTADO", differenceQuantity: countedQuantity - expectedQuantity };
}

async function nextStockCountSessionCode(date: Date) {
  const year = date.getFullYear();
  const [row] = await prisma.$queryRaw<Array<{ code: string | null }>>`
    SELECT "code"
    FROM "StockCountSession"
    WHERE "code" LIKE ${`CNT-${year}-%`}
    ORDER BY "code" DESC
    LIMIT 1
  `;
  const current = Number(String(row?.code ?? "").split("-").pop() ?? 0);
  return `CNT-${year}-${String(current + 1).padStart(4, "0")}`;
}

async function nextOperationalInventoryCode(date: Date) {
  const year = date.getFullYear();
  const [row] = await prisma.$queryRaw<Array<{ code: string | null }>>`
    SELECT "code"
    FROM "OperationalInventory"
    WHERE "code" LIKE ${`INV-${year}-%`}
    ORDER BY "code" DESC
    LIMIT 1
  `;
  const current = Number(String(row?.code ?? "").split("-").pop() ?? 0);
  return `INV-${year}-${String(current + 1).padStart(4, "0")}`;
}

async function getStockCountSessionSummary(id: string) {
  const [session] = await prisma.$queryRaw<Array<StockCountSessionRow>>`
    SELECT
      s.*,
      u."name" AS "responsibleName",
      oi."code" AS "generatedInventoryCode",
      COUNT(item."id") AS "totalItems",
      COUNT(item."id") FILTER (WHERE item."status" IN ('CONTADO', 'ZERO', 'DIVERGENTE')) AS "countedItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'PENDENTE') AS "pendingItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'DIVERGENTE') AS "divergentItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'ZERO') AS "zeroItems"
    FROM "StockCountSession" s
    LEFT JOIN "User" u ON u."id" = s."responsibleUserId"
    LEFT JOIN "OperationalInventory" oi ON oi."id" = s."generatedInventoryId"
    LEFT JOIN "StockCountSessionItem" item ON item."stockCountSessionId" = s."id"
    WHERE s."id" = ${id}
    GROUP BY s."id", u."name", oi."code"
    LIMIT 1
  `;
  return session ? normalizeStockCountSession(session) : null;
}

async function getStockCountSessionOrThrow(id: string) {
  const session = await getStockCountSessionSummary(id);
  if (!session) throw new Error("Contagem de estoque nao encontrada.");
  return session;
}

async function assertCanEditStockCountSession(id: string, user: SessionUser) {
  const session = await getStockCountSessionOrThrow(id);
  if (!editableStockCountSessionStatuses.has(session.status)) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_STOCK_COUNT_SESSION_EDIT",
      entity: "StockCountSession",
      entityId: id,
      newValue: { status: session.status }
    });
    throw new Error("Esta contagem nao pode ser editada no status atual.");
  }
  return session;
}

async function getOperationalInventorySummary(id: string) {
  const [inventory] = await prisma.$queryRaw<Array<OperationalInventoryRow>>`
    SELECT
      i.*,
      u."name" AS "responsibleName",
      COUNT(item."id") AS "totalItems",
      COUNT(item."id") FILTER (WHERE item."status" IN ('CONTADO', 'ZERO', 'DIVERGENTE')) AS "countedItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'PENDENTE') AS "pendingItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'DIVERGENTE') AS "divergentItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'ZERO') AS "zeroItems"
    FROM "OperationalInventory" i
    LEFT JOIN "User" u ON u."id" = i."responsibleUserId"
    LEFT JOIN "OperationalInventoryItem" item ON item."inventoryId" = i."id"
    WHERE i."id" = ${id}
    GROUP BY i."id", u."name"
    LIMIT 1
  `;
  return inventory ? normalizeOperationalInventory(inventory) : null;
}

async function getOperationalInventoryOrThrow(id: string) {
  const inventory = await getOperationalInventorySummary(id);
  if (!inventory) throw new Error("Inventario operacional nao encontrado.");
  return inventory;
}

async function assertCanEditOperationalInventory(id: string, user: SessionUser) {
  const inventory = await getOperationalInventoryOrThrow(id);
  if (!editableOperationalInventoryStatuses.has(inventory.status)) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_OPERATIONAL_INVENTORY_EDIT",
      entity: "OperationalInventory",
      entityId: id,
      newValue: { status: inventory.status }
    });
    throw new Error("Este inventario nao pode ser editado no status atual.");
  }
  return inventory;
}

async function createInventorySnapshotFromOperationalInventory(id: string, user: SessionUser) {
  const inventory = await getOperationalInventoryOrThrow(id);
  if (inventory.type !== "FINAL_CMV" || !finalOperationalInventoryStatuses.has(inventory.status)) return inventory.inventorySnapshotId;
  if (inventory.inventorySnapshotId) return inventory.inventorySnapshotId;

  const items = await prisma.$queryRaw<Array<OperationalInventoryItemRow & { averageCost: Prisma.Decimal | null }>>`
    SELECT item.*, stock."averageCost"
    FROM "OperationalInventoryItem" item
    LEFT JOIN "InventoryStock" stock ON stock."productId" = item."productId"
    WHERE item."inventoryId" = ${id}
    ORDER BY item."sectorName", item."location", item."categoryName", item."productName"
  `;
  if (items.some((item) => item.status === "PENDENTE")) {
    throw new Error("Inventario FINAL_CMV precisa estar totalmente contado ou zerado para gerar snapshot de CMV.");
  }

  const snapshotId = crypto.randomUUID();
  const year = inventory.date.getFullYear();
  const month = inventory.date.getMonth() + 1;
  const totalItems = items.length;
  const totalValue = items.reduce((sum, item) => {
    const quantity = item.countedQuantity == null ? 0 : Number(item.countedQuantity);
    const unitCost = item.averageCost == null ? 0 : Number(item.averageCost);
    return sum + quantity * unitCost;
  }, 0);

  await prisma.$executeRaw`
    INSERT INTO "InventorySnapshot" (
      "id", "competenceYear", "competenceMonth", "type", "countDate", "status", "totalItems", "totalValue",
      "originalFileName", "source", "createdByUserId", "notes", "createdAt", "updatedAt"
    )
    VALUES (
      ${snapshotId}, ${year}, ${month}, CAST('INVENTARIO_FINAL' AS "InventorySnapshotType"), ${inventory.date},
      'APPROVED', ${totalItems}, ${totalValue}, ${`${inventory.code} - ${inventory.name}`}, 'SISTEMA', ${user.id},
      ${inventory.notes ?? "Gerado pelo inventario operacional."}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  for (const item of items) {
    const countedQuantity = item.countedQuantity == null ? 0 : Number(item.countedQuantity);
    const unitCost = item.averageCost == null ? null : Number(item.averageCost);
    await prisma.$executeRaw`
      INSERT INTO "InventorySnapshotItem" (
        "id", "snapshotId", "productId", "productCode", "productName", "sectorName", "categoryName",
        "subcategoryName", "unit", "quantity", "unitCost", "totalCost", "divergenceQuantity", "resolutionStatus"
      )
      VALUES (
        ${crypto.randomUUID()}, ${snapshotId}, ${item.productId}, ${item.productCode}, ${item.productName},
        ${item.sectorName}, ${item.categoryName}, ${item.subcategoryName}, ${item.unit}, ${countedQuantity},
        ${unitCost}, ${unitCost == null ? null : countedQuantity * unitCost},
        ${item.differenceQuantity == null ? null : Number(item.differenceQuantity)}, 'MATCHED'
      )
    `;
  }

  await prisma.$executeRaw`
    UPDATE "OperationalInventory"
    SET "inventorySnapshotId" = ${snapshotId}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `;
  await auditLog({
    userId: user.id,
    action: "CREATE_INVENTORY_SNAPSHOT_FROM_OPERATIONAL",
    entity: "InventorySnapshot",
    entityId: snapshotId,
    newValue: { operationalInventoryId: id, code: inventory.code, totalItems, totalValue }
  });
  return snapshotId;
}

inventoryRouter.get("/count-sessions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  const includeCanceled = String(request.query.includeCanceled ?? "").toLowerCase() === "true";

  const rows = await prisma.$queryRaw<Array<StockCountSessionRow>>`
    SELECT
      s.*,
      u."name" AS "responsibleName",
      oi."code" AS "generatedInventoryCode",
      COUNT(item."id") AS "totalItems",
      COUNT(item."id") FILTER (WHERE item."status" IN ('CONTADO', 'ZERO', 'DIVERGENTE')) AS "countedItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'PENDENTE') AS "pendingItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'DIVERGENTE') AS "divergentItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'ZERO') AS "zeroItems"
    FROM "StockCountSession" s
    LEFT JOIN "User" u ON u."id" = s."responsibleUserId"
    LEFT JOIN "OperationalInventory" oi ON oi."id" = s."generatedInventoryId"
    LEFT JOIN "StockCountSessionItem" item ON item."stockCountSessionId" = s."id"
    WHERE (${includeCanceled} = true OR s."status" <> 'CANCELADA')
    GROUP BY s."id", u."name", oi."code"
    ORDER BY s."referenceDate" DESC, s."createdAt" DESC
    LIMIT 120
  `;
  response.json(rows.map(normalizeStockCountSession));
});

inventoryRouter.post("/count-sessions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const referenceDate = request.body.referenceDate ? parseLocalDate(request.body.referenceDate) : dateOnly(new Date());
  if (Number.isNaN(referenceDate.getTime())) {
    response.status(400).json({ message: "Data da contagem invalida." });
    return;
  }
  const type = String(request.body.type ?? "GERAL").toUpperCase();
  if (!["GERAL", "SETORIAL", "CATEGORIA", "SUBCATEGORIA", "FINAL_MES", "ALEATORIA", "TAREFA"].includes(type)) {
    response.status(400).json({ message: "Tipo de contagem invalido." });
    return;
  }

  const sectorId = asText(request.body.sectorId);
  const sectorName = asText(request.body.sectorName);
  const categoryId = asText(request.body.categoryId);
  const categoryName = asText(request.body.categoryName);
  const subcategoryId = asText(request.body.subcategoryId);
  const subcategoryName = asText(request.body.subcategoryName);
  const notes = asText(request.body.notes);
  const isMonthEnd = Boolean(request.body.isMonthEnd) || type === "FINAL_MES";
  const periodMonth = Number(request.body.periodMonth ?? referenceDate.getMonth() + 1);
  const periodYear = Number(request.body.periodYear ?? referenceDate.getFullYear());

  if (type === "SETORIAL" && !sectorId && !sectorName) {
    response.status(400).json({ message: "Contagem setorial precisa de um setor." });
    return;
  }
  if (type === "CATEGORIA" && !categoryId && !categoryName) {
    response.status(400).json({ message: "Contagem por categoria precisa de uma categoria." });
    return;
  }
  if (type === "SUBCATEGORIA" && !subcategoryId && !subcategoryName) {
    response.status(400).json({ message: "Contagem por subcategoria precisa de uma subcategoria." });
    return;
  }

  // Bloquear duplicata: não permitir nova contagem ativa para o mesmo período/tipo/setor
  const [existingSession] = await prisma.$queryRaw<Array<{ id: string; code: string }>>`
    SELECT "id", "code"
    FROM "StockCountSession"
    WHERE "periodYear" = ${periodYear}
      AND "periodMonth" = ${periodMonth}
      AND "type" = ${type}
      AND ("sectorId" IS NOT DISTINCT FROM ${sectorId}::text)
      AND "status" IN ('ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA')
    LIMIT 1
  `;
  if (existingSession) {
    response.status(409).json({
      message: `Ja existe uma contagem ${type} para este periodo (${existingSession.code}). Abra a contagem existente ou solicite ao gestor que a cancele antes de iniciar uma nova.`,
      existingId: existingSession.id,
      existingCode: existingSession.code
    });
    return;
  }

  const id = crypto.randomUUID();
  const code = await nextStockCountSessionCode(referenceDate);
  const title = type === "FINAL_MES" ? "contagem final do mes" : "contagem operacional";

  await prisma.$executeRaw`
    INSERT INTO "StockCountSession" (
      "id", "code", "type", "status", "referenceDate", "periodMonth", "periodYear", "isMonthEnd",
      "sectorId", "sectorName", "categoryId", "categoryName", "subcategoryId", "subcategoryName",
      "inventoryAgendaItemId", "responsibleUserId", "notes", "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${code}, ${type}, 'ABERTA', ${referenceDate}, ${periodMonth}, ${periodYear}, ${isMonthEnd},
      ${sectorId}, ${sectorName}, ${categoryId}, ${categoryName}, ${subcategoryId}, ${subcategoryName},
      ${asText(request.body.inventoryAgendaItemId)}, ${user.id}, ${notes ?? `Nova ${title}.`}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  const sectorFilter = type === "SETORIAL"
    ? Prisma.sql`AND (${sectorId ? Prisma.sql`p."inventorySectorId" = ${sectorId}` : Prisma.sql`FALSE`} OR ${sectorName ? Prisma.sql`sec."name" = ${sectorName}` : Prisma.sql`FALSE`})`
    : Prisma.empty;
  const categoryFilter = type === "CATEGORIA"
    ? Prisma.sql`AND (${categoryId ? Prisma.sql`p."categoryId" = ${categoryId}` : Prisma.sql`FALSE`} OR ${categoryName ? Prisma.sql`cat."name" = ${categoryName}` : Prisma.sql`FALSE`})`
    : Prisma.empty;
  const subcategoryFilter = type === "SUBCATEGORIA"
    ? Prisma.sql`AND (${subcategoryId ? Prisma.sql`p."subcategoryId" = ${subcategoryId}` : Prisma.sql`FALSE`} OR ${subcategoryName ? Prisma.sql`sub."name" = ${subcategoryName}` : Prisma.sql`FALSE`})`
    : Prisma.empty;

  const products = await prisma.$queryRaw<Array<{
    id: string;
    productCode: string | null;
    productName: string;
    sectorName: string | null;
    categoryName: string | null;
    subcategoryName: string | null;
    storageLocation: string | null;
    storageCorridor: string | null;
    storageShelf: string | null;
    storagePosition: string | null;
    unit: string | null;
    currentQuantity: Prisma.Decimal | null;
  }>>`
    SELECT
      p."id",
      p."externalCode" AS "productCode",
      p."name" AS "productName",
      sec."name" AS "sectorName",
      cat."name" AS "categoryName",
      sub."name" AS "subcategoryName",
      p."storageLocation",
      p."storageCorridor",
      p."storageShelf",
      p."storagePosition",
      COALESCE(p."stockUnit", p."unit", u."code") AS "unit",
      stock."currentQuantity"
    FROM "Product" p
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "Category" cat ON cat."id" = p."categoryId"
    LEFT JOIN "Subcategory" sub ON sub."id" = p."subcategoryId"
    LEFT JOIN "UnitMeasure" u ON u."id" = p."unitMeasureId"
    LEFT JOIN "InventoryStock" stock ON stock."productId" = p."id"
    WHERE p."controlsStock" = true
      AND p."isActive" = true
      ${sectorFilter}
      ${categoryFilter}
      ${subcategoryFilter}
    ORDER BY
      translate(LOWER(COALESCE(sec."name", 'zzzz_sem_setor')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(cat."name", 'zzzz_sem_categoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(sub."name", 'zzzz_sem_subcategoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(p."stockUnit", p."unit", u."code", 'zzzz_sem_unidade')), ${accentChars}, ${plainChars}),
      translate(LOWER(p."name"), ${accentChars}, ${plainChars}),
      p."externalCode" NULLS LAST
  `;

  for (const product of products) {
    const location = [product.storageLocation, product.storageCorridor, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || null;
    await prisma.$executeRaw`
      INSERT INTO "StockCountSessionItem" (
        "id", "stockCountSessionId", "productId", "productCodeSnapshot", "productNameSnapshot",
        "sectorSnapshot", "categorySnapshot", "subcategorySnapshot", "locationSnapshot", "unitSnapshot",
        "expectedQuantity", "status", "createdAt", "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()}, ${id}, ${product.id}, ${product.productCode}, ${product.productName},
        ${product.sectorName}, ${product.categoryName}, ${product.subcategoryName}, ${location}, ${product.unit},
        ${Number(product.currentQuantity ?? 0)}, 'PENDENTE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
  }

  await auditLog({
    userId: user.id,
    action: "CREATE_STOCK_COUNT_SESSION",
    entity: "StockCountSession",
    entityId: id,
    newValue: { code, type, totalItems: products.length, isMonthEnd },
    ipAddress: requestIp(request)
  });
  response.status(201).json(await getStockCountSessionSummary(id));
});

inventoryRouter.get("/count-sessions/month-end", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const year = Number(request.query.year ?? new Date().getFullYear());
  const month = Number(request.query.month ?? new Date().getMonth() + 1);
  const [session] = await prisma.$queryRaw<Array<StockCountSessionRow>>`
    SELECT s.*, u."name" AS "responsibleName", oi."code" AS "generatedInventoryCode"
    FROM "StockCountSession" s
    LEFT JOIN "User" u ON u."id" = s."responsibleUserId"
    LEFT JOIN "OperationalInventory" oi ON oi."id" = s."generatedInventoryId"
    WHERE s."isMonthEnd" = true
      AND s."periodYear" = ${year}
      AND s."periodMonth" = ${month}
      AND s."status" = 'CONCLUIDA'
    ORDER BY s."referenceDate" DESC, s."createdAt" DESC
    LIMIT 1
  `;
  response.json(session ? normalizeStockCountSession(session) : null);
});

inventoryRouter.get("/count-sessions/opening-basis", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const year = Number(request.query.year ?? new Date().getFullYear());
  const month = Number(request.query.month ?? new Date().getMonth() + 1);
  const previous = new Date(year, month - 2, 1);
  const [session] = await prisma.$queryRaw<Array<StockCountSessionRow>>`
    SELECT s.*, u."name" AS "responsibleName", oi."code" AS "generatedInventoryCode"
    FROM "StockCountSession" s
    LEFT JOIN "User" u ON u."id" = s."responsibleUserId"
    LEFT JOIN "OperationalInventory" oi ON oi."id" = s."generatedInventoryId"
    WHERE s."isMonthEnd" = true
      AND s."periodYear" = ${previous.getFullYear()}
      AND s."periodMonth" = ${previous.getMonth() + 1}
      AND s."status" = 'CONCLUIDA'
    ORDER BY s."referenceDate" DESC, s."createdAt" DESC
    LIMIT 1
  `;
  response.json(session ? normalizeStockCountSession(session) : null);
});

inventoryRouter.post("/count-sessions/consolidate-month-end", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const sessionIds = request.body.sessionIds;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    response.status(400).json({ message: "Informe ao menos uma contagem para consolidar." });
    return;
  }

  const sessions = await prisma.$queryRaw<Array<StockCountSessionRow>>`
    SELECT s.*, u."name" AS "responsibleName", oi."code" AS "generatedInventoryCode"
    FROM "StockCountSession" s
    LEFT JOIN "User" u ON u."id" = s."responsibleUserId"
    LEFT JOIN "OperationalInventory" oi ON oi."id" = s."generatedInventoryId"
    WHERE s."id" = ANY(${sessionIds})
  `;

  if (sessions.length !== sessionIds.length) {
    response.status(404).json({ message: "Uma ou mais contagens nao foram encontradas." });
    return;
  }
  for (const session of sessions) {
    if (session.status !== "CONCLUIDA") {
      response.status(400).json({ message: `Contagem ${session.code} ainda nao esta concluida.` });
      return;
    }
    if (session.type !== "SETORIAL") {
      response.status(400).json({ message: `Contagem ${session.code} nao e do tipo setorial e nao pode ser consolidada.` });
      return;
    }
    if (session.generatedInventoryId) {
      response.status(400).json({ message: `Contagem ${session.code} ja gerou um inventario individual. Cancele-o antes de consolidar.` });
      return;
    }
  }

  const allItems = await prisma.$queryRaw<Array<StockCountSessionItemRow>>`
    SELECT *
    FROM "StockCountSessionItem"
    WHERE "stockCountSessionId" = ANY(${sessionIds})
    ORDER BY "countedAt" DESC NULLS LAST, "createdAt" DESC
  `;
  const itemsByProduct = new Map<string, StockCountSessionItemRow>();
  for (const item of allItems) {
    const key = item.productId ?? item.productNameSnapshot;
    if (!itemsByProduct.has(key)) {
      itemsByProduct.set(key, item);
    }
  }

  const latestDate = sessions.reduce<Date>((max, s) => {
    const d = new Date(s.referenceDate);
    return d > max ? d : max;
  }, new Date(sessions[0].referenceDate));
  const date = dateOnly(latestDate);
  const inventoryId = crypto.randomUUID();
  const code = await nextOperationalInventoryCode(date);
  const sessionCodes = sessions.map((s) => s.code).join(", ");
  const name = `Inventario Final CMV ${brDate(date)} - ${sessions.length} setor(es) consolidado(s)`;

  await prisma.$executeRaw`
    INSERT INTO "OperationalInventory" (
      "id", "code", "date", "name", "type", "status", "sectorId", "sectorName", "responsibleUserId",
      "notes", "sourceStockCountSessionId", "createdAt", "updatedAt"
    )
    VALUES (
      ${inventoryId}, ${code}, ${date}, ${name}, 'FINAL_CMV', 'RASCUNHO', ${null}, ${null},
      ${user.id}, ${asText(request.body.notes) ?? `Consolidado das contagens: ${sessionCodes}.`},
      ${null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  for (const item of itemsByProduct.values()) {
    const countedQuantity = item.countedQuantity == null ? 0 : Number(item.countedQuantity);
    const expectedQuantity = Number(item.expectedQuantity ?? 0);
    const result = countedStatus(countedQuantity, expectedQuantity);
    await prisma.$executeRaw`
      INSERT INTO "OperationalInventoryItem" (
        "id", "inventoryId", "productId", "productCode", "productName", "sectorName", "categoryName", "subcategoryName",
        "location", "unit", "expectedQuantity", "countedQuantity", "differenceQuantity", "status", "notes", "countedByUserId",
        "countedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()}, ${inventoryId}, ${item.productId}, ${item.productCodeSnapshot}, ${item.productNameSnapshot},
        ${item.sectorSnapshot}, ${item.categorySnapshot}, ${item.subcategorySnapshot}, ${item.locationSnapshot}, ${item.unitSnapshot},
        ${expectedQuantity}, ${countedQuantity}, ${result.differenceQuantity}, ${result.status}, ${item.notes}, ${item.countedByUserId},
        ${item.countedAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
  }

  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "generatedInventoryId" = ${inventoryId},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ANY(${sessionIds}::uuid[])
  `;

  await auditLog({
    userId: user.id,
    action: "CONSOLIDATE_MONTH_END_SESSIONS",
    entity: "OperationalInventory",
    entityId: inventoryId,
    newValue: { code, sourceSessionIds: sessionIds, sourceCodes: sessionCodes, totalItems: itemsByProduct.size }
  });
  response.status(201).json(await getOperationalInventorySummary(inventoryId));
});

inventoryRouter.get("/count-sessions/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const session = await getStockCountSessionSummary(request.params.id);
  if (!session || (user.role === "ESTOQUISTA" && session.responsibleUserId !== user.id)) {
    response.status(404).json({ message: "Contagem de estoque nao encontrada." });
    return;
  }
  const items = await prisma.$queryRaw<Array<StockCountSessionItemRow>>`
    SELECT
      item."id",
      item."stockCountSessionId",
      item."productId",
      item."productCodeSnapshot",
      item."productNameSnapshot",
      COALESCE(NULLIF(item."sectorSnapshot", '[object Object]'), NULLIF(sec."name", '[object Object]')) AS "sectorSnapshot",
      COALESCE(NULLIF(item."categorySnapshot", '[object Object]'), NULLIF(cat."name", '[object Object]')) AS "categorySnapshot",
      COALESCE(NULLIF(item."subcategorySnapshot", '[object Object]'), NULLIF(sub."name", '[object Object]')) AS "subcategorySnapshot",
      item."locationSnapshot",
      COALESCE(NULLIF(item."unitSnapshot", '[object Object]'), p."stockUnit", p."unit", u."code") AS "unitSnapshot",
      item."expectedQuantity",
      item."countedQuantity",
      item."differenceQuantity",
      item."status",
      item."notes",
      item."countedByUserId",
      item."countedAt",
      item."createdAt",
      item."updatedAt"
    FROM "StockCountSessionItem" item
    LEFT JOIN "Product" p ON p."id" = item."productId"
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "Category" cat ON cat."id" = p."categoryId"
    LEFT JOIN "Subcategory" sub ON sub."id" = p."subcategoryId"
    LEFT JOIN "UnitMeasure" u ON u."id" = p."unitMeasureId"
    WHERE item."stockCountSessionId" = ${request.params.id}
    ORDER BY
      translate(LOWER(COALESCE(NULLIF(item."sectorSnapshot", '[object Object]'), NULLIF(sec."name", '[object Object]'), 'zzzz_sem_setor')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(NULLIF(item."categorySnapshot", '[object Object]'), NULLIF(cat."name", '[object Object]'), 'zzzz_sem_categoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(NULLIF(item."subcategorySnapshot", '[object Object]'), NULLIF(sub."name", '[object Object]'), 'zzzz_sem_subcategoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE(NULLIF(item."unitSnapshot", '[object Object]'), p."stockUnit", p."unit", u."code", 'zzzz_sem_unidade')), ${accentChars}, ${plainChars}),
      translate(LOWER(item."productNameSnapshot"), ${accentChars}, ${plainChars}),
      item."productCodeSnapshot" NULLS LAST
  `;
  response.json({ ...session, items: items.map(normalizeStockCountSessionItem) });
});

inventoryRouter.patch("/count-sessions/:id/items", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  await assertCanEditStockCountSession(request.params.id, user);

  const items = Array.isArray(request.body.items) ? request.body.items : [];
  for (const item of items) {
    const itemId = asText(item.id);
    if (!itemId) continue;
    const [existing] = await prisma.$queryRaw<Array<{ expectedQuantity: Prisma.Decimal }>>`
      SELECT "expectedQuantity"
      FROM "StockCountSessionItem"
      WHERE "id" = ${itemId} AND "stockCountSessionId" = ${request.params.id}
      LIMIT 1
    `;
    if (!existing) continue;
    const rawQuantity = item.countedQuantity;
    const hasQuantity = rawQuantity !== undefined && rawQuantity !== null && String(rawQuantity).trim() !== "";
    const countedQuantity = hasQuantity ? asNumber(rawQuantity) : null;
    const result = stockCountSessionItemStatus(countedQuantity, Number(existing.expectedQuantity ?? 0));
    await prisma.$executeRaw`
      UPDATE "StockCountSessionItem"
      SET "countedQuantity" = ${countedQuantity},
          "differenceQuantity" = ${result.differenceQuantity},
          "status" = ${result.status},
          "notes" = ${asText(item.notes)},
          "countedByUserId" = ${countedQuantity == null ? null : user.id},
          "countedAt" = ${countedQuantity == null ? null : new Date()},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${itemId} AND "stockCountSessionId" = ${request.params.id}
    `;
  }

  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "status" = CASE WHEN "status" = 'ABERTA' THEN 'EM_ANDAMENTO' ELSE "status" END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({ userId: user.id, action: "SAVE_STOCK_COUNT_SESSION_DRAFT", entity: "StockCountSession", entityId: request.params.id, newValue: { items: items.length } });
  response.json(await getStockCountSessionSummary(request.params.id));
});

inventoryRouter.patch("/count-sessions/:id/conclude", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  await assertCanEditStockCountSession(request.params.id, user);

  const items = Array.isArray(request.body.items) ? request.body.items : [];
  if (items.length) {
    for (const item of items) {
      const itemId = asText(item.id);
      if (!itemId) continue;
      const [existing] = await prisma.$queryRaw<Array<{ expectedQuantity: Prisma.Decimal }>>`
        SELECT "expectedQuantity"
        FROM "StockCountSessionItem"
        WHERE "id" = ${itemId} AND "stockCountSessionId" = ${request.params.id}
        LIMIT 1
      `;
      if (!existing) continue;
      const rawQuantity = item.countedQuantity;
      const countedQuantity = rawQuantity === undefined || rawQuantity === null || String(rawQuantity).trim() === "" ? null : asNumber(rawQuantity);
      const result = stockCountSessionItemStatus(countedQuantity, Number(existing.expectedQuantity ?? 0));
      await prisma.$executeRaw`
        UPDATE "StockCountSessionItem"
        SET "countedQuantity" = ${countedQuantity},
            "differenceQuantity" = ${result.differenceQuantity},
            "status" = ${result.status},
            "notes" = ${asText(item.notes)},
            "countedByUserId" = ${countedQuantity == null ? null : user.id},
            "countedAt" = ${countedQuantity == null ? null : new Date()},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId} AND "stockCountSessionId" = ${request.params.id}
      `;
    }
  }

  const [pending] = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS "total"
    FROM "StockCountSessionItem"
    WHERE "stockCountSessionId" = ${request.params.id}
      AND "countedQuantity" IS NULL
  `;
  const pendingItems = Number(pending?.total ?? 0);
  if (pendingItems > 0) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_CONCLUDE_STOCK_COUNT_SESSION_PENDING_ITEMS",
      entity: "StockCountSession",
      entityId: request.params.id,
      newValue: { pendingItems }
    });
    response.status(400).json({
      message: `Existem ${pendingItems} produtos sem quantidade informada. Informe a quantidade contada ou digite 0 nos produtos sem estoque antes de concluir.`,
      pendingItems
    });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "status" = 'CONCLUIDA',
        "concludedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({ userId: user.id, action: "CONCLUDE_STOCK_COUNT_SESSION", entity: "StockCountSession", entityId: request.params.id, newValue: { pendingItems: 0 } });
  response.json(await getStockCountSessionSummary(request.params.id));
});

inventoryRouter.patch("/count-sessions/:id/reopen", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const session = await getStockCountSessionOrThrow(request.params.id);
  if (session.status !== "CONCLUIDA") {
    response.status(400).json({ message: "Apenas contagem concluida pode ser reaberta." });
    return;
  }
  if (session.generatedInventoryId) {
    response.status(400).json({ message: "Esta contagem ja gerou inventario. Cancele ou revise o inventario antes de reabrir." });
    return;
  }
  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "status" = 'EM_ANDAMENTO',
        "reopenedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({ userId: user.id, action: "REOPEN_STOCK_COUNT_SESSION", entity: "StockCountSession", entityId: request.params.id, previousValue: { status: session.status }, newValue: { reason: asText(request.body.reason) } });
  response.json(await getStockCountSessionSummary(request.params.id));
});

inventoryRouter.patch("/count-sessions/:id/cancel", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const session = await getStockCountSessionOrThrow(request.params.id);
  const reason = asText(request.body.reason);
  if (!reason) {
    response.status(400).json({ message: "Informe o motivo do cancelamento da contagem." });
    return;
  }
  if (session.status === "CANCELADA") {
    response.status(400).json({ message: "Esta contagem ja esta cancelada." });
    return;
  }
  if (session.generatedInventoryId) {
    response.status(400).json({ message: "Esta contagem ja gerou inventario e nao pode ser cancelada." });
    return;
  }
  if (!canCancelStockCountSession(session, user)) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_CANCEL_STOCK_COUNT_SESSION",
      entity: "StockCountSession",
      entityId: request.params.id,
      newValue: { status: session.status, generatedInventoryId: session.generatedInventoryId }
    });
    response.status(403).json({ message: "Perfil sem permissao para cancelar esta contagem." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "status" = 'CANCELADA',
        "canceledAt" = CURRENT_TIMESTAMP,
        "canceledByUserId" = ${user.id},
        "cancelReason" = ${reason},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({
    userId: user.id,
    action: "CANCEL_STOCK_COUNT_SESSION",
    entity: "StockCountSession",
    entityId: request.params.id,
    previousValue: { status: session.status, generatedInventoryId: session.generatedInventoryId },
    newValue: { status: "CANCELADA", reason }
  });
  response.json(await getStockCountSessionSummary(request.params.id));
});

inventoryRouter.post("/count-sessions/:id/generate-inventory", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const session = await getStockCountSessionOrThrow(request.params.id);
  if (session.status === "CANCELADA") {
    response.status(400).json({ message: "Nao e possivel gerar inventario a partir de uma contagem cancelada." });
    return;
  }
  if (session.status !== "CONCLUIDA") {
    response.status(400).json({ message: "Conclua a contagem antes de gerar o inventario." });
    return;
  }
  if (session.generatedInventoryId) {
    response.json(await getOperationalInventorySummary(session.generatedInventoryId));
    return;
  }

  const date = dateOnly(new Date(session.referenceDate));
  const inventoryId = crypto.randomUUID();
  const inventoryType = session.type === "FINAL_MES" || session.isMonthEnd ? "FINAL_CMV" : session.type === "SETORIAL" ? "SETORIAL" : "GERAL";
  const code = await nextOperationalInventoryCode(date);
  const name = `Inventario ${brDate(date)} - gerado da contagem ${session.code}`;
  await prisma.$executeRaw`
    INSERT INTO "OperationalInventory" (
      "id", "code", "date", "name", "type", "status", "sectorId", "sectorName", "responsibleUserId",
      "notes", "sourceStockCountSessionId", "createdAt", "updatedAt"
    )
    VALUES (
      ${inventoryId}, ${code}, ${date}, ${name}, ${inventoryType}, 'RASCUNHO', ${session.sectorId}, ${session.sectorName},
      ${user.id}, ${asText(request.body.notes) ?? `Gerado a partir da contagem ${session.code}.`},
      ${session.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  const items = await prisma.$queryRaw<Array<StockCountSessionItemRow>>`
    SELECT *
    FROM "StockCountSessionItem"
    WHERE "stockCountSessionId" = ${session.id}
    ORDER BY
      translate(LOWER(COALESCE("sectorSnapshot", 'zzzz_sem_setor')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE("categorySnapshot", 'zzzz_sem_categoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE("subcategorySnapshot", 'zzzz_sem_subcategoria')), ${accentChars}, ${plainChars}),
      translate(LOWER(COALESCE("unitSnapshot", 'zzzz_sem_unidade')), ${accentChars}, ${plainChars}),
      translate(LOWER("productNameSnapshot"), ${accentChars}, ${plainChars}),
      "productCodeSnapshot" NULLS LAST
  `;
  for (const item of items) {
    const countedQuantity = item.countedQuantity == null ? 0 : Number(item.countedQuantity);
    const expectedQuantity = Number(item.expectedQuantity ?? 0);
    const result = countedStatus(countedQuantity, expectedQuantity);
    await prisma.$executeRaw`
      INSERT INTO "OperationalInventoryItem" (
        "id", "inventoryId", "productId", "productCode", "productName", "sectorName", "categoryName", "subcategoryName",
        "location", "unit", "expectedQuantity", "countedQuantity", "differenceQuantity", "status", "notes", "countedByUserId",
        "countedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()}, ${inventoryId}, ${item.productId}, ${item.productCodeSnapshot}, ${item.productNameSnapshot},
        ${item.sectorSnapshot}, ${item.categorySnapshot}, ${item.subcategorySnapshot}, ${item.locationSnapshot}, ${item.unitSnapshot},
        ${expectedQuantity}, ${countedQuantity}, ${result.differenceQuantity}, ${result.status}, ${item.notes}, ${item.countedByUserId},
        ${item.countedAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
  }

  await prisma.$executeRaw`
    UPDATE "StockCountSession"
    SET "generatedInventoryId" = ${inventoryId},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${session.id}
  `;
  await auditLog({
    userId: user.id,
    action: "GENERATE_OPERATIONAL_INVENTORY_FROM_COUNT",
    entity: "OperationalInventory",
    entityId: inventoryId,
    newValue: { code, sourceStockCountSessionId: session.id, sourceCode: session.code, totalItems: items.length }
  });
  response.status(201).json(await getOperationalInventorySummary(inventoryId));
});

inventoryRouter.get("/operational/purchasing-report", async (_request, response) => {
  const [latest] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "OperationalInventory"
    WHERE "status" IN ('RASCUNHO', 'EM_REVISAO', 'APROVADO', 'FECHADO')
    ORDER BY "date" DESC, "createdAt" DESC
    LIMIT 1
  `;
  if (!latest) {
    response.json({ zeros: [], pending: [], divergent: [], withoutCount: [], summary: { zeros: 0, pending: 0, divergent: 0, withoutCount: 0 } });
    return;
  }

  const rows = await prisma.$queryRaw<Array<OperationalInventoryItemRow>>`
    SELECT *
    FROM "OperationalInventoryItem"
    WHERE "inventoryId" = ${latest.id}
      AND ("status" IN ('ZERO', 'PENDENTE', 'DIVERGENTE') OR "countedQuantity" IS NULL)
    ORDER BY "status", "sectorName", "productName"
    LIMIT 200
  `;
  const normalized = rows.map(normalizeOperationalInventoryItem);
  const zeros = normalized.filter((item) => item.status === "ZERO");
  const pending = normalized.filter((item) => item.status === "PENDENTE");
  const divergent = normalized.filter((item) => item.status === "DIVERGENTE");
  const withoutCount = normalized.filter((item) => item.countedQuantity == null);
  response.json({ zeros, pending, divergent, withoutCount, summary: { zeros: zeros.length, pending: pending.length, divergent: divergent.length, withoutCount: withoutCount.length } });
});

inventoryRouter.get("/operational", async (request, response) => {
  const includeCanceled = String(request.query.includeCanceled ?? "").toLowerCase() === "true";
  const rows = await prisma.$queryRaw<Array<OperationalInventoryRow>>`
    SELECT
      i.*,
      u."name" AS "responsibleName",
      COUNT(item."id") AS "totalItems",
      COUNT(item."id") FILTER (WHERE item."status" IN ('CONTADO', 'ZERO', 'DIVERGENTE')) AS "countedItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'PENDENTE') AS "pendingItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'DIVERGENTE') AS "divergentItems",
      COUNT(item."id") FILTER (WHERE item."status" = 'ZERO') AS "zeroItems"
    FROM "OperationalInventory" i
    LEFT JOIN "User" u ON u."id" = i."responsibleUserId"
    LEFT JOIN "OperationalInventoryItem" item ON item."inventoryId" = i."id"
    WHERE (${includeCanceled} = true OR i."status" <> 'CANCELADO')
    GROUP BY i."id", u."name"
    ORDER BY i."date" DESC, i."createdAt" DESC
    LIMIT 80
  `;
  response.json(rows.map(normalizeOperationalInventory));
});

inventoryRouter.post("/operational", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const date = request.body.date ? parseLocalDate(request.body.date) : dateOnly(new Date());
  if (Number.isNaN(date.getTime())) {
    response.status(400).json({ message: "Data do inventario invalida." });
    return;
  }
  const type = String(request.body.type ?? "GERAL").toUpperCase();
  if (!["GERAL", "SETORIAL", "FINAL_CMV", "CONFERENCIA"].includes(type)) {
    response.status(400).json({ message: "Tipo de inventario invalido." });
    return;
  }
  const sectorId = asText(request.body.sectorId);
  const sectorName = asText(request.body.sectorName);
  if (type === "SETORIAL" && !sectorId && !sectorName) {
    response.status(400).json({ message: "Inventario setorial precisa de um setor." });
    return;
  }

  const id = crypto.randomUUID();
  const code = await nextOperationalInventoryCode(date);
  const name = `Inventario ${brDate(date)} - ${inventoryTypeLabel(type, sectorName)}`;
  const notes = asText(request.body.notes);
  await prisma.$executeRaw`
    INSERT INTO "OperationalInventory" (
      "id", "code", "date", "name", "type", "status", "sectorId", "sectorName", "responsibleUserId", "notes", "createdAt", "updatedAt"
    )
    VALUES (${id}, ${code}, ${date}, ${name}, ${type}, 'RASCUNHO', ${sectorId}, ${sectorName}, ${user.id}, ${notes}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;

  const sectorFilter = type === "SETORIAL"
    ? Prisma.sql`AND (${sectorId ? Prisma.sql`p."inventorySectorId" = ${sectorId}` : Prisma.sql`FALSE`} OR ${sectorName ? Prisma.sql`sec."name" = ${sectorName}` : Prisma.sql`FALSE`})`
    : Prisma.empty;
  const products = await prisma.$queryRaw<Array<{
    id: string;
    externalCode: string | null;
    name: string;
    sectorName: string | null;
    categoryName: string | null;
    subcategoryName: string | null;
    storageLocation: string | null;
    storageCorridor: string | null;
    storageShelf: string | null;
    storagePosition: string | null;
    unit: string | null;
    unitCode: string | null;
    currentQuantity: Prisma.Decimal | null;
  }>>`
    SELECT
      p."id", p."externalCode", p."name", sec."name" AS "sectorName", c."name" AS "categoryName",
      sub."name" AS "subcategoryName", p."storageLocation", p."storageCorridor", p."storageShelf", p."storagePosition",
      p."stockUnit" AS "unit", u."code" AS "unitCode", stock."currentQuantity"
    FROM "Product" p
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Subcategory" sub ON sub."id" = p."subcategoryId"
    LEFT JOIN "UnitMeasure" u ON u."id" = p."unitMeasureId"
    LEFT JOIN "InventoryStock" stock ON stock."productId" = p."id"
    WHERE p."controlsStock" = true
      AND p."isActive" = true
      ${sectorFilter}
    ORDER BY sec."name" NULLS LAST, p."storageLocation" NULLS LAST, c."name" NULLS LAST, p."name"
  `;

  for (const product of products) {
    const location = [product.storageLocation, product.storageCorridor, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || null;
    await prisma.$executeRaw`
      INSERT INTO "OperationalInventoryItem" (
        "id", "inventoryId", "productId", "productCode", "productName", "sectorName", "categoryName", "subcategoryName",
        "location", "unit", "expectedQuantity", "status", "createdAt", "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()}, ${id}, ${product.id}, ${product.externalCode}, ${product.name}, ${product.sectorName},
        ${product.categoryName}, ${product.subcategoryName}, ${location}, ${product.unit ?? product.unitCode},
        ${Number(product.currentQuantity ?? 0)}, 'PENDENTE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
  }
  await auditLog({ userId: user.id, action: "CREATE_OPERATIONAL_INVENTORY", entity: "OperationalInventory", entityId: id, newValue: { code, type, totalItems: products.length } });
  await auditLog({ userId: user.id, action: "GENERATE_OPERATIONAL_INVENTORY_ITEMS", entity: "OperationalInventory", entityId: id, newValue: { totalItems: products.length } });
  response.status(201).json(await getOperationalInventorySummary(id));
});

export async function buildBuyerSupportReport(query: Record<string, unknown>) {
  const search = asText(query.search)?.toLowerCase() ?? "";
  const supplier = asText(query.supplier);
  const sector = asText(query.sector);
  const category = asText(query.category);
  const subcategory = asText(query.subcategory);
  const statusFilter = asText(query.status);

  const rows = await prisma.$queryRaw<Array<{
    productId: string;
    productCode: string | null;
    productName: string;
    unit: string | null;
    logisticsNotes: string | null;
    supplierId: string | null;
    sectorName: string | null;
    categoryName: string | null;
    subcategoryName: string | null;
    estoqueMinimo: Prisma.Decimal | null;
    estoqueIdeal: Prisma.Decimal | null;
    leadTimeCompraDias: number | null;
    supplierName: string | null;
    lastInventoryCode: string | null;
    lastInventoryType: string | null;
    lastInventoryStatus: string | null;
    lastCountDate: Date | null;
    lastQuantity: Prisma.Decimal | null;
    lastItemStatus: string | null;
    lastNotes: string | null;
    consumptionEstimated: Prisma.Decimal | null;
    averageDailyConsumption: Prisma.Decimal | null;
    consumptionPeriodStart: Date | null;
    consumptionPeriodEnd: Date | null;
  }>>`
    WITH latest AS (
      SELECT DISTINCT ON (item."productId")
        item."productId",
        inv."code" AS "lastInventoryCode",
        inv."type" AS "lastInventoryType",
        inv."status" AS "lastInventoryStatus",
        inv."date" AS "lastCountDate",
        item."countedQuantity" AS "lastQuantity",
        item."status" AS "lastItemStatus",
        item."notes" AS "lastNotes"
      FROM "OperationalInventoryItem" item
      JOIN "OperationalInventory" inv ON inv."id" = item."inventoryId"
      WHERE inv."status" <> 'CANCELADO'
        AND item."productId" IS NOT NULL
      ORDER BY item."productId", inv."date" DESC, inv."createdAt" DESC
    ),
    latest_final_inventory AS (
      SELECT "id"
      FROM "OperationalInventory"
      WHERE "type" = 'FINAL_CMV'
        AND "status" IN ('APROVADO', 'FECHADO')
      ORDER BY "date" DESC, "createdAt" DESC
      LIMIT 1
    ),
    latest_final_items AS (
      SELECT DISTINCT item."productId"
      FROM "OperationalInventoryItem" item
      JOIN latest_final_inventory inv ON inv."id" = item."inventoryId"
      WHERE item."productId" IS NOT NULL
    ),
    latest_period AS (
      SELECT "id", "dataInicial", "dataFinal", "estoqueInicialSnapshotId", "estoqueFinalSnapshotId"
      FROM "CmvPeriod"
      WHERE "estoqueInicialSnapshotId" IS NOT NULL
        AND "estoqueFinalSnapshotId" IS NOT NULL
      ORDER BY "dataFinal" DESC
      LIMIT 1
    ),
    purchases_period AS (
      SELECT item."productId", SUM(COALESCE(item."convertedQuantity", item."quantity", 0)) AS "purchaseQuantity"
      FROM "PurchaseItem" item
      JOIN "Purchase" purchase ON purchase."id" = item."purchaseId"
      JOIN latest_period period ON purchase."purchaseDate" >= period."dataInicial" AND purchase."purchaseDate" <= period."dataFinal"
      WHERE purchase."status" <> 'CANCELLED'
      GROUP BY item."productId"
    ),
    initial_quantities AS (
      SELECT item."productId", SUM(item."quantity") AS "initialQuantity"
      FROM "InventorySnapshotItem" item
      JOIN latest_period period ON period."estoqueInicialSnapshotId" = item."snapshotId"
      WHERE item."productId" IS NOT NULL
      GROUP BY item."productId"
    ),
    final_quantities AS (
      SELECT item."productId", SUM(item."quantity") AS "finalQuantity"
      FROM "InventorySnapshotItem" item
      JOIN latest_period period ON period."estoqueFinalSnapshotId" = item."snapshotId"
      WHERE item."productId" IS NOT NULL
      GROUP BY item."productId"
    ),
    consumption_products AS (
      SELECT "productId" FROM initial_quantities
      UNION
      SELECT "productId" FROM final_quantities
      UNION
      SELECT "productId" FROM purchases_period
    ),
    consumption AS (
      SELECT
        consumption_products."productId",
        period."dataInicial",
        period."dataFinal",
        initial_quantities."initialQuantity",
        final_quantities."finalQuantity",
        COALESCE(purchases_period."purchaseQuantity", 0) AS "purchaseQuantity",
        CASE
          WHEN initial_quantities."initialQuantity" IS NOT NULL AND final_quantities."finalQuantity" IS NOT NULL
          THEN initial_quantities."initialQuantity" + COALESCE(purchases_period."purchaseQuantity", 0) - final_quantities."finalQuantity"
          ELSE NULL
        END AS "consumptionEstimated",
        CASE
          WHEN initial_quantities."initialQuantity" IS NOT NULL AND final_quantities."finalQuantity" IS NOT NULL
          THEN (initial_quantities."initialQuantity" + COALESCE(purchases_period."purchaseQuantity", 0) - final_quantities."finalQuantity")
            / GREATEST(EXTRACT(DAY FROM (period."dataFinal" - period."dataInicial")) + 1, 1)
          ELSE NULL
        END AS "averageDailyConsumption"
      FROM latest_period period
      JOIN consumption_products ON true
      LEFT JOIN initial_quantities ON initial_quantities."productId" = consumption_products."productId"
      LEFT JOIN final_quantities ON final_quantities."productId" = consumption_products."productId"
      LEFT JOIN purchases_period ON purchases_period."productId" = consumption_products."productId"
    )
    SELECT
      p."id" AS "productId",
      p."externalCode" AS "productCode",
      p."name" AS "productName",
      COALESCE(p."stockUnit", p."unit", u."code") AS "unit",
      p."logisticsNotes",
      p."fornecedorPrincipalId" AS "supplierId",
      sec."name" AS "sectorName",
      cat."name" AS "categoryName",
      sub."name" AS "subcategoryName",
      COALESCE(p."estoqueMinimo", stock."minQuantity") AS "estoqueMinimo",
      p."estoqueIdeal",
      p."leadTimeCompraDias",
      supplier."name" AS "supplierName",
      latest."lastInventoryCode",
      latest."lastInventoryType",
      latest."lastInventoryStatus",
      latest."lastCountDate",
      latest."lastQuantity",
      latest."lastItemStatus",
      latest."lastNotes",
      consumption."consumptionEstimated",
      consumption."averageDailyConsumption",
      consumption."dataInicial" AS "consumptionPeriodStart",
      consumption."dataFinal" AS "consumptionPeriodEnd"
    FROM "Product" p
    LEFT JOIN "UnitMeasure" u ON u."id" = p."unitMeasureId"
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "Category" cat ON cat."id" = p."categoryId"
    LEFT JOIN "Subcategory" sub ON sub."id" = p."subcategoryId"
    LEFT JOIN "InventoryStock" stock ON stock."productId" = p."id"
    LEFT JOIN "Supplier" supplier ON supplier."id" = p."fornecedorPrincipalId"
    LEFT JOIN latest ON latest."productId" = p."id"
    LEFT JOIN consumption ON consumption."productId" = p."id"
    WHERE p."controlsStock" = true
      AND p."isActive" = true
      AND p."id" IN (SELECT "productId" FROM latest_final_items)
    ORDER BY sec."name" NULLS LAST, cat."name" NULLS LAST, p."name"
  `;

  const items = rows.map((row) => {
    const quantity = row.lastQuantity == null ? null : Number(row.lastQuantity);
    const min = row.estoqueMinimo == null ? null : Number(row.estoqueMinimo);
    const ideal = row.estoqueIdeal == null ? null : Number(row.estoqueIdeal);
    const averageDailyConsumption = row.averageDailyConsumption == null ? null : Math.max(Number(row.averageDailyConsumption), 0);
    const consumptionEstimated = row.consumptionEstimated == null ? null : Math.max(Number(row.consumptionEstimated), 0);
    const coverageDays = quantity == null || !averageDailyConsumption ? null : quantity / averageDailyConsumption;
    const alerts: string[] = [];
    const registrationAlerts: string[] = [];
    if (quantity == null) alerts.push("SEM CONTAGEM");
    if (quantity != null && quantity <= 0) alerts.push("ZERADO");
    if (quantity != null && min != null && quantity < min) alerts.push("ABAIXO DO MINIMO");
    if (row.lastItemStatus === "DIVERGENTE") alerts.push("DIVERGENTE");
    if (!row.supplierId) registrationAlerts.push("SEM_FORNECEDOR");
    if (min == null) registrationAlerts.push("SEM_ESTOQUE_MINIMO");
    if (ideal == null) registrationAlerts.push("SEM_ESTOQUE_IDEAL");
    if (!row.sectorName) registrationAlerts.push("SEM_SETOR");
    if (!row.categoryName) registrationAlerts.push("SEM_CATEGORIA");
    if (!row.unit) registrationAlerts.push("SEM_UNIDADE_PADRAO");
    if (registrationAlerts.length > 0) alerts.push("CADASTRO INCOMPLETO", ...registrationAlerts);
    const canUseConsumption = ideal != null && quantity != null && averageDailyConsumption != null && averageDailyConsumption > 0 && Number(row.leadTimeCompraDias ?? 0) > 0;
    const suggestedQuantity = ideal == null || quantity == null
      ? null
      : Math.max((canUseConsumption ? ideal + averageDailyConsumption * Number(row.leadTimeCompraDias ?? 0) : ideal) - quantity, 0);
    return {
      productId: row.productId,
      productCode: row.productCode,
      productName: row.productName,
      supplierId: row.supplierId,
      supplierName: row.supplierName ?? "Sem fornecedor definido",
      sectorName: row.sectorName,
      categoryName: row.categoryName,
      subcategoryName: row.subcategoryName,
      unit: row.unit,
      logisticsNotes: row.logisticsNotes,
      estoqueMinimo: min,
      estoqueIdeal: ideal,
      leadTimeCompraDias: row.leadTimeCompraDias,
      lastInventoryCode: row.lastInventoryCode,
      lastCountDate: row.lastCountDate,
      lastQuantity: quantity,
      status: row.lastItemStatus ?? "SEM_CONTAGEM",
      notes: row.lastNotes,
      alerts,
      registrationAlerts,
      suggestedQuantity,
      suggestionType: canUseConsumption ? "POR_CONSUMO" : "SIMPLES",
      consumptionEstimated,
      averageDailyConsumption,
      coverageDays,
      consumptionPeriodStart: row.consumptionPeriodStart,
      consumptionPeriodEnd: row.consumptionPeriodEnd
    };
  }).filter((item) => {
    if (search && ![item.productCode, item.productName].some((value) => String(value ?? "").toLowerCase().includes(search))) return false;
    if (supplier && (supplier === "__NONE__" ? item.supplierId != null : item.supplierId !== supplier)) return false;
    if (sector && item.sectorName !== sector) return false;
    if (category && item.categoryName !== category) return false;
    if (subcategory && item.subcategoryName !== subcategory) return false;
    if (statusFilter && !item.alerts.includes(statusFilter)) return false;
    return true;
  });

  const controlledTotal = rows.length;
  const latestFinal = await prisma.$queryRaw<Array<{ code: string; date: Date; inventorySnapshotId: string | null }>>`
    SELECT "code", "date", "inventorySnapshotId"
    FROM "OperationalInventory"
    WHERE "type" = 'FINAL_CMV'
      AND "status" IN ('APROVADO', 'FECHADO')
    ORDER BY "date" DESC, "createdAt" DESC
    LIMIT 1
  `;
  const supplierGroups = Array.from(items.reduce((map, item) => {
    const key = item.supplierId ?? "__NONE__";
    const current = map.get(key) ?? {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      items: [] as typeof items,
      suggestedItems: 0,
      zeroItems: 0,
      belowMinimumItems: 0,
      incompleteItems: 0,
      totalSuggestedQuantity: 0
    };
    current.items.push(item);
    if (Number(item.suggestedQuantity ?? 0) > 0) current.suggestedItems += 1;
    if (item.alerts.includes("ZERADO")) current.zeroItems += 1;
    if (item.alerts.includes("ABAIXO DO MINIMO")) current.belowMinimumItems += 1;
    if (item.registrationAlerts.length > 0) current.incompleteItems += 1;
    current.totalSuggestedQuantity += Number(item.suggestedQuantity ?? 0);
    map.set(key, current);
    return map;
  }, new Map<string, {
    supplierId: string | null;
    supplierName: string;
    items: typeof items;
    suggestedItems: number;
    zeroItems: number;
    belowMinimumItems: number;
    incompleteItems: number;
    totalSuggestedQuantity: number;
  }>()).values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));

  const prelist = supplierGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => Number(item.suggestedQuantity ?? 0) > 0 || item.alerts.includes("ZERADO") || item.alerts.includes("ABAIXO DO MINIMO")) }))
    .filter((group) => group.items.length > 0);

  return {
    summary: {
      itemsWithSuggestion: items.filter((item) => Number(item.suggestedQuantity ?? 0) > 0).length,
      suggestedSuppliers: supplierGroups.filter((group) => group.suggestedItems > 0).length,
      productsWithoutSupplier: items.filter((item) => !item.supplierId).length,
      zeros: items.filter((item) => item.alerts.includes("ZERADO")).length,
      belowMinimum: items.filter((item) => item.alerts.includes("ABAIXO DO MINIMO")).length,
      withoutCount: items.filter((item) => item.alerts.includes("SEM CONTAGEM")).length,
      divergent: items.filter((item) => item.alerts.includes("DIVERGENTE")).length,
      incompleteRegistration: items.filter((item) => item.alerts.includes("CADASTRO INCOMPLETO")).length,
      withoutIdeal: items.filter((item) => item.estoqueIdeal == null).length,
      withoutMinimum: items.filter((item) => item.estoqueMinimo == null).length,
      controlledTotal,
      latestFinalCmv: latestFinal[0] ?? null
    },
    supplierGroups,
    prelist,
    items
  };
}

inventoryRouter.get("/operational/buyer-support", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  const report = await buildBuyerSupportReport(request.query);
  await auditLog({
    userId: user.id,
    action: "VIEW_BUYER_SUPPORT_REPORT",
    entity: "OperationalInventory",
    newValue: { rows: report.items.length, query: request.query },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json(report);
});

inventoryRouter.get("/operational/buyer-support/prelist.csv", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  const report = await buildBuyerSupportReport(request.query);
  const rows = report.prelist.flatMap((group) => group.items.map((item) => [
    group.supplierName,
    item.productCode ?? "",
    item.productName,
    item.unit ?? "",
    item.lastQuantity ?? "",
    item.estoqueMinimo ?? "",
    item.estoqueIdeal ?? "",
    item.suggestedQuantity ?? "",
    item.alerts.join(" | "),
    item.logisticsNotes ?? item.notes ?? ""
  ]));
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["fornecedor", "codigo", "produto", "unidade", "ultima_quantidade", "estoque_minimo", "estoque_ideal", "quantidade_sugerida", "alerta", "observacao_logistica"].map(escape).join(";"),
    ...rows.map((row) => row.map(escape).join(";"))
  ].join("\r\n");
  await auditLog({
    userId: user.id,
    action: "EXPORT_BUYER_PRELIST_CSV",
    entity: "OperationalInventory",
    newValue: { rows: rows.length, query: request.query },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", "attachment; filename=pre-lista-compras.csv");
  response.send(`\uFEFF${csv}`);
});

inventoryRouter.get("/operational/:id/pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const inventory = await getOperationalInventorySummary(request.params.id);
  if (!inventory) {
    response.status(404).json({ message: "Inventario operacional nao encontrado." });
    return;
  }
  const userIds = [
    inventory.responsibleUserId,
    inventory.approvedByUserId,
    inventory.closedByUserId,
    inventory.reviewedByUserId
  ].filter(Boolean) as string[];
  const [users, snapshotRows, items] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "User"
      WHERE ${userIds.length ? Prisma.sql`"id" IN (${Prisma.join(userIds)})` : Prisma.sql`false`}
    `,
    inventory.inventorySnapshotId
      ? prisma.$queryRaw<Array<{ totalValue: Prisma.Decimal }>>`
          SELECT "totalValue" FROM "InventorySnapshot" WHERE "id" = ${inventory.inventorySnapshotId} LIMIT 1
        `
      : Promise.resolve([]),
    prisma.$queryRaw<Array<OperationalInventoryItemRow>>`
      SELECT *
      FROM "OperationalInventoryItem"
      WHERE "inventoryId" = ${request.params.id}
      ORDER BY "sectorName" NULLS LAST, "categoryName" NULLS LAST, "subcategoryName" NULLS LAST, "productName"
    `
  ]);
  const userById = new Map(users.map((row) => [row.id, row.name]));
  const pdf = createOperationalInventoryPdf({
    systemName: "Pateo da Luz - Gest\u00e3o de Estoque",
    inventoryCode: inventory.code,
    inventoryName: inventory.name,
    inventoryTypeLabel: inventoryTypeLabel(inventory.type, inventory.sectorName),
    inventoryStatusLabel: operationalInventoryStatusLabel(inventory.status),
    inventoryDateLabel: brDate(inventory.date),
    responsibleName: inventory.responsibleUserId ? userById.get(inventory.responsibleUserId) ?? inventory.responsibleUserId : "-",
    approverName: inventory.approvedByUserId ? userById.get(inventory.approvedByUserId) ?? inventory.approvedByUserId : "-",
    reviewerName: inventory.reviewedByUserId ? userById.get(inventory.reviewedByUserId) ?? inventory.reviewedByUserId : "-",
    closedByName: inventory.closedByUserId ? userById.get(inventory.closedByUserId) ?? inventory.closedByUserId : "-",
    generatedAtLabel: brDateTime(new Date()),
    notes: inventory.notes,
    cancelReason: inventory.cancelReason,
    rejectionReason: inventory.rejectionReason,
    snapshotTotalLabel: snapshotRows[0] ? formatMoney(snapshotRows[0].totalValue) : null,
    totals: {
      totalItems: Number(inventory.totalItems ?? 0),
      countedItems: Number(inventory.countedItems ?? 0),
      pendingItems: Number(inventory.pendingItems ?? 0),
      divergentItems: Number(inventory.divergentItems ?? 0),
      zeroItems: Number(inventory.zeroItems ?? 0)
    },
    items: items.map((item) => ({
      productCode: item.productCode,
      productName: item.productName,
      sectorName: item.sectorName,
      categoryName: item.categoryName,
      subcategoryName: item.subcategoryName,
      unit: item.unit,
      countedQuantity: item.countedQuantity == null ? null : Number(item.countedQuantity),
      differenceQuantity: item.differenceQuantity == null ? null : Number(item.differenceQuantity),
      status: item.status as "PENDENTE" | "CONTADO" | "ZERO" | "DIVERGENTE" | "IGNORADO",
      notes: item.notes
    }))
  });

  await auditLog({
    userId: user.id,
    action: "GENERATE_OPERATIONAL_INVENTORY_PDF",
    entity: "OperationalInventory",
    entityId: inventory.id,
    newValue: { code: inventory.code, status: inventory.status },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename=${inventory.code}.pdf`);
  response.send(pdf);
});

inventoryRouter.get("/operational/:id", async (request, response) => {
  const inventory = await getOperationalInventorySummary(request.params.id);
  if (!inventory) {
    response.status(404).json({ message: "Inventario operacional nao encontrado." });
    return;
  }
  const items = await prisma.$queryRaw<Array<OperationalInventoryItemRow>>`
    SELECT *
    FROM "OperationalInventoryItem"
    WHERE "inventoryId" = ${request.params.id}
    ORDER BY "sectorName" NULLS LAST, "categoryName" NULLS LAST, "subcategoryName" NULLS LAST, "productName"
  `;
  response.json({ ...inventory, items: items.map(normalizeOperationalInventoryItem) });
});

inventoryRouter.patch("/operational/:id/items", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;
  try {
    await assertCanEditOperationalInventory(request.params.id, user);
    const items = Array.isArray(request.body.items) ? request.body.items : [];
    for (const input of items) {
      const itemId = asText(input.id);
      if (!itemId) continue;
      const [current] = await prisma.$queryRaw<Array<{ expectedQuantity: Prisma.Decimal }>>`
        SELECT "expectedQuantity"
        FROM "OperationalInventoryItem"
        WHERE "id" = ${itemId} AND "inventoryId" = ${request.params.id}
        LIMIT 1
      `;
      if (!current) continue;
      const countedQuantity = input.countedQuantity === "" || input.countedQuantity == null ? null : asNumber(input.countedQuantity);
      const result = countedStatus(countedQuantity, Number(current.expectedQuantity ?? 0));
      await prisma.$executeRaw`
        UPDATE "OperationalInventoryItem"
        SET "countedQuantity" = ${countedQuantity}, "differenceQuantity" = ${result.differenceQuantity}, "status" = ${result.status},
            "notes" = ${asText(input.notes)}, "countedByUserId" = ${countedQuantity == null ? null : user.id},
            "countedAt" = ${countedQuantity == null ? null : new Date()}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId} AND "inventoryId" = ${request.params.id}
      `;
    }
    await auditLog({ userId: user.id, action: "SAVE_OPERATIONAL_INVENTORY_DRAFT", entity: "OperationalInventory", entityId: request.params.id, newValue: { items: items.length } });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao salvar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/mark-zero", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;
  try {
    await assertCanEditOperationalInventory(request.params.id, user);
    const itemIds = Array.isArray(request.body.itemIds) ? request.body.itemIds.map(asText).filter(Boolean) : [];
    let updated = 0;
    for (const itemId of itemIds) {
      const [current] = await prisma.$queryRaw<Array<{ expectedQuantity: Prisma.Decimal }>>`
        SELECT "expectedQuantity"
        FROM "OperationalInventoryItem"
        WHERE "id" = ${itemId} AND "inventoryId" = ${request.params.id}
        LIMIT 1
      `;
      if (!current) continue;
      const result = countedStatus(0, Number(current.expectedQuantity ?? 0));
      await prisma.$executeRaw`
        UPDATE "OperationalInventoryItem"
        SET "countedQuantity" = 0, "differenceQuantity" = ${result.differenceQuantity}, "status" = ${result.status},
            "countedByUserId" = ${user.id}, "countedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${itemId} AND "inventoryId" = ${request.params.id}
      `;
      updated += 1;
    }
    await auditLog({ userId: user.id, action: "MARK_OPERATIONAL_INVENTORY_ZERO", entity: "OperationalInventory", entityId: request.params.id, newValue: { items: updated } });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao zerar itens." });
  }
});

inventoryRouter.patch("/operational/:id/submit", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;
  try {
    const inventory = await assertCanEditOperationalInventory(request.params.id, user);
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'EM_REVISAO', "sentToReviewAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "SUBMIT_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "EM_REVISAO" }
    });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao enviar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/approve", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const inventory = await getOperationalInventoryOrThrow(request.params.id);
    if (!isInventoryManager(user)) throw new Error("Apenas ADMIN ou Gestao completa pode aprovar inventario.");
    if (!["EM_REVISAO", "APROVADO"].includes(inventory.status)) throw new Error("Inventario precisa estar em revisao para ser aprovado.");
    if (inventory.type === "FINAL_CMV" && Number(inventory.pendingItems ?? 0) > 0) throw new Error("Inventario FINAL_CMV precisa estar totalmente contado ou zerado.");
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'APROVADO', "approvedByUserId" = ${user.id}, "approvedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "APPROVE_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "APROVADO" }
    });
    await createInventorySnapshotFromOperationalInventory(request.params.id, user);
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao aprovar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/reject", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const reason = asText(request.body.reason);
  if (!reason) {
    response.status(400).json({ message: "Informe o motivo da rejeicao." });
    return;
  }
  try {
    const inventory = await getOperationalInventoryOrThrow(request.params.id);
    if (inventory.status !== "EM_REVISAO") throw new Error("Inventario precisa estar em revisao para ser rejeitado.");
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'REJEITADO', "reviewedByUserId" = ${user.id}, "reviewedAt" = CURRENT_TIMESTAMP,
          "rejectionReason" = ${reason}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "REJECT_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "REJEITADO", reason }
    });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao rejeitar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/close", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const inventory = await getOperationalInventoryOrThrow(request.params.id);
    if (inventory.status !== "APROVADO") throw new Error("Inventario precisa estar aprovado para ser fechado.");
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'FECHADO', "closedByUserId" = ${user.id}, "closedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "CLOSE_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "FECHADO" }
    });
    await createInventorySnapshotFromOperationalInventory(request.params.id, user);
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao fechar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/cancel", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const reason = asText(request.body.reason);
  if (!reason) {
    response.status(400).json({ message: "Informe o motivo do cancelamento." });
    return;
  }
  try {
    const inventory = await getOperationalInventoryOrThrow(request.params.id);
    if (inventory.status === "FECHADO") throw new Error("Inventario fechado nao pode ser cancelado por esta acao.");
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'CANCELADO', "canceledByUserId" = ${user.id}, "canceledAt" = CURRENT_TIMESTAMP,
          "cancelReason" = ${reason}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "CANCEL_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "CANCELADO", reason }
    });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao cancelar inventario." });
  }
});

inventoryRouter.patch("/operational/:id/reopen", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const reason = asText(request.body.reason);
  if (!reason) {
    response.status(400).json({ message: "Informe o motivo da reabertura." });
    return;
  }
  try {
    const inventory = await getOperationalInventoryOrThrow(request.params.id);
    if (!["REJEITADO", "CANCELADO"].includes(inventory.status)) throw new Error("Apenas inventario rejeitado ou cancelado pode voltar para rascunho.");
    await prisma.$executeRaw`
      UPDATE "OperationalInventory"
      SET "status" = 'RASCUNHO', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    await auditLog({
      userId: user.id,
      action: "REOPEN_OPERATIONAL_INVENTORY",
      entity: "OperationalInventory",
      entityId: request.params.id,
      previousValue: { status: inventory.status },
      newValue: { status: "RASCUNHO", reason }
    });
    response.json(await getOperationalInventorySummary(request.params.id));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao reabrir inventario." });
  }
});

inventoryRouter.get("/stocks", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const search = asText(request.query.search);
  const stocks = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      s.*,
      p."name" AS "productName",
      p."externalCode" AS "productCode",
      sec."name" AS "sectorName",
      u."code" AS "unitCode"
    FROM "InventoryStock" s
    JOIN "Product" p ON p."id" = s."productId"
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "UnitMeasure" u ON u."id" = s."unitMeasureId"
    WHERE ${search ? Prisma.sql`(p."name" ILIKE ${`%${search}%`} OR p."externalCode" ILIKE ${`%${search}%`})` : Prisma.sql`true`}
    ORDER BY p."name"
  `;
  response.json(
    isCostAllowed(user)
      ? stocks
      : stocks.map(({ averageCost, costPerKg, costPerBox, costPerUnit, ...stock }) => stock)
  );
});

inventoryRouter.patch("/stocks/:productId/min-quantity", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const { productId } = request.params;
  const { minQuantity } = request.body as { minQuantity: number | null };

  await prisma.$executeRaw`
    INSERT INTO "InventoryStock" ("id", "productId", "minQuantity", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${productId}, ${minQuantity}::numeric, NOW())
    ON CONFLICT ("productId") DO UPDATE SET "minQuantity" = ${minQuantity}::numeric, "updatedAt" = NOW()
  `;

  await auditLog({ userId: user.id, action: "UPDATE_STOCK_MIN_QUANTITY", entity: "InventoryStock", entityId: productId, newValue: { minQuantity } });
  response.json({ ok: true });
});

inventoryRouter.get("/movements", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const productId = asText(request.query.productId);
  const search = asText(request.query.search);
  const { startDate, endDate } = queryDateRange(request.query);
  const movements = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT m.*, p."name" AS "productName", p."externalCode" AS "productCode", sec."name" AS "sectorName"
    FROM "InventoryMovement" m
    JOIN "Product" p ON p."id" = m."productId"
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    WHERE ${productId ? Prisma.sql`m."productId" = ${productId}` : Prisma.sql`true`}
      AND ${search ? Prisma.sql`(p."name" ILIKE ${`%${search}%`} OR p."externalCode" ILIKE ${`%${search}%`})` : Prisma.sql`true`}
      AND ${startDate ? Prisma.sql`m."createdAt" >= ${startDate}` : Prisma.sql`true`}
      AND ${endDate ? Prisma.sql`m."createdAt" <= ${endDate}` : Prisma.sql`true`}
      AND ${user.role === "ESTOQUISTA" ? Prisma.sql`m."responsibleUserId" = ${user.id}` : Prisma.sql`true`}
    ORDER BY m."createdAt" DESC
    LIMIT 300
  `;
  response.json(
    isCostAllowed(user)
      ? movements
      : movements.map(({ unitCost, totalCost, ...movement }) => movement)
  );
});

inventoryRouter.post("/movements", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const productId = asText(request.body.productId);
  const type = asText(request.body.type) ?? "MANUAL_OUT";
  const quantity = asNumber(request.body.quantity);
  const unit = asText(request.body.unit);
  const unitMeasureId = asText(request.body.unitMeasureId);
  const notes = asText(request.body.notes);
  const unitCost = isCostAllowed(user) && request.body.unitCost != null ? asNumber(request.body.unitCost) : null;
  const totalCost = isCostAllowed(user) && request.body.totalCost != null ? asNumber(request.body.totalCost) : unitCost == null ? null : unitCost * Math.abs(quantity);

  if (!productId || quantity <= 0) {
    response.status(400).json({ message: "Produto e quantidade sao obrigatorios." });
    return;
  }
  if (requiresMovementNotes(type) && !notes) {
    response.status(400).json({ message: "Observacao obrigatoria para quebra, perda, compra por funcionario e ajuste negativo." });
    return;
  }

  const signedQuantity = movementQuantitySign(type, quantity);
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "InventoryMovement" (
      "id", "productId", "type", "quantity", "unit", "unitMeasureId", "unitCost", "totalCost", "responsibleUserId", "notes"
    )
    VALUES (
      ${id}, ${productId}, CAST(${type} AS "InventoryMovementType"), ${signedQuantity}, ${unit}, ${unitMeasureId}, ${unitCost}, ${totalCost}, ${user.id}, ${notes}
    )
  `;
  await upsertStock({ productId, quantityDelta: signedQuantity, unit, unitMeasureId, unitCost, totalCost });
  await auditLog({
    userId: user.id,
    action: ["ADJUSTMENT", "POSITIVE_ADJUSTMENT", "NEGATIVE_ADJUSTMENT"].includes(type)
      ? "ADJUST_STOCK"
      : ["BREAKAGE", "LOSS", "EMPLOYEE_PURCHASE"].includes(type)
        ? "CREATE_SENSITIVE_INVENTORY_MOVEMENT"
        : "CREATE_INVENTORY_MOVEMENT",
    entity: "InventoryMovement",
    entityId: id,
    newValue: request.body,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json({ id });
});

inventoryRouter.get("/counts", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const counts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.*, p."name" AS "productName", p."externalCode" AS "productCode"
    FROM "StockCount" c
    JOIN "Product" p ON p."id" = c."productId"
    WHERE ${user.role === "ESTOQUISTA" ? Prisma.sql`c."responsibleUserId" = ${user.id}` : Prisma.sql`true`}
    ORDER BY c."countedAt" DESC
    LIMIT 300
  `;
  response.json(counts);
});

inventoryRouter.post("/counts", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const productId = asText(request.body.productId);
  const countedQuantity = asNumber(request.body.countedQuantity);
  const unit = asText(request.body.unit);
  const unitMeasureId = asText(request.body.unitMeasureId);
  const generateAdjustment = Boolean(request.body.generateAdjustment);
  const status = asText(request.body.status) === "SUBMITTED" ? "SUBMITTED" : "DRAFT";
  const inventoryAgendaItemId = asText(request.body.inventoryAgendaItemId);

  if (!productId) {
    response.status(400).json({ message: "Produto obrigatorio." });
    return;
  }

  const [stock] = await prisma.$queryRaw<Array<{ currentQuantity: Prisma.Decimal }>>`
    SELECT "currentQuantity" FROM "InventoryStock" WHERE "productId" = ${productId}
  `;
  const expectedQuantity = Number(stock?.currentQuantity ?? 0);
  const divergenceQuantity = countedQuantity - expectedQuantity;
  const id = crypto.randomUUID();
  const [snapshot] = await prisma.$queryRaw<Array<{
    productCode: string | null;
    productName: string;
    sectorName: string | null;
    categoryName: string | null;
    subcategoryName: string | null;
    unit: string | null;
  }>>`
    SELECT
      p."externalCode" AS "productCode",
      p."name" AS "productName",
      sec."name" AS "sectorName",
      c."name" AS "categoryName",
      sc."name" AS "subcategoryName",
      COALESCE(u."code", p."unit") AS "unit"
    FROM "Product" p
    LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    LEFT JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
    LEFT JOIN "UnitMeasure" u ON u."id" = p."unitMeasureId"
    WHERE p."id" = ${productId}
  `;

  await prisma.$executeRaw`
    INSERT INTO "StockCount" (
      "id", "productId", "inventoryAgendaItemId", "countedQuantity", "expectedQuantity", "divergenceQuantity",
      "productCodeSnapshot", "productNameSnapshot", "sectorSnapshot", "categorySnapshot", "subcategorySnapshot", "unitSnapshot",
      "unit", "unitMeasureId", "responsibleUserId", "status", "notes", "adjustmentGenerated", "submittedAt"
    )
    VALUES (
      ${id}, ${productId}, ${inventoryAgendaItemId}, ${countedQuantity}, ${expectedQuantity}, ${divergenceQuantity},
      ${snapshot?.productCode ?? null}, ${snapshot?.productName ?? null}, ${snapshot?.sectorName ?? null},
      ${snapshot?.categoryName ?? null}, ${snapshot?.subcategoryName ?? null}, ${snapshot?.unit ?? unit},
      ${unit}, ${unitMeasureId}, ${user.id}, ${status}, ${asText(request.body.notes)}, ${generateAdjustment},
      ${status === "SUBMITTED" ? new Date() : null}
    )
  `;

  let movementId: string | null = null;
  if (generateAdjustment && divergenceQuantity !== 0) {
    movementId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "InventoryMovement" ("id", "productId", "type", "quantity", "unit", "unitMeasureId", "sourceStockCountId", "responsibleUserId", "notes")
      VALUES (${movementId}, ${productId}, 'ADJUSTMENT', ${divergenceQuantity}, ${unit}, ${unitMeasureId}, ${id}, ${user.id}, 'Ajuste gerado por contagem de estoque.')
    `;
    await upsertStock({ productId, quantityDelta: divergenceQuantity, unit, unitMeasureId, unitCost: null, totalCost: null });
    await prisma.$executeRaw`UPDATE "StockCount" SET "adjustmentMovementId" = ${movementId} WHERE "id" = ${id}`;
  }

  await auditLog({
    userId: user.id,
    action: status === "SUBMITTED" ? "SUBMIT_STOCK_COUNT" : "SAVE_STOCK_COUNT_DRAFT",
    entity: "StockCount",
    entityId: id,
    newValue: { ...request.body, expectedQuantity, divergenceQuantity, movementId },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json({ id, expectedQuantity, divergenceQuantity, adjustmentMovementId: movementId });
});

inventoryRouter.get("/policy", async (_request, response) => {
  const user = await requireRole(_request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [policy] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "StockCountPolicy" ORDER BY "createdAt" LIMIT 1
  `;
  response.json(policy ?? null);
});

inventoryRouter.put("/policy", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const frequency = asText(request.body.frequency) ?? "WEEKLY";
  const notes = asText(request.body.notes);
  await prisma.$executeRaw`
    UPDATE "StockCountPolicy"
    SET "frequency" = CAST(${frequency} AS "StockCountFrequency"), "notes" = ${notes}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 'default-stock-count-policy'
  `;
  await auditLog({ userId: user.id, action: "UPDATE", entity: "StockCountPolicy", entityId: "default-stock-count-policy", newValue: request.body });
  response.json({ id: "default-stock-count-policy", frequency, notes });
});

inventoryRouter.get("/agenda", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const now = new Date();
  const year = Number(request.query.year ?? now.getFullYear());
  const month = Number(request.query.month ?? now.getMonth() + 1);
  const { start, end } = monthBounds(year, month);

  await ensureAgendaForMonth(year, month);
  await markLateAgendaItems(user.id);

  const [items, rules] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        i.*,
        u."name" AS "responsibleName",
        c."name" AS "categoryDisplayName"
      FROM "InventoryAgendaItem" i
      LEFT JOIN "User" u ON u."id" = i."responsibleUserId"
      LEFT JOIN "Category" c ON c."id" = i."categoryId"
      WHERE i."scheduledDate" >= ${start}
        AND i."scheduledDate" < ${end}
        AND ${user.role === "ESTOQUISTA" ? Prisma.sql`(i."responsibleUserId" IS NULL OR i."responsibleUserId" = ${user.id})` : Prisma.sql`true`}
      ORDER BY i."scheduledDate", i."categoryName"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r.*, u."name" AS "responsibleName"
      FROM "InventoryAgendaRule" r
      LEFT JOIN "User" u ON u."id" = r."defaultResponsibleUserId"
      ORDER BY r."dayOfWeek" NULLS LAST, r."categoryName"
    `
  ]);

  response.json({ year, month, items, rules });
});

inventoryRouter.post("/agenda/rules", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const id = crypto.randomUUID();
  const dayOfWeek = request.body.dayOfWeek == null || request.body.dayOfWeek === "" ? null : Number(request.body.dayOfWeek);
  const sectorId = asText(request.body.sectorId);
  const sectorName = asText(request.body.sectorName) ?? asText(request.body.categoryName);
  const categoryId = asText(request.body.categoryId);
  const categoryName = asText(request.body.categoryName) ?? sectorName;
  const frequency = asText(request.body.frequency) ?? "WEEKLY";

  if (!sectorName && !categoryName) {
    response.status(400).json({ message: "Setor obrigatorio para agenda." });
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "InventoryAgendaRule" (
      "id", "dayOfWeek", "sectorId", "sectorName", "categoryId", "categoryName", "frequency", "defaultResponsibleUserId", "notes", "isActive", "updatedAt"
    )
    VALUES (
      ${id}, ${dayOfWeek}, ${sectorId}, ${sectorName}, ${categoryId}, ${categoryName}, ${frequency},
      ${asText(request.body.defaultResponsibleUserId)}, ${asText(request.body.notes)}, ${request.body.isActive ?? true}, CURRENT_TIMESTAMP
    )
  `;
  await auditLog({ userId: user.id, action: "CREATE_INVENTORY_AGENDA", entity: "InventoryAgendaRule", entityId: id, newValue: request.body, ipAddress: requestIp(request) });
  response.status(201).json({ id });
});

inventoryRouter.put("/agenda/rules/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventoryAgendaRule" WHERE "id" = ${request.params.id}
  `;
  const dayOfWeek = request.body.dayOfWeek == null || request.body.dayOfWeek === "" ? null : Number(request.body.dayOfWeek);
  await prisma.$executeRaw`
    UPDATE "InventoryAgendaRule"
    SET
      "dayOfWeek" = ${dayOfWeek},
      "sectorId" = ${asText(request.body.sectorId)},
      "sectorName" = ${asText(request.body.sectorName) ?? asText(request.body.categoryName)},
      "categoryId" = ${asText(request.body.categoryId)},
      "categoryName" = ${asText(request.body.categoryName) ?? asText(request.body.sectorName)},
      "frequency" = ${asText(request.body.frequency) ?? "WEEKLY"},
      "defaultResponsibleUserId" = ${asText(request.body.defaultResponsibleUserId)},
      "notes" = ${asText(request.body.notes)},
      "isActive" = ${request.body.isActive ?? true},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({
    userId: user.id,
    action: "UPDATE_INVENTORY_AGENDA",
    entity: "InventoryAgendaRule",
    entityId: request.params.id,
    previousValue: previous,
    newValue: request.body,
    ipAddress: requestIp(request)
  });
  response.json({ id: request.params.id });
});

inventoryRouter.delete("/agenda/rules/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventoryAgendaRule" WHERE "id" = ${request.params.id}
  `;
  if (!previous) {
    response.status(404).json({ message: "Agenda nao encontrada." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "InventoryAgendaRule"
    SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({
    userId: user.id,
    action: "DELETE_INVENTORY_AGENDA",
    entity: "InventoryAgendaRule",
    entityId: request.params.id,
    previousValue: previous,
    ipAddress: requestIp(request)
  });
  response.json({ id: request.params.id, isActive: false });
});

inventoryRouter.get("/agenda/:id/detail", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const [item] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT i.*, u."name" AS "responsibleName"
    FROM "InventoryAgendaItem" i
    LEFT JOIN "User" u ON u."id" = i."responsibleUserId"
    WHERE i."id" = ${request.params.id}
      AND ${user.role === "ESTOQUISTA" ? Prisma.sql`(i."responsibleUserId" IS NULL OR i."responsibleUserId" = ${user.id})` : Prisma.sql`true`}
  `;
  if (!item) {
    response.status(404).json({ message: "Contagem nao encontrada." });
    return;
  }

  const isGeneral = item.sectorName === "INVENTARIO GERAL" || item.categoryName === "Todas as categorias";
  const [products, counts] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."unit",
        p."stockUnit",
        p."storageLocation",
        p."storageShelf",
        p."storagePosition",
        sec."name" AS "sectorName",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName",
        COALESCE(s."currentQuantity", 0)::text AS "expectedQuantity"
      FROM "Product" p
      LEFT JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      LEFT JOIN "InventoryStock" s ON s."productId" = p."id"
      WHERE p."controlsStock" = true
        AND ${!isGeneral && item.sectorName ? Prisma.sql`sec."name" = ${item.sectorName}` : Prisma.sql`true`}
      ORDER BY COALESCE(sec."countOrder", 0), p."storageLocation" NULLS LAST, p."name"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT *
      FROM "StockCount"
      WHERE "inventoryAgendaItemId" = ${request.params.id}
      ORDER BY "countedAt" DESC
    `
  ]);

  response.json({ item, products, counts });
});

inventoryRouter.patch("/agenda/:id/start", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  await prisma.$executeRaw`
    UPDATE "InventoryAgendaItem"
    SET "status" = 'IN_PROGRESS',
        "startedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP),
        "responsibleUserId" = COALESCE("responsibleUserId", ${user.id}),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
      AND "status" IN ('PENDING', 'LATE', 'IN_PROGRESS')
  `;
  await auditLog({ userId: user.id, action: "START_STOCK_COUNT", entity: "InventoryAgendaItem", entityId: request.params.id, ipAddress: requestIp(request) });
  response.json({ id: request.params.id, status: "IN_PROGRESS" });
});

inventoryRouter.patch("/agenda/:id/submit", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  await prisma.$executeRaw`
    UPDATE "InventoryAgendaItem"
    SET "status" = 'SUBMITTED',
        "submittedAt" = CURRENT_TIMESTAMP,
        "responsibleUserId" = COALESCE("responsibleUserId", ${user.id}),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
      AND "status" IN ('PENDING', 'LATE', 'IN_PROGRESS', 'SUBMITTED')
  `;
  await auditLog({ userId: user.id, action: "SUBMIT_STOCK_COUNT", entity: "InventoryAgendaItem", entityId: request.params.id, newValue: request.body, ipAddress: requestIp(request) });
  response.json({ id: request.params.id, status: "SUBMITTED" });
});

// ─── Requisicoes de insumos ───────────────────────────────────────────────────

type InventoryRequisitionRow = {
  id: string;
  code: string;
  date: Date;
  shift: string;
  reason: string;
  reasonNotes: string | null;
  sectorId: string | null;
  sectorName: string | null;
  requestedByUserId: string;
  requestedByName: string | null;
  status: string;
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type InventoryRequisitionItemRow = {
  id: string;
  requisitionId: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  unit: string | null;
  quantity: Prisma.Decimal | number | string;
  movementId: string | null;
  stockBefore: Prisma.Decimal | number | string | null;
  stockAfter: Prisma.Decimal | number | string | null;
  createdAt: Date;
};

async function nextRequisitionCode(date: Date) {
  const year = date.getFullYear();
  const [row] = await prisma.$queryRaw<Array<{ code: string | null }>>`
    SELECT "code"
    FROM "InventoryRequisition"
    WHERE "code" LIKE ${`REQ-${year}-%`}
    ORDER BY "code" DESC
    LIMIT 1
  `;
  const current = Number(String(row?.code ?? "").split("-").pop() ?? 0);
  return `REQ-${year}-${String(current + 1).padStart(4, "0")}`;
}

inventoryRouter.get("/requisitions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const { startDate, endDate } = queryDateRange(request.query);
  const sectorId = asText(request.query.sectorId);
  const shift = asText(request.query.shift);
  const requestedBy = asText(request.query.requestedBy);
  const clientRequestId = asText(request.query.clientRequestId);

  // Busca por clientRequestId para verificação de idempotência pós-timeout
  if (clientRequestId) {
    const [row] = await prisma.$queryRaw<Array<InventoryRequisitionRow & { itemCount: bigint }>>`
      SELECT r.*, u."name" AS "requestedByName", sec."name" AS "sectorName", COUNT(i."id") AS "itemCount"
      FROM "InventoryRequisition" r
      LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
      LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
      LEFT JOIN "InventoryRequisitionItem" i ON i."requisitionId" = r."id"
      WHERE r."clientRequestId" = ${clientRequestId}
      GROUP BY r."id", u."name", sec."name"
    `;
    if (row) {
      const items = await prisma.$queryRaw<Array<InventoryRequisitionItemRow>>`
        SELECT * FROM "InventoryRequisitionItem" WHERE "requisitionId" = ${row.id} ORDER BY "createdAt"
      `;
      return response.json([{ ...row, itemCount: Number(row.itemCount), items }]);
    }
    return response.json([]);
  }

  const rows = await prisma.$queryRaw<Array<InventoryRequisitionRow & { itemCount: bigint }>>`
    SELECT
      r.*,
      u."name" AS "requestedByName",
      sec."name" AS "sectorName",
      (SELECT COUNT(*) FROM "InventoryRequisitionItem" WHERE "requisitionId" = r."id") AS "itemCount"
    FROM "InventoryRequisition" r
    LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
    LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
    WHERE r."status" != 'CANCELLED'
      AND (${startDate}::timestamp IS NULL OR r."date" >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR r."date" <= ${endDate}::timestamp)
      AND (${sectorId}::text IS NULL OR r."sectorId" = ${sectorId}::text)
      AND (${shift}::text IS NULL OR r."shift" = ${shift}::text)
      AND (${requestedBy}::text IS NULL OR r."requestedByUserId" = ${requestedBy}::text)
    ORDER BY r."date" DESC, r."createdAt" DESC
    LIMIT 200
  `;

  response.json(rows.map((row) => ({ ...row, itemCount: Number(row.itemCount) })));
});

inventoryRouter.get("/requisitions/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const [row] = await prisma.$queryRaw<Array<InventoryRequisitionRow>>`
    SELECT r.*, u."name" AS "requestedByName", sec."name" AS "sectorName"
    FROM "InventoryRequisition" r
    LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
    LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
    WHERE r."id" = ${request.params.id}
    LIMIT 1
  `;
  if (!row) {
    response.status(404).json({ message: "Requisicao nao encontrada." });
    return;
  }

  const items = await prisma.$queryRaw<Array<InventoryRequisitionItemRow & { currentStock: Prisma.Decimal | null }>>`
    SELECT
      i.*,
      p."name" AS "productName",
      p."externalCode" AS "productCode",
      COALESCE(p."stockUnit", p."unit") AS "unit",
      s."currentQuantity" AS "currentStock"
    FROM "InventoryRequisitionItem" i
    LEFT JOIN "Product" p ON p."id" = i."productId"
    LEFT JOIN "InventoryStock" s ON s."productId" = i."productId"
    WHERE i."requisitionId" = ${row.id}
    ORDER BY i."createdAt"
  `;

  response.json({ ...row, items });
});

inventoryRouter.post("/requisitions", async (request, response) => {
  const t0 = Date.now();
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA"]);
  if (!user) return;

  const clientRequestId = asText(request.body.clientRequestId);
  const date = parseLocalDate(request.body.date ?? new Date());
  const shift = asText(request.body.shift) ?? "MORNING";
  const reason = asText(request.body.reason) ?? "DAILY_PRODUCTION";
  const reasonNotes = asText(request.body.reasonNotes);
  const sectorId = asText(request.body.sectorId);
  const notes = asText(request.body.notes);
  const rawItems = Array.isArray(request.body.items) ? request.body.items : [];

  if (rawItems.length === 0) {
    response.status(400).json({ message: "Informe ao menos um produto na requisicao." });
    return;
  }

  // Idempotência: se clientRequestId já existe, retorna a requisição criada anteriormente
  if (clientRequestId) {
    const [existing] = await prisma.$queryRaw<Array<InventoryRequisitionRow>>`
      SELECT r.*, u."name" AS "requestedByName", sec."name" AS "sectorName"
      FROM "InventoryRequisition" r
      LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
      LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
      WHERE r."clientRequestId" = ${clientRequestId}
    `;
    if (existing) {
      const existingItems = await prisma.$queryRaw<Array<InventoryRequisitionItemRow>>`
        SELECT * FROM "InventoryRequisitionItem" WHERE "requisitionId" = ${existing.id} ORDER BY "createdAt"
      `;
      console.log(`[requisition] idempotent hit clientRequestId=${clientRequestId} code=${existing.code} ms=${Date.now() - t0}`);
      return response.status(200).json({ ...existing, items: existingItems });
    }
  }

  type ParsedItem = { productId: string; quantity: number; unit: string | null };
  const parsedItems: ParsedItem[] = rawItems
    .map((item: Record<string, unknown>) => ({
      productId: asText(item.productId),
      quantity: asNumber(item.quantity),
      unit: asText(item.unit)
    }))
    .filter((item: { productId: string | null; quantity: number; unit: string | null }): item is ParsedItem => Boolean(item.productId) && item.quantity > 0);

  if (parsedItems.length === 0) {
    response.status(400).json({ message: "Todos os itens precisam de produto e quantidade valida." });
    return;
  }

  const productIds = parsedItems.map((item: ParsedItem) => item.productId);

  // Busca produtos e saldos em paralelo
  const [products, stocks] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; externalCode: string | null; controlsStock: boolean; stockUnit: string | null; unit: string | null }>>`
      SELECT "id", "name", "externalCode", "controlsStock", "stockUnit", "unit"
      FROM "Product"
      WHERE "id" = ANY(${productIds}::text[])
        AND "isActive" = true
    `,
    prisma.$queryRaw<Array<{ productId: string; currentQuantity: Prisma.Decimal }>>`
      SELECT "productId", "currentQuantity"
      FROM "InventoryStock"
      WHERE "productId" = ANY(${productIds}::text[])
    `
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !productMap.has(id));
  if (missing.length > 0) {
    response.status(400).json({ message: "Produto(s) nao encontrado(s) ou inativo(s).", productIds: missing });
    return;
  }

  const stockMap = new Map(stocks.map((s) => [s.productId, Number(s.currentQuantity)]));

  // Valida saldo negativo — tudo ou nada
  const insufficient = parsedItems
    .map((item) => ({
      productId: item.productId as string,
      productName: productMap.get(item.productId as string)?.name ?? item.productId,
      requested: item.quantity,
      available: stockMap.get(item.productId as string) ?? 0
    }))
    .filter((item) => item.available - item.requested < 0);

  if (insufficient.length > 0) {
    response.status(400).json({
      message: "Saldo insuficiente para um ou mais produtos.",
      products: insufficient
    });
    return;
  }

  // Busca setor
  const [sector] = sectorId
    ? await prisma.$queryRaw<Array<{ name: string }>>`SELECT "name" FROM "InventorySector" WHERE "id" = ${sectorId} LIMIT 1`
    : [null];

  const requisitionId = crypto.randomUUID();
  const code = await nextRequisitionCode(date);

  console.log(`[requisition] creating ${code} items=${parsedItems.length} ms=${Date.now() - t0}`);

  await prisma.$executeRaw`
    INSERT INTO "InventoryRequisition" (
      "id", "clientRequestId", "code", "date", "shift", "reason", "reasonNotes", "sectorId", "sectorName",
      "requestedByUserId", "status", "notes", "createdAt", "updatedAt"
    )
    VALUES (
      ${requisitionId}, ${clientRequestId}, ${code}, ${date}, ${shift}, ${reason}, ${reasonNotes},
      ${sectorId}, ${sector?.name ?? null}, ${user.id}, 'CONFIRMED', ${notes},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  for (const item of parsedItems) {
    const product = productMap.get(item.productId as string)!;
    const unit = item.unit ?? product.stockUnit ?? product.unit;
    const stockBefore = stockMap.get(item.productId as string) ?? 0;
    const stockAfter = stockBefore - item.quantity;
    const movementId = crypto.randomUUID();
    const requisitionItemId = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "InventoryMovement" (
        "id", "productId", "type", "quantity", "unit", "responsibleUserId",
        "sourceRequisitionId", "notes"
      )
      VALUES (
        ${movementId}, ${item.productId}, 'INTERNAL_CONSUMPTION', ${-item.quantity},
        ${unit}, ${user.id}, ${requisitionId},
        ${`Requisicao ${code}${notes ? ` — ${notes}` : ""}`}
      )
    `;

    await upsertStock({
      productId: item.productId as string,
      quantityDelta: -item.quantity,
      unit,
      unitMeasureId: null,
      unitCost: null,
      totalCost: null
    });

    await prisma.$executeRaw`
      INSERT INTO "InventoryRequisitionItem" (
        "id", "requisitionId", "productId", "productName", "productCode",
        "unit", "quantity", "movementId", "stockBefore", "stockAfter", "createdAt"
      )
      VALUES (
        ${requisitionItemId}, ${requisitionId}, ${item.productId},
        ${product.name}, ${product.externalCode},
        ${unit}, ${item.quantity}, ${movementId}, ${stockBefore}, ${stockAfter},
        CURRENT_TIMESTAMP
      )
    `;
  }

  await auditLog({
    userId: user.id,
    action: "CREATE_INVENTORY_REQUISITION",
    entity: "InventoryRequisition",
    entityId: requisitionId,
    newValue: { code, shift, reason, sectorId, itemCount: parsedItems.length, clientRequestId },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  const [created] = await prisma.$queryRaw<Array<InventoryRequisitionRow>>`
    SELECT r.*, u."name" AS "requestedByName", sec."name" AS "sectorName"
    FROM "InventoryRequisition" r
    LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
    LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
    WHERE r."id" = ${requisitionId}
  `;
  const items = await prisma.$queryRaw<Array<InventoryRequisitionItemRow>>`
    SELECT * FROM "InventoryRequisitionItem" WHERE "requisitionId" = ${requisitionId} ORDER BY "createdAt"
  `;

  console.log(`[requisition] created ${code} total_ms=${Date.now() - t0}`);
  response.status(201).json({ ...created, items });
});

inventoryRouter.patch("/agenda/:id/confirm", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  await prisma.$executeRaw`
    UPDATE "InventoryAgendaItem"
    SET "status" = 'CONFIRMED',
        "confirmedAt" = CURRENT_TIMESTAMP,
        "confirmedByUserId" = ${user.id},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
      AND "status" = 'SUBMITTED'
  `;
  await prisma.$executeRaw`
    UPDATE "StockCount"
    SET "status" = 'CONFIRMED',
        "confirmedAt" = CURRENT_TIMESTAMP,
        "confirmedByUserId" = ${user.id}
    WHERE "inventoryAgendaItemId" = ${request.params.id}
      AND "status" = 'SUBMITTED'
  `;
  await auditLog({ userId: user.id, action: "CONFIRM_STOCK_COUNT", entity: "InventoryAgendaItem", entityId: request.params.id, ipAddress: requestIp(request) });
  response.json({ id: request.params.id, status: "CONFIRMED" });
});
