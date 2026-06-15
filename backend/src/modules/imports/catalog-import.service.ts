import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, type Product } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import {
  getCell,
  getRecognizedColumns,
  getMissingRequiredFields,
  resolveColumns,
  ResolvedColumnMap
} from "./column-mapping/column-resolver.js";
import {
  ProductCatalogField,
  productCatalogMapping
} from "./column-mapping/product-catalog.mapping.js";
import {
  SupplierCatalogField,
  supplierCatalogMapping
} from "./column-mapping/supplier-catalog.mapping.js";
import { readWorkbookSheetNames, readWorksheetRows } from "./excel-reader.service.js";
import { officialInventorySectorName } from "../master-data/inventory-sector-utils.js";

type CatalogKind = "suppliers" | "products";

type ImportWarning = {
  rowNumber: number;
  message: string;
};

type ImportError = {
  rowNumber: number;
  message: string;
};

type SupplierCatalogRow = {
  rowNumber: number;
  code: string | null;
  document: string | null;
  name: string;
  registrationDate: Date | null;
};

type ProductCatalogRow = {
  rowNumber: number;
  code: string | null;
  description: string;
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  sectorName: string | null;
  storageLocation: string | null;
  storageCorridor: string | null;
  storageShelf: string | null;
  storagePosition: string | null;
  storageNotes: string | null;
  accountType: string | null;
  controlsStock: boolean;
  missingSector: boolean;
  countableInGeneral: boolean;
  countableInSectoral: boolean;
  countabilityReasons: string[];
};

type ProductCatalogCaches = {
  productsByCode: Map<string, Product>;
  productsByName: Map<string, Product>;
  productsById: Map<string, Product>;
  productIdByAlias: Map<string, string>;
  categoriesByName: Map<string, { id: string; name: string }>;
  subcategoriesByKey: Map<string, { id: string; name: string; categoryId: string }>;
  unitsByCode: Map<string, { id: string; code: string }>;
  sectorsByName: Map<string, { id: string; name: string; normalizedName: string }>;
};

type CatalogRow = SupplierCatalogRow | ProductCatalogRow;

type CatalogPreview = {
  kind: CatalogKind;
  sheetNames: string[];
  sheetName: string | null;
  totalRows: number;
  importFileId: string;
  originalFileName: string | null;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  missingRequiredFields: string[];
  validation: {
    spreadsheetRows: number;
    emptyRowsIgnored: number;
    recognizedRows: number;
    validRows: number;
    ignoredRows: number;
    rowsWithCode: number;
    rowsWithoutCode: number;
    existingByCode: number;
    existingByName: number;
    newRows: number;
    withoutSector: number;
    withoutControlsStock: number;
    notCountableRows: number;
  };
  warnings: ImportWarning[];
  errors: ImportError[];
  ignoredRowDetails: Array<{
    rowNumber: number;
    code: string | null;
    label: string | null;
    reason: string;
  }>;
  previewRows: CatalogRow[];
};

type CatalogImportReport = {
  importBatchId: string | null;
  totalRows: number;
  recognizedRows: number;
  validRows: number;
  processedRows: number;
  importedRows: number;
  createdRows: number;
  updatedRows: number;
  reusedRows: number;
  ignoredRows: number;
  withoutSector: number;
  withoutControlsStock: number;
  notCountableRows: number;
  ignoredReasons: Array<{ reason: string; count: number }>;
  errors: ImportError[];
  warnings: ImportWarning[];
  ignoredRowDetails: Array<{
    rowNumber: number;
    code: string | null;
    label: string | null;
    reason: string;
  }>;
};

function safeUploadPath(importFileId: string): string {
  return path.resolve("uploads", path.basename(importFileId));
}

