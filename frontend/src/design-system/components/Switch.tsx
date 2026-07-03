import type { ButtonHTMLAttributes } from "react";
import "./Switch.css";

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "value" | "type"
> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Rótulo acessível quando usado fora de um FormField/label. */
  label?: string;
};

/** Substituto do checkbox nativo azul. role="switch" + aria-checked. */
export function Switch({
  checked,
  onChange,
  label,
  className,
  disabled,
  ...rest
}: SwitchProps) {
  const classes = ["ds-switch", checked && "ds-switch-on", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={classes}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="ds-switch-thumb" aria-hidden />
    </button>
  );
}
