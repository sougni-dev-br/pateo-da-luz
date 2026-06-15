import { normalizeHeader } from "../../../shared/utils/normalize-text.js";

export type ResolvedColumnMap<T extends string = string> = Partial<Record<T, string>>;
export type ColumnMapping<T extends string = string> = Record<T, string[]>;

export function resolveColumns<T extends string>(
  headers: string[],
  mapping: ColumnMapping<T>,
  rows: Record<string, unknown>[] = []
): ResolvedColumnMap<T> {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const normalizedHeaderEntries = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header)
  }));
  const resolved: ResolvedColumnMap<T> = {};
  const usedColumns = new Set<string>();

  for (const [field, aliases] of Object.entries(mapping) as [T, string[]][]) {
    const candidates: Array<{ column: string; aliasIndex: number; filledCount: number }> = [];

    aliases.forEach((alias, aliasIndex) => {
      const column = normalizedHeaders.get(normalizeHeader(alias));
      if (column && !usedColumns.has(column)) {
        candidates.push({ column, aliasIndex, filledCount: countFilledRows(rows, column) });
      }
    });

    const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));
    normalizedHeaderEntries.forEach(({ original, normalized }) => {
      if (usedColumns.has(original) || candidates.some((candidate) => candidate.column === original)) return;
      const aliasIndex = normalizedAliases.findIndex((alias) => normalized.includes(alias) || alias.includes(normalized));
      if (aliasIndex >= 0) {
        candidates.push({ column: original, aliasIndex, filledCount: countFilledRows(rows, original) });
      }
    });

    if (candidates.length > 0) {
      const best = candidates.sort((left, right) =>
        right.filledCount - left.filledCount || left.aliasIndex - right.aliasIndex
      )[0];
      resolved[field] = best.column;
      usedColumns.add(best.column);
      continue;
    }
  }

  return resolved;
}

function countFilledRows(rows: Record<string, unknown>[], column: string) {
  return rows.filter((row) => String(row[column] ?? "").trim()).length;
}

export function getRecognizedColumns<T extends string>(
  headers: string[],
  mapping: ColumnMapping<T>,
  resolvedColumns: ResolvedColumnMap<T> = {}
) {
  const recognized = new Set(Object.values(resolvedColumns).filter(Boolean));
  const aliasHeaders = new Set(
    Object.values(mapping)
      .flat()
      .map((alias) => normalizeHeader(alias))
  );

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (aliasHeaders.has(normalized)) {
      recognized.add(header);
    }
  }

  return recognized;
}

export function getCell<T extends string>(
  row: Record<string, unknown>,
  resolvedColumns: ResolvedColumnMap<T>,
  field: T
): unknown {
  const column = resolvedColumns[field];
  return column ? row[column] : undefined;
}

export function getMissingRequiredFields<T extends string>(
  resolvedColumns: ResolvedColumnMap<T>,
  requiredFields: T[]
): T[] {
  return requiredFields.filter((field) => !resolvedColumns[field]);
}
