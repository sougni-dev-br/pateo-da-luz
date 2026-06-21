import { Router } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { createSupplierPositionPdf, type SupplierPositionData } from "./supplier-position-pdf.js";
import {
  formatPaymentMethodWithInstallments,
  getPaymentMethodBaseName,
  paymentMethodAllowsInstallments
} from "../../shared/utils/payment-methods.js";
import { createPayablesFinancialPdf, type PayablesFinancialPdfRow } from "./payables-financial-pdf.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import { recordPurchaseInventoryEntry } from "../inventory/inventory.routes.js";
import { removeCardStatementItemsForPurchase, syncCardStatementItemForPurchase, syncCardStatementItemsForPurchase } from "../cards/cards.service.js";
import { OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES } from "../master-data/small-expense-type-options.js";
import {
  buildReferenceLabel,
  cleanPurchaseReference,
  findPurchaseReferenceMatches,
  normalizePurchaseReference
} from "./purchase-duplicate-utils.js";

export const purchaseRouter = Router();

type ManualPurchaseItem = {
  productId: string;
  rawProductCode: string | null;
  rawProductName: string;
  unit: string | null;
  unitMeasureId: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  rawCategory: string | null;
  rawSubcategory: string | null;
};

function localDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseLocalDateInput(value: unknown) {
  return parseDate(value) ?? new Date(String(value ?? ""));
}

function parseDateRange(query: { startDate?: unknown; endDate?: unknown }) {
  const startDate = query.startDate ? parseLocalDateInput(query.startDate) : null;
  const endDate = query.endDate ? parseLocalDateInput(query.endDate) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

function formatCurrency(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateValue(value: unknown) {
  if (!value) return "-";
  return new Date(String(value)).toLocaleDateString("pt-BR");
}

function asNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function getManualPaymentMethodDisplayName(
  paymentMethodName: string | null | undefined,
  installments: number | null | undefined
) {
  return formatPaymentMethodWithInstallments(paymentMethodName, installments ?? 1);
}

async function getPurchaseDetail(id: string) {
  const [purchase] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      p.*,
      s."name" AS "supplierName",
      s."document" AS "supplierDocument",
      pm."name" AS "paymentMethodName",
      cc."name" AS "creditCardName",
      cc."bankName" AS "creditCardBankName",
      cc."last4Digits" AS "creditCardLast4Digits"
    FROM "Purchase" p
    JOIN "Supplier" s ON s."id" = p."supplierId"
    LEFT JOIN "PaymentMethod" pm ON pm."id" = p."paymentMethodId"
    LEFT JOIN "CreditCard" cc ON cc."id" = p."creditCardId"
    WHERE p."id" = ${id}
  `;
  if (!purchase) return null;

  const [items, installments, audits, cardStatementItems] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        i.*,
        i."quantity"::text AS "quantity",
        i."unitPrice"::text AS "unitPrice",
        i."totalPrice"::text AS "totalPrice",
        p."externalCode" AS "productCode",
        p."name" AS "productName",
        p."controlsStock" AS "controlsStock",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName"
      FROM "PurchaseItem" i
      JOIN "Product" p ON p."id" = i."productId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      WHERE i."purchaseId" = ${id}
      ORDER BY i."createdAt", i."rawProductName"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        pi.*,
        pi."amount"::text AS "amount",
        pi."paidAmount"::text AS "paidAmount",
        COUNT(*) OVER (PARTITION BY pi."purchaseId")::int AS "totalInstallments",
        COALESCE(pi."paymentMethodName", pm."name") AS "paymentMethodName",
        COALESCE(pi."paidPaymentMethodName", ppm."name") AS "paidPaymentMethodName"
      FROM "PaymentInstallment" pi
      LEFT JOIN "PaymentMethod" pm ON pm."id" = pi."paymentMethodId"
      LEFT JOIN "PaymentMethod" ppm ON ppm."id" = pi."paidPaymentMethodId"
      WHERE pi."purchaseId" = ${id}
      ORDER BY pi."installment", pi."dueDate"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT a.*, u."name" AS "userName"
      FROM "AuditLog" a
      LEFT JOIN "User" u ON u."id" = a."userId"
      WHERE (a."entity" = 'Purchase' AND a."entityId" = ${id})
         OR (a."entity" IN ('PurchaseItem', 'PaymentInstallment') AND a."newValue"::text ILIKE ${`%${id}%`})
      ORDER BY a."createdAt" DESC
      LIMIT 30
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        ccsi."id",
        ccsi."value"::text AS "value",
        ccsi."installment",
        ccsi."totalInstallments",
        ccsi."itemDate",
        ccsi."description",
        ccs."id" AS "statementId",
        ccs."name" AS "statementName",
        ccs."competenceMonth",
        ccs."competenceYear",
        ccs."dueDate" AS "statementDueDate",
        ccs."status" AS "statementStatus",
        cc."name" AS "creditCardName",
        cc."last4Digits" AS "creditCardLast4Digits"
      FROM "CreditCardStatementItem" ccsi
      JOIN "CreditCardStatement" ccs ON ccs."id" = ccsi."statementId"
      JOIN "CreditCard" cc ON cc."id" = ccs."creditCardId"
      WHERE ccsi."purchaseId" = ${id}
      ORDER BY ccsi."installment" NULLS FIRST
    `
  ]);

  const formattedInstallments = installments.map((installment) => ({
    ...installment,
    paymentMethodName: getManualPaymentMethodDisplayName(
      String(installment.paymentMethodName ?? purchase.paymentMethodName ?? purchase.paymentMethod ?? ""),
      Number(installment.totalInstallments ?? installments.length ?? 1)
    )
  }));

  return {
    ...purchase,
    paymentMethodName: purchase.paymentMethodName
      ? getManualPaymentMethodDisplayName(String(purchase.paymentMethodName), formattedInstallments.length || 1)
      : purchase.paymentMethodName,
    paymentMethod: purchase.paymentMethod
      ? getManualPaymentMethodDisplayName(String(purchase.paymentMethod), formattedInstallments.length || 1)
      : purchase.paymentMethod,
    items,
    installments: formattedInstallments,
    audits,
    cardStatementItems
  };
}

async function rejectManualPurchase(
  response: { status: (code: number) => { json: (body: unknown) => void } },
  input: {
    status: number;
    message: string;
    userId?: string | null;
    body: unknown;
    action?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  await auditLog({
    userId: input.userId,
    action: input.action ?? "MANUAL_PURCHASE_NOT_SAVED",
    entity: "Purchase",
    newValue: { message: input.message, body: input.body },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  }).catch(() => undefined);
  response.status(input.status).json({ message: input.message });
}

function duplicatePurchaseResponse(match: {
  id: string;
  supplierName: string;
  purchaseDate: Date;
  totalAmount: string;
  invoiceNumber: string | null;
  purchaseOrderNumber: string | null;
  purchaseNumber: string | null;
  matchType: "INVOICE" | "ORDER";
}) {
  return {
    id: match.id,
    supplierName: match.supplierName,
    purchaseDate: match.purchaseDate,
    totalAmount: match.totalAmount,
    invoiceNumber: match.invoiceNumber,
    purchaseOrderNumber: match.purchaseOrderNumber,
    purchaseNumber: match.purchaseNumber,
    matchType: match.matchType,
    referenceLabel: buildReferenceLabel({
      invoiceNumber: match.invoiceNumber,
      purchaseOrderNumber: match.purchaseOrderNumber
    })
  };
}

function isPurchaseReferenceUniqueError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.join(",")
    : String(error.meta?.target ?? "");
  return target.includes("Purchase_active_supplier_invoice_unique_idx")
    || target.includes("Purchase_active_supplier_order_unique_idx")
    || target.includes("normalizedInvoiceNumber")
    || target.includes("normalizedPurchaseOrderNumber");
}

async function getNextPurchaseNumber(tx: Prisma.TransactionClient, year: number) {
  await tx.$executeRaw`
    INSERT INTO "PurchaseSequence" ("year", "currentValue", "updatedAt")
    VALUES (${year}, 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO NOTHING
  `;
  const [row] = await tx.$queryRaw<Array<{ currentValue: number }>>`
    UPDATE "PurchaseSequence"
    SET "currentValue" = "currentValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "year" = ${year}
    RETURNING "currentValue"
  `;
  return `CMP-${year}-${String(row.currentValue).padStart(6, "0")}`;
}

