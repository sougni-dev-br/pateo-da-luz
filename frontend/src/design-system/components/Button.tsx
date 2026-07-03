import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "icon";
export type ButtonSize = "sm" | "md";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Se true, força layout 40x40 sem texto (só ícone). Auto quando variant="icon". */
  iconOnly?: boolean;
  /** Ícone Lucide colocado antes do texto. */
  leadingIcon?: ReactNode;
  /** Default "button" para evitar submit acidental em forms. */
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  iconOnly,
  leadingIcon,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  const isIconOnly = iconOnly ?? variant === "icon";
  const sizeClass = isIconOnly ? "ds-button-icon-only" : size === "sm" ? "ds-button-sm" : "ds-button-md";
  const variantClass = `ds-button-${variant}`;
  const classes = ["ds-button", sizeClass, variantClass, className].filter(Boolean).join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {leadingIcon}
      {children}
    </button>
  );
}
