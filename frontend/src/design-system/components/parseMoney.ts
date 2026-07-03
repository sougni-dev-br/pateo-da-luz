/**
 * Extrai um número (BRL) de uma string tipo "R$ 128.450", "– R$ 820" ou
 * "R$ 1.234,56". Retorna null se a string nao for reconhecivel como moeda.
 *
 * Usado por SummaryCard e KpiCard para detectar strings monetarias vindas de
 * codigo legado e delegar para <Money />, garantindo mascaramento via
 * HideValuesContext.
 */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  if (!/^[-–]?\s*R\$/.test(trimmed)) return null;

  const negative = /^[-–]/.test(trimmed);
  const body = trimmed.replace(/^[-–]\s*/, "").replace(/^R\$\s*/, "").trim();
  // pt-BR: pontos = milhar, vírgula = decimal
  const normalized = body.replace(/\./g, "").replace(",", ".");
  const num = Number.parseFloat(normalized);
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * Determina se uma string "parece moeda" para triggering do auto-detect.
 * Nao valida se e parsavel — parseMoney faz isso.
 */
export function looksLikeMoneyString(value: unknown): value is string {
  return typeof value === "string" && /^[-–]?\s*R\$/.test(value.trim());
}