function catalogBatchImportFileId(importFileId: string, batchId: string): string {
  return `${path.basename(importFileId)}#${batchId}`;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function shouldControlStock(sectorName?: string | null, accountType?: string | null) {
  const sector = normalizeText(sectorName);
  const account = normalizeText(accountType);
  if (sector === "nao bater est" || sector === "nao bater estoque") return false;
  if (account === "custo fixo" || account === "custo variavel") return false;
  return true;
}

function detectedColumns<T extends string>(columns: ResolvedColumnMap<T>) {
  return Object.fromEntries(
    Object.entries(columns).filter(([, column]) => Boolean(column))
  ) as Record<string, string>;
}

function getUnrecognizedColumns<T extends string>(headers: string[], columns: ResolvedColumnMap<T>) {
  const recognized = new Set(Object.values(columns).filter(Boolean));
  return headers.filter((header) => header && header !== "__rowNumber" && !recognized.has(header));
}

function getUnrecognizedMappedColumns<T extends string>(headers: string[], mapping: Record<T, string[]>, columns: ResolvedColumnMap<T>) {
  const recognized = getRecognizedColumns(headers, mapping, columns);
  return headers.filter((header) => header && header !== "__rowNumber" && !recognized.has(header));
}

function mapSupplierRows(rows: Record<string, unknown>[], columns: ResolvedColumnMap<SupplierCatalogField>) {
  return rows.map<SupplierCatalogRow>((row, index) => ({
    rowNumber: Number(row.__rowNumber ?? index + 2),
    code: asText(getCell(row, columns, "supplierCode")),
    document: asText(getCell(row, columns, "supplierDocument")),
    name: asText(getCell(row, columns, "supplierName")) ?? "",
    registrationDate: parseDate(getCell(row, columns, "registrationDate"))
  }));
}

function mapProductRows(rows: Record<string, unknown>[], columns: ResolvedColumnMap<ProductCatalogField>) {
  return rows.map<ProductCatalogRow>((row, index) => {
    const rawSectorName = asText(getCell(row, columns, "sectorName"));
    const sectorName = officialInventorySectorName(rawSectorName);
    return {
      rowNumber: Number(row.__rowNumber ?? index + 2),
      code: asText(getCell(row, columns, "productCode")),
      description: asText(getCell(row, columns, "productDescription")) ?? "",
      categoryName: asText(getCell(row, columns, "categoryName")),
      subcategoryName: asText(getCell(row, columns, "subcategoryName")),
      unit: asText(getCell(row, columns, "unit")),
      sectorName,
      storageLocation: asText(getCell(row, columns, "storageLocation")),
      storageCorridor: asText(getCell(row, columns, "storageCorridor")),
      storageShelf: asText(getCell(row, columns, "storageShelf")),
      storagePosition: asText(getCell(row, columns, "storagePosition")),
      storageNotes: asText(getCell(row, columns, "storageNotes")),
      accountType: asText(getCell(row, columns, "accountType")),
      controlsStock: shouldControlStock(
        sectorName,
        asText(getCell(row, columns, "accountType"))
      ),
      missingSector: !sectorName,
      countableInGeneral: shouldControlStock(
        sectorName,
        asText(getCell(row, columns, "accountType"))
      ),
      countableInSectoral: Boolean(sectorName)
        && shouldControlStock(
          sectorName,
          asText(getCell(row, columns, "accountType"))
        ),
      countabilityReasons: [
        ...(!sectorName ? [rawSectorName ? "SETOR_INVALIDO" : "SEM_SETOR"] : []),
        ...(!shouldControlStock(
          sectorName,
          asText(getCell(row, columns, "accountType"))
        ) ? ["SEM_CONTROLE_ESTOQUE"] : [])
      ]
    };
  });
}

async function updateProductStorageFields(tx: TransactionClient, productId: string, row: ProductCatalogRow) {
  await tx.$executeRaw`
    UPDATE "Product"
    SET
      "stockUnit" = ${row.unit},
      "purchaseUnit" = ${row.unit},
      "storageLocation" = ${row.storageLocation},
      "storageCorridor" = ${row.storageCorridor},
      "storageShelf" = ${row.storageShelf},
      "storagePosition" = ${row.storagePosition},
      "storageNotes" = ${row.storageNotes}
    WHERE "id" = ${productId}
  `;
}

function getRelationshipWarnings(
  rows: Array<{ rowNumber: number; code: string | null; name: string }>
) {
  const warnings: ImportWarning[] = [];
  const codeNames = new Map<string, Set<string>>();
  const nameCodes = new Map<string, Set<string>>();

  for (const row of rows) {
    const normalizedName = normalizeText(row.name);
    if (!row.code) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: "Registro sem codigo original. O nome normalizado sera usado apenas como fallback."
      });
    }

    if (row.code) {
      const names = codeNames.get(row.code) ?? new Set<string>();
      if (normalizedName) names.add(normalizedName);
      codeNames.set(row.code, names);
    }

    if (normalizedName && row.code) {
      const codes = nameCodes.get(normalizedName) ?? new Set<string>();
      codes.add(row.code);
      nameCodes.set(normalizedName, codes);
    }
  }

  codeNames.forEach((names, code) => {
    if (names.size > 1) {
      warnings.push({ rowNumber: 0, message: `Mesmo codigo com nomes diferentes: ${code}.` });
    }
  });

  nameCodes.forEach((codes, name) => {
    if (codes.size > 1) {
      warnings.push({
        rowNumber: 0,
        message: `Mesmo nome com codigos diferentes: ${name} (${[...codes].join(", ")}).`
      });
    }
  });

  return warnings;
}

async function getSupplierDbWarnings(rows: SupplierCatalogRow[]) {
  const warnings: ImportWarning[] = [];
  const codes = rows.map((row) => row.code).filter(Boolean) as string[];
  const names = rows.map((row) => row.name).filter(Boolean);
  const [suppliersByCode, suppliersByName] = await Promise.all([
    prisma.supplier.findMany({ where: { externalCode: { in: codes } } }),
    prisma.supplier.findMany({ where: { name: { in: names } } })
  ]);
  const byCode = new Map(suppliersByCode.map((supplier) => [supplier.externalCode, supplier]));
  const byName = new Map(suppliersByName.map((supplier) => [normalizeText(supplier.name), supplier]));

  for (const row of rows) {
    const existingByCode = row.code ? byCode.get(row.code) : null;
    if (existingByCode && normalizeText(existingByCode.name) !== normalizeText(row.name)) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: `Codigo ${row.code} ja existe com outro nome: ${existingByCode.name}.`
      });
    }

    const existingByName = byName.get(normalizeText(row.name));
    if (existingByName?.externalCode && row.code && existingByName.externalCode !== row.code) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: `Nome ${row.name} ja existe com outro codigo: ${existingByName.externalCode}.`
      });
    }
  }

  return warnings;
}

