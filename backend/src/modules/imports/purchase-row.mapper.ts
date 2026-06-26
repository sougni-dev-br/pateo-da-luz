import { parseDate } from "../../shared/utils/parse-date.js";
import { parseMoney } from "../../shared/utils/parse-money.js";
import { normalizeHeader } from "../../shared/utils/normalize-text.js";
import { getCell, ResolvedColumnMap } from "./column-mapping/column-resolver.js";
import { PurchaseImportRow } from "./purchase-import.types.js";

function asText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function rowNumber(row: Record<string, unknown>) {
  return Number(row.__rowNumber ?? 0);
}

function dueDateText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return asText(value);
}

function collectDueDates(row: Record<string, unknown>, columns: ResolvedColumnMap) {
  const directValue = dueDateText(getCell(row, columns, "dueDates"));
  const values: string[] = [];
  if (directValue) values.push(directValue);

  for (const [header, value] of Object.entries(row)) {
    if (header === "__rowNumber") continue;
    const normalized = normalizeHeader(header);
    const isDueDate =
      normalized === "vencimento" ||
      normalized.startsWith("vencimento ") ||
      normalized.startsWith("data vencimento") ||
      normalized.startsWith("dt vencimento") ||
      normalized === "data" ||
      /^data \d+$/.test(normalized) ||
      normalized.startsWith("vcto") ||
      normalized.startsWith("vencto");
    if (!isDueDate) continue;
    const text = dueDateText(value);
    if (text && !values.includes(text)) values.push(text);
  }

  return values.length ? values.join("; ") : null;
}

export function mapPurchaseSpreadsheetRow(
  row: Record<string, unknown>,
  columns: ResolvedColumnMap
): PurchaseImportRow {
  const quantity = parseMoney(getCell(row, columns, "quantity"));
  const unitPrice = parseMoney(getCell(row, columns, "unitPrice"));
  const explicitTotal = parseMoney(getCell(row, columns, "totalPrice"));
  const calculatedTotal = quantity * unitPrice;

  const productCode = asText(getCell(row, columns, "productCode"));
  const productDescription = asText(getCell(row, columns, "productDescription")) ?? productCode ?? "Produto nao informado";

  return {
    purchaseDate: parseDate(getCell(row, columns, "purchaseDate")),
    receivedAt: parseDate(getCell(row, columns, "receivedAt")),
    supplierCode: asText(getCell(row, columns, "supplierCode")),
    invoiceNumber: asText(getCell(row, columns, "invoiceNumber")),
    purchaseOrderNumber: asText(getCell(row, columns, "purchaseOrderNumber")),
    supplierDocument: asText(getCell(row, columns, "supplierDocument")),
    supplierName: asText(getCell(row, columns, "supplierName")) ?? "Fornecedor nao informado",
    productCode,
    categoryName: asText(getCell(row, columns, "categoryName")),
    subcategoryName: asText(getCell(row, columns, "subcategoryName")),
    expenseType: asText(getCell(row, columns, "expenseType")),
    productDescription,
    unit: asText(getCell(row, columns, "unit")),
    quantity,
    unitPrice,
    totalPrice: explicitTotal || calculatedTotal,
    paymentMethod: asText(getCell(row, columns, "paymentMethod")),
    dueDates: collectDueDates(row, columns),
    sourceRowNumber: rowNumber(row) || null,
    rawRow: row
  };
}
