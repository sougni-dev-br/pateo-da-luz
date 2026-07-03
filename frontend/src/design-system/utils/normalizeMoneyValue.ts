export type MoneyValueInput = number | string | null | undefined;

/**
 * Normaliza input de valor monetário para number finito ou null.
 * - null/undefined → null
 * - number finito → o próprio número
 * - number NaN/Infinity → null
 * - string vazia ou whitespace → null
 * - string numérica válida → number parseado
 * - string inválida → null
 */
export function normalizeMoneyValue(value: MoneyValueInput): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
