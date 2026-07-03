import { useHideValues } from "../context/HideValuesContext";
import "./Money.css";

export type MoneyProps = {
  value: number | null | undefined;
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

export function Money({ value, hidden, decimals = 2, className }: MoneyProps) {
  const { hidden: contextHidden } = useHideValues();
  const isHidden = hidden ?? contextHidden;
  const rootClass = className ? `ds-money ${className}` : "ds-money";

  if (isHidden) {
    return (
      <span className={rootClass} aria-label="valor oculto">
        <span className="ds-money-cur">R$</span>
        <span className="ds-money-hidden">••••</span>
      </span>
    );
  }

  if (value === null || value === undefined) {
    return <span className={rootClass}>—</span>;
  }

  const isNegative = value < 0;
  const amount = formatAmount(value, decimals);

  return (
    <span className={rootClass}>
      {isNegative && <span className="ds-money-sign">{EN_DASH} </span>}
      <span className="ds-money-cur">R$</span>
      {amount}
    </span>
  );
}
