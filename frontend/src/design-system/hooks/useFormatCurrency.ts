import { useHideValues } from "../context/HideValuesContext";

export type FormatCurrencyOptions = {
  decimals?: number;
};

export type FormatCurrencyFn = (
  value: number | null | undefined,
  opts?: FormatCurrencyOptions
) => string;

const HIDDEN_GLYPH = "R$ ••••";

/**
 * Hook reativo para formatar valores monetários em pt-BR respeitando o toggle
 * global "ocultar valores" (HideValuesContext). Use em qualquer JSX onde por
 * limitação de estrutura (ex: string dentro de <td>, tooltip, label) não dá
 * pra renderizar <Money />.
 *
 * - Se HideValuesContext.hidden === true → retorna "R$ ••••".
 * - Se visível → formata Intl.NumberFormat("pt-BR", currency BRL) com 2 casas
 *   por default.
 * - null/undefined → mesmo comportamento do legacy formatCurrency: "R$ 0,00".
 *   (Documentação: alinhamento intencional com o helper antigo para não
 *   quebrar contratos das telas durante migração.)
 */
export function useFormatCurrency(): FormatCurrencyFn {
  const { hidden } = useHideValues();
  return (value, opts) => {
    if (hidden) return HIDDEN_GLYPH;
    const amount = Number(value ?? 0);
    const decimals = opts?.decimals ?? 2;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(Number.isFinite(amount) ? amount : 0);
  };
}
