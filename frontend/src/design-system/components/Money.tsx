import { useHideValues } from "../context/HideValuesContext";
import "./Money.css";

export type MoneyProps = {
  /**
   * Valor monetário. Aceita `number` ou `string` numérica (útil para
   * `Decimal` serializado do Prisma). `null`, `undefined`, `NaN`,
   * `Infinity` ou string não-numérica renderizam "—".
   */
  value: number | string | null | undefined;
  /**
   * Sobrescreve o estado do HideValuesContext.
   * Se omitido, o componente lê `hidden` do contexto.
   */
  hidden?: boolean;
  /**
   * Casas decimais. Default 2 — moeda pt-BR sempre exibe centavos
   * ("R$ 2.760,50", nunca "R$ 2.760,5"). Use 0 para valores redondos
   * em displays compactos.
   */
  decimals?: number;
  className?: string;
};

const EN_DASH = "–";

function formatAmount(value: number, decimals: number): string {
  return Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function normalize(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  // string: rejeitar vazia/whitespace antes de Number() (JS: Number("") === 0)
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function Money({ value, hidden, decimals = 2, className }: MoneyProps) {
  const { hidden: contextHidden } = useHideValues();
  const isHidden = hidden ?? contextHidden;
  const rootClass = className ? `ds-money ${className}` : "ds-money";
  const normalizedValue = normalize(value);

  if (isHidden) {
    return (
      <span className={rootClass} aria-label="valor oculto">
        <span className="ds-money-cur">R$</span>
        <span className="ds-money-hidden">••••</span>
      </span>
    );
  }

  if (normalizedValue === null) {
    return <span className={rootClass}>—</span>;
  }

  const isNegative = normalizedValue < 0;
  const amount = formatAmount(normalizedValue, decimals);

  return (
    <span className={rootClass}>
      {isNegative && <span className="ds-money-sign">{EN_DASH} </span>}
      <span className="ds-money-cur">R$</span>
      {amount}
    </span>
  );
}