async function getProductDbWarnings(rows: ProductCatalogRow[]) {
  const warnings: ImportWarning[] = [];
  const codes = rows.map((row) => row.code).filter(Boolean) as string[];
  const normalizedNames = rows.map((row) => normalizeText(row.description)).filter(Boolean);
  const [productsByCode, productsByName] = await Promise.all([
    prisma.product.findMany({ where: { externalCode: { in: codes } } }),
    prisma.product.findMany({ where: { normalizedName: { in: normalizedNames } } })
  ]);
  const byCode = new Map(productsByCode.map((product) => [product.externalCode, product]));
  const byName = new Map(productsByName.map((product) => [product.normalizedName, product]));

  for (const row of rows) {
    const existingByCode = row.code ? byCode.get(row.code) : null;
    if (existingByCode && existingByCode.normalizedName !== normalizeText(row.description)) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: `Codigo ${row.code} ja existe com outro produto: ${existingByCode.name}.`
      });
    }

    const existingByName = byName.get(normalizeText(row.description));
    if (existingByName?.externalCode && row.code && existingByName.externalCode !== row.code) {
      warnings.push({
        rowNumber: row.rowNumber,
        message: `Produto ${row.description} ja existe com outro codigo: ${existingByName.externalCode}.`
      });
    }
  }

  return warnings;
}

function getProductSectorWarnings(rows: ProductCatalogRow[]) {
  return rows
    .filter((row) => row.countabilityReasons.includes("SETOR_INVALIDO"))
    .map((row) => ({
      rowNumber: row.rowNumber,
      message: `Setor invalido para o produto ${row.description || row.code || "sem descricao"}. O setor sera tratado como ausente.`
    }));
}

async function summarizeSupplierRows(rows: SupplierCatalogRow[]) {
  const codes = rows.map((row) => row.code).filter(Boolean) as string[];
  const names = rows.map((row) => row.name).filter(Boolean);
  const [existingByCode, existingByName] = await Promise.all([
    prisma.supplier.count({ where: { externalCode: { in: codes } } }),
    prisma.supplier.count({ where: { name: { in: names } } })
  ]);

  return {
    rowsWithCode: codes.length,
    rowsWithoutCode: rows.length - codes.length,
    existingByCode,
    existingByName,
    newRows: Math.max(rows.length - existingByCode - existingByName, 0)
  };
}

async function summarizeProductRows(rows: ProductCatalogRow[]) {
  const codes = rows.map((row) => row.code).filter(Boolean) as string[];
  const normalizedNames = rows.map((row) => normalizeText(row.description)).filter(Boolean);
  const [existingByCode, existingByName] = await Promise.all([
    prisma.product.count({ where: { externalCode: { in: codes } } }),
    prisma.product.count({ where: { normalizedName: { in: normalizedNames } } })
  ]);

  return {
    rowsWithCode: codes.length,
    rowsWithoutCode: rows.length - codes.length,
    existingByCode,
    existingByName,
    newRows: Math.max(rows.length - existingByCode - existingByName, 0)
  };
}

function supplierErrors(rows: SupplierCatalogRow[]) {
  return rows
    .filter((row) => !row.name)
    .map((row) => ({ rowNumber: row.rowNumber, message: "Nome do fornecedor ausente." }));
}

function productErrors(rows: ProductCatalogRow[]) {
  return rows
    .filter((row) => !row.description)
    .map((row) => ({ rowNumber: row.rowNumber, message: "Descricao do produto ausente." }));
}

function countErrorsByRow<T extends { rowNumber: number }>(rows: T[], errors: ImportError[]) {
  const errorRows = new Set(errors.map((item) => item.rowNumber));
  return rows.filter((row) => errorRows.has(row.rowNumber)).length;
}

function getValidRows<T extends { rowNumber: number }>(rows: T[], errors: ImportError[]) {
  const errorRows = new Set(errors.map((item) => item.rowNumber));
  return rows.filter((row) => !errorRows.has(row.rowNumber));
}

function getIgnoredRowDetails(rows: CatalogRow[], errors: ImportError[]) {
  const rowMap = new Map(rows.map((row) => [row.rowNumber, row]));
  return errors.map((error) => {
    const row = rowMap.get(error.rowNumber);
    const label = row
      ? ("description" in row ? row.description : row.name)
      : null;

    return {
      rowNumber: error.rowNumber,
      code: row?.code ?? null,
      label: label || null,
      reason: error.message
    };
  });
}

function countProductDiagnostics(rows: ProductCatalogRow[]) {
  const withoutSector = rows.filter((row) => row.missingSector).length;
  const withoutControlsStock = rows.filter((row) => !row.controlsStock).length;
  const notCountableRows = rows.filter((row) => !row.countableInSectoral).length;
  return { withoutSector, withoutControlsStock, notCountableRows };
}

function pushReason(counter: Map<string, number>, reason: string) {
  counter.set(reason, (counter.get(reason) ?? 0) + 1);
}

