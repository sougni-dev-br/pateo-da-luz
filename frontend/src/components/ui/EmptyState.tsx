import { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state rich-empty-state">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
