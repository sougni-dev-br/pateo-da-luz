import crypto from "node:crypto";
import ExcelJS from "exceljs";

export type TaxImportRow = {
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  documentType: string | null;
  description: string | null;
  competenceDate: Date | null;
  dueDate: Date | null;
  amount: number | null;
  paymentDate: Date | null;
  comments: string | null;
  rawRow: Record<string, unknown>;
  rowIndex: number;
};

export type TaxImportRowResult = TaxImportRow & {
  valid: boolean;
  errors: string[];
  isDuplicate: boolean;
  dedupKey: string | null;
};

export type TaxImportPreview = {
  importFileId: string;
  filePath: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  pendingRows: number;
  paidRows: number;
  rows: TaxImportRowResult[];
  byCompany: Record<string, { legalName: string | null; tradeName: string | null; count: number; total: number }>;
  byDocumentType: Record<string, { count: number; total: number }>;
};

const EXCEL_DATE_ORIGIN = new Date(1900, 0, 1);

function excelSerialToDate(serial: number): Date | null {
  if (serial < 1 || serial > 100000) return null;
  const adjusted = serial > 59 ? serial - 1 : serial;
  const date = new Date(EXCEL_DATE_ORIGIN);
  date.setDate(date.getDate() + adjusted - 1);
  return date;
}

const DATE_INVALID_TEXTS = new Set([
  "sem data", "semdatas", "anual", "diversos", "n/a", "na", "-", "", "indefinido",
]);

function parseFlexibleDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  if (typeof value === "number") {
    return excelSerialToDate(value);
  }

  const text = String(value).trim().toLowerCase();
  if (DATE_INVALID_TEXTS.has(text)) return null;

  // Normalizar formatos estranhos: "04/026" -> ignorar, "20/022/25" -> ignorar
  const parts = text.replace(/\//g, "/").split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts.map((p) => p.replace(/\D/g, ""));
    if (!d || !m || !y || d.length > 2 || m.length > 2) return null;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const month = Number(m) - 1;
    const day = Number(d);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  }

  // ISO format YYYY-MM-DD
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function normalizeCnpj(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length <= 11) return digits.padStart(11, "0"); // CPF
  return digits.padStart(14, "0").slice(0, 14); // CNPJ
}

function parseAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return isNaN(value) ? null : Math.abs(value);
  const text = String(value).trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const num = parseFloat(text);
  return isNaN(num) ? null : Math.abs(num);
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

function normalizeCellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return (v as { result: unknown }).result ?? null;
    if ("text" in v) return (v as { text: string }).text;
    if ("richText" in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
  }
  return v;
}

async function readSheet(filePath: string, sheetName: string): Promise<Record<string, unknown>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= headerRow.cellCount; c++) {
    headers.push(String(normalizeCellValue(headerRow.getCell(c)) ?? "").trim().toUpperCase());
  }

  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    const obj: Record<string, unknown> = { _rowIndex: rowIndex };
    headers.forEach((h, i) => {
      obj[h] = normalizeCellValue(row.getCell(i + 1));
    });
    const hasData = headers.some((h) => obj[h] != null && String(obj[h]).trim() !== "");
    if (hasData) rows.push(obj);
  });
  return rows;
}

function headerVariants(headers: string[], ...candidates: string[]): string | null {
  const upper = candidates.map((c) => c.toUpperCase());
  return headers.find((h) => upper.some((u) => h.includes(u))) ?? null;
}

function buildCompanyMap(empresasRows: Record<string, unknown>[]): Map<string, { legalName: string | null; tradeName: string | null }> {
  const map = new Map<string, { legalName: string | null; tradeName: string | null }>();
  const headers = empresasRows.length > 0 ? Object.keys(empresasRows[0]) : [];
  const cnpjHeader = headerVariants(headers, "CNPJ") ?? "CNPJ";
  const razaoHeader = headerVariants(headers, "RAZAO SOCIAL", "RAZÃO SOCIAL") ?? "RAZÃO SOCIAL";
  const fantasiaHeader = headerVariants(headers, "NOME FANTASIA", "FANTASIA") ?? "NOME FANTASIA";

  for (const row of empresasRows) {
    const cnpj = normalizeCnpj(row[cnpjHeader]);
    if (!cnpj) continue;
    map.set(cnpj, {
      legalName: cleanText(row[razaoHeader]),
      tradeName: cleanText(row[fantasiaHeader]),
    });
  }
  return map;
}