function reasonsFromCounter(counter: Map<string, number>) {
  return [...counter.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function reportWithBase(
  errors: ImportError[],
  warnings: ImportWarning[],
  base?: Partial<CatalogImportReport>
) {
  return {
    importBatchId: null,
    totalRows: 0,
    recognizedRows: 0,
    validRows: 0,
    processedRows: 0,
    importedRows: 0,
    createdRows: 0,
    updatedRows: 0,
    reusedRows: 0,
    ignoredRows: 0,
    withoutSector: 0,
    withoutControlsStock: 0,
    notCountableRows: 0,
    ignoredReasons: [],
    errors,
    warnings,
    ignoredRowDetails: [],
    ...base
  } satisfies CatalogImportReport;
}

export async function previewSupplierCatalog(filePath: string, originalFileName: string | null, sheetName?: string | null) {
  const [sheetNames, worksheet] = await Promise.all([
    readWorkbookSheetNames(filePath),
    readWorksheetRows(filePath, sheetName)
  ]);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]) : [];
  const columns = resolveColumns(headers, supplierCatalogMapping, worksheet.rows);
  const missingRequiredFields = getMissingRequiredFields(columns, ["supplierName"]);
  const rows = mapSupplierRows(worksheet.rows, columns);

  const warnings = [
    ...getRelationshipWarnings(rows.map((row) => ({ rowNumber: row.rowNumber, code: row.code, name: row.name }))),
    ...(await getSupplierDbWarnings(rows))
  ];
  const errors = supplierErrors(rows);
  const summary = await summarizeSupplierRows(rows);
  const validRows = getValidRows(rows, errors);

  return {
    kind: "suppliers",
    sheetNames,
    sheetName: worksheet.sheetName,
    totalRows: rows.length,
    importFileId: path.basename(filePath),
    originalFileName,
    detectedColumns: detectedColumns(columns),
    unrecognizedColumns: getUnrecognizedColumns(headers, columns),
    missingRequiredFields,
    validation: {
      spreadsheetRows: rows.length + Number(worksheet.emptyRowsIgnored ?? 0),
      emptyRowsIgnored: Number(worksheet.emptyRowsIgnored ?? 0),
      recognizedRows: rows.length,
      validRows: validRows.length,
      ignoredRows: rows.length - validRows.length,
      withoutSector: 0,
      withoutControlsStock: 0,
      notCountableRows: 0,
      ...summary
    },
    warnings,
    errors,
    ignoredRowDetails: getIgnoredRowDetails(rows, errors),
    previewRows: validRows.slice(0, 20)
  } satisfies CatalogPreview;
}

export async function previewProductCatalog(filePath: string, originalFileName: string | null, sheetName?: string | null) {
  const [sheetNames, worksheet] = await Promise.all([
    readWorkbookSheetNames(filePath),
    readWorksheetRows(filePath, sheetName)
  ]);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]) : [];
  const columns = resolveColumns(headers, productCatalogMapping, worksheet.rows);
  const missingRequiredFields = getMissingRequiredFields(columns, ["productDescription"]);
  const rows = mapProductRows(worksheet.rows, columns);

  const warnings = [
    ...getRelationshipWarnings(rows.map((row) => ({
      rowNumber: row.rowNumber,
      code: row.code,
      name: row.description
    }))),
    ...getProductSectorWarnings(rows),
    ...(await getProductDbWarnings(rows))
  ];
  const errors = productErrors(rows);
  const summary = await summarizeProductRows(rows);
  const validRows = getValidRows(rows, errors);
  const diagnostics = countProductDiagnostics(validRows);

  return {
    kind: "products",
    sheetNames,
    sheetName: worksheet.sheetName,
    totalRows: rows.length,
    importFileId: path.basename(filePath),
    originalFileName,
    detectedColumns: detectedColumns(columns),
    unrecognizedColumns: getUnrecognizedMappedColumns(headers, productCatalogMapping, columns),
    missingRequiredFields,
    validation: {
      spreadsheetRows: rows.length + Number(worksheet.emptyRowsIgnored ?? 0),
      emptyRowsIgnored: Number(worksheet.emptyRowsIgnored ?? 0),
      recognizedRows: rows.length,
      validRows: validRows.length,
      ignoredRows: rows.length - validRows.length,
      withoutSector: diagnostics.withoutSector,
      withoutControlsStock: diagnostics.withoutControlsStock,
      notCountableRows: diagnostics.notCountableRows,
      ...summary
    },
    warnings,
    errors,
    ignoredRowDetails: getIgnoredRowDetails(rows, errors),
    previewRows: validRows.slice(0, 20)
  } satisfies CatalogPreview;
}

async function findSupplierFallback(tx: TransactionClient, row: SupplierCatalogRow) {
  if (row.code) {
    const supplier = await tx.supplier.findFirst({ where: { externalCode: row.code } });
    if (supplier) return supplier;
  }

  if (row.document) {
    const supplier = await tx.supplier.findFirst({ where: { document: row.document } });
    if (supplier) return supplier;
  }

  return tx.supplier.findFirst({ where: { name: { equals: row.name, mode: "insensitive" } } });
}

async function findProductFallback(tx: TransactionClient, row: ProductCatalogRow) {
  if (row.code) {
    const product = await tx.product.findFirst({ where: { externalCode: row.code } });
    if (product) return product;
  }

  const normalizedName = normalizeText(row.description);
  const product = await tx.product.findFirst({ where: { normalizedName } });
  if (product) return product;

  const alias = await tx.productAlias.findUnique({ where: { normalizedAlias: normalizedName } });
  if (!alias) return null;

  return tx.product.findUnique({ where: { id: alias.productId } });
}

function findProductFallbackFromCache(row: ProductCatalogRow, caches: ProductCatalogCaches) {
  if (row.code) {
    const product = caches.productsByCode.get(row.code);
    if (product) return product;
  }

  const normalizedName = normalizeText(row.description);
  const product = caches.productsByName.get(normalizedName);
  if (product) return product;

  const aliasProductId = caches.productIdByAlias.get(normalizedName);
  if (!aliasProductId) return null;

  return caches.productsById.get(aliasProductId) ?? null;
}

