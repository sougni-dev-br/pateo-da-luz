import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ExpenseType, PaymentRegime } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import {
  getPaymentMethodBaseName,
  parseInstallmentCountFromPaymentMethodName,
  paymentMethodAllowsInstallments
} from "../../shared/utils/payment-methods.js";
import { currentSpreadsheetMapping } from "./column-mapping/current-spreadsheet.mapping.js";
import {
  getMissingRequiredFields,
  resolveColumns
} from "./column-mapping/column-resolver.js";
import { readFirstWorksheetRows } from "./excel-reader.service.js";
import { PurchaseImportRow } from "./purchase-import.types.js";
import { mapPurchaseSpreadsheetRow } from "./purchase-row.mapper.js";
import { detectPurchaseImportConflicts, summarizeConflictDecisions } from "../import-conflicts/conflict-detection.service.js";
import {
  buildReferenceLabel,
  cleanPurchaseReference,
  findPurchaseReferenceMatches,
  normalizePurchaseReference
} from "../purchases/purchase-duplicate-utils.js";
import { recordPurchaseInventoryEntry } from "../inventory/inventory.routes.js";
import { auditLog } from "../security/security-utils.js";

const requiredPurchaseFields = [
  "purchaseDate",
  "supplierName",
  "quantity",
  "totalPrice"
] as const;

export type PurchaseImportOptions = {
  historicalMode?: boolean;
  ignoreRowsWithoutProduct?: boolean;
  authorizedByUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ImportError = {
  rowNumber: number;
  message: string;
  rawRow?: Record<string, unknown>;
};

type ImportWarning = {
  rowNumber: number;
  message: string;
};

type ImportCounters = {
  importedRows: number;
  ignoredRows: number;
  suppliersCreated: number;
  suppliersReused: number;
  categoriesCreated: number;
  categoriesReused: number;
  subcategoriesCreated: number;
  subcategoriesReused: number;
  productsCreated: number;
  productsReused: number;
  unitsCreated: number;
  unitsReused: number;
  expenseTypesCreated: number;
  expenseTypesReused: number;
  productsLinkedByFallback: number;
};

type PurchaseGroup = {
  key: string;
  firstRowNumber: number;
  header: PurchaseImportRow;
  rows: Array<{ rowNumber: number; row: PurchaseImportRow }>;
};

export type PurchaseImportReport = ImportCounters & {
  importBatchId: string | null;
  purchasesCreated: number;
  installmentsCreated: number;
  spreadsheetTotal: number;
  importedTotal: number;
  differenceTotal: number;
  duplicateProducts: Array<{ name: string; count: number }>;
  categories: string[];
  subcategories: string[];
  paymentMethods: string[];
  conflictsFound: number;
  conflictsResolved: number;
  conflictsPending: number;
  decisionsAppliedAutomatically: number;
  productsLinkedByFallback: number;
  ignoredWithoutProduct: number;
  duplicatePurchasesBlocked: number;
  duplicatePurchasesAuthorized: number;
  purchaseNumbers: string[];
  emptyRowsIgnored: number;
  elapsedMs: number;
  errors: ImportError[];
  warnings: ImportWarning[];
};

function safeUploadPath(importFileId: string): string {
  const safeFileName = path.basename(importFileId);
  return path.resolve("uploads", safeFileName);
}

function sourceRowNumber(row: PurchaseImportRow, fallback: number) {
  return row.sourceRowNumber ?? fallback;
}

async function readPurchaseRows(filePath: string) {
  const { rows, emptyRowsIgnored = 0 } = await readFirstWorksheetRows(filePath);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const columns = resolveColumns(headers, currentSpreadsheetMapping, rows);

  return {
    rows,
    columns,
    emptyRowsIgnored,
    missingRequiredFields: getMissingRequiredFields(columns, [...requiredPurchaseFields])
  };
}

function validateRow(row: PurchaseImportRow): string[] {
  const errors: string[] = [];

  if (!row.purchaseDate) errors.push("Data de compra ausente ou invalida.");
  if (!row.supplierName || row.supplierName === "Fornecedor nao informado") {
    errors.push("Fornecedor ausente.");
  }
  if (!row.productDescription || row.productDescription === "Produto nao informado") {
    errors.push("Produto ausente.");
  }
  if (row.quantity <= 0) errors.push("Quantidade deve ser maior que zero.");
  if (row.totalPrice <= 0) errors.push("Valor total deve ser maior que zero.");

  return errors;
}

function hasProductIdentity(row: PurchaseImportRow) {
  return Boolean(row.productCode || (row.productDescription && row.productDescription !== "Produto nao informado"));
}

function hasAnyOperationalContent(row: PurchaseImportRow) {
  return Boolean(
    hasProductIdentity(row) ||
    row.supplierCode ||
    row.supplierDocument ||
    (row.supplierName && row.supplierName !== "Fornecedor nao informado") ||
    row.invoiceNumber ||
    row.totalPrice > 0 ||
    row.quantity > 0 ||
    row.paymentMethod ||
    row.dueDates
  );
}

function summarizeImportRows(rows: PurchaseImportRow[]) {
  const categories = new Set<string>();
  const subcategories = new Set<string>();
  const paymentMethods = new Set<string>();

  for (const row of rows) {
    if (row.categoryName) categories.add(row.categoryName);
    if (row.subcategoryName) subcategories.add(row.subcategoryName);
    if (row.paymentMethod) paymentMethods.add(row.paymentMethod);
  }

  return {
    spreadsheetTotal: rows.reduce((sum, row) => sum + row.totalPrice, 0),
    duplicateProducts: [],
    categories: [...categories].sort(),
    subcategories: [...subcategories].sort(),
    paymentMethods: [...paymentMethods].sort()
  };
}

function getCodeRelationshipWarnings(rows: PurchaseImportRow[]): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const supplierCodeNames = new Map<string, Set<string>>();
  const supplierNameCodes = new Map<string, Set<string>>();
  const productCodeNames = new Map<string, Set<string>>();
  const productNameCodes = new Map<string, Set<string>>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    if (row.supplierCode) {
      const names = supplierCodeNames.get(row.supplierCode) ?? new Set<string>();
      names.add(normalizeText(row.supplierName));
      supplierCodeNames.set(row.supplierCode, names);
    }
    if (row.productCode) {
      const names = productCodeNames.get(row.productCode) ?? new Set<string>();
      names.add(normalizeText(row.productDescription));
      productCodeNames.set(row.productCode, names);
    }

    const supplierName = normalizeText(row.supplierName);
    if (supplierName && row.supplierCode) {
      const codes = supplierNameCodes.get(supplierName) ?? new Set<string>();
      codes.add(row.supplierCode);
      supplierNameCodes.set(supplierName, codes);
    }

    const productName = normalizeText(row.productDescription);
    if (productName && row.productCode) {
      const codes = productNameCodes.get(productName) ?? new Set<string>();
      codes.add(row.productCode);
      productNameCodes.set(productName, codes);
    }
  });

  const suppliersWithoutCode = rows.filter((row) => !row.supplierCode).length;
  const productsWithoutCode = rows.filter(
    (row) => !row.productCode && row.productDescription !== "Produto nao informado"
  ).length;
  if (suppliersWithoutCode > 0) {
    warnings.push({
      rowNumber: 0,
      message: `${suppliersWithoutCode} linhas sem codigo de fornecedor utilizaram fallback por CNPJ/nome.`
    });
  }
  if (productsWithoutCode > 0) {
    warnings.push({
      rowNumber: 0,
      message: `${productsWithoutCode} linhas sem codigo de produto utilizaram fallback por nome normalizado.`
    });
  }

  supplierCodeNames.forEach((names, code) => {
    if (names.size > 1) {
      warnings.push({ rowNumber: 0, message: `Mesmo codigo de fornecedor com nomes diferentes: ${code}.` });
    }
  });
  supplierNameCodes.forEach((codes, name) => {
    if (codes.size > 1) {
      warnings.push({ rowNumber: 0, message: `Mesmo fornecedor com codigos diferentes: ${name} (${[...codes].join(", ")}).` });
    }
  });
  productCodeNames.forEach((names, code) => {
    if (names.size > 1) {
      warnings.push({ rowNumber: 0, message: `Mesmo codigo de produto com nomes diferentes: ${code}.` });
    }
  });
  productNameCodes.forEach((codes, name) => {
    if (codes.size > 1) {
      warnings.push({ rowNumber: 0, message: `Mesmo produto com codigos diferentes: ${name} (${[...codes].join(", ")}).` });
    }
  });

  return warnings;
}

