import crypto from "node:crypto";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeHeader, normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { parseMoney } from "../../shared/utils/parse-money.js";
import { readWorksheetRows } from "../imports/excel-reader.service.js";

type InventorySnapshotType = "INVENTARIO_INICIAL" | "INVENTARIO_FINAL" | "CONTAGEM_PARCIAL" | "AJUSTE";
type MonthlyRole = "ADMIN" | "GESTAO_COMPLETA" | "ESTOQUISTA" | "VISUALIZACAO";

type InventoryRow = {
  rowNumber: number;
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  countDate: Date | null;
  productId: string | null;
  resolutionStatus: "MATCHED" | "PENDING";
};

const inventoryColumnMapping = {
  productCode: ["COD PRODUTO", "COD. PRODUTO", "CD. PRODUTO", "C. PRODUTO", "CODIGO PRODUTO"],
  productName: ["ITEM/DESCRICAO", "ITEM / DESCRICAO", "DESCRICAO", "DESCRIÇÃO", "PRODUTO", "ITEM"],
  sectorName: ["SETOR"],
  categoryName: ["CATEGORIA"],
  subcategoryName: ["SUB CATEGORIA", "SUB. CATEGORIA", "SUBCATEGORIA"],
  unit: ["UN", "UND", "UNIDADE", "UNIDADES", "U. MEDIDA", "U MEDIDA"],
  quantity: ["QUANTIDADE", "QTDE", "QTD", "QUANTIDADE CONTADA", "ESTOQUE", "SALDO"],
  unitCost: ["CUSTO UNITARIO", "CUSTO UNITÁRIO", "V.UNI", "V UNI", "VALOR UNITARIO"],
  totalCost: ["CUSTO TOTAL", "V.TOTAL", "V TOTAL", "VALOR TOTAL", "TOTAL"],
  countDate: ["DATA CONTAGEM", "DT CONTAGEM", "DATA", "DT"],
  competence: ["COMPETENCIA", "COMPETÊNCIA"]
} as const;

const inventoryColumnMappingV2 = {
  productCode: ["CODIGO", "CODIGO PRODUTO", "COD PRODUTO", "COD. PRODUTO", "CD PRODUTO", "CD. PRODUTO", "C. PRODUTO", "C PRODUTO"],
  productName: ["ITEM/DESCRICAO", "ITEM / DESCRICAO", "ITEM DESCRICAO", "DESCRICAO", "DESCRICAO PRODUTO", "ITEM", "PRODUTO"],
  sectorName: ["SETOR"],
  categoryName: ["CATEGORIA"],
  subcategoryName: ["SUB CATEGORIA", "SUB. CATEGORIA", "SUBCATEGORIA"],
  unit: ["UNIDADE", "UNIDADES", "U. MEDIDA", "U MEDIDA", "UND", "UN"],
  quantity: ["QTDE", "QTD", "QUANTIDADE", "QUANTIDADE CONTADA", "EST", "ESTOQUE", "SALDO"],
  unitCost: ["CUSTO UNITARIO", "CUSTO UNIT.", "CUSTO UNITARIO", "CUSTO UNIT", "CUSTO UNITÁRIO", "VALOR UNITARIO", "V.UNI", "V UNI"],
  totalCost: ["CUSTO TOTAL", "V.TOTAL", "V TOTAL", "VALOR TOTAL", "TOTAL"],
  countDate: ["DATA CONTAGEM", "DT CONTAGEM", "DATA", "DT"],
  competence: ["COMPETENCIA"]
} as const;

function safeUploadPath(importFileId: string): string {
  return path.resolve("uploads", path.basename(importFileId));
}