async function findOrCreateCategory(tx: TransactionClient, name?: string | null) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;
  return tx.category.upsert({
    where: { name: cleanName },
    create: { name: cleanName },
    update: {}
  });
}

async function findOrCreateCategoryCached(
  tx: TransactionClient,
  caches: ProductCatalogCaches,
  name?: string | null
) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;

  const existing = caches.categoriesByName.get(cleanName);
  if (existing) return existing;

  const created = await tx.category.upsert({
    where: { name: cleanName },
    create: { name: cleanName },
    update: {}
  });
  caches.categoriesByName.set(cleanName, created);
  return created;
}

async function findOrCreateSubcategory(tx: TransactionClient, name?: string | null, categoryId?: string) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName || !categoryId) return null;
  return tx.subcategory.upsert({
    where: { categoryId_name: { categoryId, name: cleanName } },
    create: { categoryId, name: cleanName },
    update: {}
  });
}

async function findOrCreateSubcategoryCached(
  tx: TransactionClient,
  caches: ProductCatalogCaches,
  name?: string | null,
  categoryId?: string
) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName || !categoryId) return null;

  const key = `${categoryId}:${cleanName}`;
  const existing = caches.subcategoriesByKey.get(key);
  if (existing) return existing;

  const created = await tx.subcategory.upsert({
    where: { categoryId_name: { categoryId, name: cleanName } },
    create: { categoryId, name: cleanName },
    update: {}
  });
  caches.subcategoriesByKey.set(key, created);
  return created;
}

async function findOrCreateUnit(tx: TransactionClient, code?: string | null) {
  const cleanCode = String(code ?? "").trim().toUpperCase();
  if (!cleanCode) return null;
  return tx.unitMeasure.upsert({
    where: { code: cleanCode },
    create: { code: cleanCode, name: cleanCode },
    update: {}
  });
}

async function findOrCreateUnitCached(
  tx: TransactionClient,
  caches: ProductCatalogCaches,
  code?: string | null
) {
  const cleanCode = String(code ?? "").trim().toUpperCase();
  if (!cleanCode) return null;

  const existing = caches.unitsByCode.get(cleanCode);
  if (existing) return existing;

  const created = await tx.unitMeasure.upsert({
    where: { code: cleanCode },
    create: { code: cleanCode, name: cleanCode },
    update: {}
  });
  caches.unitsByCode.set(cleanCode, created);
  return created;
}

async function findOrCreateSectorCached(
  tx: TransactionClient,
  caches: ProductCatalogCaches,
  name?: string | null
) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;
  const normalizedName = normalizeText(cleanName);
  const existing = caches.sectorsByName.get(normalizedName);
  if (existing) return existing;

  const [created] = await tx.$queryRaw<Array<{ id: string; name: string; normalizedName: string }>>`
    INSERT INTO "InventorySector" ("id", "name", "normalizedName", "updatedAt")
    VALUES (${randomUUID()}, ${cleanName}, ${normalizedName}, CURRENT_TIMESTAMP)
    ON CONFLICT ("normalizedName") DO UPDATE SET
      "name" = EXCLUDED."name",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id", "name", "normalizedName"
  `;
  caches.sectorsByName.set(normalizedName, created);
  return created;
}

type SupplierSnapshot = {
  externalCode: string | null;
  document: string | null;
  name: string;
  registrationDate: Date | null;
  isActive: boolean;
  notes: string | null;
};

async function selectSupplierSnapshot(tx: TransactionClient, id: string) {
  const [supplier] = await tx.$queryRaw<SupplierSnapshot[]>`
    SELECT
      "externalCode",
      "document",
      "name",
      "registrationDate",
      "isActive",
      "notes"
    FROM "Supplier"
    WHERE "id" = ${id}
  `;
  return supplier;
}

async function updateSupplierRegistrationDate(tx: TransactionClient, id: string, registrationDate: Date | null) {
  await tx.$executeRaw`
    UPDATE "Supplier"
    SET "registrationDate" = ${registrationDate}
    WHERE "id" = ${id}
  `;
}

function productSnapshot(product: Product) {
  return {
    externalCode: product.externalCode,
    name: product.name,
    normalizedName: product.normalizedName,
    unit: product.unit,
    unitMeasureId: product.unitMeasureId,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    inventorySectorId: product.inventorySectorId,
    accountType: product.accountType,
    controlsStock: product.controlsStock,
    isActive: product.isActive,
    notes: product.notes
  };
}

function rememberProduct(caches: ProductCatalogCaches, product: Product) {
  caches.productsById.set(product.id, product);
  if (product.externalCode) caches.productsByCode.set(product.externalCode, product);
  caches.productsByName.set(product.normalizedName, product);
}