function parseManualInstallments(rawValue: unknown, totalAmount: number) {
  const parts = String(rawValue ?? "")
    .split(/[\n;,|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return [];

  const amountPerInstallment = new Prisma.Decimal(totalAmount).div(parts.length);
  return parts.map((part, index) => ({
    dueDate: parseDate(part),
    rawValue: part,
    installment: index + 1,
    amount: amountPerInstallment,
    status: "OPEN"
  }));
}

function cents(value: number) {
  return Math.round(value * 100);
}

function payableStatusSql(startToday: Date) {
  return Prisma.sql`
    CASE
      WHEN p."status" = 'CANCELLED' THEN 'CANCELLED'
      WHEN pi."status" = 'CANCELLED' THEN 'CANCELLED'
      WHEN pi."status" = 'PAID_LATE' THEN 'PAID_LATE'
      WHEN pi."status" = 'PAID' THEN 'PAID'
      WHEN pi."paidDate" IS NOT NULL AND pi."dueDate" IS NOT NULL AND DATE(pi."paidDate") > DATE(pi."dueDate") THEN 'PAID_LATE'
      WHEN pi."paidDate" IS NOT NULL THEN 'PAID'
      WHEN pi."dueDate" IS NOT NULL AND pi."dueDate" < ${startToday} THEN 'OVERDUE'
      ELSE COALESCE(pi."status", 'OPEN')
    END
  `;
}

function installmentStatusForPayment(dueDate: unknown, paidDate: Date) {
  if (!dueDate) return "PAID";
  return localDateOnly(paidDate).getTime() > localDateOnly(new Date(String(dueDate))).getTime() ? "PAID_LATE" : "PAID";
}

type ManualInstallmentPayload = {
  dueDate: Date | null;
  rawValue: string;
  installment: number;
  amount: Prisma.Decimal;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  status: string;
  paidDate?: Date | null;
  paidAmount?: Prisma.Decimal | null;
};

function parseManualInstallmentPayload(rawValue: unknown, totalAmount: number): ManualInstallmentPayload[] {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((part, index) => ({
        dueDate: parseDate(part?.dueDate),
        rawValue: String(part?.dueDate ?? ""),
        installment: Number(part?.installment ?? index + 1),
        amount: new Prisma.Decimal(Number(part?.amount ?? 0)),
        paymentMethodId: part?.paymentMethodId ? String(part.paymentMethodId) : null,
        paymentMethodName: part?.paymentMethodName ? String(part.paymentMethodName) : null,
        status: String(part?.status ?? "OPEN").toUpperCase(),
        paidDate: parseDate(part?.paidDate),
        paidAmount: part?.paidAmount == null ? null : new Prisma.Decimal(Number(part.paidAmount))
      }))
      .filter((part) => Number(part.amount) >= 0);
  }

  return parseManualInstallments(rawValue, totalAmount).map((part) => ({
    ...part,
    paymentMethodId: null,
    paymentMethodName: null,
    paidDate: null,
    paidAmount: null
  }));
}

purchaseRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const year = request.query.year ? Number(request.query.year) : undefined;
  const month = request.query.month ? Number(request.query.month) : undefined;
  const supplierId = request.query.supplierId ? String(request.query.supplierId) : undefined;
  const category = request.query.category ? String(request.query.category) : undefined;
  const productId = request.query.productId ? String(request.query.productId) : undefined;
  const paymentMethod = request.query.paymentMethod ? String(request.query.paymentMethod) : undefined;
  const search = request.query.search ? normalizeText(String(request.query.search)) : undefined;
  const showCancelled = String(request.query.showCancelled ?? "") === "true";
  const { startDate, endDate } = parseDateRange(request.query);

  const where: Prisma.PurchaseWhereInput = {
    NOT: { workflowStatus: "CARD_STATEMENT" },
    ...(year ? { competenceYear: year } : {}),
    ...(month ? { competenceMonth: month } : {}),
    ...((startDate || endDate)
      ? {
          purchaseDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {})
          }
        }
      : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...((category || productId || search)
      ? {
          items: {
            some: {
              ...(category ? { rawCategory: category } : {}),
              ...(productId ? { productId } : {}),
              ...(search
                ? {
                    OR: [
                      { rawProductName: { contains: search, mode: "insensitive" } },
                      { product: { normalizedName: { contains: search, mode: "insensitive" } } }
                    ]
                  }
                : {})
            }
          }
        }
      : {})
  };

  const purchases = await prisma.purchase.findMany({
    where,
    include: { supplier: true, items: { include: { product: true } }, installments: true },
    orderBy: { purchaseDate: "desc" },
    take: 100
  });

  const statusRows = purchases.length
    ? await prisma.$queryRaw<Array<{ id: string; status: string; cancelledAt: Date | null; cancellationReason: string | null; purchaseNumber: string | null; workflowStatus: string | null }>>`
        SELECT "id", "status", "cancelledAt", "cancellationReason", "purchaseNumber", "workflowStatus"
        FROM "Purchase"
        WHERE "id" IN (${Prisma.join(purchases.map((purchase) => purchase.id))})
      `
    : [];
  const statusById = new Map(statusRows.map((row) => [row.id, row]));
  const visiblePurchases = showCancelled
    ? purchases
    : purchases.filter((purchase) => (statusById.get(purchase.id)?.status ?? "ACTIVE") !== "CANCELLED");

  const itemIds = visiblePurchases.flatMap((purchase) => purchase.items.map((item) => item.id));
  if (itemIds.length === 0) {
    response.json(visiblePurchases.map((purchase) => ({ ...purchase, ...(statusById.get(purchase.id) ?? {}) })));
    return;
  }

  const conversionFields = await prisma.$queryRaw<
    Array<{
      id: string;
      convertedUnit: string | null;
      convertedQuantity: string | null;
      convertedUnitPrice: string | null;
      conversionFactorUsed: string | null;
      conversionMissing: boolean;
    }>
  >`
    SELECT
      "id",
      "convertedUnit",
      "convertedQuantity"::text AS "convertedQuantity",
      "convertedUnitPrice"::text AS "convertedUnitPrice",
      "conversionFactorUsed"::text AS "conversionFactorUsed",
      "conversionMissing"
    FROM "PurchaseItem"
    WHERE "id" IN (${Prisma.join(itemIds)})
  `;
  const conversionByItemId = new Map(conversionFields.map((item) => [item.id, item]));

  response.json(
    visiblePurchases.map((purchase) => ({
      ...purchase,
      ...(statusById.get(purchase.id) ?? {}),
      items: purchase.items.map((item) => ({
        ...item,
        ...(conversionByItemId.get(item.id) ?? {})
      }))
    }))
  );
});

