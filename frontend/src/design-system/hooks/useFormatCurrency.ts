import { useHideValues } from "../context/HideValuesContext";
import { normalizeMoneyValue, type MoneyValueInput } from "../utils/normalizeMoneyValue";

export type FormatCurrencyOptions = {
  decimals?: number;
};

export type FormatCurrencyFn = (
  value: MoneyValueInput,
  opts?: FormatCurrencyOptions
) => string;

const HIDDEN_GLYPH = "R$ ••••";

/**
 * Hook reativo para formatar valores monetários em pt-BR respeitando o toggle
 * global "ocultar valores" (HideValuesContext). Use em qualquer JSX onde por
 * limitação de estrutura (ex: string dentro de <td>, tooltip, label) não dá
 * pra renderizar <Money />.
 *
 * Aceita `number`, string numérica (útil para Prisma Decimal serializado),
 * `null` e `undefined`. Valores inválidos (`NaN`, `Infinity`, string
 * não-numérica, string vazia/whitespace) retornam "R$ 0,00" — fallback
 * intencionalmente diferente do `<Money />` (que retorna "—"): o hook é
 * usado em contextos de string legada (prop `value: string` de KpiCard
 * local, aria-label, tooltip) onde em-dash pode confundir.
 *
 * - Se HideValuesContext.hidden === true → sempre retorna "R$ ••••"
 *   (precedência do mascaramento sobre o fallback).
 * - Se visível → formata Intl.NumberFormat("pt-BR", currency BRL) com 2 casas
 *   por default.
 */
export function useFormatCurrency(): FormatCurrencyFn {
  const { hidden } = useHideValues();
  return (value, opts) => {
    if (hidden) return HIDDEN_GLYPH;
    const normalized = normalizeMoneyValue(value);
    const amount = normalized ?? 0;
    const decimals = opts?.decimals ?? 2;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(amount);
  };
}