async function buildProductCatalogCaches(rows: ProductCatalogRow[]): Promise<ProductCatalogCaches> {
  const codes = [...new Set(rows.map((row) => row.code).filter(Boolean) as string[])];
  const normalizedNames = [...new Set(rows.map((row) => normalizeText(row.description)).filter(Boolean))];
  const categoryNames = [...new Set(rows.map((row) => String(row.categoryName ?? "").trim()).filter(Boolean))];
  const unitCodes = [...new Set(rows.map((row) => String(row.unit ?? "").trim().toUpperCase()).filter(Boolean))];
  const sectorNames = [...new Set(rows.map((row) => normalizeText(row.sectorName)).filter(Boolean))];

  const [productsByCode, productsByName, aliases, categories, units, sectors] = await Promise.all([
    codes.length ? prisma.product.findMany({ where: { externalCode: { in: codes } } }) : [],
    normalizedNames.length ? prisma.product.findMany({ where: { normalizedName: { in: normalizedNames } } }) : [],
    normalizedNames.length
      ? prisma.productAlias.findMany({ where: { normalizedAlias: { in: normalizedNames } } })
      : [],
    categoryNames.length ? prisma.category.findMany({ where: { name: { in: categoryNames } } }) : [],
    unitCodes.length ? prisma.unitMeasure.findMany({ where: { code: { in: unitCodes } } }) : [],
    sectorNames.length
      ? prisma.$queryRaw<Array<{ id: string; name: string; normalizedName: string }>>`
          SELECT "id", "name", "normalizedName" FROM "InventorySector"
          WHERE "normalizedName" IN (${Prisma.join(sectorNames)})
        `
      : []
  ]);

  const aliasProductIds = [...new Set(aliases.map((alias) => alias.productId))];
  const productsByAlias = aliasProductIds.length
    ? await prisma.product.findMany({ where: { id: { in: aliasProductIds } } })
    : [];
  const allProducts = [...productsByCode, ...productsByName, ...productsByAlias];
  const categoryIds = categories.map((category) => category.id);
  const subcategories = categoryIds.length
    ? await prisma.subcategory.findMany({ where: { categoryId: { in: categoryIds } } })
    : [];

  const caches: ProductCatalogCaches = {
    productsByCode: new Map(),
    productsByName: new Map(),
    productsById: new Map(),
    productIdByAlias: new Map(aliases.map((alias) => [alias.normalizedAlias, alias.productId])),
    categoriesByName: new Map(categories.map((category) => [category.name, category])),
    subcategoriesByKey: new Map(
      subcategories.map((subcategory) => [`${subcategory.categoryId}:${subcategory.name}`, subcategory])
    ),
    unitsByCode: new Map(units.map((unit) => [unit.code, unit])),
    sectorsByName: new Map(sectors.map((sector) => [sector.normalizedName, sector]))
  };

  for (const product of allProducts) {
    rememberProduct(caches, product);
  }

  return caches;
}

export async function confirmSupplierCatalogImport(
  importFileId: string,
  originalFileName: string | null,
  sheetName: string | null,
  updateExisting: boolean
) {
  const filePath = safeUploadPath(importFileId);
  const worksheet = await readWorksheetRows(filePath, sheetName);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]) : [];
  const columns = resolveColumns(headers, supplierCatalogMapping, worksheet.rows);
  const rows = mapSupplierRows(worksheet.rows, columns);
  const errors = supplierErrors(rows);
  const validRows = getValidRows(rows, errors);
  const warnings: ImportWarning[] = [
    ...getRelationshipWarnings(rows.map((row) => ({ rowNumber: row.rowNumber, code: row.code, name: row.name }))),
    ...(await getSupplierDbWarnings(rows))
  ];
  const baseReport = reportWithBase(errors, warnings, {
    totalRows: rows.length,
    recognizedRows: rows.length,
    validRows: validRows.length,
    processedRows: validRows.length,
    ignoredRows: rows.length - validRows.length,
    ignoredRowDetails: getIgnoredRowDetails(rows, errors)
  });

  if (validRows.length === 0) {
    return baseReport;
  }

  return prisma.$transaction(async (tx) => {
    const batchId = randomUUID();
    const batchImportFileId = catalogBatchImportFileId(importFileId, batchId);
    await tx.$executeRaw`
      INSERT INTO "CatalogImportBatch"
        ("id", "importFileId", "originalFileName", "sheetName", "type", "totalRows", "errors", "warnings")
      VALUES
        (${batchId}, ${batchImportFileId}, ${originalFileName}, ${worksheet.sheetName}, 'SUPPLIERS'::"CatalogImportType",
         ${rows.length}, CAST(${JSON.stringify(errors)} AS jsonb), CAST(${JSON.stringify(warnings)} AS jsonb))
    `;

    const report = reportWithBase(errors, warnings, baseReport);
    report.importBatchId = batchId;
    const ignoredReasons = new Map<string, number>();
    for (const error of errors) {
      pushReason(ignoredReasons, "LINHA_INVALIDA");
    }

    for (const row of validRows) {
      const existing = await findSupplierFallback(tx, row);

      if (existing && !updateExisting) {
        report.ignoredRows += 1;
        warnings.push({ rowNumber: row.rowNumber, message: "Fornecedor existente nao atualizado." });
        report.reusedRows += 1;
        pushReason(ignoredReasons, "EXISTENTE_NAO_ATUALIZADO");
        continue;
      }

      const data = {
        externalCode: row.code,
        document: row.document,
        name: row.name,
        isActive: true
      };

      if (existing) {
        const previousSnapshot = await selectSupplierSnapshot(tx, existing.id);
        const updated = await tx.supplier.update({ where: { id: existing.id }, data });
        await updateSupplierRegistrationDate(tx, updated.id, row.registrationDate);
        const updatedSnapshot = await selectSupplierSnapshot(tx, updated.id);
        await insertCatalogChange(
          tx,
          batchId,
          "UPDATED",
          "SUPPLIERS",
          updated.id,
          previousSnapshot,
          updatedSnapshot
        );
        report.updatedRows += 1;
      } else {
        const created = await tx.supplier.create({ data });
        await updateSupplierRegistrationDate(tx, created.id, row.registrationDate);
        const createdSnapshot = await selectSupplierSnapshot(tx, created.id);
        await insertCatalogChange(
          tx,
          batchId,
          "CREATED",
          "SUPPLIERS",
          created.id,
          null,
          createdSnapshot
        );
        report.createdRows += 1;
      }
    }

    report.importedRows = report.createdRows + report.updatedRows;
    report.ignoredReasons = reasonsFromCounter(ignoredReasons);
    report.ignoredRowDetails = getIgnoredRowDetails(rows, errors);
    await updateCatalogBatchCounters(tx, batchId, report, warnings);

    return report;
  });
}

