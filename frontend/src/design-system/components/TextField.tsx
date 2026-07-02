import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import "./TextField.css";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  /** Texto auxiliar discreto abaixo do campo. */
  hint?: string;
  /** Mensagem de erro. Sobrescreve hint e pinta o campo em danger. */
  error?: string;
  containerClassName?: string;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = error || hint ? `${inputId}-helper` : undefined;

  const inputClasses = ["ds-text-field-input", error && "ds-text-field-input-error", className]
    .filter(Boolean)
    .join(" ");
  const wrapperClasses = ["ds-text-field", containerClassName].filter(Boolean).join(" ");

  return (
    <label htmlFor={inputId} className={wrapperClasses}>
      {label && <span className="ds-text-field-label">{label}</span>}
      <input
        id={inputId}
        className={inputClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={helperId}
        {...rest}
      />
      {(error || hint) && (
        <small
          id={helperId}
          className={error ? "ds-text-field-helper ds-text-field-helper-error" : "ds-text-field-helper"}
        >
          {error ?? hint}
        </small>
      )}
    </label>
  );
}