function asText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumMoney(values: Array<number | null | undefined>) {
  const cents = values.reduce<number>((sum, value) => sum + Math.round(roundMoney(Number(value ?? 0)) * 100), 0);
  return cents / 100;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAliasPhrase(normalizedHeader: string, normalizedAlias: string) {
  const pattern = normalizedAlias
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
  if (!pattern) return false;
  return new RegExp(`(^|\\s)${pattern}(\\s|$)`).test(normalizedHeader);
}

function looksLikeCodeHeader(normalizedHeader: string) {
  return normalizedHeader === "codigo" || normalizedHeader.includes("cod") || normalizedHeader.startsWith("cd ");
}

function looksLikeCostHeader(normalizedHeader: string) {
  return ["custo", "valor", "preco", "preco", "price", "total"].some((token) => normalizedHeader.includes(token));
}

function looksLikeQuantityHeader(normalizedHeader: string) {
  return ["qtd", "qtde", "quantidade", "estoque", "saldo"].some((token) => normalizedHeader.includes(token)) || normalizedHeader.startsWith("est ");
}

function resolveColumns(headers: string[], rows: Record<string, unknown>[]) {
  const entries = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const columns: Record<string, string> = {};
  const recognized = new Set<string>();

  for (const [field, aliases] of Object.entries(inventoryColumnMappingV2)) {
    const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));
    const candidates = entries
      .filter((entry) => isInventoryColumnCandidate(field, entry, normalizedAliases, rows))
      .map((entry) => ({
        header: entry.header,
        filled: rows.filter((row) => String(row[entry.header] ?? "").trim()).length,
        aliasIndex: normalizedAliases.findIndex((alias) => columnAliasMatches(field, entry.normalized, alias))
      }))
      .sort((left, right) => right.filled - left.filled || left.aliasIndex - right.aliasIndex);

    if (candidates[0]) {
      columns[field] = candidates[0].header;
    }

    for (const entry of entries) {
      if (normalizedAliases.includes(entry.normalized)) recognized.add(entry.header);
    }
  }

  for (const entry of entries) {
    if (entry.normalized === "produto" && isBooleanIndicatorColumn(rows, entry.header)) {
      recognized.add(entry.header);
    }
  }

  return { columns, recognized };
}

function columnAliasMatches(field: string, normalizedHeader: string, normalizedAlias: string) {
  if (field === "productCode") {
    return looksLikeCodeHeader(normalizedHeader) && matchesAliasPhrase(normalizedHeader, normalizedAlias);
  }

  if (field === "quantity" && normalizedAlias === "est") {
    return normalizedHeader === "est" || normalizedHeader.startsWith("est ");
  }

  if (field === "productName") {
    return !looksLikeCodeHeader(normalizedHeader)
      && !looksLikeCostHeader(normalizedHeader)
      && !looksLikeQuantityHeader(normalizedHeader)
      && (matchesAliasPhrase(normalizedHeader, normalizedAlias) || normalizedHeader.includes("descricao") || normalizedHeader.startsWith("item "));
  }

  if (field === "unit") {
    return !looksLikeCostHeader(normalizedHeader)
      && !looksLikeQuantityHeader(normalizedHeader)
      && !looksLikeCodeHeader(normalizedHeader)
      && matchesAliasPhrase(normalizedHeader, normalizedAlias);
  }

  if (field === "unitCost") {
    return matchesAliasPhrase(normalizedHeader, normalizedAlias) || normalizedHeader.includes("custo unit") || normalizedHeader.includes("valor unit") || normalizedHeader.includes("v uni");
  }

  if (field === "totalCost") {
    return matchesAliasPhrase(normalizedHeader, normalizedAlias) || normalizedHeader.includes("custo total") || normalizedHeader.includes("valor total") || normalizedHeader.includes("v total");
  }

  return matchesAliasPhrase(normalizedHeader, normalizedAlias);
}

function isBooleanIndicatorColumn(rows: Record<string, unknown>[], header: string) {
  const values = rows
    .map((row) => normalizeText(row[header]))
    .filter(Boolean);
  if (!values.length) return false;
  const booleanLike = values.filter((value) => ["sim", "nao", "s", "n", "yes", "no"].includes(value)).length;
  return booleanLike / values.length >= 0.8;
}

function isInventoryColumnCandidate(
  field: string,
  entry: { header: string; normalized: string },
  normalizedAliases: string[],
  rows: Record<string, unknown>[]
) {
  if (field === "productName") {
    if (entry.normalized.includes("cod") || entry.normalized.startsWith("cd ")) return false;
    if (looksLikeCostHeader(entry.normalized)) return false;
    if (looksLikeQuantityHeader(entry.normalized)) return false;
    if (entry.normalized === "produto" && isBooleanIndicatorColumn(rows, entry.header)) return false;
  }

  if (field === "unit") {
    if (looksLikeCostHeader(entry.normalized)) return false;
    if (looksLikeQuantityHeader(entry.normalized)) return false;
    if (looksLikeCodeHeader(entry.normalized)) return false;
  }

  if (field === "productCode") {
    if (!looksLikeCodeHeader(entry.normalized)) return false;
  }

  if (field === "quantity") {
    if (looksLikeCostHeader(entry.normalized)) return false;
  }

  return normalizedAliases.some((alias) => columnAliasMatches(field, entry.normalized, alias));
}

