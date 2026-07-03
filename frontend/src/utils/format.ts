/**
 * Formata número em moeda BRL (pt-BR) SEM aplicar mascaramento.
 *
 * Use este helper APENAS em contextos non-JSX:
 *   - export de CSV/XLSX
 *   - tooltip (attribute `title`)
 *   - aria-label
 *   - título de página / meta tags
 *
 * Para renderizar em JSX, use `<Money />` (respeita HideValuesContext
 * automaticamente) ou o hook `useFormatCurrency()` (também reativo).
 *
 * A variante antiga lia `localStorage["hideSensitiveValues"]` para mascarar
 * — comportamento removido. A única fonte de verdade do mascaramento agora é
 * o `HideValuesContext`.
 */
export function formatCurrencyString(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * @deprecated Use `<Money />` em JSX ou `useFormatCurrency()` reativo.
 * Fallback non-JSX: `formatCurrencyString`.
 *
 * MUDANÇA DE COMPORTAMENTO: este alias NÃO mascara mais. As call sites
 * remanescentes exibirão o valor real mesmo com toggle "ocultar valores"
 * ligado, até serem migradas — comportamento intencional durante a
 * migração progressiva (Fase 0 → 1..3).
 */
let formatCurrencyDeprecationWarned = false;
export function formatCurrency(value: string | number | null | undefined) {
  if (!formatCurrencyDeprecationWarned) {
    // eslint-disable-next-line no-console
    console.warn(
      "[deprecated] formatCurrency: use <Money /> em JSX ou useFormatCurrency() reativo; para non-JSX, use formatCurrencyString."
    );
    formatCurrencyDeprecationWarned = true;
  }
  return formatCurrencyString(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC"
  }).format(new Date(value));
}

export function formatNumber(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR").format(Number.isFinite(amount) ? amount : 0);
}

/**
 * Formata percentual em pt-BR (virgula decimal + sufixo %). Substitui o
 * padrao `${x.toFixed(1)}%` que produzia "0.0%" (ponto) em varias telas.
 * Retorna "—" para null/undefined/NaN/Infinity.
 *
 * @example formatPercent(31.8)      → "31,8%"
 * @example formatPercent(31.876, 2) → "31,88%"
 * @example formatPercent(null)      → "—"
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${formatted}%`;
}