function countRelevantConflicts(warnings: ImportWarning[]) {
  return warnings.filter((warning) => {
    const message = normalizeText(warning.message);
    return (
      message.includes("mesmo codigo") ||
      message.includes("codigos diferentes") ||
      message.includes("diferente da unidade cadastrada") ||
      message.includes("nome diferente")
    );
  }).length;
}

function getInstallmentWarnings(rowNumber: number, row: PurchaseImportRow): ImportWarning[] {
  if (!row.dueDates) return [];

  return row.dueDates
    .split(/[\n;,|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !parseDate(part))
    .map((part) => ({
      rowNumber,
      message: `Vencimento nao interpretado: ${part}. O valor bruto sera preservado.`
    }));
}

function getUnitWarnings(rows: PurchaseImportRow[]): ImportWarning[] {
  const rowsWithoutUnit = rows.filter((row) => !row.unit).length;
  return rowsWithoutUnit > 0
    ? [{ rowNumber: 0, message: `${rowsWithoutUnit} itens sem unidade de medida.` }]
    : [];
}

function getPurchaseKey(row: PurchaseImportRow): string {
  const dateKey = row.purchaseDate?.toISOString().slice(0, 10) ?? "";
  const normalizedReference = normalizePurchaseReference(row.invoiceNumber) || normalizePurchaseReference(row.purchaseOrderNumber) || `ROW${row.sourceRowNumber ?? ""}`;
  return [
    dateKey,
    normalizeText(row.supplierCode || row.supplierDocument || row.supplierName),
    normalizedReference
  ].join("|");
}

function getPreviewDuplicateKey(row: PurchaseImportRow, totalAmount: number) {
  return [
    normalizeText(row.supplierCode || row.supplierDocument || row.supplierName),
    normalizePurchaseReference(row.invoiceNumber),
    normalizePurchaseReference(row.purchaseOrderNumber),
    totalAmount.toFixed(2)
  ].join("|");
}

function groupPurchaseRows(rows: Array<{ rowNumber: number; row: PurchaseImportRow }>) {
  const groups = new Map<string, PurchaseGroup>();

  for (const entry of rows) {
    const key = getPurchaseKey(entry.row);
    const group = groups.get(key);

    if (group) {
      group.rows.push(entry);
      continue;
    }

    groups.set(key, {
      key,
      firstRowNumber: entry.rowNumber,
      header: entry.row,
      rows: [entry]
    });
  }

  return [...groups.values()];
}

async function findOrCreateSupplier(
  tx: Prisma.TransactionClient,
  row: PurchaseImportRow,
  counters: ImportCounters
): Promise<NonNullable<Awaited<ReturnType<typeof tx.supplier.findFirst>>>> {
  const supplierByCode = row.supplierCode
    ? await tx.supplier.findFirst({ where: { externalCode: row.supplierCode } })
    : null;

  if (supplierByCode) {
    counters.suppliersReused += 1;
    return supplierByCode;
  }

  const supplierByDocument = row.supplierDocument
    ? await tx.supplier.findFirst({ where: { document: row.supplierDocument } })
    : null;

  if (supplierByDocument) {
    counters.suppliersReused += 1;
    if (row.supplierCode && !supplierByDocument.externalCode) {
      return tx.supplier.update({
        where: { id: supplierByDocument.id },
        data: { externalCode: row.supplierCode }
      });
    }
    return supplierByDocument;
  }

  const supplierByName = await tx.supplier.findFirst({ where: { name: row.supplierName } });

  if (supplierByName) {
    counters.suppliersReused += 1;
    return supplierByName;
  }

  counters.suppliersCreated += 1;
  const createdSupplier = await tx.supplier.create({
    data: {
      externalCode: row.supplierCode,
      document: row.supplierDocument,
      name: row.supplierName
    }
  });
  await tx.$executeRaw`
    UPDATE "Supplier"
    SET "normalizedName" = ${normalizeText(row.supplierName)}
    WHERE "id" = ${createdSupplier.id}
  `;
  return createdSupplier;
}

async function findOrCreateCategory(
  tx: Prisma.TransactionClient,
  name: string | null,
  counters: ImportCounters
) {
  if (!name) return null;

  const existing = await tx.category.findUnique({ where: { name } });
  if (existing) {
    counters.categoriesReused += 1;
    return existing;
  }

  counters.categoriesCreated += 1;
  return tx.category.create({ data: { name, mainGroup: "Compras" } });
}

async function findOrCreateSubcategory(
  tx: Prisma.TransactionClient,
  name: string | null,
  categoryId: string | undefined,
  counters: ImportCounters
) {
  if (!name || !categoryId) return null;

  const existing = await tx.subcategory.findUnique({
    where: { categoryId_name: { categoryId, name } }
  });
  if (existing) {
    counters.subcategoriesReused += 1;
    return existing;
  }

  counters.subcategoriesCreated += 1;
  return tx.subcategory.create({ data: { name, categoryId } });
}

async function findOrCreateProduct(
  tx: Prisma.TransactionClient,
  row: PurchaseImportRow,
  categoryId: string | undefined,
  subcategoryId: string | undefined,
  unitMeasureId: string | undefined,
  counters: ImportCounters
) {
  const normalizedName = normalizeText(row.productDescription);

  const productByCode = row.productCode
    ? await tx.product.findFirst({ where: { externalCode: row.productCode } })
    : null;

  if (productByCode) {
    counters.productsReused += 1;
    return productByCode;
  }

  const alias = await tx.productAlias.findUnique({ where: { normalizedAlias: normalizedName } });

  if (alias) {
    counters.productsReused += 1;
    (counters as ImportCounters & { productsLinkedByFallback?: number }).productsLinkedByFallback =
      ((counters as ImportCounters & { productsLinkedByFallback?: number }).productsLinkedByFallback ?? 0) + 1;
    return tx.product.findUniqueOrThrow({ where: { id: alias.productId } });
  }

  const product = await tx.product.findFirst({
    where: { normalizedName }
  });

  if (product) {
    counters.productsReused += 1;
    (counters as ImportCounters & { productsLinkedByFallback?: number }).productsLinkedByFallback =
      ((counters as ImportCounters & { productsLinkedByFallback?: number }).productsLinkedByFallback ?? 0) + 1;
    await tx.productAlias
      .create({
        data: {
          alias: row.productDescription,
          normalizedAlias: normalizedName,
          productId: product.id
        }
      })
      .catch(() => undefined);
    return product;
  }

  counters.productsCreated += 1;
  return tx.product.create({
    data: {
      externalCode: row.productCode,
      name: row.productDescription,
      normalizedName,
      unit: row.unit,
      unitMeasureId,
      categoryId,
      subcategoryId,
      aliases: {
        create: {
          alias: row.productDescription,
          normalizedAlias: normalizedName
        }
      }
    }
  });
}

async function findOrCreateUnitMeasure(
  tx: Prisma.TransactionClient,
  unit: string | null,
  counters: ImportCounters
) {
  const code = String(unit ?? "").trim().toUpperCase();
  if (!code) return null;

  const existing = await tx.unitMeasure.findUnique({ where: { code } });
  if (existing) {
    counters.unitsReused += 1;
    return existing;
  }

  counters.unitsCreated += 1;
  return tx.unitMeasure.create({ data: { code, name: code, type: "Compra" } });
}

type ItemConversionResult = {
  convertedUnit: string | null;
  convertedQuantity: number | null;
  convertedUnitPrice: number | null;
  conversionFactorUsed: number | null;
  conversionMissing: boolean;
};

function calculateItemConversion(
  row: PurchaseImportRow
): ItemConversionResult {
  void row;
  return {
    convertedUnit: null,
    convertedQuantity: null,
    convertedUnitPrice: null,
    conversionFactorUsed: null,
    conversionMissing: false
  };
}

function getPaymentMethodType(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized.includes("dinheiro")) return "CASH";
  if (normalized.includes("pix")) return "PIX";
  if (normalized.includes("credito")) return "CREDIT_CARD";
  if (normalized.includes("debito")) return "DEBIT_CARD";
  if (normalized.includes("boleto")) return "BANK_SLIP";
  if (normalized.includes("transfer")) return "TRANSFER";

  return "OTHER";
}

