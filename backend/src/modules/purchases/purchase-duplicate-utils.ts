import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

type QueryClient = Pick<typeof prisma, "$queryRaw">;

export type PurchaseReferenceMatch = {
  id: string;
  purchaseNumber: string | null;
  purchaseOrderNumber: string | null;
  invoiceNumber: string | null;
  purchaseDate: Date;
  totalAmount: string;
  status: string;
  supplierName: string;
  normalizedInvoiceNumber: string | null;
  normalizedPurchaseOrderNumber: string | null;
  matchType: "INVOICE" | "ORDER";
  matchedValue: string | null;
};

export function cleanPurchaseReference(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text || null;
}

export function normalizePurchaseReference(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (!text) return "";

  return text
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/g, ""));
}

export function buildReferenceLabel(input: {
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
}) {
  const invoiceNumber = cleanPurchaseReference(input.invoiceNumber);
  const purchaseOrderNumber = cleanPurchaseReference(input.purchaseOrderNumber);
  if (invoiceNumber && purchaseOrderNumber) return `NF ${invoiceNumber} / pedido ${purchaseOrderNumber}`;
  if (invoiceNumber) return `NF ${invoiceNumber}`;
  if (purchaseOrderNumber) return `pedido ${purchaseOrderNumber}`;
  return "NF/pedido";
}

export async function findPurchaseReferenceMatches(
  db: QueryClient,
  input: {
    supplierId: string;
    invoiceNumber?: string | null;
    purchaseOrderNumber?: string | null;
    excludePurchaseId?: string | null;
  }
) {
  const normalizedInvoiceNumber = normalizePurchaseReference(input.invoiceNumber);
  const normalizedPurchaseOrderNumber = normalizePurchaseReference(input.purchaseOrderNumber);

  if (!normalizedInvoiceNumber && !normalizedPurchaseOrderNumber) {
    return {
      normalizedInvoiceNumber: null,
      normalizedPurchaseOrderNumber: null,
      activeDuplicate: null,
      cancelledDuplicate: null,
      matches: [] as PurchaseReferenceMatch[]
    };
  }

  const conditions: Prisma.Sql[] = [];
  if (normalizedInvoiceNumber) {
    conditions.push(Prisma.sql`p."normalizedInvoiceNumber" = ${normalizedInvoiceNumber}`);
  }
  if (normalizedPurchaseOrderNumber) {
    conditions.push(Prisma.sql`p."normalizedPurchaseOrderNumber" = ${normalizedPurchaseOrderNumber}`);
  }

  const referenceCondition =
    conditions.length === 1
      ? conditions[0]
      : Prisma.sql`(${Prisma.join(conditions, " OR ")})`;

  const excludeCondition = input.excludePurchaseId
    ? Prisma.sql`AND p."id" <> ${input.excludePurchaseId}`
    : Prisma.empty;

  const rows = await db.$queryRaw<Array<Omit<PurchaseReferenceMatch, "matchType" | "matchedValue">>>`
    SELECT
      p."id",
      p."purchaseNumber",
      p."purchaseOrderNumber",
      p."invoiceNumber",
      p."purchaseDate",
      p."totalAmount"::text AS "totalAmount",
      p."status",
      s."name" AS "supplierName",
      p."normalizedInvoiceNumber",
      p."normalizedPurchaseOrderNumber"
    FROM "Purchase" p
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."supplierId" = ${input.supplierId}
      ${excludeCondition}
      AND ${referenceCondition}
    ORDER BY
      CASE WHEN p."status" <> 'CANCELLED' THEN 0 ELSE 1 END,
      p."purchaseDate" DESC,
      p."createdAt" DESC
    LIMIT 20
  `;

  const matches: PurchaseReferenceMatch[] = rows.map((row) => {
    const matchType =
      normalizedInvoiceNumber && row.normalizedInvoiceNumber === normalizedInvoiceNumber
        ? "INVOICE"
        : "ORDER";
    return {
      ...row,
      matchType,
      matchedValue: matchType === "INVOICE" ? row.invoiceNumber : row.purchaseOrderNumber
    };
  });

  return {
    normalizedInvoiceNumber: normalizedInvoiceNumber || null,
    normalizedPurchaseOrderNumber: normalizedPurchaseOrderNumber || null,
    activeDuplicate: matches.find((row) => row.status !== "CANCELLED") ?? null,
    cancelledDuplicate: matches.find((row) => row.status === "CANCELLED") ?? null,
    matches
  };
}