function cell(row: Record<string, unknown>, columns: Record<string, string>, field: string) {
  const column = columns[field];
  return column ? row[column] : undefined;
}

async function resolveProducts(rows: Omit<InventoryRow, "productId" | "resolutionStatus">[]) {
  const codes = [...new Set(rows.map((row) => row.productCode).filter(Boolean))] as string[];
  const names = [...new Set(rows.map((row) => normalizeText(row.productName)).filter(Boolean))];
  const [byCode, byName] = await Promise.all([
    codes.length
      ? prisma.product.findMany({ where: { externalCode: { in: codes } }, select: { id: true, externalCode: true, normalizedName: true } })
      : [],
    names.length
      ? prisma.product.findMany({ where: { normalizedName: { in: names } }, select: { id: true, externalCode: true, normalizedName: true } })
      : []
  ]);

  const byCodeMap = new Map(byCode.map((product) => [product.externalCode, product.id]));
  const byNameMap = new Map(byName.map((product) => [product.normalizedName, product.id]));

  return rows.map<InventoryRow>((row) => {
    const productId = (row.productCode ? byCodeMap.get(row.productCode) : null) ?? byNameMap.get(normalizeText(row.productName)) ?? null;
    return { ...row, productId, resolutionStatus: productId ? "MATCHED" : "PENDING" };
  });
}

export async function previewInventorySnapshot(filePath: string, originalFileName: string | null, sheetName?: string | null) {
  const worksheet = await readWorksheetRows(filePath, sheetName);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]).filter((header) => !header.startsWith("__")) : [];
  const { columns, recognized } = resolveColumns(headers, worksheet.rows);

  const parsedRows = worksheet.rows
    .map((row, index) => {
      const quantity = parseMoney(cell(row, columns, "quantity"));
      const unitCostRaw = cell(row, columns, "unitCost");
      const totalCostRaw = cell(row, columns, "totalCost");
      const unitCost = unitCostRaw == null || String(unitCostRaw).trim() === "" ? null : parseMoney(unitCostRaw);
      const totalCost = totalCostRaw == null || String(totalCostRaw).trim() === ""
        ? unitCost == null ? null : roundMoney(quantity * unitCost)
        : roundMoney(parseMoney(totalCostRaw));
      return {
        rowNumber: Number(row.__rowNumber ?? index + 2),
        productCode: asText(cell(row, columns, "productCode")),
        productName: asText(cell(row, columns, "productName")) ?? "",
        sectorName: asText(cell(row, columns, "sectorName")),
        categoryName: asText(cell(row, columns, "categoryName")),
        subcategoryName: asText(cell(row, columns, "subcategoryName")),
        unit: asText(cell(row, columns, "unit")),
        quantity,
        unitCost,
        totalCost,
        countDate: parseDate(cell(row, columns, "countDate"))
      };
    })
    .filter((row) => row.productName || row.productCode || row.quantity !== 0);

  const rows = await resolveProducts(parsedRows);
  const warnings = [];
  const withoutUnit = rows.filter((row) => !row.unit).length;
  const pending = rows.filter((row) => row.resolutionStatus === "PENDING").length;
  if (withoutUnit) warnings.push({ rowNumber: 0, message: `${withoutUnit} itens sem unidade de medida.` });
  if (pending) warnings.push({ rowNumber: 0, message: `${pending} itens pendentes de resolucao de produto.` });

  return {
    sheetName: worksheet.sheetName,
    importFileId: path.basename(filePath),
    originalFileName,
      totalRows: rows.length,
      detectedColumns: columns,
      unrecognizedColumns: headers.filter((header) => !recognized.has(header) && !Object.values(columns).includes(header)),
      validation: {
        matchedItems: rows.filter((row) => row.resolutionStatus === "MATCHED").length,
        pendingItems: pending,
        totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalValue: sumMoney(rows.map((row) => row.totalCost))
      },
    warnings,
    previewRows: rows.slice(0, 30)
  };
}

