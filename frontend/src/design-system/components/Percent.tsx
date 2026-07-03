import "./Percent.css";

export type PercentProps = {
  value: number | null | undefined;
  /**
   * Se true, mascara com ••••. Diferente de Money, Percent NÃO lê o
   * HideValuesContext por padrão: percentuais são razões (CMV %, margem)
   * que geralmente podem permanecer visíveis mesmo com valores ocultos.
   */
  hidden?: boolean;
  /** Casas decimais. Default 1. */
  decimals?: number;
  className?: string;
};

export function Percent({ value, hidden = false, decimals = 1, className }: PercentProps) {
  const rootClass = className ? `ds-percent ${className}` : "ds-percent";

  if (hidden) {
    return (
      <span className={rootClass} aria-label="valor oculto">
        <span className="ds-percent-hidden">••••</span>
      </span>
    );
  }

  if (value === null || value === undefined) {
    return <span className={rootClass}>—</span>;
  }

  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return <span className={rootClass}>{formatted}%</span>;
}