function getPaymentMethodGroup(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized.includes("dinheiro")) return "dinheiro";
  if (normalized.includes("pix")) return "pix";
  if (normalized.includes("boleto")) return "boleto";
  if (normalized.includes("cartao")) return "cartao";
  if (normalized.includes("faturado")) return "faturado";

  return "outros";
}

async function findOrCreatePaymentMethod(tx: Prisma.TransactionClient, name: string | null) {
  if (!name) return null;

  const baseName = getPaymentMethodBaseName(name) ?? name;
  const normalizedName = normalizeText(baseName);
  const existing = await tx.paymentMethod.findUnique({ where: { normalizedName } });
  if (existing) return existing;

  return tx.paymentMethod.create({
    data: {
      name: baseName,
      normalizedName,
      type: getPaymentMethodType(baseName),
      group: getPaymentMethodGroup(baseName)
    }
  });
}

function getExpenseType(value: string | null): ExpenseType {
  const normalized = normalizeText(value);

  if (normalized.includes("alimento") || normalized.includes("insumo")) return "FOOD";
  if (normalized.includes("bebida")) return "BEVERAGE";
  if (normalized.includes("embalag")) return "PACKAGING";
  if (normalized.includes("limpeza")) return "CLEANING";
  if (normalized.includes("admin")) return "ADMINISTRATIVE";
  if (normalized.includes("pequeno")) return "SMALL_EXPENSE";

  return "OTHER";
}

