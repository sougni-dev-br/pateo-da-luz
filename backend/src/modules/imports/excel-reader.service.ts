import ExcelJS from "exceljs";

function cellToValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;

  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    if ("result" in value) return value.result ?? null;
    if ("text" in value) return value.text;
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("formula" in value || "sharedFormula" in value) return null;
  }

  return value;
}

function uniqueHeaders(rawHeaders: string[]) {
  const seen = new Map<string, number>();
  return rawHeaders.map((header) => {
    const normalized = header.trim();
    if (!normalized) return "";
    const count = (seen.get(normalized) ?? 0) + 1;
    seen.set(normalized, count);
    return count === 1 ? normalized : `${normalized} ${count}`;
  });
}

export async function readFirstWorksheetRows(filePath: string) {
  return readWorksheetRows(filePath);
}

export async function readWorkbookSheetNames(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  return workbook.worksheets.map((worksheet) => worksheet.name);
}

export async function readWorksheetRows(filePath: string, sheetName?: string | null) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0];

  if (!worksheet) {
    return { sheetName: null, rows: [] as Record<string, unknown>[] };
  }

  const headerRow = worksheet.getRow(1);
  const rawHeaders: string[] = [];

  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    rawHeaders.push(String(cellToValue(headerRow.getCell(column)) ?? "").trim());
  }
  const headers = uniqueHeaders(rawHeaders);

  const rows: Record<string, unknown>[] = [];
  const debugRows: Record<string, unknown>[] = [];
  const debugRowNumbers = new Set([191, 908, 918]);
  let emptyRowsIgnored = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const item: Record<string, unknown> = {};
    let hasValue = false;

    headers.forEach((header: string, index: number) => {
      if (!header) return;

      const value = cellToValue(row.getCell(index + 1));
      item[header] = value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasValue = true;
      }
    });

    item.__rowNumber = rowNumber;
    if (debugRowNumbers.has(rowNumber)) {
      debugRows.push({ ...item });
    }

    if (hasValue) {
      rows.push(item);
    } else {
      emptyRowsIgnored += 1;
    }
  });

  return {
    sheetName: worksheet.name,
    rows,
    debugRows,
    emptyRowsIgnored
  };
}