function makeDedupKey(row: TaxImportRow): string | null {
  if (!row.cnpj || !row.documentType || !row.dueDate || row.amount == null) return null;
  const comp = row.competenceDate ? row.competenceDate.toISOString().slice(0, 10) : "null";
  const due = row.dueDate.toISOString().slice(0, 10);
  const desc = (row.description ?? "").toLowerCase().trim();
  const raw = `${row.cnpj}|${row.documentType}|${desc}|${comp}|${due}|${row.amount}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function previewTaxImport(
  filePath: string,
  existingDedupKeys: Set<string>
): Promise<TaxImportPreview> {
  const importFileId = crypto.randomUUID();

  let empresasRows: Record<string, unknown>[] = [];
  try {
    empresasRows = await readSheet(filePath, "Empresas");
  } catch {
    // sheet might not exist
  }

  let impostosRows: Record<string, unknown>[] = [];
  try {
    impostosRows = await readSheet(filePath, "Impostos");
  } catch {
    impostosRows = await readSheet(filePath, "Sheet1").catch(() => []);
  }

  const companyMap = buildCompanyMap(empresasRows);
  const headers = impostosRows.length > 0 ? Object.keys(impostosRows[0]) : [];

  const cnpjH = headerVariants(headers, "CNPJ") ?? "CNPJ";
  const razaoH = headerVariants(headers, "RAZAO SOCIAL", "RAZÃO SOCIAL") ?? "RAZÃO SOCIAL";
  const fantasiaH = headerVariants(headers, "NOME FANTASIA", "FANTASIA") ?? "NOME FANTASIA";
  const orgaoH = headerVariants(headers, "ORGAO", "ÓRGÃO", "ORGÃO", "DOCUMENTO") ?? "ORGÃO / DOCUMENTO";
  const descH = headerVariants(headers, "DESCRICAO", "DESCRIÇÃO", "DESCRICAO") ?? "DESCRIÇÃO";
  const compH = headerVariants(headers, "COMPETENCIA", "COMPETÊNCIA") ?? "COMPETENCIA";
  const vencH = headerVariants(headers, "VENCIMENTO") ?? "VENCIMENTO";
  const valorH = headerVariants(headers, "VALOR") ?? "VALOR";
  const pagtoH = headerVariants(headers, "DATA PAGAMENTO", "PAGAMENTO", "PAGO") ?? "DATA PAGAMENTO";
  const obsH = headerVariants(headers, "COMENTARIOS", "COMENTÁRIOS", "OBS", "OBSERV") ?? "COMENTÁRIOS";

  const seenKeys = new Set<string>();
  const results: TaxImportRowResult[] = [];

  for (const raw of impostosRows) {
    const rowIndex = Number(raw["_rowIndex"] ?? 0);
    const cnpj = normalizeCnpj(raw[cnpjH]);
    const companyInfo = cnpj ? companyMap.get(cnpj) : undefined;

    const row: TaxImportRow = {
      cnpj,
      legalName: cleanText(raw[razaoH]) ?? companyInfo?.legalName ?? null,
      tradeName: cleanText(raw[fantasiaH]) ?? companyInfo?.tradeName ?? null,
      documentType: cleanText(raw[orgaoH]),
      description: cleanText(raw[descH]),
      competenceDate: parseFlexibleDate(raw[compH]),
      dueDate: parseFlexibleDate(raw[vencH]),
      amount: parseAmount(raw[valorH]),
      paymentDate: parseFlexibleDate(raw[pagtoH]),
      comments: cleanText(raw[obsH]),
      rawRow: raw,
      rowIndex,
    };

    const errors: string[] = [];
    if (!row.documentType) errors.push("Tipo de documento (ÓRGÃO/DOCUMENTO) obrigatório");
    if (!row.dueDate) errors.push("Vencimento inválido ou ausente");
    if (row.amount == null) errors.push("Valor inválido ou ausente");

    const dedupKey = makeDedupKey(row);
    const isDuplicate = dedupKey != null && (existingDedupKeys.has(dedupKey) || seenKeys.has(dedupKey));
    if (dedupKey) seenKeys.add(dedupKey);

    results.push({ ...row, valid: errors.length === 0, errors, isDuplicate, dedupKey });
  }

  const validRows = results.filter((r) => r.valid && !r.isDuplicate).length;
  const invalidRows = results.filter((r) => !r.valid).length;
  const duplicateRows = results.filter((r) => r.valid && r.isDuplicate).length;
  const pendingRows = results.filter((r) => r.valid && !r.paymentDate).length;
  const paidRows = results.filter((r) => r.valid && r.paymentDate != null).length;

  const byCompany: TaxImportPreview["byCompany"] = {};
  const byDocumentType: TaxImportPreview["byDocumentType"] = {};

  for (const r of results) {
    if (!r.valid) continue;
    const key = r.cnpj ?? "sem-cnpj";
    if (!byCompany[key]) byCompany[key] = { legalName: r.legalName, tradeName: r.tradeName, count: 0, total: 0 };
    byCompany[key].count += 1;
    byCompany[key].total += r.amount ?? 0;

    const dt = r.documentType ?? "Sem tipo";
    if (!byDocumentType[dt]) byDocumentType[dt] = { count: 0, total: 0 };
    byDocumentType[dt].count += 1;
    byDocumentType[dt].total += r.amount ?? 0;
  }

  return {
    importFileId,
    filePath,
    totalRows: impostosRows.length,
    validRows,
    invalidRows,
    duplicateRows,
    pendingRows,
    paidRows,
    rows: results,
    byCompany,
    byDocumentType,
  };
}
