import type { HTMLAttributes, ReactNode } from "react";
import "./EmptyState.css";

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action, className, ...rest }: EmptyStateProps) {
  const classes = ["ds-empty-state", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      <strong className="ds-empty-state-title">{title}</strong>
      {description && <p className="ds-empty-state-description">{description}</p>}
      {action && <div className="ds-empty-state-action">{action}</div>}
    </div>
  );
}