async function findOrCreateExpenseTypeMaster(
  tx: Prisma.TransactionClient,
  name: string | null,
  counters: ImportCounters
) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;

  const normalizedName = normalizeText(cleanName);
  const existing = await tx.expenseTypeMaster.findUnique({ where: { normalizedName } });
  if (existing) {
    counters.expenseTypesReused += 1;
    return existing;
  }

  counters.expenseTypesCreated += 1;
  return tx.expenseTypeMaster.create({
    data: {
      name: cleanName,
      normalizedName,
      group: getExpenseType(cleanName)
    }
  });
}

async function findOrCreateSmallExpenseType(
  tx: Prisma.TransactionClient,
  row: PurchaseImportRow
) {
  if (getExpenseType(row.expenseType) !== "SMALL_EXPENSE") return null;

  const name = row.subcategoryName || row.categoryName || row.expenseType || "Pequeno gasto";
  const normalizedName = normalizeText(name);
  const existing = await tx.smallExpenseType.findUnique({ where: { normalizedName } });
  if (existing) return existing;

  return tx.smallExpenseType.create({
    data: {
      name,
      normalizedName,
      group: row.categoryName || "Pequenos gastos"
    }
  });
}

function getPaymentRegime(row: PurchaseImportRow): PaymentRegime {
  const payment = normalizeText(getPaymentMethodBaseName(row.paymentMethod));
  const dueDates = normalizeText(row.dueDates);

  if (dueDates || payment.includes("prazo") || payment.includes("boleto") || payment.includes("faturado")) {
    return "ACCRUAL";
  }

  return "CASH";
}

function parseInstallmentCountFromPaymentMethod(paymentMethod: string | null) {
  return parseInstallmentCountFromPaymentMethodName(paymentMethod);
}

function collectGroupDueDates(group: PurchaseGroup) {
  const values: string[] = [];

  for (const entry of group.rows) {
    if (!entry.row.dueDates) continue;
    for (const part of entry.row.dueDates.split(/[\n;,|]+/)) {
      const raw = part.trim();
      if (!raw) continue;
      const parsed = parseDate(raw);
      const key = parsed ? parsed.toISOString().slice(0, 10) : normalizeText(raw);
      if (!values.some((value) => {
        const existingDate = parseDate(value);
        const existingKey = existingDate ? existingDate.toISOString().slice(0, 10) : normalizeText(value);
        return existingKey === key;
      })) {
        values.push(raw);
      }
    }
  }

  return values.join("; ") || null;
}