async function ensureCompetenceOpen(year: number, month: number) {
  const [closed] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "MonthlyCmv"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
      AND "status" = 'CLOSED'
    LIMIT 1
  `;
  if (closed) throw new Error("Competencia fechada. Reabra antes de alterar dados.");
}

function nextCompetence(year: number, month: number) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

async function cloneFinalAsNextInitial(tx: Prisma.TransactionClient, snapshotId: string, input: {
  competenceYear: number;
  competenceMonth: number;
  countDate: Date;
  originalFileName?: string | null;
  userId: string;
  userRole: MonthlyRole;
}) {
  const next = nextCompetence(input.competenceYear, input.competenceMonth);
  const [existingInitial] = await tx.$queryRaw<Array<{
    id: string;
    isAutoLinkedInitial: boolean;
    status: string;
  }>>`
    SELECT "id", "isAutoLinkedInitial", "status"
    FROM "InventorySnapshot"
    WHERE "competenceYear" = ${next.year}
      AND "competenceMonth" = ${next.month}
      AND "type" = CAST('INVENTARIO_INICIAL' AS "InventorySnapshotType")
      AND "status" <> 'CANCELLED'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  if (existingInitial && !existingInitial.isAutoLinkedInitial && input.userRole !== "ADMIN") {
    throw new Error("O mes seguinte ja possui inventario inicial manual. Apenas ADMIN pode revisar esse vinculo.");
  }

  if (existingInitial) {
    await tx.$executeRaw`
      UPDATE "InventorySnapshot"
      SET "status" = 'CANCELLED',
          "cancelledAt" = CURRENT_TIMESTAMP,
          "cancelledByUserId" = ${input.userId},
          "cancellationReason" = 'Substituido automaticamente por novo inventario final do mes anterior'
      WHERE "id" = ${existingInitial.id}
    `;
  }

  const [finalSnapshot] = await tx.$queryRaw<Array<{ totalItems: number; totalValue: Prisma.Decimal | number }>>`
    SELECT "totalItems", "totalValue"
    FROM "InventorySnapshot"
    WHERE "id" = ${snapshotId}
    LIMIT 1
  `;
  const linkedInitialId = crypto.randomUUID();

  await tx.$executeRaw`
    INSERT INTO "InventorySnapshot" (
      "id", "competenceYear", "competenceMonth", "type", "countDate", "totalItems", "totalValue",
      "importFileId", "originalFileName", "createdByUserId", "notes", "linkedFromSnapshotId",
      "isAutoLinkedInitial", "updatedAt"
    )
    VALUES (
      ${linkedInitialId}, ${next.year}, ${next.month}, CAST('INVENTARIO_INICIAL' AS "InventorySnapshotType"),
      ${input.countDate}, ${Number(finalSnapshot?.totalItems ?? 0)}, ${Number(finalSnapshot?.totalValue ?? 0)},
      ${snapshotId}, ${input.originalFileName ?? null}, ${input.userId},
      ${`Gerado automaticamente a partir do inventario final ${String(input.competenceMonth).padStart(2, "0")}/${input.competenceYear}.`},
      ${snapshotId}, true, CURRENT_TIMESTAMP
    )
  `;

  const items = await tx.$queryRaw<Array<InventoryRow>>`
    SELECT
      "productId", "productCode", "productName", "sectorName", "categoryName", "subcategoryName",
      "unit", "quantity", "unitCost", "totalCost", "sourceRowNumber" AS "rowNumber", "resolutionStatus"
    FROM "InventorySnapshotItem"
    WHERE "snapshotId" = ${snapshotId}
  `;

  for (const item of items) {
    await tx.$executeRaw`
      INSERT INTO "InventorySnapshotItem" (
        "id", "snapshotId", "productId", "productCode", "productName", "sectorName", "categoryName",
        "subcategoryName", "unit", "quantity", "unitCost", "totalCost", "sourceRowNumber", "resolutionStatus"
      )
      VALUES (
        ${crypto.randomUUID()}, ${linkedInitialId}, ${item.productId}, ${item.productCode}, ${item.productName},
        ${item.sectorName}, ${item.categoryName}, ${item.subcategoryName}, ${item.unit}, ${item.quantity},
        ${item.unitCost}, ${item.totalCost}, ${item.rowNumber}, ${item.resolutionStatus}
      )
    `;
  }

  return linkedInitialId;
}

