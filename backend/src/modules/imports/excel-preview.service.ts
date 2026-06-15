import { currentSpreadsheetMapping } from "./column-mapping/current-spreadsheet.mapping.js";
import {
  getRecognizedColumns,
  getMissingRequiredFields,
  resolveColumns
} from "./column-mapping/column-resolver.js";
import { readFirstWorksheetRows } from "./excel-reader.service.js";
import { mapPurchaseSpreadsheetRow } from "./purchase-row.mapper.js";
import { normalizeHeader, normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { parseInstallmentCountFromPaymentMethodName } from "../../shared/utils/payment-methods.js";
import { prisma } from "../../config/database.js";
import { detectPurchaseImportConflicts, summarizeConflictDecisions } from "../import-conflicts/conflict-detection.service.js";
import {
  buildReferenceLabel,
  findPurchaseReferenceMatches,
  normalizePurchaseReference
} from "../purchases/purchase-duplicate-utils.js";

const requiredPurchaseFields = [
  "purchaseDate",
  "supplierName",
  "quantity",
  "totalPrice"
] as const;

export type PurchaseImportOptions = {
  historicalMode?: boolean;
  ignoreRowsWithoutProduct?: boolean;
};

type PreviewWarning = {
  rowNumber: number;
  message: string;
};

function sourceRowNumber(row: ReturnType<typeof mapPurchaseSpreadsheetRow>, fallback: number) {
  return row.sourceRowNumber ?? fallback;
}

function hasProductIdentity(row: ReturnType<typeof mapPurchaseSpreadsheetRow>) {
  return Boolean(row.productCode || (row.productDescription && row.productDescription !== "Produto nao informado"));
}

function hasAnyOperationalContent(row: ReturnType<typeof mapPurchaseSpreadsheetRow>) {
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

function dueDateDebug(row: ReturnType<typeof mapPurchaseSpreadsheetRow>) {
  return String(row.dueDates ?? "")
    .split(/[\n;,|]+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, parsed: parseDate(raw)?.toISOString().slice(0, 10) ?? null }));
}

function parseInstallmentCountFromPaymentMethod(paymentMethod: string | null) {
  return parseInstallmentCountFromPaymentMethodName(paymentMethod);
}

function isRepeatedDueDateColumn(header: string) {
  const normalized = normalizeHeader(header);
  return (
    normalized === "data" ||
    /^data \d+$/.test(normalized) ||
    normalized.startsWith("vencimento ") ||
    normalized.startsWith("data vencimento") ||
    normalized.startsWith("vcto") ||
    normalized.startsWith("vencto")
  );
}

function countDueDates(row: ReturnType<typeof mapPurchaseSpreadsheetRow>) {
  return dueDateDebug(row).filter((entry) => entry.parsed).length;
}

function previewDebugRows(
  entries: Array<{ rowNumber: number; row: ReturnType<typeof mapPurchaseSpreadsheetRow> }>,
  columns: Record<string, string | undefined>,
  warnings: PreviewWarning[]
) {
  const targets = new Set([191, 908, 918]);
  const byRowNumber = new Map<number, { rowNumber: number; row: ReturnType<typeof mapPurchaseSpreadsheetRow> }>();
  entries.forEach((entry) => {
    if (targets.has(entry.rowNumber)) byRowNumber.set(entry.rowNumber, entry);
  });
  return [...byRowNumber.values()]
    .filter((entry) => targets.has(entry.rowNumber))
    .map((entry) => ({
      rowNumber: entry.rowNumber,
      rawRow: entry.row.rawRow,
      detectedColumns: columns,
      productDetected: {
        code: entry.row.productCode,
        description: entry.row.productDescription,
        hasProduct: hasProductIdentity(entry.row)
      },
      unitDetected: entry.row.unit,
      invoiceDetected: entry.row.invoiceNumber,
      dueDatesDetected: dueDateDebug(entry.row),
      operationalContent: hasAnyOperationalContent(entry.row),
      alerts: warnings.filter((warning) => warning.rowNumber === entry.rowNumber).map((warning) => warning.message)
    }));
}

