import { normalizeText } from "../../shared/utils/normalize-text.js";

export const OFFICIAL_INVENTORY_SECTORS = [
  "ADEGA",
  "BAR",
  "CAMARA FRIA",
  "CORREDORES",
  "ESTOQUE",
  "ESTOQUE SECO",
  "FREEZER",
  "GERENCIA"
] as const;

export const LEGACY_INVENTORY_SECTORS = [
  "INVENTARIO GERAL",
  "NAO BATER EST",
  "REVISAO/PENDENCIAS"
] as const;

const OFFICIAL_SECTOR_BY_NORMALIZED = new Map(
  OFFICIAL_INVENTORY_SECTORS.map((name) => [normalizeText(name), name])
);

const OFFICIAL_SECTOR_ORDER = new Map(
  OFFICIAL_INVENTORY_SECTORS.map((name, index) => [normalizeText(name), index])
);

export function normalizeInventorySectorInput(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (
    normalized === "object object"
    || normalized === "sem setor"
    || normalized === "undefined"
    || normalized === "null"
  ) {
    return null;
  }
  return text;
}

export function officialInventorySectorName(value: unknown) {
  const cleaned = normalizeInventorySectorInput(value);
  if (!cleaned) return null;
  return OFFICIAL_SECTOR_BY_NORMALIZED.get(normalizeText(cleaned)) ?? null;
}

export function isOfficialInventorySectorName(value: unknown) {
  return officialInventorySectorName(value) != null;
}

export function inventorySectorOrder(value: unknown) {
  const official = officialInventorySectorName(value);
  if (!official) return 999;
  return OFFICIAL_SECTOR_ORDER.get(normalizeText(official)) ?? 999;
}