export async function confirmInventorySnapshot(input: {
  importFileId: string;
  originalFileName?: string | null;
  sheetName?: string | null;
  competenceYear: number;
  competenceMonth: number;
  type: InventorySnapshotType;
  countDate: Date;
  notes?: string | null;
  allowOverwrite?: boolean;
  overwriteReason?: string | null;
  userId: string;
  userRole: MonthlyRole;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await ensureCompetenceOpen(input.competenceYear, input.competenceMonth);
  if (input.allowOverwrite && input.userRole !== "ADMIN") {
    throw new Error("Apenas ADMIN pode substituir inventarios existentes.");
  }

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "InventorySnapshot"
    WHERE "competenceYear" = ${input.competenceYear}
      AND "competenceMonth" = ${input.competenceMonth}
      AND "type" = CAST(${input.type} AS "InventorySnapshotType")
      AND "status" <> 'CANCELLED'
    LIMIT 1
  `;
  if (existing[0] && !input.allowOverwrite) {
    throw new Error("Ja existe inventario ativo para esta competencia e tipo.");
  }
  if (existing[0] && input.allowOverwrite && !input.overwriteReason?.trim()) {
    throw new Error("Motivo obrigatorio para substituir inventario existente.");
  }
  if (input.type === "INVENTARIO_INICIAL" && existing[0] && input.userRole !== "ADMIN") {
    throw new Error("Inventario inicial vinculado so pode ser alterado por ADMIN.");
  }

  const preview = await previewInventorySnapshot(safeUploadPath(input.importFileId), input.originalFileName ?? null, input.sheetName);
  const fullRows = await getAllInventoryRows(safeUploadPath(input.importFileId), input.sheetName);
  const totalValue = sumMoney(fullRows.map((row) => row.totalCost));
  let storedTotalValue = totalValue;
  const snapshotId = crypto.randomUUID();

  let linkedInitialSnapshotId: string | null = null;

  await prisma.$transaction(async (tx) => {
    if (existing[0]) {
      await tx.$executeRaw`
        UPDATE "InventorySnapshot"
        SET "status" = 'CANCELLED',
            "cancelledAt" = CURRENT_TIMESTAMP,
            "cancelledByUserId" = ${input.userId},
            "cancellationReason" = ${input.overwriteReason}
        WHERE "id" = ${existing[0].id}
      `;
    }

    if (input.type === "INVENTARIO_INICIAL") {
      const [linkedInitial] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "InventorySnapshot"
        WHERE "id" = ${existing[0]?.id ?? ""}
          AND "isAutoLinkedInitial" = true
        LIMIT 1
      `;
      if (linkedInitial && input.userRole !== "ADMIN") {
        throw new Error("Inventario inicial automatico so pode ser desbloqueado por ADMIN.");
      }
    }

    await tx.$executeRaw`
      INSERT INTO "InventorySnapshot" (
        "id", "competenceYear", "competenceMonth", "type", "countDate", "totalItems", "totalValue",
        "importFileId", "originalFileName", "createdByUserId", "notes", "updatedAt"
      )
      VALUES (
        ${snapshotId}, ${input.competenceYear}, ${input.competenceMonth}, CAST(${input.type} AS "InventorySnapshotType"),
        ${input.countDate}, ${fullRows.length}, ${totalValue}, ${input.importFileId}, ${input.originalFileName ?? null},
        ${input.userId}, ${input.notes ?? null}, CURRENT_TIMESTAMP
      )
    `;

    for (const row of fullRows) {
      await tx.$executeRaw`
        INSERT INTO "InventorySnapshotItem" (
          "id", "snapshotId", "productId", "productCode", "productName", "sectorName", "categoryName",
          "subcategoryName", "unit", "quantity", "unitCost", "totalCost", "sourceRowNumber", "resolutionStatus"
        )
        VALUES (
          ${crypto.randomUUID()}, ${snapshotId}, ${row.productId}, ${row.productCode}, ${row.productName},
          ${row.sectorName}, ${row.categoryName}, ${row.subcategoryName}, ${row.unit}, ${row.quantity},
          ${row.unitCost}, ${row.totalCost}, ${row.rowNumber}, ${row.resolutionStatus}
        )
      `;
    }

    const [storedTotal] = await tx.$queryRaw<Array<{ totalValue: Prisma.Decimal | number }>>`
      SELECT COALESCE(SUM("totalCost"), 0) AS "totalValue"
      FROM "InventorySnapshotItem"
      WHERE "snapshotId" = ${snapshotId}
    `;
    storedTotalValue = Number(storedTotal?.totalValue ?? totalValue);
    await tx.$executeRaw`
      UPDATE "InventorySnapshot"
      SET "totalValue" = ${storedTotalValue},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${snapshotId}
    `;

    if (input.type === "INVENTARIO_FINAL") {
      linkedInitialSnapshotId = await cloneFinalAsNextInitial(tx, snapshotId, {
        competenceYear: input.competenceYear,
        competenceMonth: input.competenceMonth,
        countDate: input.countDate,
        originalFileName: input.originalFileName ?? null,
        userId: input.userId,
        userRole: input.userRole
      });
    }
  });

  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "ipAddress", "userAgent", "newValue")
    VALUES (${crypto.randomUUID()}, ${input.userId}, ${`IMPORT_${input.type}`}, 'InventorySnapshot', ${snapshotId},
      ${input.ipAddress ?? null}, ${input.userAgent ?? null}, CAST(${JSON.stringify({ ...input, totalValue: storedTotalValue, rows: fullRows.length, linkedInitialSnapshotId })} AS jsonb))
  `;

  return {
    id: snapshotId,
    importedRows: fullRows.length,
    pendingItems: fullRows.filter((row) => row.resolutionStatus === "PENDING").length,
    totalValue: storedTotalValue,
    warnings: preview.warnings,
    replacedSnapshotId: existing[0]?.id ?? null,
    linkedInitialSnapshotId
  };
}

async function getAllInventoryRows(filePath: string, sheetName?: string | null) {
  const preview = await previewInventorySnapshot(filePath, null, sheetName);
  const worksheet = await readWorksheetRows(filePath, sheetName);
  const headers = worksheet.rows[0] ? Object.keys(worksheet.rows[0]).filter((header) => !header.startsWith("__")) : [];
  const { columns } = resolveColumns(headers, worksheet.rows);
  const parsedRows = worksheet.rows
    .map((row, index) => {
      const quantity = parseMoney(cell(row, columns, "quantity"));
      const unitCostRaw = cell(row, columns, "unitCost");
      const totalCostRaw = cell(row, columns, "totalCost");
      const unitCost = unitCostRaw == null || String(unitCostRaw).trim() === "" ? null : parseMoney(unitCostRaw);
      const totalCost = totalCostRaw == null || String(totalCostRaw).trim() === ""
        ? unitCost == null ? null : roundMoney(quantity * unitCost)
        : roundMoney(parseMoney(totalCostRaw));
      return {
        rowNumber: Number(row.__rowNumber ?? index + 2),
        productCode: asText(cell(row, columns, "productCode")),
        productName: asText(cell(row, columns, "productName")) ?? "",
        sectorName: asText(cell(row, columns, "sectorName")),
        categoryName: asText(cell(row, columns, "categoryName")),
        subcategoryName: asText(cell(row, columns, "subcategoryName")),
        unit: asText(cell(row, columns, "unit")),
        quantity,
        unitCost,
        totalCost,
        countDate: parseDate(cell(row, columns, "countDate"))
      };
    })
    .filter((row) => row.productName || row.productCode || row.quantity !== 0);
  void preview;
  return resolveProducts(parsedRows);
}

export async function listInventorySnapshots(year?: number, month?: number) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT s.*, u."name" AS "createdByName"
    FROM "InventorySnapshot" s
    LEFT JOIN "User" u ON u."id" = s."createdByUserId"
    WHERE ${year ? Prisma.sql`s."competenceYear" = ${year}` : Prisma.sql`true`}
      AND ${month ? Prisma.sql`s."competenceMonth" = ${month}` : Prisma.sql`true`}
    ORDER BY s."competenceYear" DESC, s."competenceMonth" DESC, s."createdAt" DESC
  `;
}

