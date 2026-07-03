import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";
import "./Textarea.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  /** Texto auxiliar discreto abaixo do campo. */
  hint?: string;
  /** Mensagem de erro. Sobrescreve hint e pinta o campo em danger. */
  error?: string;
  containerClassName?: string;
};

export function Textarea({
  label,
  hint,
  error,
  id,
  rows = 3,
  className,
  containerClassName,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const helperId = error || hint ? `${textareaId}-helper` : undefined;

  const textareaClasses = ["ds-textarea-input", error && "ds-textarea-input-error", className]
    .filter(Boolean)
    .join(" ");
  const wrapperClasses = ["ds-textarea", containerClassName].filter(Boolean).join(" ");

  return (
    <label htmlFor={textareaId} className={wrapperClasses}>
      {label && <span className="ds-textarea-label">{label}</span>}
      <textarea
        id={textareaId}
        rows={rows}
        className={textareaClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={helperId}
        {...rest}
      />
      {(error || hint) && (
        <small
          id={helperId}
          className={error ? "ds-textarea-helper ds-textarea-helper-error" : "ds-textarea-helper"}
        >
          {error ?? hint}
        </small>
      )}
    </label>
  );
}