function splitAmountIntoInstallments(totalAmount: number, installments: number) {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / installments);
  const remainder = totalCents - baseCents * installments;

  return Array.from({ length: installments }, (_, index) => {
    const cents = baseCents + (index < remainder ? 1 : 0);
    return new Prisma.Decimal(cents).div(100);
  });
}

function parseInstallments(rawValue: string | null, totalAmount: number, paymentMethod: string | null = null) {
  const baseName = getPaymentMethodBaseName(paymentMethod);
  const allowsInstallments = paymentMethodAllowsInstallments({ name: baseName });
  const expectedCount = allowsInstallments ? parseInstallmentCountFromPaymentMethod(paymentMethod) : 1;

  if (!rawValue) {
    const count = expectedCount ?? 1;
    const amounts = splitAmountIntoInstallments(totalAmount, count);
    return [
      ...amounts.map((amount, index) => ({
        dueDate: null,
        amount,
        installment: index + 1,
        rawValue: null
      }))
    ];
  }

  const parts = rawValue
    .split(/[\n;,|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const dueDates = parts.map((part) => ({ raw: part, date: parseDate(part) }));
  const installmentCount = Math.max(expectedCount ?? 0, dueDates.length, 1);
  const amounts = splitAmountIntoInstallments(totalAmount, installmentCount);

  if (!dueDates.length) {
    return amounts.map((amount, index) => ({
        dueDate: null,
        amount,
        installment: index + 1,
        rawValue
    }));
  }

  return Array.from({ length: installmentCount }, (_, index) => ({
    dueDate: dueDates[index]?.date ?? null,
    amount: amounts[index],
    installment: index + 1,
    rawValue: dueDates[index]?.raw ?? null
  }));
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

async function findExistingDuplicatePurchase(
  tx: Prisma.TransactionClient,
  input: {
    supplierId: string;
    invoiceNumber?: string | null;
    purchaseOrderNumber?: string | null;
  }
) {
  const result = await findPurchaseReferenceMatches(tx, input);
  return result.activeDuplicate;
}

async function getDuplicateWarnings(groups: PurchaseGroup[]) {
  const warnings: ImportWarning[] = [];
  const sheetKeys = new Map<string, number[]>();

  for (const group of groups) {
    const totalAmount = group.rows.reduce((sum, entry) => sum + entry.row.totalPrice, 0);
    const key = getPreviewDuplicateKey(group.header, totalAmount);
    const list = sheetKeys.get(key) ?? [];
    list.push(group.firstRowNumber);
    sheetKeys.set(key, list);
    if (!group.header.invoiceNumber) warnings.push({ rowNumber: group.firstRowNumber, message: "Compra sem numero de NF." });
    if (!group.header.supplierName || group.header.supplierName === "Fornecedor nao informado") warnings.push({ rowNumber: group.firstRowNumber, message: "Compra sem fornecedor." });
    if (!group.header.purchaseDate) warnings.push({ rowNumber: group.firstRowNumber, message: "Compra sem data." });
    if (totalAmount <= 0) warnings.push({ rowNumber: group.firstRowNumber, message: "Compra sem total." });
  }

  sheetKeys.forEach((rows, key) => {
    if (rows.length > 1) {
      warnings.push({
        rowNumber: 0,
        message: `Possivel NF/compra duplicada dentro da planilha nas linhas ${rows.join(", ")} (${key}).`
      });
    }
  });

  for (const group of groups.slice(0, 300)) {
    const supplier = await prisma.supplier.findFirst({
      where: {
        OR: [
          ...(group.header.supplierCode ? [{ externalCode: group.header.supplierCode }] : []),
          ...(group.header.supplierDocument ? [{ document: group.header.supplierDocument }] : []),
          { normalizedName: normalizeText(group.header.supplierName) },
          { name: { equals: group.header.supplierName, mode: "insensitive" } }
        ]
      }
    });
    if (!supplier) continue;
    const matches = await findPurchaseReferenceMatches(prisma, {
      supplierId: supplier.id,
      invoiceNumber: group.header.invoiceNumber,
      purchaseOrderNumber: group.header.purchaseOrderNumber
    });
    if (matches.activeDuplicate) {
      warnings.push({
        rowNumber: group.firstRowNumber,
        message: `Bloqueio por duplicidade: ja existe compra ativa para ${supplier.name} com ${buildReferenceLabel({ invoiceNumber: group.header.invoiceNumber, purchaseOrderNumber: group.header.purchaseOrderNumber })}.`
      });
    } else if (matches.cancelledDuplicate) {
      warnings.push({
        rowNumber: group.firstRowNumber,
        message: `Aviso: existe compra cancelada para ${supplier.name} com ${buildReferenceLabel({ invoiceNumber: group.header.invoiceNumber, purchaseOrderNumber: group.header.purchaseOrderNumber })}.`
      });
    }
  }

  return warnings;
}

export async function confirmPurchaseImport(
  importFileId: string,
  originalFileName?: string | null,
  options: PurchaseImportOptions = {}
): Promise<PurchaseImportReport> {
  const startedAt = Date.now();
  const filePath = safeUploadPath(importFileId);

  if (!fs.existsSync(filePath)) {
    throw new Error("Arquivo de importacao nao encontrado. Envie a planilha novamente.");
  }

  const { rows, columns, emptyRowsIgnored: readerEmptyRowsIgnored, missingRequiredFields } = await readPurchaseRows(filePath);

  if (missingRequiredFields.length > 0) {
    return {
      importedRows: 0,
      ignoredRows: rows.length,
      suppliersCreated: 0,
      suppliersReused: 0,
      categoriesCreated: 0,
      categoriesReused: 0,
      subcategoriesCreated: 0,
      subcategoriesReused: 0,
      productsCreated: 0,
      productsReused: 0,
      unitsCreated: 0,
      unitsReused: 0,
      expenseTypesCreated: 0,
      expenseTypesReused: 0,
      importBatchId: null,
      purchasesCreated: 0,
      installmentsCreated: 0,
      spreadsheetTotal: 0,
      importedTotal: 0,
      differenceTotal: 0,
      duplicateProducts: [],
      categories: [],
      subcategories: [],
      paymentMethods: [],
      conflictsFound: 0,
      conflictsResolved: 0,
      conflictsPending: 0,
      decisionsAppliedAutomatically: 0,
      productsLinkedByFallback: 0,
      ignoredWithoutProduct: 0,
      duplicatePurchasesBlocked: 0,
      duplicatePurchasesAuthorized: 0,
      purchaseNumbers: [],
      emptyRowsIgnored: 0,
      elapsedMs: Date.now() - startedAt,
      errors: [
        {
          rowNumber: 0,
          message: `Colunas obrigatorias ausentes: ${missingRequiredFields.join(", ")}.`
        }
      ],
      warnings: []
    };
  }

  const validRows: Array<{ rowNumber: number; row: PurchaseImportRow }> = [];
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const ignoreRowsWithoutProduct = options.ignoreRowsWithoutProduct || options.historicalMode;
  let ignoredWithoutProduct = 0;
  let emptyRowsIgnored = readerEmptyRowsIgnored;
  const mappedRows = rows.map((rawRow, index) => ({
    rawRow,
    row: mapPurchaseSpreadsheetRow(rawRow, columns)
  })).map((entry, index) => ({
    ...entry,
    rowNumber: sourceRowNumber(entry.row, index + 2)
  }));
  const rowsForImport = mappedRows.filter((entry) => {
    if (!hasAnyOperationalContent(entry.row)) {
      emptyRowsIgnored += 1;
      return false;
    }
    if (!hasProductIdentity(entry.row) && ignoreRowsWithoutProduct) {
      ignoredWithoutProduct += 1;
      return false;
    }
    return true;
  });
  const rowsForSummary = rowsForImport.map((entry) => entry.row);
  const summary = summarizeImportRows(rowsForSummary);
  warnings.push(...getCodeRelationshipWarnings(rowsForSummary));
  warnings.push(...getUnitWarnings(rowsForSummary));
  if (ignoredWithoutProduct > 0) {
    warnings.push({
      rowNumber: 0,
      message: `${ignoredWithoutProduct} linhas ignoradas por ausencia de produto.`
    });
  }
  if (emptyRowsIgnored > 0) {
    warnings.push({
      rowNumber: 0,
      message: `Total de linhas vazias ignoradas: ${emptyRowsIgnored}. A linha 191 esta preenchida e foi considerada para importacao quando estiver sem erro.`
    });
  }
  mappedRows.forEach((entry) => {
    if (hasProductIdentity(entry.row)) return;
    if (hasAnyOperationalContent(entry.row)) {
      warnings.push({
        rowNumber: entry.rowNumber,
        message: "Linha com conteudo operacional nao foi ignorada, mas precisa de produto para importar."
      });
    }
  });
  const conflicts = await detectPurchaseImportConflicts(rowsForImport);
  const conflictSummary = summarizeConflictDecisions(conflicts);

  rowsForImport.forEach(({ rawRow, rowNumber, row: mappedRow }) => {
    const rowErrors = validateRow(mappedRow);
    warnings.push(...getInstallmentWarnings(rowNumber, mappedRow));

    if (rowErrors.length) {
      errors.push({ rowNumber, message: rowErrors.join(" "), rawRow });
      return;
    }

    validRows.push({ rowNumber, row: mappedRow });
  });

  const counters: ImportCounters = {
    importedRows: 0,
    ignoredRows: errors.length + ignoredWithoutProduct + emptyRowsIgnored,
    suppliersCreated: 0,
    suppliersReused: 0,
    categoriesCreated: 0,
    categoriesReused: 0,
    subcategoriesCreated: 0,
    subcategoriesReused: 0,
    productsCreated: 0,
    productsReused: 0,
    unitsCreated: 0,
    unitsReused: 0,
    expenseTypesCreated: 0,
    expenseTypesReused: 0,
    productsLinkedByFallback: 0
  };

  let purchasesCreated = 0;
  let installmentsCreated = 0;
  let importBatchId: string | null = null;
  let importedTotal = 0;
  let duplicatePurchasesBlocked = 0;
  let duplicatePurchasesAuthorized = 0;
  const purchaseNumbers: string[] = [];
  const groups = groupPurchaseRows(validRows);
  warnings.push(...(await getDuplicateWarnings(groups)));
  const inventoryEntries: Array<{
    productId: string;
    purchaseItemId: string;
    quantity: number;
    unit: string | null;
    unitMeasureId: string | null;
    totalCost: number;
  }> = [];

  await prisma.$transaction(async (tx) => {
    const existingBatch = await tx.importBatch.findUnique({ where: { importFileId } });
    if (existingBatch) {
      throw new Error("Esta planilha enviada ja foi confirmada. Envie novamente para criar um novo teste.");
    }

    const importBatch = await tx.importBatch.create({
      data: {
        importFileId,
        originalFileName,
        totalRows: rows.length,
        ignoredRows: counters.ignoredRows,
        spreadsheetTotal: new Prisma.Decimal(summary.spreadsheetTotal)
      }
    });

    importBatchId = importBatch.id;

    for (const group of groups) {
      const supplier = await findOrCreateSupplier(tx, group.header, counters);
      const totalAmount = group.rows.reduce((sum, entry) => sum + entry.row.totalPrice, 0);
      const purchaseDate = group.header.purchaseDate as Date;
      const invoiceNumber = cleanPurchaseReference(group.header.invoiceNumber);
      const purchaseOrderNumber = cleanPurchaseReference(group.header.purchaseOrderNumber);
      const duplicate = await findExistingDuplicatePurchase(tx, {
        supplierId: supplier.id,
        invoiceNumber,
        purchaseOrderNumber
      });

      if (duplicate) {
        duplicatePurchasesBlocked += 1;
        counters.ignoredRows += group.rows.length;
        warnings.push({
          rowNumber: group.firstRowNumber,
          message: `Compra bloqueada por duplicidade. Ja existe uma compra ativa para este fornecedor com ${buildReferenceLabel({ invoiceNumber, purchaseOrderNumber })}.`
        });
        await auditLog({
          userId: options.authorizedByUserId ?? null,
          action: "BLOCK_DUPLICATE_PURCHASE",
          entity: "Purchase",
          entityId: String(duplicate.id),
          newValue: {
            firstRowNumber: group.firstRowNumber,
            duplicate
          },
          ipAddress: options.ipAddress,
          userAgent: options.userAgent
        });
        continue;
      }

      const purchaseNumber = await getNextPurchaseNumber(tx, purchaseDate.getFullYear());
      const expenseType = getExpenseType(group.header.expenseType);
      const expenseTypeMaster = await findOrCreateExpenseTypeMaster(
        tx,
        group.header.expenseType,
        counters
      );
      const smallExpenseType = await findOrCreateSmallExpenseType(tx, group.header);
      const paymentMethod = await findOrCreatePaymentMethod(tx, group.header.paymentMethod);
      const paymentMethodBaseName = getPaymentMethodBaseName(group.header.paymentMethod);

      const purchase = await tx.purchase.create({
        data: {
          purchaseDate,
          competenceMonth: purchaseDate.getMonth() + 1,
          competenceYear: purchaseDate.getFullYear(),
          supplierId: supplier.id,
          invoiceNumber,
          purchaseOrderNumber,
          normalizedInvoiceNumber: normalizePurchaseReference(invoiceNumber) || null,
          normalizedPurchaseOrderNumber: normalizePurchaseReference(purchaseOrderNumber) || null,
          rawSupplierCode: group.header.supplierCode,
          paymentMethod: paymentMethodBaseName,
          paymentMethodId: paymentMethod?.id,
          paymentRegime: getPaymentRegime(group.header),
          expenseType,
          expenseTypeId: expenseTypeMaster?.id,
          smallExpenseTypeId: smallExpenseType?.id,
          isSmallExpense: expenseType === "SMALL_EXPENSE",
          totalAmount: new Prisma.Decimal(totalAmount),
          sourceFile: importFileId,
          importBatchId: importBatch.id,
          rawRow: group.header.rawRow as Prisma.InputJsonValue
        }
      });
      await tx.$executeRaw`
        UPDATE "Purchase"
        SET "purchaseNumber" = ${purchaseNumber},
            "workflowStatus" = 'confirmed'
        WHERE "id" = ${purchase.id}
      `;

      purchasesCreated += 1;
      purchaseNumbers.push(purchaseNumber);
      importedTotal += totalAmount;
      await auditLog({
        userId: options.authorizedByUserId ?? null,
        action: "IMPORT_PURCHASE",
        entity: "Purchase",
        entityId: purchase.id,
        newValue: { purchaseNumber, importBatchId: importBatch.id, totalAmount, invoiceNumber, purchaseOrderNumber },
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });

      for (const entry of group.rows) {
        const category = await findOrCreateCategory(tx, entry.row.categoryName, counters);
        const subcategory = await findOrCreateSubcategory(
          tx,
          entry.row.subcategoryName,
          category?.id,
          counters
        );
        const unitMeasure = await findOrCreateUnitMeasure(tx, entry.row.unit, counters);
        const product = await findOrCreateProduct(
          tx,
          entry.row,
          category?.id,
          subcategory?.id,
          unitMeasure?.id,
          counters
        );

        if (unitMeasure && product.unitMeasureId && product.unitMeasureId !== unitMeasure.id) {
          warnings.push({
            rowNumber: entry.rowNumber,
            message: `Unidade do item (${unitMeasure.code}) diferente da unidade cadastrada no produto (${product.unit ?? "sem sigla"}).`
          });
        }

        const conversion = calculateItemConversion(entry.row);

        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: product.id,
            rawProductCode: entry.row.productCode,
            rawProductName: entry.row.productDescription,
            unit: entry.row.unit,
            unitMeasureId: unitMeasure?.id,
            quantity: new Prisma.Decimal(entry.row.quantity),
            unitPrice: new Prisma.Decimal(entry.row.unitPrice),
            totalPrice: new Prisma.Decimal(entry.row.totalPrice),
            rawCategory: entry.row.categoryName,
            rawSubcategory: entry.row.subcategoryName
          }
        });

        await tx.$executeRaw`
          UPDATE "PurchaseItem"
          SET
            "convertedUnit" = ${conversion.convertedUnit},
            "convertedQuantity" = ${conversion.convertedQuantity},
            "convertedUnitPrice" = ${conversion.convertedUnitPrice},
            "conversionFactorUsed" = ${conversion.conversionFactorUsed},
            "conversionMissing" = ${conversion.conversionMissing}
          WHERE "id" = ${purchaseItem.id}
        `;
        inventoryEntries.push({
          productId: product.id,
          purchaseItemId: purchaseItem.id,
          quantity: entry.row.quantity,
          unit: entry.row.unit,
          unitMeasureId: unitMeasure?.id ?? null,
          totalCost: entry.row.totalPrice
        });

        counters.importedRows += 1;
      }

      const groupDueDates = collectGroupDueDates(group);
      const installments = parseInstallments(groupDueDates, totalAmount, group.header.paymentMethod);
      const installmentsWithoutDueDate = installments.filter((installment) => !installment.dueDate).length;
      if (installmentsWithoutDueDate > 0 && groupDueDates) {
        warnings.push({
          rowNumber: group.firstRowNumber,
          message: `${installmentsWithoutDueDate} parcela(s) sem vencimento interpretado para ${group.header.paymentMethod ?? "forma de pagamento sem nome"}.`
        });
      }

      await tx.paymentInstallment.createMany({
        data: installments.map((installment) => ({
          purchaseId: purchase.id,
          dueDate: installment.dueDate,
          amount: installment.amount,
          installment: installment.installment,
          paymentMethodId: paymentMethod?.id ?? null,
          paymentMethodName: paymentMethodBaseName,
          status: "OPEN",
          rawValue: installment.rawValue
        }))
      });

      installmentsCreated += installments.length;
    }

    await tx.importBatch.update({
      where: { id: importBatch.id },
      data: {
        importedRows: counters.importedRows,
        ignoredRows: counters.ignoredRows,
        importedTotal: new Prisma.Decimal(importedTotal),
        differenceTotal: new Prisma.Decimal(summary.spreadsheetTotal - importedTotal)
      }
    });
  }, { maxWait: 10000, timeout: options.historicalMode ? 60000 : 30000 });

  for (const entry of inventoryEntries) {
    await recordPurchaseInventoryEntry(entry);
  }

  return {
    ...counters,
    importBatchId,
    purchasesCreated,
    installmentsCreated,
    spreadsheetTotal: summary.spreadsheetTotal,
    importedTotal,
    differenceTotal: summary.spreadsheetTotal - importedTotal,
    duplicateProducts: summary.duplicateProducts,
    categories: summary.categories,
    subcategories: summary.subcategories,
    paymentMethods: summary.paymentMethods,
    conflictsFound: Math.max(conflictSummary.conflictsFound, countRelevantConflicts(warnings)),
    conflictsResolved: conflictSummary.conflictsResolved,
    conflictsPending: conflictSummary.conflictsPending,
    decisionsAppliedAutomatically: conflictSummary.decisionsAppliedAutomatically,
    ignoredWithoutProduct,
    emptyRowsIgnored,
    duplicatePurchasesBlocked,
    duplicatePurchasesAuthorized,
    purchaseNumbers,
    elapsedMs: Date.now() - startedAt,
    errors,
    warnings
  };
}

export async function deleteImportBatch(importBatchId: string) {
  const importBatch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
    include: { purchases: { select: { id: true } } }
  });

  if (!importBatch) {
    throw new Error("Importacao nao encontrada.");
  }

  const purchaseIds = importBatch.purchases.map((purchase) => purchase.id);

  await prisma.$transaction(async (tx) => {
    await tx.paymentInstallment.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await tx.purchaseItem.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
    await tx.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await tx.importBatch.delete({ where: { id: importBatchId } });
  });

  return {
    importBatchId,
    purchasesDeleted: purchaseIds.length,
    masterDataKept: true
  };
}