export async function getInventorySnapshot(id: string) {
  const [snapshot] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventorySnapshot" WHERE "id" = ${id}
  `;
  if (!snapshot) throw new Error("Inventario nao encontrado.");
  const items = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventorySnapshotItem"
    WHERE "snapshotId" = ${id}
    ORDER BY "sectorName", "categoryName", "productName"
  `;
  return { ...snapshot, items };
}

export async function undoInventorySnapshot(id: string, input: { reason: string; userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const [snapshot] = await prisma.$queryRaw<Array<{ competenceYear: number; competenceMonth: number; status: string; type: string }>>`
    SELECT "competenceYear", "competenceMonth", "status", "type"::text AS "type" FROM "InventorySnapshot" WHERE "id" = ${id}
  `;
  if (!snapshot) throw new Error("Inventario nao encontrado.");
  await ensureCompetenceOpen(snapshot.competenceYear, snapshot.competenceMonth);
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio.");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "InventorySnapshot"
      SET "status" = 'CANCELLED',
          "cancelledAt" = CURRENT_TIMESTAMP,
          "cancelledByUserId" = ${input.userId},
          "cancellationReason" = ${input.reason}
      WHERE "id" = ${id}
    `;

    if (snapshot.type === "INVENTARIO_FINAL") {
      await tx.$executeRaw`
        UPDATE "InventorySnapshot"
        SET "status" = 'CANCELLED',
            "cancelledAt" = CURRENT_TIMESTAMP,
            "cancelledByUserId" = ${input.userId},
            "cancellationReason" = ${`Inventario inicial automatico cancelado porque o inventario final vinculado foi desfeito: ${input.reason}`}
        WHERE "linkedFromSnapshotId" = ${id}
          AND "isAutoLinkedInitial" = true
          AND "status" <> 'CANCELLED'
      `;
    }
  });
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "ipAddress", "userAgent", "newValue")
    VALUES (${crypto.randomUUID()}, ${input.userId}, 'UNDO_INVENTORY_SNAPSHOT', 'InventorySnapshot', ${id},
      ${input.ipAddress ?? null}, ${input.userAgent ?? null}, CAST(${JSON.stringify(input)} AS jsonb))
  `;
  return { id, status: "CANCELLED" };
}

export async function getMonthlyCmv(year: number, month: number) {
  const [initialInventory, finalInventory, purchases, revenue] = await Promise.all([
    snapshotValue(year, month, "INVENTARIO_INICIAL"),
    snapshotValue(year, month, "INVENTARIO_FINAL"),
    purchaseValue(year, month),
    revenueValue(year, month)
  ]);
  const realCmv = initialInventory + purchases - finalInventory;
  const cmvPercent = revenue.net > 0 ? realCmv / revenue.net : null;
  const estimatedGrossMargin = revenue.net - realCmv;
  const [saved] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "MonthlyCmv"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
    LIMIT 1
  `;
  return {
    competenceYear: year,
    competenceMonth: month,
    initialInventoryValue: initialInventory,
    purchasesValue: purchases,
    finalInventoryValue: finalInventory,
    realCmvValue: realCmv,
    revenueGrossValue: revenue.gross,
    revenueNetValue: revenue.net,
    cmvPercent,
    estimatedGrossMargin,
    status: saved?.status ?? "OPEN",
    saved
  };
}

async function snapshotValue(year: number, month: number, type: InventorySnapshotType) {
  const [row] = await prisma.$queryRaw<Array<{ totalValue: Prisma.Decimal | null }>>`
    SELECT "totalValue"
    FROM "InventorySnapshot"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
      AND "type" = CAST(${type} AS "InventorySnapshotType")
      AND "status" <> 'CANCELLED'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return Number(row?.totalValue ?? 0);
}

async function purchaseValue(year: number, month: number) {
  const [row] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM("totalAmount"), 0) AS "total"
    FROM "Purchase"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
      AND "status" <> 'CANCELLED'
  `;
  return Number(row?.total ?? 0);
}

async function revenueValue(year: number, month: number) {
  const [row] = await prisma.$queryRaw<Array<{ gross: Prisma.Decimal | null; net: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "gross", COALESCE(SUM("netAmount"), 0) AS "net"
    FROM "RevenueEntry"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
      AND "status" <> 'CANCELLED'
  `;
  return { gross: Number(row?.gross ?? 0), net: Number(row?.net ?? 0) };
}