export async function confirmProductCatalogImport(
  importFileId: string,
  originalFileName: string | null,
  sheetName: string | null,
  updateExisting: boolean
) {
  const filePath = safeUploadPath(importFileId);
  const worksheet = await readWorksheetRows(filePath, sheetName);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]) : [];
  const columns = resolveColumns(headers, productCatalogMapping, worksheet.rows);
  const rows = mapProductRows(worksheet.rows, columns);
  const errors = productErrors(rows);
  const validRows = getValidRows(rows, errors);
  const warnings: ImportWarning[] = [
    ...getRelationshipWarnings(rows.map((row) => ({ rowNumber: row.rowNumber, code: row.code, name: row.description }))),
    ...getProductSectorWarnings(rows),
    ...(await getProductDbWarnings(rows))
  ];
  const diagnostics = countProductDiagnostics(validRows);
  const baseReport = reportWithBase(errors, warnings, {
    totalRows: rows.length,
    recognizedRows: rows.length,
    validRows: validRows.length,
    processedRows: validRows.length,
    ignoredRows: rows.length - validRows.length,
    withoutSector: diagnostics.withoutSector,
    withoutControlsStock: diagnostics.withoutControlsStock,
    notCountableRows: diagnostics.notCountableRows,
    ignoredRowDetails: getIgnoredRowDetails(rows, errors)
  });

  if (validRows.length === 0) {
    return baseReport;
  }

  const batchId = randomUUID();
  const report = reportWithBase(errors, warnings, baseReport);
  report.importBatchId = batchId;
  const caches = await buildProductCatalogCaches(validRows);
  const ignoredReasons = new Map<string, number>();
  for (const error of errors) {
    pushReason(ignoredReasons, "LINHA_INVALIDA");
  }

  await prisma.$transaction(async (tx) => {
    const batchImportFileId = catalogBatchImportFileId(importFileId, batchId);
    await tx.$executeRaw`
      INSERT INTO "CatalogImportBatch"
        ("id", "importFileId", "originalFileName", "sheetName", "type", "totalRows", "errors", "warnings")
      VALUES
        (${batchId}, ${batchImportFileId}, ${originalFileName}, ${worksheet.sheetName}, 'PRODUCTS'::"CatalogImportType",
         ${rows.length}, CAST(${JSON.stringify(errors)} AS jsonb), CAST(${JSON.stringify(warnings)} AS jsonb))
    `;
  });

  for (const row of validRows) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = findProductFallbackFromCache(row, caches);
        const category = await findOrCreateCategoryCached(tx, caches, row.categoryName);
        const subcategory = await findOrCreateSubcategoryCached(
          tx,
          caches,
          row.subcategoryName,
          category?.id
        );
        const unitMeasure = await findOrCreateUnitCached(tx, caches, row.unit);
        const sector = await findOrCreateSectorCached(tx, caches, row.sectorName);

        if (existing && !updateExisting) {
          report.ignoredRows += 1;
          report.reusedRows += 1;
          warnings.push({ rowNumber: row.rowNumber, message: "Produto existente nao atualizado." });
          pushReason(ignoredReasons, "EXISTENTE_NAO_ATUALIZADO");
          return;
        }

        const data = {
          externalCode: row.code,
          name: row.description,
          normalizedName: normalizeText(row.description),
          unit: row.unit,
          unitMeasureId: unitMeasure?.id,
          categoryId: category?.id,
          subcategoryId: subcategory?.id,
          inventorySectorId: sector?.id,
          accountType: row.accountType,
          controlsStock: row.controlsStock,
          isActive: true
        };

        if (existing) {
          const updated = await tx.product.update({ where: { id: existing.id }, data });
          await updateProductStorageFields(tx, updated.id, row);
          await tx.productAlias
            .upsert({
              where: { normalizedAlias: data.normalizedName },
              create: { alias: row.description, normalizedAlias: data.normalizedName, productId: updated.id },
              update: { alias: row.description, productId: updated.id }
            })
            .catch(() => undefined);
          await insertCatalogChange(
            tx,
            batchId,
            "UPDATED",
            "PRODUCTS",
            updated.id,
            productSnapshot(existing),
            productSnapshot(updated)
          );
          rememberProduct(caches, updated);
          caches.productIdByAlias.set(data.normalizedName, updated.id);
          report.updatedRows += 1;
          return;
        }

        const created = await tx.product.create({
          data: {
            ...data,
            aliases: {
              create: { alias: row.description, normalizedAlias: data.normalizedName }
            }
          }
        });
        await updateProductStorageFields(tx, created.id, row);
        await insertCatalogChange(
          tx,
          batchId,
          "CREATED",
          "PRODUCTS",
          created.id,
          null,
          productSnapshot(created)
        );
        rememberProduct(caches, created);
        caches.productIdByAlias.set(data.normalizedName, created.id);
        report.createdRows += 1;
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Erro ao importar produtos.";
      errors.push({
        rowNumber: row.rowNumber,
        message: rawMessage
      });
      report.ignoredRows += 1;
      pushReason(ignoredReasons, "ERRO_AO_PROCESSAR_LINHA");
    }
  }

  report.importedRows = report.createdRows + report.updatedRows;
  report.ignoredReasons = reasonsFromCounter(ignoredReasons);
  report.ignoredRowDetails = getIgnoredRowDetails(rows, errors);

  await prisma.$transaction(async (tx) => {
    await updateCatalogBatchCounters(tx, batchId, report, warnings);
    await tx.$executeRaw`
      UPDATE "CatalogImportBatch"
      SET "errors" = CAST(${JSON.stringify(errors)} AS jsonb)
      WHERE "id" = ${batchId}
    `;
  });

  return report;
}

