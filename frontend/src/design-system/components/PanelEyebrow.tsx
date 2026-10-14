import type { HTMLAttributes } from "react";
import "./PanelEyebrow.css";

export type PanelEyebrowProps = HTMLAttributes<HTMLParagraphElement> & {
  // Quando o eyebrow é o título de uma seção (aria-labelledby), use "h2": leitor de tela navega por títulos. Visual idêntico.
  as?: "p" | "h2" | "h3";
};

/**
 * Contexto de negócio de um painel/card (caps + tracking, muted), acima do
 * título do painel. Regra Fase 5: contexto do MÓDULO usa PageHeader
 * description (sentence case); contexto do PAINEL usa PanelEyebrow.
 */
export function PanelEyebrow({ className, children, as: Tag = "p", ...rest }: PanelEyebrowProps) {
  const classes = ["ds-panel-eyebrow", className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
