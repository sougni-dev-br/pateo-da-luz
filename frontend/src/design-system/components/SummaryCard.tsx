import type { HTMLAttributes, ReactNode } from "react";
import { Money } from "./Money";
import { looksLikeMoneyString, parseMoney } from "./parseMoney";
import "./SummaryCard.css";

export type SummaryTone = "neutral" | "success" | "warning" | "danger" | "info";

export type SummaryCardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  label: ReactNode;
  /**
   * ReactNode ou string. Se for string começando com "R$" (ou "– R$"),
   * delega para <Money /> automaticamente (mascaramento via HideValuesContext).
   * Números crus e strings quaisquer passam through.
   */
  value: ReactNode;
  detail?: ReactNode;
  tone?: SummaryTone;
  /** Ícone Lucide renderizado no chip 38x38 tonalizado. */
  icon?: ReactNode;
};

function renderValue(value: ReactNode): ReactNode {
  if (looksLikeMoneyString(value)) {
    const parsed = parseMoney(value);
    if (parsed !== null) return <Money value={parsed} />;
  }
  return value;
}

export function SummaryCard({
  label,
  value,
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
        <strong className="ds-summary-card-value">{renderValue(value)}</strong>
        {detail && <small className="ds-summary-card-detail">{detail}</small>}
      </div>
      {icon && <div className="ds-summary-card-chip">{icon}</div>}
    </article>
  );
}
