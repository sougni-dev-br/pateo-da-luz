type StatusBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: StatusBadgeTone;
  title?: string;
};

export function StatusBadge({ children, tone = "neutral", title }: StatusBadgeProps) {
  return (
    <span className={`status-badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}
