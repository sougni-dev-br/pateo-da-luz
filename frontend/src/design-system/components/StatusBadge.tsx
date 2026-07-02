import type { HTMLAttributes, ReactNode } from "react";
import "./StatusBadge.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
  children: ReactNode;
};

export function StatusBadge({ tone = "neutral", className, children, ...rest }: StatusBadgeProps) {
  const classes = ["ds-status-badge", `ds-status-badge-${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
