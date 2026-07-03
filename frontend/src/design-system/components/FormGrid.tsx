import type { ReactNode } from "react";
import "./FormGrid.css";

export type FormGridProps = {
  /** Colunas no desktop. Colapsa para 1 coluna abaixo de 720px. */
  cols?: 1 | 2 | 3 | 4;
  className?: string;
  children: ReactNode;
};

export function FormGrid({ cols = 2, className, children }: FormGridProps) {
  const classes = ["ds-form-grid", `ds-form-grid-${cols}`, className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}