function emptyReport(errors: ImportError[], warnings: ImportWarning[]): CatalogImportReport {
  return reportWithBase(errors, warnings);
}

export async function undoCatalogImportBatch(importBatchId: string) {
  const [batch] = await prisma.$queryRaw<
    Array<{ id: string; type: string }>
  >`SELECT "id", "type"::text AS "type" FROM "CatalogImportBatch" WHERE "id" = ${importBatchId}`;

  if (!batch) {
    throw new Error("Lote de cadastro nao encontrado.");
  }

  const changes = await prisma.$queryRaw<
    Array<{
      id: string;
      action: "CREATED" | "UPDATED";
      entityType: "SUPPLIERS" | "PRODUCTS";
      entityId: string;
      previousData: Prisma.JsonValue | null;
    }>
  >`
    SELECT
      "id",
      "action"::text AS "action",
      "entityType"::text AS "entityType",
      "entityId",
      "previousData"
    FROM "CatalogImportChange"
    WHERE "batchId" = ${importBatchId}
    ORDER BY "createdAt" DESC
  `;

  const errors: string[] = [];
  let undoneChanges = 0;

  for (const change of changes) {
    try {
      if (change.entityType === "SUPPLIERS") {
        if (change.action === "CREATED") {
          await prisma.supplier.delete({ where: { id: change.entityId } });
        } else {
          const previous = change.previousData as SupplierSnapshot;
          await prisma.$executeRaw`
            UPDATE "Supplier"
            SET
              "externalCode" = ${previous.externalCode},
              "document" = ${previous.document},
              "name" = ${previous.name},
              "registrationDate" = ${previous.registrationDate},
              "isActive" = ${previous.isActive},
              "notes" = ${previous.notes}
            WHERE "id" = ${change.entityId}
          `;
        }
      }

      if (change.entityType === "PRODUCTS") {
        if (change.action === "CREATED") {
          await prisma.$executeRaw`DELETE FROM "ProductUnitConversion" WHERE "productId" = ${change.entityId}`;
          await prisma.productAlias.deleteMany({ where: { productId: change.entityId } });
          await prisma.product.delete({ where: { id: change.entityId } });
        } else {
          await prisma.product.update({
            where: { id: change.entityId },
            data: change.previousData as Prisma.ProductUpdateInput
          });
        }
      }

      undoneChanges += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Erro ao desfazer alteracao.");
    }
  }

  if (errors.length === 0) {
    await prisma.$executeRaw`DELETE FROM "CatalogImportChange" WHERE "batchId" = ${importBatchId}`;
    await prisma.$executeRaw`DELETE FROM "CatalogImportBatch" WHERE "id" = ${importBatchId}`;
  }

  return {
    importBatchId,
    type: batch.type,
    undoneChanges,
    deletedBatch: errors.length === 0,
    errors
  };
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function insertCatalogChange(
  tx: TransactionClient,
  batchId: string,
  action: "CREATED" | "UPDATED",
  entityType: "SUPPLIERS" | "PRODUCTS",
  entityId: string,
  previousData: unknown,
  newData: unknown
) {
  await tx.$executeRaw`
    INSERT INTO "CatalogImportChange"
      ("id", "batchId", "action", "entityType", "entityId", "previousData", "newData")
    VALUES
      (${randomUUID()}, ${batchId}, ${action}::"CatalogImportAction",
       ${entityType}::"CatalogImportType", ${entityId},
       CAST(${JSON.stringify(previousData)} AS jsonb), CAST(${JSON.stringify(newData)} AS jsonb))
  `;
}

async function updateCatalogBatchCounters(
  tx: TransactionClient,
  batchId: string,
  report: CatalogImportReport,
  warnings: ImportWarning[]
) {
  await tx.$executeRaw`
    UPDATE "CatalogImportBatch"
    SET
      "importedRows" = ${report.importedRows},
      "createdRows" = ${report.createdRows},
      "updatedRows" = ${report.updatedRows},
      "ignoredRows" = ${report.ignoredRows},
      "warnings" = CAST(${JSON.stringify(warnings)} AS jsonb)
    WHERE "id" = ${batchId}
  `;
}