async function ensureCanRecalculateMonthlyCmv(year: number, month: number, userRole: MonthlyRole) {
  const [closed] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "MonthlyCmv"
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
      AND "status" = 'CLOSED'
    LIMIT 1
  `;
  if (closed && userRole !== "ADMIN") {
    throw new Error("Apenas ADMIN pode recalcular competencia fechada.");
  }
}

export async function saveMonthlyCmv(year: number, month: number, userId: string, userRole: MonthlyRole = "ADMIN") {
  await ensureCanRecalculateMonthlyCmv(year, month, userRole);
  const cmv = await getMonthlyCmv(year, month);
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "MonthlyCmv" (
      "id", "competenceYear", "competenceMonth", "initialInventoryValue", "purchasesValue", "finalInventoryValue",
      "realCmvValue", "revenueGrossValue", "revenueNetValue", "cmvPercent", "estimatedGrossMargin", "updatedAt"
    )
    VALUES (${id}, ${year}, ${month}, ${cmv.initialInventoryValue}, ${cmv.purchasesValue}, ${cmv.finalInventoryValue},
      ${cmv.realCmvValue}, ${cmv.revenueGrossValue}, ${cmv.revenueNetValue}, ${cmv.cmvPercent}, ${cmv.estimatedGrossMargin}, CURRENT_TIMESTAMP)
    ON CONFLICT ("competenceYear", "competenceMonth") DO UPDATE SET
      "initialInventoryValue" = EXCLUDED."initialInventoryValue",
      "purchasesValue" = EXCLUDED."purchasesValue",
      "finalInventoryValue" = EXCLUDED."finalInventoryValue",
      "realCmvValue" = EXCLUDED."realCmvValue",
      "revenueGrossValue" = EXCLUDED."revenueGrossValue",
      "revenueNetValue" = EXCLUDED."revenueNetValue",
      "cmvPercent" = EXCLUDED."cmvPercent",
      "estimatedGrossMargin" = EXCLUDED."estimatedGrossMargin",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "newValue")
    VALUES (${crypto.randomUUID()}, ${userId}, 'CALCULATE_CMV', 'MonthlyCmv', ${`${year}-${month}`}, CAST(${JSON.stringify(cmv)} AS jsonb))
  `;
  return getMonthlyCmv(year, month);
}

