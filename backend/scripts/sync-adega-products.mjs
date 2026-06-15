import { randomUUID } from "node:crypto";
import path from "node:path";

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const expectedAdegaCodes = [
  "777", "476", "959", "674", "673", "467", "675", "881", "676", "762",
  "963", "763", "882", "764", "879", "481", "984", "985", "478", "472",
  "482", "475", "677", "471", "480", "778", "473", "470", "671", "672",
  "479", "477", "474", "468", "1110", "1137", "1138", "1141",
];

const workbookArg = process.argv.find((arg) => arg.startsWith("--workbook="));
const workbookPath = workbookArg
  ? workbookArg.slice("--workbook=".length)
  : "C:/Users/elioe/Downloads/C. PRODUTOS.xlsx";
const shouldApply = process.argv.includes("--apply");

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

async function ensureSector(tx, name) {
  const normalizedName = normalizeText(name);
  const [sector] = await tx.$queryRawUnsafe(
    `
      INSERT INTO "InventorySector" ("id", "name", "normalizedName", "isActive", "updatedAt")
      VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)
      ON CONFLICT ("normalizedName") DO UPDATE SET
        "name" = EXCLUDED."name",
        "isActive" = true,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "name"
    `,
    randomUUID(),
    name,
    normalizedName,
  );
  return sector;
}

async function ensureCategory(tx, name) {
  const category = await tx.category.upsert({
    where: { name },
    update: { isActive: true },
    create: { name, isActive: true },
    select: { id: true, name: true },
  });
  return category;
}

async function ensureSubcategory(tx, categoryId, name) {
  const subcategory = await tx.subcategory.upsert({
    where: { categoryId_name: { categoryId, name } },
    update: { isActive: true },
    create: { categoryId, name, isActive: true },
    select: { id: true, name: true },
  });
  return subcategory;
}

async function ensureUnitMeasure(tx, code) {
  const normalizedCode = cleanText(code).toUpperCase();
  const unit = await tx.unitMeasure.upsert({
    where: { code: normalizedCode },
    update: { isActive: true },
    create: { code: normalizedCode, name: normalizedCode, isActive: true },
    select: { id: true, code: true },
  });
  return unit;
}

async function loadWorkbookRows() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`Nenhuma aba encontrada em ${workbookPath}.`);

  const rowsByCode = new Map();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cleanText(row.getCell(1).value);
    if (!code) return;
    rowsByCode.set(code, {
      externalCode: code,
      name: cleanText(row.getCell(2).value),
      categoryName: cleanText(row.getCell(3).value),
      subcategoryName: cleanText(row.getCell(4).value),
      unit: cleanText(row.getCell(5).value || "UNI").toUpperCase(),
      accountType: cleanText(row.getCell(6).value || "PRODUTO"),
    });
  });

  return rowsByCode;
}

async function buildReport(rowsByCode) {
  const targetRows = expectedAdegaCodes.map((code) => rowsByCode.get(code)).filter(Boolean);
  const missingInWorkbook = expectedAdegaCodes.filter((code) => !rowsByCode.has(code));

  const existingProducts = await prisma.product.findMany({
    where: { externalCode: { in: expectedAdegaCodes } },
    include: {
      inventorySector: { select: { name: true } },
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
    },
    orderBy: { externalCode: "asc" },
  });

  const existingByCode = new Map(existingProducts.map((product) => [String(product.externalCode), product]));
  const currentAdega = await prisma.product.findMany({
    where: { inventorySector: { name: "ADEGA" } },
    select: { externalCode: true, name: true },
    orderBy: { externalCode: "asc" },
  });

  const missingInDatabase = expectedAdegaCodes.filter((code) => !existingByCode.has(code));
  const unexpectedInAdega = currentAdega.filter((product) => !expectedAdegaCodes.includes(String(product.externalCode)));

  return {
    workbookPath: path.resolve(workbookPath),
    expectedAdegaCount: expectedAdegaCodes.length,
    workbookMatches: targetRows.length,
    existingInDatabase: existingProducts.length,
    missingInWorkbook,
    missingInDatabase,
    unexpectedInAdega,
    existingProducts: existingProducts.map((product) => ({
      externalCode: product.externalCode,
      name: product.name,
      sectorName: product.inventorySector?.name ?? null,
      categoryName: product.category?.name ?? null,
      subcategoryName: product.subcategory?.name ?? null,
      isActive: product.isActive,
      controlsStock: product.controlsStock,
    })),
  };
}

async function applySync(rowsByCode) {
  const rows = expectedAdegaCodes.map((code) => rowsByCode.get(code));
  const missing = expectedAdegaCodes.filter((code) => !rowsByCode.has(code));
  if (missing.length > 0) {
    throw new Error(`Codigos ausentes na planilha: ${missing.join(", ")}`);
  }

  return prisma.$transaction(async (tx) => {
    const sector = await ensureSector(tx, "ADEGA");
    const category = await ensureCategory(tx, "BEBIDAS");
    const subcategory = await ensureSubcategory(tx, category.id, "VINHO");
    const unit = await ensureUnitMeasure(tx, "UNI");

    let created = 0;
    let updated = 0;
    const touched = [];

    for (const row of rows) {
      const existing = await tx.product.findFirst({
        where: { externalCode: row.externalCode },
        select: { id: true, name: true },
      });

      const data = {
        externalCode: row.externalCode,
        name: row.name,
        normalizedName: normalizeText(row.name),
        unit: unit.code,
        unitMeasureId: unit.id,
        accountType: row.accountType || "PRODUTO",
        controlsStock: true,
        isActive: true,
        categoryId: category.id,
        subcategoryId: subcategory.id,
        inventorySectorId: sector.id,
      };

      let productId;
      if (existing) {
        await tx.product.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
        productId = existing.id;
      } else {
        const createdProduct = await tx.product.create({ data, select: { id: true } });
        created += 1;
        productId = createdProduct.id;
      }

      await tx.productAlias.upsert({
        where: { normalizedAlias: normalizeText(row.name) },
        update: { alias: row.name, productId },
        create: { alias: row.name, normalizedAlias: normalizeText(row.name), productId },
      });

      touched.push({ externalCode: row.externalCode, name: row.name });
    }

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        action: "SYNC_ADEGA_PRODUCTS_FROM_WORKBOOK",
        entity: "Product",
        entityId: sector.id,
        newValue: {
          workbookPath: path.resolve(workbookPath),
          expectedAdegaCount: expectedAdegaCodes.length,
          created,
          updated,
          externalCodes: expectedAdegaCodes,
        },
      },
    });

    return { created, updated, touched };
  });
}

async function main() {
  const rowsByCode = await loadWorkbookRows();
  const report = await buildReport(rowsByCode);
  console.log(JSON.stringify({ mode: shouldApply ? "apply" : "dry-run", report }, null, 2));

  if (!shouldApply) return;

  if (report.unexpectedInAdega.length > 0) {
    throw new Error("Existem produtos extras na ADEGA fora da lista oficial. Corrija manualmente antes de aplicar.");
  }

  const result = await applySync(rowsByCode);

  const [after] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total
    FROM "Product" p
    JOIN "InventorySector" sec ON sec."id" = p."inventorySectorId"
    WHERE sec."name" = 'ADEGA'
      AND p."isActive" = true
      AND p."controlsStock" = true
  `);

  console.log(JSON.stringify({ applied: result, adegaAfter: after.total }, null, 2));
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
