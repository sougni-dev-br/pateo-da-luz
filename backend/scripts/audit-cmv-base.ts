import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CountRow = { total: bigint | number };
type ProductIssueRow = {
  id: string;
  externalCode: string | null;
  name: string;
  controlsStock: boolean;
  dreCategoryName: string | null;
  dreGroup: string | null;
  sectorName: string | null;
};
type PurchaseItemIssueRow = {
  purchaseId: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  competenceYear: number;
  competenceMonth: number;
  purchaseDate: Date;
  supplierName: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string;
  controlsStock: boolean | null;
  dreCategoryName: string | null;
  dreGroup: string | null;
  totalPrice: unknown;
};
type MixedPurchaseRow = {
  purchaseId: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  competenceYear: number;
  competenceMonth: number;
  cmvItems: bigint | number;
  nonCmvItems: bigint | number;
  uncategorizedItems: bigint | number;
  totalAmount: unknown;
};
type MonthlyComparisonRow = {
  competenceYear: number;
  competenceMonth: number;
  categoryBasedTotal: unknown;
  currentLogicTotal: unknown;
  delta: unknown;
};

function toNumber(value: unknown) {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function fmtMoney(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMonth(year: number, month: number) {
  return `${String(month).padStart(2, "0")}/${year}`;
}

async function scalarCount(query: Promise<CountRow[]>) {
  const [row] = await query;
  return toNumber(row?.total);
}

async function main() {
  const [
    activeProducts,
    activeProductsWithoutDreCategory,
    activeControlledProductsWithoutDreCategory,
    productsCmvGroupControlsStockFalse,
    productsNonCmvGroupControlsStockTrue,
    productsControlledWithoutSector,
    purchaseItemsWithoutProduct,
    purchaseItemsWithoutProductCategory,
    purchaseItemsCmvGroupControlsStockFalse,
    purchaseItemsNonCmvGroupControlsStockTrue,
    mixedPurchases,
    monthComparison,
    sampleProductsWithoutDreCategory,
    sampleProductsCmvGroupControlsStockFalse,
    sampleProductsNonCmvGroupControlsStockTrue,
    samplePurchaseItemsWithoutProductCategory,
    samplePurchaseItemsCmvGroupControlsStockFalse,
    samplePurchaseItemsNonCmvGroupControlsStockTrue,
  ] = await Promise.all([
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product"
      WHERE "isActive" = true
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product"
      WHERE "isActive" = true
        AND "dreCategoryId" IS NULL
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product"
      WHERE "isActive" = true
        AND "controlsStock" = true
        AND "dreCategoryId" IS NULL
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      WHERE p."isActive" = true
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND p."controlsStock" = false
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      WHERE p."isActive" = true
        AND p."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "Product"
      WHERE "isActive" = true
        AND "controlsStock" = true
        AND "inventorySectorId" IS NULL
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      WHERE p."status" <> 'CANCELLED'
        AND pi."productId" IS NULL
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      WHERE p."status" <> 'CANCELLED'
        AND pi."productId" IS NOT NULL
        AND pr."dreCategoryId" IS NULL
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND pr."controlsStock" = false
    `),
    scalarCount(prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS total
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
        AND pr."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
    `),
    prisma.$queryRaw<MixedPurchaseRow[]>`
      SELECT
        p."id" AS "purchaseId",
        p."purchaseNumber",
        p."invoiceNumber",
        p."competenceYear",
        p."competenceMonth",
        COUNT(*) FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS') AS "cmvItems",
        COUNT(*) FILTER (WHERE dc."dreGroup" IS NOT NULL AND dc."dreGroup" <> 'CMV_COMPRAS') AS "nonCmvItems",
        COUNT(*) FILTER (WHERE pr."dreCategoryId" IS NULL) AS "uncategorizedItems",
        p."totalAmount"
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
      GROUP BY p."id"
      HAVING COUNT(*) FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS') > 0
         AND (
           COUNT(*) FILTER (WHERE dc."dreGroup" IS NOT NULL AND dc."dreGroup" <> 'CMV_COMPRAS') > 0
           OR COUNT(*) FILTER (WHERE pr."dreCategoryId" IS NULL) > 0
         )
      ORDER BY p."competenceYear" DESC, p."competenceMonth" DESC, p."purchaseDate" DESC
      LIMIT 15
    `,
    prisma.$queryRaw<MonthlyComparisonRow[]>`
      SELECT
        p."competenceYear",
        p."competenceMonth",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS'), 0) AS "categoryBasedTotal",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE pr."controlsStock" = true), 0) AS "currentLogicTotal",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE pr."controlsStock" = true), 0)
          - COALESCE(SUM(pi."totalPrice") FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS'), 0) AS "delta"
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
      GROUP BY p."competenceYear", p."competenceMonth"
      ORDER BY p."competenceYear" DESC, p."competenceMonth" DESC
      LIMIT 12
    `,
    prisma.$queryRaw<ProductIssueRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName"
      FROM "Product" p
      LEFT JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      WHERE p."isActive" = true
        AND p."dreCategoryId" IS NULL
      ORDER BY p."controlsStock" DESC, p."name" ASC
      LIMIT 10
    `,
    prisma.$queryRaw<ProductIssueRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      WHERE p."isActive" = true
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND p."controlsStock" = false
      ORDER BY p."name" ASC
      LIMIT 10
    `,
    prisma.$queryRaw<ProductIssueRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      WHERE p."isActive" = true
        AND p."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
      ORDER BY p."name" ASC
      LIMIT 10
    `,
    prisma.$queryRaw<PurchaseItemIssueRow[]>`
      SELECT
        p."id" AS "purchaseId",
        p."purchaseNumber",
        p."invoiceNumber",
        p."competenceYear",
        p."competenceMonth",
        p."purchaseDate",
        s."name" AS "supplierName",
        pi."productId",
        pi."rawProductCode" AS "productCode",
        pi."rawProductName" AS "productName",
        pr."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        pi."totalPrice"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
        AND pi."productId" IS NOT NULL
        AND pr."dreCategoryId" IS NULL
      ORDER BY p."purchaseDate" DESC
      LIMIT 10
    `,
    prisma.$queryRaw<PurchaseItemIssueRow[]>`
      SELECT
        p."id" AS "purchaseId",
        p."purchaseNumber",
        p."invoiceNumber",
        p."competenceYear",
        p."competenceMonth",
        p."purchaseDate",
        s."name" AS "supplierName",
        pi."productId",
        pi."rawProductCode" AS "productCode",
        pi."rawProductName" AS "productName",
        pr."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        pi."totalPrice"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND pr."controlsStock" = false
      ORDER BY p."purchaseDate" DESC
      LIMIT 10
    `,
    prisma.$queryRaw<PurchaseItemIssueRow[]>`
      SELECT
        p."id" AS "purchaseId",
        p."purchaseNumber",
        p."invoiceNumber",
        p."competenceYear",
        p."competenceMonth",
        p."purchaseDate",
        s."name" AS "supplierName",
        pi."productId",
        pi."rawProductCode" AS "productCode",
        pi."rawProductName" AS "productName",
        pr."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        pi."totalPrice"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
        AND pr."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
      ORDER BY p."purchaseDate" DESC
      LIMIT 10
    `,
  ]);

  console.log("");
  console.log("AUDITORIA CMV BASE");
  console.log("==================");
  console.log("");
  console.log(`Produtos ativos: ${activeProducts}`);
  console.log(`Produtos ativos sem categoria DRE: ${activeProductsWithoutDreCategory}`);
  console.log(`Produtos ativos controlados sem categoria DRE: ${activeControlledProductsWithoutDreCategory}`);
  console.log(`Produtos CMV_COMPRAS com controlsStock=false: ${productsCmvGroupControlsStockFalse}`);
  console.log(`Produtos controlsStock=true fora do grupo CMV_COMPRAS: ${productsNonCmvGroupControlsStockTrue}`);
  console.log(`Produtos controlsStock=true sem setor: ${productsControlledWithoutSector}`);
  console.log("");
  console.log(`Itens de compra sem productId: ${purchaseItemsWithoutProduct}`);
  console.log(`Itens de compra com produto sem categoria DRE: ${purchaseItemsWithoutProductCategory}`);
  console.log(`Itens de compra CMV_COMPRAS com controlsStock=false: ${purchaseItemsCmvGroupControlsStockFalse}`);
  console.log(`Itens de compra controlsStock=true fora do grupo CMV_COMPRAS: ${purchaseItemsNonCmvGroupControlsStockTrue}`);
  console.log("");

  console.log("COMPARACAO MENSAL");
  console.log("-----------------");
  for (const row of monthComparison) {
    console.log(
      `${fmtMonth(row.competenceYear, row.competenceMonth)} | ` +
      `criterio_categoria=${fmtMoney(row.categoryBasedTotal)} | ` +
      `logica_atual=${fmtMoney(row.currentLogicTotal)} | ` +
      `delta=${fmtMoney(row.delta)}`
    );
  }
  console.log("");

  function printProducts(title: string, rows: ProductIssueRow[]) {
    console.log(title);
    console.log("-".repeat(title.length));
    if (!rows.length) {
      console.log("Nenhum registro.");
      console.log("");
      return;
    }
    for (const row of rows) {
      console.log(
        `${row.externalCode ?? "-"} | ${row.name} | ` +
        `estoque=${row.controlsStock ? "sim" : "nao"} | ` +
        `grupo=${row.dreGroup ?? "-"} | cat=${row.dreCategoryName ?? "-"} | setor=${row.sectorName ?? "-"}`
      );
    }
    console.log("");
  }

  function printPurchaseItems(title: string, rows: PurchaseItemIssueRow[]) {
    console.log(title);
    console.log("-".repeat(title.length));
    if (!rows.length) {
      console.log("Nenhum registro.");
      console.log("");
      return;
    }
    for (const row of rows) {
      console.log(
        `${fmtMonth(row.competenceYear, row.competenceMonth)} | ` +
        `ped=${row.purchaseNumber ?? "-"} nf=${row.invoiceNumber ?? "-"} | ` +
        `${row.productCode ?? "-"} ${row.productName} | ` +
        `estoque=${row.controlsStock == null ? "-" : row.controlsStock ? "sim" : "nao"} | ` +
        `grupo=${row.dreGroup ?? "-"} | total=${fmtMoney(row.totalPrice)}`
      );
    }
    console.log("");
  }

  printProducts("AMOSTRA: PRODUTOS SEM CATEGORIA DRE", sampleProductsWithoutDreCategory);
  printProducts("AMOSTRA: PRODUTOS CMV_COMPRAS COM STOCK FALSE", sampleProductsCmvGroupControlsStockFalse);
  printProducts("AMOSTRA: PRODUTOS STOCK TRUE FORA DE CMV_COMPRAS", sampleProductsNonCmvGroupControlsStockTrue);
  printPurchaseItems("AMOSTRA: ITENS COM PRODUTO SEM CATEGORIA DRE", samplePurchaseItemsWithoutProductCategory);
  printPurchaseItems("AMOSTRA: ITENS CMV_COMPRAS COM STOCK FALSE", samplePurchaseItemsCmvGroupControlsStockFalse);
  printPurchaseItems("AMOSTRA: ITENS STOCK TRUE FORA DE CMV_COMPRAS", samplePurchaseItemsNonCmvGroupControlsStockTrue);

  console.log("COMPRAS MISTAS");
  console.log("--------------");
  if (!mixedPurchases.length) {
    console.log("Nenhuma compra mista encontrada.");
  } else {
    for (const row of mixedPurchases) {
      console.log(
        `${fmtMonth(row.competenceYear, row.competenceMonth)} | ` +
        `ped=${row.purchaseNumber ?? "-"} nf=${row.invoiceNumber ?? "-"} | ` +
        `cmv=${toNumber(row.cmvItems)} nao_cmv=${toNumber(row.nonCmvItems)} sem_cat=${toNumber(row.uncategorizedItems)} | ` +
        `total=${fmtMoney(row.totalAmount)}`
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
