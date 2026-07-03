import type { HTMLAttributes } from "react";
import "./PanelEyebrow.css";

export type PanelEyebrowProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * Contexto de negócio de um painel/card (caps + tracking, muted), acima do
 * título do painel. Regra Fase 5: contexto do MÓDULO usa PageHeader
 * description (sentence case); contexto do PAINEL usa PanelEyebrow.
 */
export function PanelEyebrow({ className, children, ...rest }: PanelEyebrowProps) {
  const classes = ["ds-panel-eyebrow", className].filter(Boolean).join(" ");
  return (
    <p className={classes} {...rest}>
      {children}
    </p>
  );
}
