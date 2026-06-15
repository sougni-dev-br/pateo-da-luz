import { ReactNode } from "react";

type SummaryCardTone = "neutral" | "success" | "warning" | "danger" | "info";

type SummaryCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: SummaryCardTone;
  icon?: ReactNode;
};

export function SummaryCard({ label, value, detail, tone = "neutral", icon }: SummaryCardProps) {
  return (
    <article className={`summary-card tone-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
      {icon && <div className="summary-card-icon">{icon}</div>}
    </article>
  );
}
