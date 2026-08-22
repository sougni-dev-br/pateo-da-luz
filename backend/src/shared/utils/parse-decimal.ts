const THOUSAND_GROUPED = /^\d{1,3}(\.\d{3})+$/;

/**
 * Converte entrada de formulario (string pt-BR ou numero JSON) em numero.
 *
 * A versao anterior removia TODOS os pontos antes de converter, assumindo que
 * ponto e sempre separador de milhar — "1.5" virava 15 e o numero JSON 0.5
 * virava 5. Aqui o separador decimal e decidido pelo formato recebido.
 *
 * "1.234" continua sendo lido como mil duzentos e trinta e quatro: quando o
 * agrupamento de milhar e exato, a leitura pt-BR prevalece. Para o valor
 * fracionario use virgula ("1,234").
 */
export function parseDecimalInput(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value === null || value === undefined) return null;

  const raw = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/i, "");
  if (!raw) return null;

  const sign = raw.startsWith("-") ? -1 : 1;
  const digits = raw.replace(/^[+-]/, "");
  if (!/^[\d.,]+$/.test(digits)) return null;

  const hasComma = digits.includes(",");
  const hasDot = digits.includes(".");

  let normalized: string;
  if (hasComma) {
    // Virgula presente: ela e o separador decimal e os pontos sao de milhar.
    normalized = digits.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && THOUSAND_GROUPED.test(digits)) {
    normalized = digits.replace(/\./g, "");
  } else {
    normalized = digits;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : null;
}