async function getCodeWarnings(
  rows: ReturnType<typeof mapPurchaseSpreadsheetRow>[]
): Promise<PreviewWarning[]> {
  const warnings: PreviewWarning[] = [];
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

    const supplierName = normalizeText(row.supplierName);
    if (supplierName && row.supplierCode) {
      const codes = supplierNameCodes.get(supplierName) ?? new Set<string>();
      codes.add(row.supplierCode);
      supplierNameCodes.set(supplierName, codes);
    }

    if (row.productCode) {
      const names = productCodeNames.get(row.productCode) ?? new Set<string>();
      names.add(normalizeText(row.productDescription));
      productCodeNames.set(row.productCode, names);
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

  const supplierCodes = [...supplierCodeNames.keys()];
  const productCodes = [...productCodeNames.keys()];
  const [existingSuppliers, existingProducts] = await Promise.all([
    supplierCodes.length
      ? prisma.supplier.findMany({ where: { externalCode: { in: supplierCodes } } })
      : [],
    productCodes.length ? prisma.product.findMany({ where: { externalCode: { in: productCodes } } }) : []
  ]);

  for (const supplier of existingSuppliers) {
    const sheetNames = supplier.externalCode ? supplierCodeNames.get(supplier.externalCode) : undefined;
    if (sheetNames && !sheetNames.has(normalizeText(supplier.name))) {
      warnings.push({
        rowNumber: 0,
        message: `Fornecedor ja cadastrado com codigo ${supplier.externalCode}, mas nome diferente no banco: ${supplier.name}.`
      });
    }
  }

  for (const product of existingProducts) {
    const sheetNames = product.externalCode ? productCodeNames.get(product.externalCode) : undefined;
    if (sheetNames && !sheetNames.has(normalizeText(product.name))) {
      warnings.push({
        rowNumber: 0,
        message: `Produto ja cadastrado com codigo ${product.externalCode}, mas nome diferente no banco: ${product.name}.`
      });
    }
  }

  return warnings;
}

function summarizeRows(rows: ReturnType<typeof mapPurchaseSpreadsheetRow>[]) {
  const categories = new Set<string>();
  const subcategories = new Set<string>();
  const paymentMethods = new Set<string>();
  let rowsWithDueDates = 0;
  let smallExpenses = 0;
  let purchasesWithoutInvoice = 0;
  let purchasesWithoutDueDate = 0;

  for (const row of rows) {
    if (row.categoryName) categories.add(row.categoryName);
    if (row.subcategoryName) subcategories.add(row.subcategoryName);
    if (row.paymentMethod) paymentMethods.add(row.paymentMethod);
    if (row.dueDates) rowsWithDueDates += 1;
    if (normalizeText(row.expenseType).includes("pequeno")) smallExpenses += 1;
    if (!row.invoiceNumber) purchasesWithoutInvoice += 1;
    if (!row.dueDates) purchasesWithoutDueDate += 1;
  }

  const groups = new Map<string, {
    invoiceNumber: string | null;
    supplierName: string;
    total: number;
    items: number;
    paymentMethod: string | null;
    dueDates: Set<string>;
  }>();
  rows.forEach((row) => {
    const key = purchaseGroupKey(row);
    const group = groups.get(key) ?? {
      invoiceNumber: row.invoiceNumber,
      supplierName: row.supplierName,
      total: 0,
      items: 0,
      paymentMethod: row.paymentMethod,
      dueDates: new Set<string>()
    };
    group.total += row.totalPrice;
    group.items += 1;
    for (const entry of dueDateDebug(row)) {
      if (entry.parsed) group.dueDates.add(entry.parsed);
    }
    groups.set(key, group);
  });
  const groupedInvoiceTotals = [...groups.values()].slice(0, 20).map((group) => ({
    invoiceNumber: group.invoiceNumber,
    supplierName: group.supplierName,
    total: group.total,
    items: group.items,
    paymentMethod: group.paymentMethod,
    dueDates: [...group.dueDates].sort(),
    expectedInstallments: Math.max(parseInstallmentCountFromPaymentMethod(group.paymentMethod) ?? 0, group.dueDates.size, 1)
  }));

  return {
    spreadsheetTotal: rows.reduce((sum, row) => sum + row.totalPrice, 0),
    groupedPurchases: groups.size,
    itemRows: rows.length,
    uniqueInvoices: new Set(rows.map((row) => row.invoiceNumber).filter(Boolean)).size,
    groupedInvoiceTotals,
    rowsWithDueDates,
    dueDatesDetected: rows.reduce((sum, row) => sum + countDueDates(row), 0),
    expectedInstallments: [...groups.values()].reduce((sum, group) => {
      return sum + Math.max(parseInstallmentCountFromPaymentMethod(group.paymentMethod) ?? 0, group.dueDates.size, 1);
    }, 0),
    smallExpenses,
    purchasesWithoutInvoice,
    purchasesWithoutDueDate,
    uniqueSuppliers: new Set(rows.map((row) => row.supplierCode || row.supplierName)).size,
    uniqueProducts: new Set(rows.map((row) => row.productCode || normalizeText(row.productDescription))).size,
    supplierCodes: [...new Set(rows.map((row) => row.supplierCode).filter(Boolean))],
    productCodes: [...new Set(rows.map((row) => row.productCode).filter(Boolean))],
    duplicateProducts: [],
    categories: [...categories].sort(),
    subcategories: [...subcategories].sort(),
    paymentMethods: [...paymentMethods].sort()
  };
}

function purchaseGroupKey(row: ReturnType<typeof mapPurchaseSpreadsheetRow>) {
  const normalizedReference = normalizePurchaseReference(row.invoiceNumber) || normalizePurchaseReference(row.purchaseOrderNumber) || `ROW${row.sourceRowNumber ?? ""}`;
  return [
    row.purchaseDate?.toISOString().slice(0, 10) ?? "",
    normalizeText(row.supplierCode || row.supplierDocument || row.supplierName),
    normalizedReference
  ].join("|");
}

async function getPurchaseDuplicateWarnings(
  rows: Array<{ rowNumber: number; row: ReturnType<typeof mapPurchaseSpreadsheetRow> }>
) {
  const warnings: PreviewWarning[] = [];
  const groups = new Map<string, Array<{ rowNumber: number; row: ReturnType<typeof mapPurchaseSpreadsheetRow> }>>();

  for (const entry of rows) {
    const key = purchaseGroupKey(entry.row);
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  const duplicateSheetKeys = new Map<string, number[]>();
  for (const entries of groups.values()) {
    const first = entries[0];
    const totalAmount = entries.reduce((sum, entry) => sum + entry.row.totalPrice, 0);
    const duplicateKey = [
      normalizeText(first.row.supplierCode || first.row.supplierDocument || first.row.supplierName),
      normalizePurchaseReference(first.row.invoiceNumber),
      normalizePurchaseReference(first.row.purchaseOrderNumber),
      totalAmount.toFixed(2)
    ].join("|");
    const list = duplicateSheetKeys.get(duplicateKey) ?? [];
    list.push(first.rowNumber);
    duplicateSheetKeys.set(duplicateKey, list);

    if (!first.row.invoiceNumber) warnings.push({ rowNumber: first.rowNumber, message: "Compra sem numero de NF." });
    if (!first.row.supplierName || first.row.supplierName === "Fornecedor nao informado") warnings.push({ rowNumber: first.rowNumber, message: "Compra sem fornecedor." });
    if (!first.row.purchaseDate) warnings.push({ rowNumber: first.rowNumber, message: "Compra sem data." });
    if (totalAmount <= 0) warnings.push({ rowNumber: first.rowNumber, message: "Compra sem total." });

    const supplier = await prisma.supplier.findFirst({
      where: {
        OR: [
          ...(first.row.supplierCode ? [{ externalCode: first.row.supplierCode }] : []),
          ...(first.row.supplierDocument ? [{ document: first.row.supplierDocument }] : []),
          { normalizedName: normalizeText(first.row.supplierName) },
          { name: { equals: first.row.supplierName, mode: "insensitive" } }
        ]
      }
    });
    if (supplier) {
      const matches = await findPurchaseReferenceMatches(prisma, {
        supplierId: supplier.id,
        invoiceNumber: first.row.invoiceNumber,
        purchaseOrderNumber: first.row.purchaseOrderNumber
      });
      if (matches.activeDuplicate) {
        warnings.push({
          rowNumber: first.rowNumber,
          message: `Bloqueio por duplicidade: ja existe compra ativa para ${supplier.name} com ${buildReferenceLabel({ invoiceNumber: first.row.invoiceNumber, purchaseOrderNumber: first.row.purchaseOrderNumber })}.`
        });
      } else if (matches.cancelledDuplicate) {
        warnings.push({
          rowNumber: first.rowNumber,
          message: `Aviso: existe compra cancelada para ${supplier.name} com ${buildReferenceLabel({ invoiceNumber: first.row.invoiceNumber, purchaseOrderNumber: first.row.purchaseOrderNumber })}.`
        });
      }
    }
  }

  duplicateSheetKeys.forEach((groupRows, key) => {
    if (groupRows.length > 1) {
      warnings.push({ rowNumber: 0, message: `Possivel NF/compra duplicada dentro da planilha nas linhas ${groupRows.join(", ")} (${key}).` });
    }
  });

  return warnings;
}

export async function previewPurchaseSpreadsheet(
  filePath: string,
  originalFileName?: string,
  options: PurchaseImportOptions = {}
) {
  const { sheetName, rows, debugRows: rawDebugRows = [], emptyRowsIgnored = 0 } = await readFirstWorksheetRows(filePath);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const columns = resolveColumns(headers, currentSpreadsheetMapping, rows);
  const recognizedHeaders = getRecognizedColumns(headers, currentSpreadsheetMapping, columns);
  const mappedRows = rows.map((row) => mapPurchaseSpreadsheetRow(row, columns));
  const mappedDebugRows = rawDebugRows.map((row) => mapPurchaseSpreadsheetRow(row, columns));
  const rowsWithRowNumbers = mappedRows.map((row, index) => ({ rowNumber: sourceRowNumber(row, index + 2), row }));
  const debugRowsWithRowNumbers = mappedDebugRows.map((row, index) => ({ rowNumber: sourceRowNumber(row, index + 2), row }));
  const emptyRows = rowsWithRowNumbers.filter((entry) => !hasAnyOperationalContent(entry.row));
  const operationalRows = rowsWithRowNumbers.filter((entry) => hasAnyOperationalContent(entry.row));
  const missingProductRows = operationalRows.filter((entry) => !hasProductIdentity(entry.row));
  const rowsForWarnings = operationalRows.map((entry) => entry.row);
  const rowsWithNumbers = rowsWithRowNumbers.filter((entry) => hasAnyOperationalContent(entry.row));
  const previewRows = rowsForWarnings.slice(0, 20);
  const warnings = await getCodeWarnings(rowsForWarnings);
  warnings.push(...(await getPurchaseDuplicateWarnings(rowsWithNumbers)));
  missingProductRows.slice(0, 10).forEach((entry) => {
    warnings.push({
      rowNumber: entry.rowNumber,
      message: "Linha com conteudo operacional, mas sem codigo/descricao de produto. Corrija o produto antes de confirmar."
    });
  });
  const totalEmptyRowsIgnored = emptyRowsIgnored + emptyRows.length;
  if (totalEmptyRowsIgnored > 0) {
    warnings.push({
      rowNumber: 0,
      message: `Total de linhas vazias ignoradas: ${totalEmptyRowsIgnored}. A linha 191 esta preenchida e sera importada quando estiver sem alerta.`
    });
  }
  const rowsWithoutUnit = operationalRows.filter((entry) => hasProductIdentity(entry.row) && !entry.row.unit);
  if (rowsWithoutUnit.length > 0) {
    warnings.push({
      rowNumber: 0,
      message: `${rowsWithoutUnit.length} itens sem unidade de medida. Amostra: linhas ${rowsWithoutUnit.slice(0, 10).map((entry) => entry.rowNumber).join(", ")}.`
    });
  }
  const conflicts = await detectPurchaseImportConflicts(rowsWithNumbers);
  const conflictSummary = summarizeConflictDecisions(conflicts);
  if (missingProductRows.length > 0) {
    warnings.push({
      rowNumber: 0,
      message: `${missingProductRows.length} linhas com conteudo estao sem codigo/descricao de produto. Amostra: linhas ${missingProductRows.slice(0, 10).map((entry) => entry.rowNumber).join(", ")}.`
    });
  }

  return {
    sheetName,
    totalRows: rows.length,
    importFileId: filePath.split(/[\\/]/).at(-1),
    originalFileName: originalFileName ?? null,
    detectedColumns: columns,
    unrecognizedColumns: headers.filter((header) => header !== "__rowNumber" && !recognizedHeaders.has(header) && !isRepeatedDueDateColumn(header)),
    missingRequiredFields: getMissingRequiredFields(columns, [...requiredPurchaseFields]),
    missingFields: Object.keys(currentSpreadsheetMapping).filter(
      (field) => !columns[field as keyof typeof currentSpreadsheetMapping]
    ),
    validation: { ...summarizeRows(operationalRows.map((entry) => entry.row)), emptyRowsIgnored: totalEmptyRowsIgnored },
    debugRows: previewDebugRows([...rowsWithRowNumbers, ...debugRowsWithRowNumbers], columns, warnings),
    conflicts,
    conflictSummary,
    warnings,
    previewRows
  };
}
