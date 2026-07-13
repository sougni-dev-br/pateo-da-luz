import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ReviewRow = {
  id: string;
  externalCode: string | null;
  name: string;
  controlsStock: boolean;
  dreCategoryName: string | null;
  dreGroup: string | null;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  purchaseItems: bigint | number;
  totalPurchased: unknown;
  lastPurchaseDate: Date | null;
};

type SectorRow = {
  id: string;
  externalCode: string | null;
  name: string;
  controlsStock: boolean;
  dreCategoryName: string | null;
  dreGroup: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  purchaseItems: bigint | number;
  totalPurchased: unknown;
  lastPurchaseDate: Date | null;
};

function toNumber(value: unknown) {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function fmtMoney(value: unknown) {
  return toNumber(value).toFixed(2);
}

function fmtDate(value: Date | null) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath: string, headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function recommendationForStockButNonCmv(dreGroup: string | null) {
  if (!dreGroup) return "REVIEW_MANUAL";
  if (["DESPESAS_GERAIS", "DESPESAS_OPERACIONAIS", "TARIFAS_PUBLICAS", "TARIFAS_BANCARIAS"].includes(dreGroup)) {
    return "LIKELY_DISABLE_STOCK";
  }
  return "REVIEW_MANUAL";
}

async function main() {
  const [uncategorized, cmvButNoStock, stockButNonCmv, controlledWithoutSector] = await Promise.all([
    prisma.$queryRaw<ReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      LEFT JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND p."dreCategoryId" IS NULL
      GROUP BY p."id", dc."name", dc."dreGroup", s."name", c."name", sc."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<ReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND p."controlsStock" = false
      GROUP BY p."id", dc."name", dc."dreGroup", s."name", c."name", sc."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<ReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND p."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
      GROUP BY p."id", dc."name", dc."dreGroup", s."name", c."name", sc."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<SectorRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        c."name" AS "categoryName",
        sc."name" AS "subcategoryName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      LEFT JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Subcategory" sc ON sc."id" = p."subcategoryId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND p."controlsStock" = true
        AND p."inventorySectorId" IS NULL
      GROUP BY p."id", dc."name", dc."dreGroup", c."name", sc."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const exportDir = path.resolve("..", "exports", `cmv-review-queues-${today}`);
  fs.mkdirSync(exportDir, { recursive: true });

  writeCsv(
    path.join(exportDir, "01-produtos-sem-categoria-dre.csv"),
    [
      "recommended_action",
      "product_id",
      "external_code",
      "product_name",
      "controls_stock",
      "category_name",
      "subcategory_name",
      "sector_name",
      "purchase_items",
      "total_purchased",
      "last_purchase_date",
    ],
    uncategorized.map((row) => ({
      recommended_action: "SET_DRE_CATEGORY_MANUALLY",
      product_id: row.id,
      external_code: row.externalCode ?? "",
      product_name: row.name,
      controls_stock: row.controlsStock ? "true" : "false",
      category_name: row.categoryName ?? "",
      subcategory_name: row.subcategoryName ?? "",
      sector_name: row.sectorName ?? "",
      purchase_items: toNumber(row.purchaseItems),
      total_purchased: fmtMoney(row.totalPurchased),
      last_purchase_date: fmtDate(row.lastPurchaseDate),
    })),
  );

  writeCsv(
    path.join(exportDir, "02-produtos-cmv-com-stock-false.csv"),
    [
      "recommended_action",
      "product_id",
      "external_code",
      "product_name",
      "dre_category_name",
      "dre_group",
      "controls_stock",
      "category_name",
      "subcategory_name",
      "sector_name",
      "purchase_items",
      "total_purchased",
      "last_purchase_date",
    ],
    cmvButNoStock.map((row) => ({
      recommended_action: "REVIEW_ENABLE_STOCK_OR_RECLASSIFY_DRE",
      product_id: row.id,
      external_code: row.externalCode ?? "",
      product_name: row.name,
      dre_category_name: row.dreCategoryName ?? "",
      dre_group: row.dreGroup ?? "",
      controls_stock: row.controlsStock ? "true" : "false",
      category_name: row.categoryName ?? "",
      subcategory_name: row.subcategoryName ?? "",
      sector_name: row.sectorName ?? "",
      purchase_items: toNumber(row.purchaseItems),
      total_purchased: fmtMoney(row.totalPurchased),
      last_purchase_date: fmtDate(row.lastPurchaseDate),
    })),
  );

  writeCsv(
    path.join(exportDir, "03-produtos-stock-true-fora-cmv.csv"),
    [
      "recommended_action",
      "product_id",
      "external_code",
      "product_name",
      "dre_category_name",
      "dre_group",
      "controls_stock",
      "category_name",
      "subcategory_name",
      "sector_name",
      "purchase_items",
      "total_purchased",
      "last_purchase_date",
    ],
    stockButNonCmv.map((row) => ({
      recommended_action: recommendationForStockButNonCmv(row.dreGroup),
      product_id: row.id,
      external_code: row.externalCode ?? "",
      product_name: row.name,
      dre_category_name: row.dreCategoryName ?? "",
      dre_group: row.dreGroup ?? "",
      controls_stock: row.controlsStock ? "true" : "false",
      category_name: row.categoryName ?? "",
      subcategory_name: row.subcategoryName ?? "",
      sector_name: row.sectorName ?? "",
      purchase_items: toNumber(row.purchaseItems),
      total_purchased: fmtMoney(row.totalPurchased),
      last_purchase_date: fmtDate(row.lastPurchaseDate),
    })),
  );

  writeCsv(
    path.join(exportDir, "04-produtos-controlados-sem-setor.csv"),
    [
      "recommended_action",
      "product_id",
      "external_code",
      "product_name",
      "dre_category_name",
      "dre_group",
      "controls_stock",
      "category_name",
      "subcategory_name",
      "purchase_items",
      "total_purchased",
      "last_purchase_date",
    ],
    controlledWithoutSector.map((row) => ({
      recommended_action: "SET_INVENTORY_SECTOR",
      product_id: row.id,
      external_code: row.externalCode ?? "",
      product_name: row.name,
      dre_category_name: row.dreCategoryName ?? "",
      dre_group: row.dreGroup ?? "",
      controls_stock: row.controlsStock ? "true" : "false",
      category_name: row.categoryName ?? "",
      subcategory_name: row.subcategoryName ?? "",
      purchase_items: toNumber(row.purchaseItems),
      total_purchased: fmtMoney(row.totalPurchased),
      last_purchase_date: fmtDate(row.lastPurchaseDate),
    })),
  );

  const summary = [
    "# Filas de Revisao CMV",
    "",
    `Gerado em ${today}.`,
    "",
    `- 01-produtos-sem-categoria-dre.csv: ${uncategorized.length} linha(s)`,
    `- 02-produtos-cmv-com-stock-false.csv: ${cmvButNoStock.length} linha(s)`,
    `- 03-produtos-stock-true-fora-cmv.csv: ${stockButNonCmv.length} linha(s)`,
    `- 04-produtos-controlados-sem-setor.csv: ${controlledWithoutSector.length} linha(s)`,
    "",
    "Legenda de recommended_action:",
    "- SET_DRE_CATEGORY_MANUALLY: classificar produto sem categoria DRE.",
    "- REVIEW_ENABLE_STOCK_OR_RECLASSIFY_DRE: decidir se o produto deve entrar no estoque ou sair de CMV.",
    "- LIKELY_DISABLE_STOCK: forte indicio de que o item e despesa estocada operacional, nao item de CMV.",
    "- REVIEW_MANUAL: exige revisao humana.",
    "- SET_INVENTORY_SECTOR: definir setor para produto controlado.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(exportDir, "README.md"), `${summary}\n`, "utf8");
  console.log(`Filas geradas em: ${exportDir}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
