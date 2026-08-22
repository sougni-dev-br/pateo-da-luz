import { normalizeText } from "../../shared/utils/normalize-text.js";

/**
 * Setores esperados para bebida. Nao e catalogo: e a heuristica usada pela
 * auditoria de integridade para sugerir reclassificacao de vinho/cerveja.
 * O catalogo de setores vive no banco — quem manda e o cadastro.
 */
export const BEVERAGE_SECTORS = ["ADEGA", "BAR"] as const;

const BEVERAGE_BY_NORMALIZED = new Map(
  BEVERAGE_SECTORS.map((name) => [normalizeText(name), name as string])
);

const REJECTED_SECTOR_NAMES = new Set([
  "object object",
  "sem setor",
  "undefined",
  "null"
]);

/**
 * Porteiro unico de escrita de setor: apara espacos, recusa vazio e o lixo que
 * ja entrou na base por serializacao errada ("[object Object]") ou por texto
 * de placeholder. Qualquer outro nome e aceito — cadastrar setor novo precisa
 * funcionar sem deploy.
 */
export function normalizeInventorySectorInput(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const text = String(value).trim();
  if (!text) return null;

  const normalized = normalizeText(text);
  if (!normalized || REJECTED_SECTOR_NAMES.has(normalized)) return null;

  return text;
}

/** Nome canonico do setor de bebida, ou null se nao for ADEGA/BAR. */
export function beverageSectorName(value: unknown): string | null {
  const cleaned = normalizeInventorySectorInput(value);
  if (!cleaned) return null;
  return BEVERAGE_BY_NORMALIZED.get(normalizeText(cleaned)) ?? null;
}