purchaseRouter.get("/payables", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const today = request.query.date ? parseLocalDateInput(request.query.date) : new Date();
  const startToday = localDateOnly(today);
  const tomorrow = new Date(startToday);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const filter = String(request.query.filter ?? "");
  const supplierId = request.query.supplierId ? String(request.query.supplierId) : null;
  const paymentMethodId = request.query.paymentMethodId ? String(request.query.paymentMethodId) : null;
  const status = request.query.status ? String(request.query.status).toUpperCase() : null;
  const computedStatus = payableStatusSql(startToday);

  let startDate: Date | null = null;
  let endDate: Date | null = null;
  if (filter === "overdue") {
    endDate = startToday;
  } else if (filter === "today") {
    startDate = startToday;
    endDate = tomorrow;
  } else if (filter === "next7") {
    startDate = startToday;
    endDate = new Date(startToday);
    endDate.setDate(endDate.getDate() + 8);
  } else if (filter === "next30") {
    startDate = startToday;
    endDate = new Date(startToday);
    endDate.setDate(endDate.getDate() + 31);
  }
  const customRange = parseDateRange(request.query);
  if (customRange.startDate || customRange.endDate) {
    startDate = customRange.startDate;
    endDate = customRange.endDate;
  }

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      pi."id",
      pi."purchaseId",
      pi."dueDate",
      pi."paidDate",
      pi."amount"::text AS "amount",
      pi."paidAmount"::text AS "paidAmount",
      pi."installment",
      COUNT(*) OVER (PARTITION BY pi."purchaseId")::int AS "totalInstallments",
      pi."paymentMethodId",
      COALESCE(pi."paymentMethodName", pm."name", p."paymentMethod") AS "paymentMethodName",
      pi."paidPaymentMethodId",
      COALESCE(pi."paidPaymentMethodName", ppm."name") AS "paidPaymentMethodName",
      pi."paymentNotes",
      pi."sourceType",
      ${computedStatus} AS "status",
      pi."rawValue",
      s."id" AS "supplierId",
      s."name" AS "supplierName",
      p."purchaseNumber",
      p."invoiceNumber",
      p."purchaseDate",
      p."rawRow"->>'notes' AS "notes"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    JOIN "Supplier" s ON s."id" = p."supplierId"
    LEFT JOIN "PaymentMethod" pm ON pm."id" = pi."paymentMethodId"
    LEFT JOIN "PaymentMethod" ppm ON ppm."id" = pi."paidPaymentMethodId"
    WHERE ${supplierId ? Prisma.sql`s."id" = ${supplierId}` : Prisma.sql`true`}
      AND ${paymentMethodId ? Prisma.sql`
        EXISTS (
          SELECT 1 FROM "PaymentMethod" ref WHERE ref."id" = ${paymentMethodId}
          AND (
            (pm."group" = ref."group" AND pm."type" = ref."type")
            OR (ref."type" = 'CREDIT_CARD' AND pi."sourceType" IN ('CARD_STATEMENT', 'LEGACY_CREDIT_CARD'))
          )
        )
      ` : Prisma.sql`true`}
      AND ${startDate ? Prisma.sql`pi."dueDate" >= ${startDate}` : Prisma.sql`true`}
      AND ${endDate ? Prisma.sql`pi."dueDate" < ${endDate}` : Prisma.sql`true`}
      AND ${status ? Prisma.sql`
        ${computedStatus} = ${status}
      ` : Prisma.sql`true`}
    ORDER BY pi."dueDate" NULLS LAST, s."name", p."purchaseNumber", pi."installment"
    LIMIT 500
  `;

  response.json(
    rows.map((row) => ({
      ...row,
      paymentMethodName: getManualPaymentMethodDisplayName(
        String(row.paymentMethodName ?? ""),
        Number(row.totalInstallments ?? 1)
      )
    }))
  );
});

purchaseRouter.get("/reports/supplier-position.pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const supplierId = request.query.supplierId ? String(request.query.supplierId) : null;
  const { startDate, endDate } = parseDateRange(request.query);

  const purchases = await prisma.purchase.findMany({
    where: {
      status: "ACTIVE",
      ...(supplierId ? { supplierId } : {}),
      ...((startDate || endDate)
        ? {
            purchaseDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          }
        : {})
    },
    include: {
      supplier: true,
      items: { include: { product: true } },
      installments: true
    },
    orderBy: [{ supplier: { name: "asc" } }, { purchaseDate: "asc" }]
  });

  const totalPurchased = purchases.reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0);
  const installments = purchases.flatMap((purchase) => purchase.installments.map((installment) => ({ purchase, installment })));
  const today = localDateOnly(new Date());
  const openAmount = installments
    .filter(({ installment }) => !installment.paidDate && installment.status !== "CANCELLED")
    .reduce((sum, { installment }) => sum + Number(installment.amount ?? 0), 0);
  const paidAmount = installments
    .filter(({ installment }) => Boolean(installment.paidDate) || ["PAID", "PAID_LATE"].includes(String(installment.status)))
    .reduce((sum, { installment }) => sum + Number((installment as { paidAmount?: unknown }).paidAmount ?? installment.amount ?? 0), 0);
  const overdueAmount = installments
    .filter(({ installment }) => !installment.paidDate && installment.dueDate && localDateOnly(new Date(installment.dueDate)).getTime() < today.getTime())
    .reduce((sum, { installment }) => sum + Number(installment.amount ?? 0), 0);

  const pdfData: SupplierPositionData = {
    period: {
      from: startDate ? startDate.toISOString() : null,
      to:   endDate   ? endDate.toISOString()   : null,
    },
    supplierFilter: supplierId ? (purchases[0]?.supplier.name ?? null) : null,
    summary: {
      totalPurchased,
      paidAmount,
      openAmount,
      overdueAmount,
      purchaseCount: purchases.length,
    },
    purchases: purchases.map((purchase) => ({
      supplierName:       purchase.supplier.name,
      supplierDocument:   purchase.supplier.document ?? null,
      purchaseDate:       purchase.purchaseDate.toISOString(),
      purchaseNumber:     purchase.purchaseNumber ?? null,
      invoiceNumber:      purchase.invoiceNumber  ?? null,
      totalAmount:        Number(purchase.totalAmount),
      paymentMethodLabel: getManualPaymentMethodDisplayName(purchase.paymentMethod, purchase.installments.length || 1),
      items: purchase.items.map((item) => ({
        code:       item.rawProductCode ?? item.product.externalCode ?? null,
        name:       item.rawProductName || item.product.name,
        unit:       item.unit ?? null,
        quantity:   Number(item.quantity),
        totalPrice: Number(item.totalPrice),
      })),
      installments: purchase.installments.map((inst) => {
        const isPaid = Boolean(inst.paidDate) || ["PAID", "PAID_LATE"].includes(String(inst.status));
        const isOverdue = !isPaid && Boolean(inst.dueDate) &&
          localDateOnly(new Date(String(inst.dueDate))).getTime() < today.getTime();
        return {
          installmentNum: inst.installment ?? null,
          dueDate:        inst.dueDate ? new Date(String(inst.dueDate)).toISOString() : null,
          amount:         Number(inst.amount ?? 0),
          isPaid,
          isOverdue,
        };
      }),
    })),
  };

  const pdf = createSupplierPositionPdf(pdfData);

  await auditLog({
    userId: user.id,
    action: "GENERATE_SUPPLIER_POSITION_PDF",
    entity: "Report",
    newValue: { supplierId, startDate, endDate, purchases: purchases.length },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=posicao-fornecedor.pdf");
  response.send(pdf);
});

purchaseRouter.get("/payables/report.pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const today = request.query.date ? parseLocalDateInput(request.query.date) : new Date();
  const startToday = localDateOnly(today);
  const computedStatus = payableStatusSql(startToday);
  const supplierId = request.query.supplierId ? String(request.query.supplierId) : null;
  const paymentMethodId = request.query.paymentMethodId ? String(request.query.paymentMethodId) : null;
  const status = request.query.status ? String(request.query.status).toUpperCase() : null;
  const { startDate, endDate } = parseDateRange(request.query);

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      pi."id",
      pi."purchaseId",
      pi."dueDate",
      pi."paidDate",
      pi."amount"::text AS "amount",
      pi."paidAmount"::text AS "paidAmount",
      pi."installment",
      COUNT(*) OVER (PARTITION BY pi."purchaseId")::int AS "totalInstallments",
      COALESCE(pi."paymentMethodName", pm."name", p."paymentMethod") AS "paymentMethodName",
      pi."paymentNotes",
      ${computedStatus} AS "status",
      s."name" AS "supplierName",
      p."purchaseNumber",
      p."invoiceNumber",
      p."purchaseDate",
      p."rawRow"->>'notes' AS "notes"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    JOIN "Supplier" s ON s."id" = p."supplierId"
    LEFT JOIN "PaymentMethod" pm ON pm."id" = pi."paymentMethodId"
    WHERE ${supplierId ? Prisma.sql`s."id" = ${supplierId}` : Prisma.sql`true`}
      AND ${paymentMethodId ? Prisma.sql`
        EXISTS (
          SELECT 1 FROM "PaymentMethod" ref WHERE ref."id" = ${paymentMethodId}
          AND (
            (pm."group" = ref."group" AND pm."type" = ref."type")
            OR (ref."type" = 'CREDIT_CARD' AND pi."sourceType" IN ('CARD_STATEMENT', 'LEGACY_CREDIT_CARD'))
          )
        )
      ` : Prisma.sql`true`}
      AND ${startDate ? Prisma.sql`pi."dueDate" >= ${startDate}` : Prisma.sql`true`}
      AND ${endDate ? Prisma.sql`pi."dueDate" <= ${endDate}` : Prisma.sql`true`}
      AND ${status ? Prisma.sql`${computedStatus} = ${status}` : Prisma.sql`true`}
    ORDER BY pi."dueDate" NULLS LAST, s."name", p."purchaseNumber", pi."installment"
    LIMIT 1000
  `;

  const formattedRows = rows.map((row) => ({
    ...row,
    paymentMethodName: getManualPaymentMethodDisplayName(
      String(row.paymentMethodName ?? ""),
      Number(row.totalInstallments ?? 1)
    )
  }));

  const pdf = createPayablesFinancialPdf({
    generatedAt: new Date(),
    today: startToday,
    periodStart: startDate,
    periodEnd: endDate,
    periodLabel: `${startDate ? formatDateValue(startDate) : "Inicio"} ate ${endDate ? formatDateValue(endDate) : "Hoje"}`,
    supplierLabel: supplierId ? String(rows[0]?.supplierName ?? supplierId) : "Todos",
    paymentMethodLabel: paymentMethodId ? String(formattedRows.find((row) => row.paymentMethodName)?.paymentMethodName ?? paymentMethodId) : "Todas",
    statusLabel: status ?? "Todos",
    rows: formattedRows as PayablesFinancialPdfRow[]
  });

  await auditLog({
    userId: user.id,
    action: "GENERATE_PAYABLES_FINANCIAL_PDF",
    entity: "Report",
    newValue: { supplierId, paymentMethodId, status, startDate, endDate, rows: formattedRows.length },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=financeiro-contas-a-pagar.pdf");
  response.send(pdf);
});

purchaseRouter.get("/payables/:id/history", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a.*, u."name" AS "userName", u."email" AS "userEmail"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE (a."entity" = 'PaymentInstallment' AND a."entityId" = ${request.params.id})
       OR (a."entity" = 'PaymentInstallment' AND a."newValue"::text ILIKE ${`%${request.params.id}%`})
    ORDER BY a."createdAt" DESC
    LIMIT 80
  `;
  response.json(rows);
});

purchaseRouter.patch("/payables/:id/pay", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const paidDate = parseLocalDateInput(request.body.paidDate);
  const paidAmount = Number(request.body.paidAmount ?? request.body.amount ?? 0);
  const paidPaymentMethodId = asNullableText(request.body.paidPaymentMethodId);
  const paidPaymentMethodNameInput = asNullableText(request.body.paidPaymentMethodName);
  const differenceReason = asNullableText(request.body.differenceReason ?? request.body.justificativaDiferenca);
  const paymentNotes = asNullableText(request.body.paymentNotes ?? request.body.notes);
  const payingCompanyId = asNullableText(request.body.payingCompanyId);
  const companyBankAccountId = asNullableText(request.body.companyBankAccountId);

  if (Number.isNaN(paidDate.getTime()) || paidAmount <= 0 || (!paidPaymentMethodId && !paidPaymentMethodNameInput)) {
    response.status(400).json({ message: "Data do pagamento, valor pago e forma efetiva sao obrigatorios." });
    return;
  }

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT pi.*, pi."amount"::text AS "amount", p."status" AS "purchaseStatus"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    WHERE pi."id" = ${request.params.id}
    LIMIT 1
  `;
  if (!previous) {
    response.status(404).json({ message: "Conta a pagar nao encontrada." });
    return;
  }
  if (previous.purchaseStatus === "CANCELLED" || previous.status === "CANCELLED") {
    response.status(400).json({ message: "Conta cancelada nao pode ser paga." });
    return;
  }
  const originalAmount = Number(previous.amount ?? 0);
  const difference = Number((paidAmount - originalAmount).toFixed(2));
  const discountAmount = difference < 0 ? Math.abs(difference) : 0;
  const surchargeAmount = difference > 0 ? difference : 0;
  if (Math.abs(difference) > 0.009 && !differenceReason) {
    response.status(400).json({ message: "Justificativa obrigatoria quando o valor pago difere do valor original da parcela." });
    return;
  }

  if (payingCompanyId && companyBankAccountId) {
    const [owned] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "CompanyBankAccount"
      WHERE id = ${companyBankAccountId} AND "companyId" = ${payingCompanyId} AND "isActive" = true
      LIMIT 1
    `;
    if (!owned) {
      response.status(400).json({ message: "Conta bancária não pertence à empresa selecionada ou está inativa." });
      return;
    }
  }

  const [method] = paidPaymentMethodId
    ? await prisma.$queryRaw<Array<{ name: string }>>`SELECT "name" FROM "PaymentMethod" WHERE "id" = ${paidPaymentMethodId} LIMIT 1`
    : [];
  const paidPaymentMethodName = method?.name ?? paidPaymentMethodNameInput;
  const nextStatus = installmentStatusForPayment(previous.dueDate, paidDate);

  await prisma.$executeRaw`
    UPDATE "PaymentInstallment"
    SET "paidDate" = ${paidDate},
        "paidAmount" = ${paidAmount},
        "discountAmount" = ${discountAmount},
        "surchargeAmount" = ${surchargeAmount},
        "differenceReason" = ${differenceReason},
        "paidPaymentMethodId" = ${paidPaymentMethodId},
        "paidPaymentMethodName" = ${paidPaymentMethodName},
        "paymentNotes" = ${paymentNotes},
        "paidByUserId" = ${user.id},
        "reversedAt" = NULL,
        "reversedByUserId" = NULL,
        "payingCompanyId" = ${payingCompanyId},
        "companyBankAccountId" = ${companyBankAccountId},
        "status" = ${nextStatus}
    WHERE "id" = ${request.params.id}
  `;

  if (String(previous.sourceType ?? "DIRECT") === "CARD_STATEMENT") {
    await prisma.$executeRaw`
      UPDATE "CreditCardStatement"
      SET "status" = 'PAID'
      WHERE "generatedPurchaseId" = ${previous.purchaseId}
        AND "status" IN ('CLOSED', 'PAID')
    `;
  }

  await auditLog({
    userId: user.id,
    action: "PAY_INSTALLMENT",
    entity: "PaymentInstallment",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { id: request.params.id, originalAmount, paidDate, paidAmount, discountAmount, surchargeAmount, differenceReason, paidPaymentMethodId, paidPaymentMethodName, paymentNotes, payingCompanyId, companyBankAccountId, status: nextStatus },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ id: request.params.id, status: nextStatus });
});

purchaseRouter.patch("/payables/:id/reverse", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const reason = asNullableText(request.body.reason ?? request.body.paymentNotes);
  if (!reason) {
    response.status(400).json({ message: "Motivo obrigatorio para estornar pagamento." });
    return;
  }

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT pi.*, pi."amount"::text AS "amount", p."status" AS "purchaseStatus"
    FROM "PaymentInstallment" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    WHERE pi."id" = ${request.params.id}
    LIMIT 1
  `;
  if (!previous) {
    response.status(404).json({ message: "Conta a pagar nao encontrada." });
    return;
  }
  if (!previous.paidDate && previous.status !== "PAID" && previous.status !== "PAID_LATE") {
    response.status(400).json({ message: "Conta a pagar ainda nao possui pagamento para estornar." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "PaymentInstallment"
    SET "paidDate" = NULL,
        "paidAmount" = NULL,
        "discountAmount" = NULL,
        "surchargeAmount" = NULL,
        "differenceReason" = NULL,
        "paidPaymentMethodId" = NULL,
        "paidPaymentMethodName" = NULL,
        "paymentNotes" = ${reason},
        "paidByUserId" = NULL,
        "reversedAt" = CURRENT_TIMESTAMP,
        "reversedByUserId" = ${user.id},
        "payingCompanyId" = NULL,
        "companyBankAccountId" = NULL,
        "status" = 'OPEN'
    WHERE "id" = ${request.params.id}
  `;

  if (String(previous.sourceType ?? "DIRECT") === "CARD_STATEMENT") {
    await prisma.$executeRaw`
      UPDATE "CreditCardStatement"
      SET "status" = 'CLOSED'
      WHERE "generatedPurchaseId" = ${previous.purchaseId}
        AND "status" = 'PAID'
    `;
  }

  await auditLog({
    userId: user.id,
    action: "REVERSE_INSTALLMENT_PAYMENT",
    entity: "PaymentInstallment",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { id: request.params.id, reason, status: "OPEN" },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ id: request.params.id, status: "OPEN" });
});

purchaseRouter.get("/duplicate-check", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const supplierId = String(request.query.supplierId ?? "").trim();
  const invoiceNumber = cleanPurchaseReference(request.query.invoiceNumber);
  const purchaseOrderNumber = cleanPurchaseReference(request.query.purchaseOrderNumber);
  const excludePurchaseId = cleanPurchaseReference(request.query.excludePurchaseId);

  if (!supplierId) {
    response.status(400).json({ message: "Fornecedor obrigatorio para validar duplicidade." });
    return;
  }

  const result = await findPurchaseReferenceMatches(prisma, {
    supplierId,
    invoiceNumber,
    purchaseOrderNumber,
    excludePurchaseId
  });

  response.json({
    normalizedInvoiceNumber: result.normalizedInvoiceNumber,
    normalizedPurchaseOrderNumber: result.normalizedPurchaseOrderNumber,
    hasActiveDuplicate: Boolean(result.activeDuplicate),
    hasCancelledDuplicate: Boolean(result.cancelledDuplicate),
    existingPurchase: result.activeDuplicate ? duplicatePurchaseResponse(result.activeDuplicate) : null,
    cancelledPurchase: result.cancelledDuplicate ? duplicatePurchaseResponse(result.cancelledDuplicate) : null
  });
});

purchaseRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const detail = await getPurchaseDetail(request.params.id);
  if (!detail) {
    response.status(404).json({ message: "Compra nao encontrada." });
    return;
  }
  response.json(detail);
});

purchaseRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  let supplierId = "";
  let invoiceNumber: string | null = null;
  let purchaseOrderNumber: string | null = null;

  try {

  supplierId = String(request.body.supplierId ?? "").trim();
  const purchaseDate = parseLocalDateInput(request.body.purchaseDate);
  invoiceNumber = cleanPurchaseReference(request.body.invoiceNumber);
  purchaseOrderNumber = cleanPurchaseReference(request.body.purchaseOrderNumber);
  const normalizedInvoiceNumber = normalizePurchaseReference(invoiceNumber) || null;
  const normalizedPurchaseOrderNumber = normalizePurchaseReference(purchaseOrderNumber) || null;
  const noInvoiceReason = String(request.body.noInvoiceReason ?? "").trim();
  const items: Record<string, unknown>[] = Array.isArray(request.body.items) ? request.body.items : [];
  const totalAmount = Number(request.body.totalAmount ?? items.reduce((sum: number, item: Record<string, unknown>) => sum + Number(item.totalPrice ?? 0), 0));
  const paymentMethodId = request.body.paymentMethodId ? String(request.body.paymentMethodId) : null;
  const paymentMethodName = request.body.paymentMethod ? String(request.body.paymentMethod) : null;
  const isSmallExpense = Boolean(request.body.isSmallExpense);
  const smallExpenseTypeId = request.body.smallExpenseTypeId ? String(request.body.smallExpenseTypeId) : null;
  const smallExpenseResponsibleName = asNullableText(request.body.smallExpenseResponsibleName);
  const smallExpenseAuthorizedBy = asNullableText(request.body.smallExpenseAuthorizedBy);
  const smallExpenseMoneyOrigin = asNullableText(request.body.smallExpenseMoneyOrigin);
  const smallExpenseNotes = asNullableText(request.body.smallExpenseNotes ?? request.body.notes);
  const creditCardId = request.body.creditCardId ? String(request.body.creditCardId) : null;
  const numberOfInstallments = Math.max(1, Math.floor(Number(request.body.numberOfInstallments ?? 1)));
  const requestMeta = {
    userId: user.id,
    body: request.body,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  };

  const validItems: ManualPurchaseItem[] = items
    .map((item: Record<string, unknown>) => ({
      productId: String(item.productId ?? "").trim(),
      rawProductCode: item.rawProductCode ? String(item.rawProductCode) : null,
      rawProductName: String(item.rawProductName ?? item.productName ?? "Produto").trim(),
      unit: item.unit ? String(item.unit).trim().toUpperCase() : null,
      unitMeasureId: item.unitMeasureId ? String(item.unitMeasureId) : null,
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      totalPrice: Number(item.totalPrice ?? 0),
      rawCategory: item.rawCategory ? String(item.rawCategory) : null,
      rawSubcategory: item.rawSubcategory ? String(item.rawSubcategory) : null
    }))
    .filter((item) => item.productId || item.rawProductName || item.quantity || item.totalPrice);

  if (!supplierId || Number.isNaN(purchaseDate.getTime())) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Fornecedor e data sao obrigatorios." });
    return;
  }

  if (!invoiceNumber && !noInvoiceReason && !isSmallExpense) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Informe a NF ou o motivo para compra sem NF." });
    return;
  }

  if (isSmallExpense && !smallExpenseTypeId) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Informe o tipo de pequeno gasto." });
    return;
  }
  if (isSmallExpense && smallExpenseTypeId) {
    const type = await prisma.smallExpenseType.findFirst({
      where: {
        id: smallExpenseTypeId,
        isActive: true,
        normalizedName: { in: OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES }
      }
    });
    if (!type) {
      await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Tipo de pequeno gasto invalido." });
      return;
    }
  }

  if (isSmallExpense && smallExpenseMoneyOrigin && normalizeText(smallExpenseMoneyOrigin).includes("cartao de credito") && !creditCardId) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Selecione o cartao para pequeno gasto no cartao de credito da loja." });
    return;
  }

  if (isSmallExpense && creditCardId) {
    const [openStatement] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM "CreditCardStatement"
      WHERE "creditCardId" = ${creditCardId}
        AND "status" IN ('OPEN', 'CHECKED')
        AND ${purchaseDate} >= "closingDate" - INTERVAL '45 days'
        AND ${purchaseDate} <= "dueDate"
      ORDER BY "closingDate" DESC
      LIMIT 1
    `;
    if (!openStatement) {
      await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Nao ha fatura aberta para este cartao/periodo. Abra a fatura antes de salvar." });
      return;
    }
  }

  let paymentMethodType: string | null = null;
  if (paymentMethodId) {
    const [pmRow] = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT "type" FROM "PaymentMethod" WHERE "id" = ${paymentMethodId} LIMIT 1
    `;
    paymentMethodType = pmRow?.type ?? null;
  }
  const isNormalCreditCard = !isSmallExpense && paymentMethodType === "CREDIT_CARD";

  if (isNormalCreditCard && !creditCardId) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Selecione o cartao para compras no cartao de credito." });
    return;
  }

  if (validItems.length === 0) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Informe ao menos um item." });
    return;
  }

  const invalidItem = validItems.find((item) => !item.productId || !item.unit || item.quantity <= 0 || item.unitPrice < 0);
  if (invalidItem) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Produto, unidade, quantidade maior que zero e valor unitario valido sao obrigatorios." });
    return;
  }

  const itemTotal = validItems.reduce((sum, item) => sum + item.totalPrice, 0);
  if (cents(itemTotal) !== cents(totalAmount)) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Total dos itens nao bate com o total da compra.", action: "BLOCK_PURCHASE_TOTAL_DIVERGENCE" });
    return;
  }

  let installments = parseManualInstallmentPayload(request.body.installments ?? request.body.dueDates, totalAmount);
  const basePaymentMethodName = getPaymentMethodBaseName(paymentMethodName) ?? paymentMethodName;
  const effectiveSmallExpenseOrigin = smallExpenseMoneyOrigin ?? basePaymentMethodName ?? "Forma de pagamento informada";
  const effectiveSmallExpenseResponsible = smallExpenseResponsibleName ?? user.name;
  const effectiveSmallExpenseAuthorizedBy = smallExpenseAuthorizedBy ?? user.name;
  const effectiveSmallExpenseNotes = smallExpenseNotes ?? "Pequeno gasto lancado de forma simplificada.";
  const originNormalized = normalizeText(effectiveSmallExpenseOrigin);
  const allowsInstallments = paymentMethodAllowsInstallments({ name: basePaymentMethodName });
  const paymentAllowsNoInstallments = isSmallExpense
    ? (creditCardId !== null || [
        "caixa",
        "dinheiro",
        "pix",
        "cartao de debito",
        "cartao debito",
        "cartao de credito da loja",
        "cartao de credito",
        "cartao credito"
      ].includes(originNormalized))
    : false;
  if (!isSmallExpense && !isNormalCreditCard && installments.length === 0) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Informe os vencimentos conforme a forma de pagamento." });
    return;
  }
  if (!isSmallExpense && !isNormalCreditCard && !allowsInstallments && installments.length > 1) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "A forma de pagamento selecionada nao permite mais de uma parcela." });
    return;
  }

  if ((isSmallExpense && creditCardId) && installments.length > 0) {
    await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Compra no cartao de credito nao deve gerar parcelas avulsas; os itens vao para a fatura do cartao." });
    return;
  }

  if (isSmallExpense && installments.length === 0 && ["caixa", "dinheiro", "pix", "cartao de debito", "cartao debito"].includes(originNormalized)) {
    installments = [
      {
        installment: 1,
        dueDate: purchaseDate,
        rawValue: formatDateValue(purchaseDate),
        amount: new Prisma.Decimal(totalAmount),
        paymentMethodId,
        paymentMethodName: basePaymentMethodName ?? effectiveSmallExpenseOrigin,
        status: "PAID",
        paidDate: purchaseDate,
        paidAmount: new Prisma.Decimal(totalAmount)
      }
    ];
  }

  if (installments.length) {
    const installmentTotal = installments.reduce((sum, installment) => sum + Number(installment.amount ?? 0), 0);
    if (cents(installmentTotal) !== cents(totalAmount)) {
      await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Total das parcelas deve bater com o total dos itens.", action: "BLOCK_PURCHASE_INSTALLMENT_DIVERGENCE" });
      return;
    }
    if (installments.some((installment) => !installment.dueDate)) {
      await rejectManualPurchase(response, { ...requestMeta, status: 400, message: "Todas as parcelas precisam de vencimento." });
      return;
    }
  }

  const duplicateCheck = await findPurchaseReferenceMatches(prisma, {
    supplierId,
    invoiceNumber,
    purchaseOrderNumber
  });
  const duplicate = duplicateCheck.activeDuplicate;

  if (duplicate) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_DUPLICATE_PURCHASE",
      entity: "Purchase",
      entityId: String(duplicate.id),
      newValue: {
        ...request.body,
        duplicate: duplicatePurchaseResponse(duplicate)
      },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(409).json({
      message: "Ja existe uma compra ativa para este fornecedor com esta NF/pedido.",
      existingPurchase: duplicatePurchaseResponse(duplicate),
      cancelledPurchase: duplicateCheck.cancelledDuplicate ? duplicatePurchaseResponse(duplicateCheck.cancelledDuplicate) : null
    });
    return;
  }

  const inventoryEntries: Array<{ productId: string; purchaseItemId: string; quantity: number; unit: string | null; unitMeasureId: string | null; totalCost: number }> = [];
  const result = await prisma.$transaction(async (tx) => {
    const purchaseNumber = await getNextPurchaseNumber(tx, purchaseDate.getFullYear());
    const purchase = await tx.purchase.create({
      data: {
        purchaseDate,
        competenceMonth: purchaseDate.getMonth() + 1,
        competenceYear: purchaseDate.getFullYear(),
        supplierId,
        invoiceNumber,
        purchaseOrderNumber,
        normalizedInvoiceNumber,
        normalizedPurchaseOrderNumber,
        noInvoiceReason: noInvoiceReason || null,
        rawSupplierCode: request.body.rawSupplierCode || null,
        paymentMethod: basePaymentMethodName,
        paymentMethodId,
        creditCardId,
        totalAmount: new Prisma.Decimal(totalAmount),
        isSmallExpense,
        smallExpenseTypeId,
        smallExpenseResponsibleName: isSmallExpense ? effectiveSmallExpenseResponsible : null,
        smallExpenseAuthorizedBy: isSmallExpense ? effectiveSmallExpenseAuthorizedBy : null,
        smallExpenseMoneyOrigin: isSmallExpense ? effectiveSmallExpenseOrigin : null,
        smallExpenseNotes: isSmallExpense ? effectiveSmallExpenseNotes : null,
        rawRow: request.body as Prisma.InputJsonValue,
        companyId: request.body.companyId ? String(request.body.companyId) : null
      }
    });
    await tx.$executeRaw`
      UPDATE "Purchase"
      SET "purchaseNumber" = ${purchaseNumber},
          "workflowStatus" = ${request.body.workflowStatus || "draft"}
      WHERE "id" = ${purchase.id}
    `;

    for (const item of validItems) {
      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          productId: item.productId,
          rawProductCode: item.rawProductCode,
          rawProductName: item.rawProductName,
          unit: item.unit,
          unitMeasureId: item.unitMeasureId,
          quantity: new Prisma.Decimal(item.quantity),
          unitPrice: new Prisma.Decimal(item.unitPrice),
          totalPrice: new Prisma.Decimal(item.totalPrice),
          rawCategory: item.rawCategory,
          rawSubcategory: item.rawSubcategory
        }
      });
      inventoryEntries.push({
        productId: item.productId,
        purchaseItemId: purchaseItem.id,
        quantity: item.quantity,
        unit: item.unit,
        unitMeasureId: item.unitMeasureId,
        totalCost: item.totalPrice
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          action: "ADD_PURCHASE_ITEM",
          entity: "PurchaseItem",
          entityId: purchaseItem.id,
          newValue: item as Prisma.InputJsonValue
        }
      });
    }

    if (installments.length) {
      await tx.paymentInstallment.createMany({
        data: installments.map((installment) => ({
          purchaseId: purchase.id,
          dueDate: installment.dueDate,
          amount: installment.amount,
          installment: installment.installment,
          paymentMethodId: installment.paymentMethodId ?? paymentMethodId,
          paymentMethodName: installment.paymentMethodName ?? basePaymentMethodName,
          status: installment.status ?? "OPEN",
          paidDate: installment.paidDate ?? null,
          paidAmount: installment.paidAmount ?? null,
          rawValue: installment.rawValue,
          sourceType: "DIRECT"
        }))
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          action: "CREATE_PAYABLE_TITLES",
          entity: "PaymentInstallment",
          entityId: purchase.id,
          newValue: installments.map((installment) => ({
            ...installment,
            amount: String(installment.amount)
          })) as Prisma.InputJsonValue
        }
      });
    }

    if (creditCardId) {
      const [supplierRow] = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM "Supplier" WHERE "id" = ${supplierId} LIMIT 1
      `;
      const supplierName = supplierRow?.name ?? "Fornecedor";
      const firstItem = validItems[0];

      if (isNormalCreditCard) {
        const desc = invoiceNumber
          ? `NF ${invoiceNumber} — ${supplierName}`
          : (firstItem?.rawProductName ? `${firstItem.rawProductName} — ${supplierName}` : supplierName);
        await syncCardStatementItemsForPurchase(tx, {
          purchaseId: purchase.id,
          cardId: creditCardId,
          purchaseDate,
          description: desc,
          supplierName,
          totalAmount,
          numberOfInstallments,
          categoryName: firstItem?.rawCategory ?? null,
          notes: paymentMethodName ?? null
        });
      } else if (isSmallExpense) {
        await syncCardStatementItemForPurchase(tx, {
          purchaseId: purchase.id,
          cardId: creditCardId,
          purchaseDate,
          description: firstItem?.rawProductName || invoiceNumber || purchaseNumber || "Pequeno gasto no cartao",
          supplierName,
          value: totalAmount,
          categoryName: firstItem?.rawCategory ?? null,
          smallExpenseTypeId,
          responsibleName: effectiveSmallExpenseResponsible,
          notes: effectiveSmallExpenseNotes
        });
      }
    }

    return { id: purchase.id, purchaseNumber };
  });

  if (String(request.body.workflowStatus ?? "confirmed") === "confirmed") {
    for (const entry of inventoryEntries) {
      await recordPurchaseInventoryEntry(entry);
    }
  }

  await auditLog({
    userId: user.id,
    action: isSmallExpense ? "CREATE_SMALL_EXPENSE" : "CREATE_MANUAL_PURCHASE",
    entity: "Purchase",
    entityId: result.id,
    newValue: { ...request.body, purchaseNumber: result.purchaseNumber },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  if (request.body.paymentDifferenceReason) {
    await auditLog({
      userId: user.id,
      action: "AUTHORIZE_PURCHASE_INSTALLMENT_DIVERGENCE",
      entity: "Purchase",
      entityId: result.id,
      newValue: {
        reason: request.body.paymentDifferenceReason,
        totalAmount,
        installmentTotal: installments.reduce((sum, installment) => sum + Number(installment.amount ?? 0), 0)
      },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
  }

  response.status(201).json(result);
  } catch (error) {
    if (isPurchaseReferenceUniqueError(error)) {
      const duplicateCheck = await findPurchaseReferenceMatches(prisma, { supplierId, invoiceNumber, purchaseOrderNumber });
      const duplicate = duplicateCheck.activeDuplicate ?? duplicateCheck.cancelledDuplicate;
      await auditLog({
        userId: user.id,
        action: "BLOCK_DUPLICATE_PURCHASE",
        entity: "Purchase",
        entityId: duplicate?.id ? String(duplicate.id) : undefined,
        newValue: { body: request.body, reason: "unique_index_conflict" },
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      }).catch(() => undefined);
      response.status(409).json({
        message: "Ja existe uma compra ativa para este fornecedor com esta NF/pedido.",
        existingPurchase: duplicateCheck.activeDuplicate ? duplicatePurchaseResponse(duplicateCheck.activeDuplicate) : null,
        cancelledPurchase: duplicateCheck.cancelledDuplicate ? duplicatePurchaseResponse(duplicateCheck.cancelledDuplicate) : null
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Erro inesperado ao salvar compra.";
    await auditLog({
      userId: user.id,
      action: "MANUAL_PURCHASE_NOT_SAVED",
      entity: "Purchase",
      newValue: { message, body: request.body },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }).catch(() => undefined);
    response.status(500).json({ message });
  }
});

purchaseRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await getPurchaseDetail(request.params.id);
  if (!previous) {
    response.status(404).json({ message: "Compra nao encontrada." });
    return;
  }
  const previousRecord = previous as Record<string, unknown> & { items: Array<Record<string, unknown>> };
  if (previousRecord.status === "CANCELLED") {
    response.status(400).json({ message: "Compra cancelada nao pode ser editada." });
    return;
  }

  const currentSupplierId = String(previousRecord.supplierId);
  const nextSupplierId = asNullableText(request.body.supplierId) ?? currentSupplierId;
  if (nextSupplierId !== currentSupplierId && !asNullableText(request.body.supplierChangeReason)) {
    response.status(400).json({ message: "Motivo obrigatorio para alterar fornecedor." });
    return;
  }

  let invoiceNumber: string | null = null;
  let purchaseOrderNumber: string | null = null;

  try {
  const purchaseDate = parseLocalDateInput(request.body.purchaseDate);
  invoiceNumber = cleanPurchaseReference(request.body.invoiceNumber);
  purchaseOrderNumber = cleanPurchaseReference(request.body.purchaseOrderNumber);
  const normalizedInvoiceNumber = normalizePurchaseReference(invoiceNumber) || null;
  const normalizedPurchaseOrderNumber = normalizePurchaseReference(purchaseOrderNumber) || null;
  const noInvoiceReason = asNullableText(request.body.noInvoiceReason);
  const items: Record<string, unknown>[] = Array.isArray(request.body.items) ? request.body.items : [];
  const paymentMethodId = asNullableText(request.body.paymentMethodId);
  const paymentMethodName = asNullableText(request.body.paymentMethod);
  const isSmallExpense = Boolean(request.body.isSmallExpense);
  const smallExpenseTypeId = asNullableText(request.body.smallExpenseTypeId);
  const smallExpenseResponsibleName = asNullableText(request.body.smallExpenseResponsibleName);
  const smallExpenseAuthorizedBy = asNullableText(request.body.smallExpenseAuthorizedBy);
  const smallExpenseMoneyOrigin = asNullableText(request.body.smallExpenseMoneyOrigin);
  const smallExpenseNotes = asNullableText(request.body.smallExpenseNotes ?? request.body.notes);
  const creditCardId = asNullableText(request.body.creditCardId);
  const numberOfInstallments = Math.max(1, Math.floor(Number(request.body.numberOfInstallments ?? 1)));
  const validItems = items.map((item) => ({
    productId: String(item.productId ?? "").trim(),
    rawProductCode: asNullableText(item.rawProductCode),
    rawProductName: String(item.rawProductName ?? item.productName ?? "Produto").trim(),
    unit: asNullableText(item.unit)?.toUpperCase() ?? null,
    unitMeasureId: asNullableText(item.unitMeasureId),
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unitPrice ?? 0),
    totalPrice: Number(item.totalPrice ?? 0),
    rawCategory: asNullableText(item.rawCategory),
    rawSubcategory: asNullableText(item.rawSubcategory)
  }));
  const invalidItem = validItems.find((item) => !item.productId || !item.unit || item.quantity <= 0 || item.unitPrice < 0);
  if (Number.isNaN(purchaseDate.getTime()) || validItems.length === 0 || invalidItem) {
    response.status(400).json({ message: "Data, NF e itens validos sao obrigatorios para editar." });
    return;
  }

  if (!invoiceNumber && !noInvoiceReason && !isSmallExpense) {
    response.status(400).json({ message: "Informe a NF ou o motivo para compra sem NF." });
    return;
  }

  if (isSmallExpense && !smallExpenseTypeId) {
    response.status(400).json({ message: "Informe o tipo de pequeno gasto." });
    return;
  }
  if (isSmallExpense && smallExpenseTypeId) {
    const type = await prisma.smallExpenseType.findFirst({
      where: {
        id: smallExpenseTypeId,
        isActive: true,
        normalizedName: { in: OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES }
      }
    });
    if (!type) {
      response.status(400).json({ message: "Tipo de pequeno gasto invalido." });
      return;
    }
  }

  const totalAmount = validItems.reduce((sum, item) => sum + item.totalPrice, 0);
  let installments = parseManualInstallmentPayload(request.body.installments, totalAmount);
  const basePaymentMethodName = getPaymentMethodBaseName(paymentMethodName) ?? paymentMethodName;
  const effectiveSmallExpenseOrigin = smallExpenseMoneyOrigin ?? basePaymentMethodName ?? "Forma de pagamento informada";
  const effectiveSmallExpenseResponsible = smallExpenseResponsibleName ?? user.name;
  const effectiveSmallExpenseAuthorizedBy = smallExpenseAuthorizedBy ?? user.name;
  const effectiveSmallExpenseNotes = smallExpenseNotes ?? "Pequeno gasto lancado de forma simplificada.";
  const originNormalized = normalizeText(effectiveSmallExpenseOrigin);
  const allowsInstallments = paymentMethodAllowsInstallments({ name: basePaymentMethodName });
  const paymentAllowsNoInstallments = isSmallExpense
    ? (creditCardId !== null || [
        "caixa",
        "dinheiro",
        "pix",
        "cartao de debito",
        "cartao debito",
        "cartao de credito da loja",
        "cartao de credito",
        "cartao credito"
      ].includes(originNormalized))
    : false;
  if (!invoiceNumber && !noInvoiceReason && !isSmallExpense) {
    response.status(400).json({ message: "Informe a NF ou o motivo para compra sem NF." });
    return;
  }
  let updatePaymentMethodType: string | null = null;
  if (paymentMethodId) {
    const [pmRow] = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT "type" FROM "PaymentMethod" WHERE "id" = ${paymentMethodId} LIMIT 1
    `;
    updatePaymentMethodType = pmRow?.type ?? null;
  }
  const isNormalCreditCard = !isSmallExpense && updatePaymentMethodType === "CREDIT_CARD";

  if (isNormalCreditCard && !creditCardId) {
    response.status(400).json({ message: "Selecione o cartao para compras no cartao de credito." });
    return;
  }
  if (!isSmallExpense && !isNormalCreditCard && installments.length === 0) {
    response.status(400).json({ message: "Informe os vencimentos conforme a forma de pagamento." });
    return;
  }
  if (!isSmallExpense && !isNormalCreditCard && !allowsInstallments && installments.length > 1) {
    response.status(400).json({ message: "A forma de pagamento selecionada nao permite mais de uma parcela." });
    return;
  }

  if ((isSmallExpense && creditCardId) && installments.length > 0) {
    response.status(400).json({ message: "Compra no cartao de credito nao deve gerar parcelas avulsas; os itens vao para a fatura do cartao." });
    return;
  }
  if (isSmallExpense && installments.length === 0 && ["caixa", "dinheiro", "pix", "cartao de debito", "cartao debito"].includes(originNormalized)) {
    installments = [
      {
        installment: 1,
        dueDate: purchaseDate,
        rawValue: formatDateValue(purchaseDate),
        amount: new Prisma.Decimal(totalAmount),
        paymentMethodId,
        paymentMethodName: basePaymentMethodName ?? effectiveSmallExpenseOrigin,
        status: "PAID",
        paidDate: purchaseDate,
        paidAmount: new Prisma.Decimal(totalAmount)
      }
    ];
  }
  if (installments.length) {
    const installmentTotal = installments.reduce((sum, installment) => sum + Number(installment.amount ?? 0), 0);
    if (cents(installmentTotal) !== cents(totalAmount)) {
      response.status(400).json({ message: "Total das parcelas deve bater com o total dos itens." });
      return;
    }
  }

  const duplicateCheck = await findPurchaseReferenceMatches(prisma, {
    supplierId: nextSupplierId,
    invoiceNumber,
    purchaseOrderNumber,
    excludePurchaseId: request.params.id
  });
  const duplicate = duplicateCheck.activeDuplicate;
  if (duplicate) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_DUPLICATE_PURCHASE",
      entity: "Purchase",
      entityId: String(duplicate.id),
      previousValue: previous,
      newValue: {
        ...request.body,
        duplicate: duplicatePurchaseResponse(duplicate)
      },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(409).json({
      message: "Ja existe uma compra ativa para este fornecedor com esta NF/pedido.",
      existingPurchase: duplicatePurchaseResponse(duplicate),
      cancelledPurchase: duplicateCheck.cancelledDuplicate ? duplicatePurchaseResponse(duplicateCheck.cancelledDuplicate) : null
    });
    return;
  }

  const previousItems = Array.isArray(previousRecord.items) ? previousRecord.items : [];
  await prisma.$transaction(async (tx) => {
    await tx.purchase.update({
      where: { id: request.params.id },
      data: {
        purchaseDate,
        competenceMonth: purchaseDate.getMonth() + 1,
        competenceYear: purchaseDate.getFullYear(),
        supplierId: nextSupplierId,
        invoiceNumber,
        purchaseOrderNumber,
        noInvoiceReason: noInvoiceReason || null,
        paymentMethod: basePaymentMethodName,
        paymentMethodId,
        creditCardId,
        totalAmount: new Prisma.Decimal(totalAmount),
        normalizedInvoiceNumber,
        normalizedPurchaseOrderNumber,
        isSmallExpense,
        smallExpenseTypeId,
        smallExpenseResponsibleName: isSmallExpense ? effectiveSmallExpenseResponsible : null,
        smallExpenseAuthorizedBy: isSmallExpense ? effectiveSmallExpenseAuthorizedBy : null,
        smallExpenseMoneyOrigin: isSmallExpense ? effectiveSmallExpenseOrigin : null,
        smallExpenseNotes: isSmallExpense ? effectiveSmallExpenseNotes : null,
        rawRow: request.body as Prisma.InputJsonValue,
        companyId: request.body.companyId ? String(request.body.companyId) : null
      }
    });

    await tx.purchaseItem.deleteMany({ where: { purchaseId: request.params.id } });
    await tx.paymentInstallment.deleteMany({ where: { purchaseId: request.params.id } });
    await removeCardStatementItemsForPurchase(request.params.id, tx);

    for (const item of validItems) {
      const created = await tx.purchaseItem.create({
        data: {
          purchaseId: request.params.id,
          productId: item.productId,
          rawProductCode: item.rawProductCode,
          rawProductName: item.rawProductName,
          unit: item.unit,
          unitMeasureId: item.unitMeasureId,
          quantity: new Prisma.Decimal(item.quantity),
          unitPrice: new Prisma.Decimal(item.unitPrice),
          totalPrice: new Prisma.Decimal(item.totalPrice),
          rawCategory: item.rawCategory,
          rawSubcategory: item.rawSubcategory
        }
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          action: "UPDATE_PURCHASE_ITEM",
          entity: "PurchaseItem",
          entityId: created.id,
          newValue: item as Prisma.InputJsonValue
        }
      });
    }

    if (installments.length) {
      await tx.paymentInstallment.createMany({
        data: installments.map((installment) => ({
          purchaseId: request.params.id,
          dueDate: installment.dueDate,
          amount: installment.amount,
          installment: installment.installment,
          paymentMethodId: installment.paymentMethodId ?? paymentMethodId,
          paymentMethodName: installment.paymentMethodName ?? basePaymentMethodName,
          status: installment.status ?? "OPEN",
          paidDate: installment.paidDate ?? null,
          paidAmount: installment.paidAmount ?? null,
          rawValue: installment.rawValue
        }))
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          action: "UPDATE_PAYABLE_TITLES",
          entity: "PaymentInstallment",
          entityId: request.params.id,
          newValue: installments.map((installment) => ({
            ...installment,
            amount: String(installment.amount)
          })) as Prisma.InputJsonValue
        }
      });
    }

    if (creditCardId) {
      const [supplierRow] = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM "Supplier" WHERE "id" = ${nextSupplierId} LIMIT 1
      `;
      const supplierName = supplierRow?.name ?? "Fornecedor";
      const firstItem = validItems[0];

      if (isNormalCreditCard) {
        const desc = invoiceNumber
          ? `NF ${invoiceNumber} — ${supplierName}`
          : (firstItem?.rawProductName ? `${firstItem.rawProductName} — ${supplierName}` : supplierName);
        await syncCardStatementItemsForPurchase(tx, {
          purchaseId: request.params.id,
          cardId: creditCardId,
          purchaseDate,
          description: desc,
          supplierName,
          totalAmount,
          numberOfInstallments,
          categoryName: firstItem?.rawCategory ?? null,
          notes: paymentMethodName ?? null
        });
      } else if (isSmallExpense) {
        await syncCardStatementItemForPurchase(tx, {
          purchaseId: request.params.id,
          cardId: creditCardId,
          purchaseDate,
          description: firstItem?.rawProductName || invoiceNumber || asNullableText(previousRecord.purchaseNumber) || "Pequeno gasto no cartao",
          supplierName,
          value: totalAmount,
          categoryName: firstItem?.rawCategory ?? null,
          smallExpenseTypeId,
          responsibleName: effectiveSmallExpenseResponsible,
          notes: effectiveSmallExpenseNotes
        });
      }
    }

    for (const productId of [...new Set([...previousItems.map((item) => String(item.productId)), ...validItems.map((item) => item.productId)])]) {
      const previousQty = previousItems
        .filter((item) => String(item.productId) === productId)
        .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
      const nextQty = validItems.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0);
      const delta = nextQty - previousQty;
      if (delta === 0) continue;
      await tx.$executeRaw`
        INSERT INTO "InventoryMovement" ("id", "productId", "type", "quantity", "unit", "responsibleUserId", "notes")
        VALUES (${crypto.randomUUID()}, ${productId}, 'ADJUSTMENT', ${delta}, ${validItems.find((item) => item.productId === productId)?.unit ?? null}, ${user.id}, 'Ajuste gerado pela edicao de compra.')
      `;
      await tx.$executeRaw`
        UPDATE "InventoryStock"
        SET "currentQuantity" = "currentQuantity" + ${delta}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "productId" = ${productId}
      `;
    }

    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        action: isSmallExpense ? "UPDATE_SMALL_EXPENSE" : "UPDATE_PURCHASE",
        entity: "Purchase",
        entityId: request.params.id,
        previousValue: previous as Prisma.InputJsonValue,
        newValue: request.body as Prisma.InputJsonValue
      }
    });
  });

  response.json(await getPurchaseDetail(request.params.id));
  } catch (error) {
    if (isPurchaseReferenceUniqueError(error)) {
      const duplicateCheck = await findPurchaseReferenceMatches(prisma, {
        supplierId: nextSupplierId,
        invoiceNumber,
        purchaseOrderNumber,
        excludePurchaseId: request.params.id
      });
      const duplicate = duplicateCheck.activeDuplicate ?? duplicateCheck.cancelledDuplicate;
      await auditLog({
        userId: user.id,
        action: "BLOCK_DUPLICATE_PURCHASE",
        entity: "Purchase",
        entityId: duplicate?.id ? String(duplicate.id) : request.params.id,
        previousValue: previous,
        newValue: { body: request.body, reason: "unique_index_conflict" },
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      }).catch(() => undefined);
      response.status(409).json({
        message: "Ja existe uma compra ativa para este fornecedor com esta NF/pedido.",
        existingPurchase: duplicateCheck.activeDuplicate ? duplicatePurchaseResponse(duplicateCheck.activeDuplicate) : null,
        cancelledPurchase: duplicateCheck.cancelledDuplicate ? duplicatePurchaseResponse(duplicateCheck.cancelledDuplicate) : null
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Erro inesperado ao atualizar compra.";
    await auditLog({
      userId: user.id,
      action: "MANUAL_PURCHASE_NOT_SAVED",
      entity: "Purchase",
      entityId: request.params.id,
      previousValue: previous,
      newValue: { message, body: request.body },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }).catch(() => undefined);
    response.status(500).json({ message });
  }
});

async function adjustStockForPurchase(purchaseId: string, direction: -1 | 1) {
  const movements = await prisma.$queryRaw<Array<{ id: string; productId: string; quantity: Prisma.Decimal }>>`
    SELECT m."id", m."productId", m."quantity"
    FROM "InventoryMovement" m
    JOIN "PurchaseItem" i ON i."id" = m."sourcePurchaseItemId"
    WHERE i."purchaseId" = ${purchaseId}
      AND m."type" = 'PURCHASE_IN'
  `;

  for (const movement of movements) {
    const quantity = Number(movement.quantity) * direction;
    await prisma.$executeRaw`
      UPDATE "InventoryStock"
      SET "currentQuantity" = "currentQuantity" + ${quantity},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "productId" = ${movement.productId}
    `;
  }

  if (!movements.length) return;

  if (direction === -1) {
    await prisma.$executeRaw`
      UPDATE "InventoryMovement"
      SET "isCancelled" = true,
          "cancelledAt" = CURRENT_TIMESTAMP,
          "cancelledByPurchaseId" = ${purchaseId}
      WHERE "id" IN (${Prisma.join(movements.map((movement) => movement.id))})
    `;
  } else if (movements.length) {
    await prisma.$executeRaw`
      UPDATE "InventoryMovement"
      SET "isCancelled" = false,
          "restoredAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (${Prisma.join(movements.map((movement) => movement.id))})
    `;
  }
}

purchaseRouter.patch("/:id/cancel", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const reason = String(request.body.reason ?? "").trim();
  if (!reason) {
    response.status(400).json({ message: "Motivo obrigatorio para cancelar compra." });
    return;
  }

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p.*, COALESCE(json_agg(i.*) FILTER (WHERE i."id" IS NOT NULL), '[]') AS "items"
    FROM "Purchase" p
    LEFT JOIN "PurchaseItem" i ON i."purchaseId" = p."id"
    WHERE p."id" = ${request.params.id}
    GROUP BY p."id"
  `;
  if (!previous) {
    response.status(404).json({ message: "Compra nao encontrada." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "Purchase"
    SET "status" = 'CANCELLED',
        "cancelledAt" = CURRENT_TIMESTAMP,
        "cancellationReason" = ${reason},
        "cancelledByUserId" = ${admin.id},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await adjustStockForPurchase(request.params.id, -1);
  await removeCardStatementItemsForPurchase(request.params.id);
  await auditLog({
    userId: admin.id,
    action: Boolean((previous as Record<string, unknown>).isSmallExpense) ? "CANCEL_SMALL_EXPENSE" : "CANCEL_PURCHASE",
    entity: "Purchase",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { status: "CANCELLED", reason },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ id: request.params.id, status: "CANCELLED" });
});

purchaseRouter.patch("/:id/restore", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "Purchase" WHERE "id" = ${request.params.id}
  `;
  if (!previous) {
    response.status(404).json({ message: "Compra nao encontrada." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "Purchase"
    SET "status" = 'ACTIVE',
        "restoredAt" = CURRENT_TIMESTAMP,
        "restoredByUserId" = ${admin.id},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await adjustStockForPurchase(request.params.id, 1);
  const [restored] = await prisma.$queryRaw<Array<{
    id: string;
    purchaseDate: Date;
    creditCardId: string | null;
    smallExpenseMoneyOrigin: string | null;
    smallExpenseResponsibleName: string | null;
    smallExpenseNotes: string | null;
    smallExpenseTypeId: string | null;
    totalAmount: Prisma.Decimal;
    supplierName: string;
    invoiceNumber: string | null;
    purchaseNumber: string | null;
  }>>`
    SELECT p."id", p."purchaseDate", p."creditCardId", p."smallExpenseMoneyOrigin", p."smallExpenseResponsibleName",
           p."smallExpenseNotes", p."smallExpenseTypeId", p."totalAmount", s."name" AS "supplierName", p."invoiceNumber", p."purchaseNumber"
    FROM "Purchase" p
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."id" = ${request.params.id}
    LIMIT 1
  `;
  if (restored?.creditCardId) {
    await prisma.$transaction(async (tx) => {
      await syncCardStatementItemForPurchase(tx, {
        purchaseId: restored.id,
        cardId: restored.creditCardId,
        purchaseDate: restored.purchaseDate,
        description: restored.invoiceNumber || restored.purchaseNumber || "Pequeno gasto no cartao",
        supplierName: restored.supplierName,
        value: Number(restored.totalAmount),
        smallExpenseTypeId: restored.smallExpenseTypeId,
        responsibleName: restored.smallExpenseResponsibleName,
        notes: restored.smallExpenseNotes
      });
    });
  }
  await auditLog({
    userId: admin.id,
    action: "RESTORE_PURCHASE",
    entity: "Purchase",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { status: "ACTIVE" },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ id: request.params.id, status: "ACTIVE" });
});
