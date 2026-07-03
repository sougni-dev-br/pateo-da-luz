import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./IconButton.css";

export type IconButtonVariant = "default" | "danger";
export type IconButtonSize = "md" | "sm";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  icon: ReactNode;
  /** Obrigatório: vira aria-label + title (tooltip nativo). */
  label: string;
  variant?: IconButtonVariant;
  /** md = 40x40 (ações de tabela), sm = 32x32 (contextos densos). */
  size?: IconButtonSize;
};

export function IconButton({
  icon,
  label,
  variant = "default",
  size = "md",
  className,
  type,
  ...rest
}: IconButtonProps) {
  const classes = [
    "ds-icon-button",
    `ds-icon-button-${size}`,
    variant === "danger" && "ds-icon-button-danger",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type ?? "button"}
      className={classes}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
