import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
import "./Select.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  /** Mensagem de erro. Sobrescreve hint e pinta o campo em danger. */
  error?: string;
  containerClassName?: string;
};

export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  id,
  className,
  containerClassName,
  value,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const helperId = error || hint ? `${selectId}-helper` : undefined;
  const isEmpty = !value;

  const selectClasses = [
    "ds-select-native",
    isEmpty && "ds-select-native-placeholder",
    error && "ds-select-native-error",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const wrapperClasses = ["ds-select", containerClassName].filter(Boolean).join(" ");

  return (
    <label htmlFor={selectId} className={wrapperClasses}>
      {label && <span className="ds-select-label">{label}</span>}
      <div className="ds-select-wrap">
        <select
          id={selectId}
          value={value}
          className={selectClasses}
          aria-invalid={error ? true : undefined}
          aria-describedby={helperId}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="ds-select-caret" aria-hidden>
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </div>
      {(error || hint) && (
        <small
          id={helperId}
          className={error ? "ds-select-helper ds-select-helper-error" : "ds-select-helper"}
        >
          {error ?? hint}
        </small>
      )}
    </label>
  );
}
