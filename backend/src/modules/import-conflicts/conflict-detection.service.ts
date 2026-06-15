import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import type { PurchaseImportRow } from "../imports/purchase-import.types.js";

export type ConflictEntityType = "product" | "supplier";
export type ConflictType =
  | "PRODUCT_CODE_NAME"
  | "PRODUCT_NAME_CODE"
  | "SUPPLIER_CODE_NAME"
  | "SUPPLIER_NAME_CODE";
export type ConflictAction = "KEEP_CURRENT" | "UPDATE_CURRENT" | "CREATE_ALIAS" | "CREATE_NEW" | "IGNORE";

export type ImportConflictDecision = {
  id: string;
  conflictKey: string;
  entityType: ConflictEntityType;
  conflictType: ConflictType;
  action: ConflictAction;
  targetId: string | null;
  code: string | null;
  normalizedName: string | null;
  incomingName: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportConflict = {
  key: string;
  entityType: ConflictEntityType;
  type: ConflictType;
  label: string;
  severity: "critical" | "alias_suggestion";
  recommendedAction: ConflictAction;
  code: string | null;
  normalizedName: string | null;
  currentId: string | null;
  currentName: string | null;
  incomingName: string;
  incomingCodes: string[];
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  supplierName: string | null;
  occurrences: number;
  exampleRows: number[];
  savedDecision: ImportConflictDecision | null;
};

type DecisionRow = ImportConflictDecision;

function keyFor(parts: unknown[]) {
  return crypto
    .createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

function firstValue(values: Set<string>) {
  return [...values].find(Boolean) ?? "";
}

async function getDecisions(keys: string[]) {
  if (!keys.length) return new Map<string, ImportConflictDecision>();

  const decisions = await prisma.$queryRaw<DecisionRow[]>`
    SELECT
      "id",
      "conflictKey",
      "entityType",
      "conflictType",
      "action",
      "targetId",
      "code",
      "normalizedName",
      "incomingName",
      "notes",
      "createdAt",
      "updatedAt"
    FROM "ImportConflictDecision"
    WHERE "conflictKey" IN (${Prisma.join(keys)})
  `;

  return new Map(decisions.map((decision) => [decision.conflictKey, decision]));
}

function pushRow(map: Map<string, Array<{ rowNumber: number; row: PurchaseImportRow }>>, key: string, entry: { rowNumber: number; row: PurchaseImportRow }) {
  const rows = map.get(key) ?? [];
  rows.push(entry);
  map.set(key, rows);
}

export async function detectPurchaseImportConflicts(
  rows: Array<{ rowNumber: number; row: PurchaseImportRow }>
): Promise<ImportConflict[]> {
  const productByCode = new Map<string, Array<{ rowNumber: number; row: PurchaseImportRow }>>();
  const productByName = new Map<string, Array<{ rowNumber: number; row: PurchaseImportRow }>>();
  const supplierByCode = new Map<string, Array<{ rowNumber: number; row: PurchaseImportRow }>>();
  const supplierByName = new Map<string, Array<{ rowNumber: number; row: PurchaseImportRow }>>();

  for (const entry of rows) {
    if (entry.row.productCode) pushRow(productByCode, entry.row.productCode, entry);
    const productName = normalizeText(entry.row.productDescription);
    if (productName && entry.row.productDescription !== "Produto nao informado") {
      pushRow(productByName, productName, entry);
    }

    if (entry.row.supplierCode) pushRow(supplierByCode, entry.row.supplierCode, entry);
    const supplierName = normalizeText(entry.row.supplierName);
    if (supplierName && entry.row.supplierName !== "Fornecedor nao informado") {
      pushRow(supplierByName, supplierName, entry);
    }
  }

  const productCodes = [...productByCode.keys()];
  const supplierCodes = [...supplierByCode.keys()];
  const productNames = [...productByName.keys()];
  const supplierNames = [...supplierByName.keys()];

  const [productsByCode, suppliersByCode, productsByName, suppliersByName] = await Promise.all([
    productCodes.length ? prisma.product.findMany({ where: { externalCode: { in: productCodes } } }) : [],
    supplierCodes.length ? prisma.supplier.findMany({ where: { externalCode: { in: supplierCodes } } }) : [],
    productNames.length ? prisma.product.findMany({ where: { normalizedName: { in: productNames } } }) : [],
    supplierNames.length ? prisma.supplier.findMany({ where: { name: { in: [...new Set(rows.map((entry) => entry.row.supplierName))] } } }) : []
  ]);

  const currentProductByCode = new Map(productsByCode.map((product) => [product.externalCode, product]));
  const currentSupplierByCode = new Map(suppliersByCode.map((supplier) => [supplier.externalCode, supplier]));
  const currentProductByName = new Map(productsByName.map((product) => [product.normalizedName, product]));
  const currentSupplierByName = new Map(suppliersByName.map((supplier) => [normalizeText(supplier.name), supplier]));

  const conflicts: ImportConflict[] = [];

  for (const [code, entries] of productByCode) {
    const names = new Set(entries.map((entry) => normalizeText(entry.row.productDescription)).filter(Boolean));
    const current = currentProductByCode.get(code) ?? null;
    const currentName = current?.name ?? null;
    const currentDifferent = currentName ? !names.has(normalizeText(currentName)) : false;

    if (names.size > 1 || currentDifferent) {
      const incomingNames = new Set(entries.map((entry) => entry.row.productDescription).filter(Boolean));
      const first = entries[0]?.row;
      conflicts.push({
        key: keyFor(["product", "PRODUCT_CODE_NAME", code]),
        entityType: "product",
        type: "PRODUCT_CODE_NAME",
        label: "Sugestao de alias para mesmo codigo de produto",
        severity: current ? "alias_suggestion" : "critical",
        recommendedAction: current ? "CREATE_ALIAS" : "KEEP_CURRENT",
        code,
        normalizedName: null,
        currentId: current?.id ?? null,
        currentName,
        incomingName: [...incomingNames].join(" | "),
        incomingCodes: [code],
        categoryName: first?.categoryName ?? null,
        subcategoryName: first?.subcategoryName ?? null,
        unit: first?.unit ?? null,
        supplierName: first?.supplierName ?? null,
        occurrences: entries.length,
        exampleRows: entries.slice(0, 5).map((entry) => entry.rowNumber),
        savedDecision: null
      });
    }
  }

  for (const [normalizedName, entries] of productByName) {
    const codes = new Set(entries.map((entry) => entry.row.productCode).filter(Boolean) as string[]);
    if (codes.size > 1) {
      const current = currentProductByName.get(normalizedName) ?? null;
      const first = entries[0]?.row;
      conflicts.push({
        key: keyFor(["product", "PRODUCT_NAME_CODE", normalizedName]),
        entityType: "product",
        type: "PRODUCT_NAME_CODE",
        label: "Mesmo nome normalizado com codigos de produto diferentes",
        severity: "critical",
        recommendedAction: "KEEP_CURRENT",
        code: null,
        normalizedName,
        currentId: current?.id ?? null,
        currentName: current?.name ?? null,
        incomingName: first?.productDescription ?? normalizedName,
        incomingCodes: [...codes],
        categoryName: first?.categoryName ?? null,
        subcategoryName: first?.subcategoryName ?? null,
        unit: first?.unit ?? null,
        supplierName: first?.supplierName ?? null,
        occurrences: entries.length,
        exampleRows: entries.slice(0, 5).map((entry) => entry.rowNumber),
        savedDecision: null
      });
    }
  }

  for (const [code, entries] of supplierByCode) {
    const names = new Set(entries.map((entry) => normalizeText(entry.row.supplierName)).filter(Boolean));
    const current = currentSupplierByCode.get(code) ?? null;
    const currentName = current?.name ?? null;
    const currentDifferent = currentName ? !names.has(normalizeText(currentName)) : false;

    if (names.size > 1 || currentDifferent) {
      const first = entries[0]?.row;
      conflicts.push({
        key: keyFor(["supplier", "SUPPLIER_CODE_NAME", code]),
        entityType: "supplier",
        type: "SUPPLIER_CODE_NAME",
        label: "Mesmo codigo de fornecedor com nomes diferentes",
        severity: "critical",
        recommendedAction: "KEEP_CURRENT",
        code,
        normalizedName: null,
        currentId: current?.id ?? null,
        currentName,
        incomingName: firstValue(new Set(entries.map((entry) => entry.row.supplierName))),
        incomingCodes: [code],
        categoryName: null,
        subcategoryName: null,
        unit: null,
        supplierName: first?.supplierName ?? null,
        occurrences: entries.length,
        exampleRows: entries.slice(0, 5).map((entry) => entry.rowNumber),
        savedDecision: null
      });
    }
  }

  for (const [normalizedName, entries] of supplierByName) {
    const codes = new Set(entries.map((entry) => entry.row.supplierCode).filter(Boolean) as string[]);
    if (codes.size > 1) {
      const current = currentSupplierByName.get(normalizedName) ?? null;
      conflicts.push({
        key: keyFor(["supplier", "SUPPLIER_NAME_CODE", normalizedName]),
        entityType: "supplier",
        type: "SUPPLIER_NAME_CODE",
        label: "Mesmo fornecedor com codigos diferentes",
        severity: "critical",
        recommendedAction: "KEEP_CURRENT",
        code: null,
        normalizedName,
        currentId: current?.id ?? null,
        currentName: current?.name ?? null,
        incomingName: entries[0]?.row.supplierName ?? normalizedName,
        incomingCodes: [...codes],
        categoryName: null,
        subcategoryName: null,
        unit: null,
        supplierName: entries[0]?.row.supplierName ?? null,
        occurrences: entries.length,
        exampleRows: entries.slice(0, 5).map((entry) => entry.rowNumber),
        savedDecision: null
      });
    }
  }

  const decisions = await getDecisions(conflicts.map((conflict) => conflict.key));
  return conflicts.map((conflict) => ({
    ...conflict,
    savedDecision: decisions.get(conflict.key) ?? null
  }));
}

export function summarizeConflictDecisions(conflicts: ImportConflict[]) {
  const resolved = conflicts.filter((conflict) => conflict.savedDecision).length;
  return {
    conflictsFound: conflicts.length,
    conflictsResolved: resolved,
    conflictsPending: conflicts.length - resolved,
    decisionsAppliedAutomatically: conflicts.filter(
      (conflict) => conflict.savedDecision && conflict.savedDecision.action !== "IGNORE"
    ).length
  };
}
