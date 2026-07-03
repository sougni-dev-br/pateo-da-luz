import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
import "./FormField.css";

export type FormFieldProps = {
  label: string;
  /** Texto auxiliar discreto abaixo do controle. */
  hint?: string;
  /** Mensagem de erro. Sobrescreve hint. */
  error?: string;
  /** Asterisco de obrigatório ao lado do label. */
  required?: boolean;
  /** Label e controle lado a lado (ex.: Switch). */
  inline?: boolean;
  className?: string;
  children: ReactNode;
};

type InjectableProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Envolve QUALQUER controle (TextField/Select/Switch/Textarea do DS ou
 * nativo) padronizando label, erro, hint e acessibilidade. Quando o filho
 * é um único elemento, injeta id + aria-describedby/aria-invalid nele —
 * TextField/Select/Textarea repassam essas props ao input interno.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  inline,
  className,
  children
}: FormFieldProps) {
  const fieldId = useId();
  const helperId = error || hint ? `${fieldId}-helper` : undefined;

  let control = children;
  if (isValidElement(children)) {
    const child = children as ReactElement<InjectableProps>;
    const injected: InjectableProps = {
      id: child.props.id ?? fieldId,
      "aria-describedby": child.props["aria-describedby"] ?? helperId
    };
    if (error) {
      injected["aria-invalid"] = true;
    }
    control = cloneElement(child, injected);
  }

  // Borda danger dos controles internos vem da classe do wrapper
  // (ds-form-field-invalid) via CSS — cobre DS e inputs nativos.
  const rootClasses = [
    "ds-form-field",
    inline && "ds-form-field-inline",
    error && "ds-form-field-invalid",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses}>
      <label className="ds-form-field-label" htmlFor={fieldId}>
        {label}
        {required && (
          <span className="ds-form-field-required" aria-hidden>
            *
          </span>
        )}
      </label>
      <div className="ds-form-field-control">{control}</div>
      {(error || hint) && (
        <small
          id={helperId}
          className={
            error
              ? "ds-form-field-helper ds-form-field-helper-error"
              : "ds-form-field-helper"
          }
        >
          {error || hint}
        </small>
      )}
    </div>
  );
}
