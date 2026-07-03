import type { HTMLAttributes, ReactNode } from "react";
import "./PageHeader.css";

export type PageHeaderProps = HTMLAttributes<HTMLDivElement> & {
  /** Breadcrumb curto acima do título. Ex.: "Pateo da Luz / Financeiro". */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Ações alinhadas à direita (tipicamente Buttons). */
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions, className, ...rest }: PageHeaderProps) {
  const classes = ["ds-page-header", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      <div className="ds-page-header-titles">
        {eyebrow && <p className="ds-page-header-eyebrow">{eyebrow}</p>}
        <h1 className="ds-page-header-title">{title}</h1>
        {description && <span className="ds-page-header-description">{description}</span>}
      </div>
      {actions && <div className="ds-page-header-actions">{actions}</div>}
    </div>
  );
}
