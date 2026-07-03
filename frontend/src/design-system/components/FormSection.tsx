import type { ReactNode } from "react";
import "./FormSection.css";

export type FormSectionProps = {
  /** Rótulo pequeno em caps acima do título (contexto de negócio). */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Ações à direita do cabeçalho (ex.: botão "Limpar"). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function FormSection({
  eyebrow,
  title,
  description,
  actions,
  className,
  children
}: FormSectionProps) {
  const classes = ["ds-form-section", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      <header className="ds-form-section-header">
        <div className="ds-form-section-heading">
          {eyebrow && <span className="ds-form-section-eyebrow">{eyebrow}</span>}
          <h3 className="ds-form-section-title">{title}</h3>
          {description && (
            <p className="ds-form-section-description">{description}</p>
          )}
        </div>
        {actions && <div className="ds-form-section-actions">{actions}</div>}
      </header>
      <div className="ds-form-section-body">{children}</div>
    </section>
  );
}
