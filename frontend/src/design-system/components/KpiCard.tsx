import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Money } from "./Money";
import { Sparkline } from "./Sparkline";
import "./KpiCard.css";

export type KpiTone = "neutral" | "success" | "warning" | "danger" | "info";
export type KpiDeltaDirection = "up" | "down" | "flat";

export type KpiDelta = {
  text: string;
  direction: KpiDeltaDirection;
};

export type KpiCardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
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
  /** Texto de apoio abaixo do valor. */
  sub?: ReactNode;
  tone?: KpiTone;
  /** Ícone Lucide no chip tonalizado (38x38). */
  icon?: ReactNode;
  /** Pill com seta (↑↓→) + texto. Cor pela direction. */
  delta?: KpiDelta | null;
  /** Sparkline SVG opcional. Array de N pontos (>= 2). */
  sparkline?: number[];
};

const DELTA_ICON: Record<KpiDeltaDirection, ReactNode> = {
  up: <ArrowUp size={12} strokeWidth={2.5} />,
  down: <ArrowDown size={12} strokeWidth={2.5} />,
  flat: <ArrowRight size={12} strokeWidth={2.5} />
};

function renderValue(value: ReactNode, moneyValue: KpiCardProps["moneyValue"]): ReactNode {
  if (moneyValue !== undefined) {
    if (value !== undefined && value !== null && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        "[KpiCard] `value` e `moneyValue` fornecidos juntos — `moneyValue` tem prioridade."
      );
    }
    return <Money value={moneyValue} />;
  }
  return value;
}

export function KpiCard({
  label,
  value,
  moneyValue,
  sub,
  tone = "neutral",
  icon,
  delta,
  sparkline,
  className,
  ...rest
}: KpiCardProps) {
  const classes = ["ds-kpi-card", `ds-kpi-card-${tone}`, className].filter(Boolean).join(" ");
  const hasFoot = Boolean(delta || (sparkline && sparkline.length >= 2));

  return (
    <article className={classes} {...rest}>
      <span className="ds-kpi-card-accent" aria-hidden />
      <div className="ds-kpi-card-top">
        <span className="ds-kpi-card-label">{label}</span>
        {icon && <span className="ds-kpi-card-chip">{icon}</span>}
      </div>
      <strong className="ds-kpi-card-value">{renderValue(value, moneyValue)}</strong>
      {sub && <div className="ds-kpi-card-sub">{sub}</div>}
      {hasFoot && (
        <div className="ds-kpi-card-foot">
          {delta ? (
            <span className={`ds-kpi-card-delta ds-kpi-card-delta-${delta.direction}`}>
              {DELTA_ICON[delta.direction]}
              {delta.text}
            </span>
          ) : (
            <span />
          )}
          {sparkline && sparkline.length >= 2 && (
            <Sparkline points={sparkline} className="ds-kpi-card-sparkline" />
          )}
        </div>
      )}
    </article>
  );
}
