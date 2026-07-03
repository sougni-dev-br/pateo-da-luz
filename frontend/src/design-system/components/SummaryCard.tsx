import type { HTMLAttributes, ReactNode } from "react";
import { Money } from "./Money";
import "./SummaryCard.css";

export type SummaryTone = "neutral" | "success" | "warning" | "danger" | "info";

export type SummaryCardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  label: ReactNode;
  /**
   * Conteúdo do card. Opcional se `moneyValue` for passado. Para valores
   * monetários que devem respeitar o toggle de ocultar valores, prefira
   * `moneyValue`.
   */
  value?: ReactNode;
  /**
   * Valor monetário em número. Renderiza via `<Money />` e respeita
   * HideValuesContext. Tem prioridade sobre `value` se ambos forem
   * passados (com aviso em dev).
   */
  moneyValue?: number | null | undefined;
  detail?: ReactNode;
  tone?: SummaryTone;
  /** Ícone Lucide renderizado no chip 38x38 tonalizado. */
  icon?: ReactNode;
};

function renderValue(value: ReactNode, moneyValue: SummaryCardProps["moneyValue"]): ReactNode {
  if (moneyValue !== undefined) {
    if (value !== undefined && value !== null && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[SummaryCard] `value` e `moneyValue` fornecidos juntos — `moneyValue` tem prioridade."
      );
    }
    return <Money value={moneyValue} />;
  }
  return value;
}

export function SummaryCard({
  label,
  value,
  moneyValue,
  detail,
  tone = "neutral",
  icon,
  className,
  ...rest
}: SummaryCardProps) {
  const classes = ["ds-summary-card", `ds-summary-card-${tone}`, className].filter(Boolean).join(" ");
  return (
    <article className={classes} {...rest}>
      <div className="ds-summary-card-body">
        <span className="ds-summary-card-label">{label}</span>
        <strong className="ds-summary-card-value">{renderValue(value, moneyValue)}</strong>
        {detail && <small className="ds-summary-card-detail">{detail}</small>}
      </div>
      {icon && <div className="ds-summary-card-chip">{icon}</div>}
    </article>
  );
}
