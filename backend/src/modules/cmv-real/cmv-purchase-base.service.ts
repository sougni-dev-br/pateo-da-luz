import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

export type CmvVisionKey = "accounting" | "managerial";

type RawPurchaseTotalRow = {
  totalAmount: Prisma.Decimal | null;
  purchasesCount: bigint | number | null;
};

type RawCategoryBreakdownRow = {
  categoryName: string | null;
  totalAmount: Prisma.Decimal | null;
  itemsCount: bigint | number | null;
};

type RawSupplierBreakdownRow = {
  supplierId: string;
  supplierName: string;
  supplierDocument: string | null;
  totalAmount: Prisma.Decimal | null;
  purchasesCount: bigint | number | null;
};

function toNumber(value: Prisma.Decimal | bigint | number | string | null | undefined) {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function competenceBounds(startDate: Date, endDate: Date) {
  return {
    startYear: startDate.getFullYear(),
    startMonth: startDate.getMonth() + 1,
    endYear: endDate.getFullYear(),
    endMonth: endDate.getMonth() + 1,
  };
}

function cmvPurchasePredicate(mode: CmvVisionKey) {
  if (mode === "managerial") {
    return Prisma.sql`(
      dc."dreGroup" = 'CMV_COMPRAS'
      OR dc."name" IN ('Material de Limpeza', 'Descartáveis', 'Descartáveis / Delivery')
    )`;
  }
  return Prisma.sql`dc."dreGroup" = 'CMV_COMPRAS'`;
}

export async function getCmvPurchaseTotalsByCompetenceRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const { startYear, startMonth, endYear, endMonth } = competenceBounds(startDate, endDate);
  const [row] = await prisma.$queryRaw<Array<RawPurchaseTotalRow>>`
    SELECT
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(DISTINCT p."id") AS "purchasesCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" <> 'CANCELLED'
      AND ${cmvPurchasePredicate(mode)}
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
  `;
  return {
    total: toNumber(row?.totalAmount),
    count: toNumber(row?.purchasesCount),
  };
}

export async function getCmvPurchaseTotalByCompetenceMonth(year: number, month: number, mode: CmvVisionKey = "accounting") {
  const [row] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM(pi."totalPrice"), 0) AS "total"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."competenceYear" = ${year}
      AND p."competenceMonth" = ${month}
      AND p."status" <> 'CANCELLED'
      AND ${cmvPurchasePredicate(mode)}
  `;
  return toNumber(row?.total);
}

export async function getCmvPurchaseTotalByPurchaseDateRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const [row] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM(pi."totalPrice"), 0) AS "total"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(mode)}
      AND p."purchaseDate" >= ${startDate}
      AND p."purchaseDate" <= ${endDate}
  `;
  return toNumber(row?.total);
}

// ==============================================================================
// CMV v2 (2026-07-14): funções que filtram por purchaseDate (data real da compra)
// em vez de MAKE_DATE(competenceYear, competenceMonth, 1).
//
// Motivo: o CMV Real é um ciclo operacional entre duas contagens físicas. O
// intervalo relevante é a janela real de tempo, não o mês inteiro de competência.
// Filtrar por competência inclui compras fora do ciclo quando dataInicial != 01/mês,
// descasando com o faturamento (que já era filtrado por data).
//
// Ver spec completa em docs/arquitetura-cmv-dre-v2.md.
// Funções antigas (ByCompetenceRange) permanecem para uso do Fechamento Contábil
// Mensal (dimensão A do modelo v2).
// ==============================================================================

export async function getCmvPurchaseTotalsByPurchaseDateRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const [row] = await prisma.$queryRaw<Array<RawPurchaseTotalRow>>`
    SELECT
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(DISTINCT p."id") AS "purchasesCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(mode)}
      AND p."purchaseDate" >= ${startDate}
      AND p."purchaseDate" <= ${endDate}
  `;
  return {
    total: toNumber(row?.totalAmount),
    count: toNumber(row?.purchasesCount),
  };
}

export async function getCmvPurchaseByCategoryByPurchaseDateRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const rows = await prisma.$queryRaw<Array<RawCategoryBreakdownRow>>`
    SELECT
      COALESCE(dc."name", pi."rawCategory", 'Sem categoria CMV') AS "categoryName",
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(*) AS "itemsCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(mode)}
      AND p."purchaseDate" >= ${startDate}
      AND p."purchaseDate" <= ${endDate}
    GROUP BY COALESCE(dc."name", pi."rawCategory", 'Sem categoria CMV')
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    categoryName: String(row.categoryName ?? "Sem categoria CMV"),
    totalAmount: toNumber(row.totalAmount),
    itemsCount: toNumber(row.itemsCount),
  }));
}

export async function getCmvPurchaseBySupplierByPurchaseDateRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const rows = await prisma.$queryRaw<Array<RawSupplierBreakdownRow>>`
    SELECT
      s."id" AS "supplierId",
      s."name" AS "supplierName",
      s."document" AS "supplierDocument",
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(DISTINCT p."id") AS "purchasesCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."status" = 'ACTIVE'
      AND ${cmvPurchasePredicate(mode)}
      AND p."purchaseDate" >= ${startDate}
      AND p."purchaseDate" <= ${endDate}
    GROUP BY s."id", s."name", s."document"
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierDocument: row.supplierDocument,
    totalAmount: toNumber(row.totalAmount),
    purchasesCount: toNumber(row.purchasesCount),
  }));
}

export async function getCmvPurchaseByCategoryByCompetenceRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const { startYear, startMonth, endYear, endMonth } = competenceBounds(startDate, endDate);
  const rows = await prisma.$queryRaw<Array<RawCategoryBreakdownRow>>`
    SELECT
      COALESCE(dc."name", pi."rawCategory", 'Sem categoria CMV') AS "categoryName",
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(*) AS "itemsCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."status" <> 'CANCELLED'
      AND ${cmvPurchasePredicate(mode)}
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
    GROUP BY COALESCE(dc."name", pi."rawCategory", 'Sem categoria CMV')
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    categoryName: String(row.categoryName ?? "Sem categoria CMV"),
    totalAmount: toNumber(row.totalAmount),
    itemsCount: toNumber(row.itemsCount),
  }));
}

export async function getCmvPurchaseBySupplierByCompetenceRange(startDate: Date, endDate: Date, mode: CmvVisionKey = "accounting") {
  const { startYear, startMonth, endYear, endMonth } = competenceBounds(startDate, endDate);
  const rows = await prisma.$queryRaw<Array<RawSupplierBreakdownRow>>`
    SELECT
      s."id" AS "supplierId",
      s."name" AS "supplierName",
      s."document" AS "supplierDocument",
      COALESCE(SUM(pi."totalPrice"), 0) AS "totalAmount",
      COUNT(DISTINCT p."id") AS "purchasesCount"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."status" <> 'CANCELLED'
      AND ${cmvPurchasePredicate(mode)}
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          >= MAKE_DATE(${startYear}::int, ${startMonth}::int, 1)
      AND MAKE_DATE(p."competenceYear", p."competenceMonth", 1)
          <= MAKE_DATE(${endYear}::int, ${endMonth}::int, 1)
    GROUP BY s."id", s."name", s."document"
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierDocument: row.supplierDocument,
    totalAmount: toNumber(row.totalAmount),
    purchasesCount: toNumber(row.purchasesCount),
  }));
}