export async function closeMonthlyCmv(year: number, month: number, userId: string, userRole: MonthlyRole = "ADMIN") {
  const initial = await snapshotValue(year, month, "INVENTARIO_INICIAL");
  const final = await snapshotValue(year, month, "INVENTARIO_FINAL");
  const purchases = await purchaseValue(year, month);
  const revenue = await revenueValue(year, month);
  if (initial <= 0 || final <= 0 || purchases <= 0 || revenue.net <= 0) {
    throw new Error("Para fechar, informe inventario inicial, compras, inventario final e faturamento.");
  }
  await saveMonthlyCmv(year, month, userId, userRole);
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = 'CLOSED',
        "closedByUserId" = ${userId},
        "closedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
  `;
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "newValue")
    VALUES (${crypto.randomUUID()}, ${userId}, 'CLOSE_MONTHLY_COMPETENCE', 'MonthlyCmv', ${`${year}-${month}`}, CAST(${JSON.stringify({ year, month })} AS jsonb))
  `;
  return getMonthlyCmv(year, month);
}

export async function reopenMonthlyCmv(year: number, month: number, input: { userId: string; reason: string }) {
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio.");
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = 'OPEN',
        "reopenedByUserId" = ${input.userId},
        "reopenedAt" = CURRENT_TIMESTAMP,
        "reopenReason" = ${input.reason},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
  `;
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "newValue")
    VALUES (${crypto.randomUUID()}, ${input.userId}, 'REOPEN_MONTHLY_COMPETENCE', 'MonthlyCmv', ${`${year}-${month}`}, CAST(${JSON.stringify({ year, month, reason: input.reason })} AS jsonb))
  `;
  return getMonthlyCmv(year, month);
}

export { ensureCompetenceOpen };
