import { AlertOctagon, AlertTriangle, ArrowRight, Clock, Info } from "lucide-react";
import { Money } from "../../design-system";
import type { AlertBucket } from "./logic";

export type AttentionItem = {
  key: string;
  bucket: AlertBucket;
  tone: "danger" | "warning" | "info";
  title: string;
  description?: string;
  amount?: number;
  actionLabel?: string;
  actionPath?: string;
};

type Props = {
  items: AttentionItem[];
  canNavigate: (path: string) => boolean;
  onNavigate: (path: string) => void;
};

const TONE_ICON = {
  danger: <AlertOctagon size={16} aria-hidden />,
  warning: <AlertTriangle size={16} aria-hidden />,
  info: <Info size={16} aria-hidden />,
};

/**
 * O que pede ação vem como lista, do mais urgente para o menos; o que só
 * acontece no fim do mês fica numa linha discreta abaixo, sem cor de alarme.
 */
export function AttentionList({ items, canNavigate, onNavigate }: Props) {
  const actionable = items.filter((i) => i.bucket !== "waiting");
  const waiting = items.filter((i) => i.bucket === "waiting");
  if (items.length === 0) return null;

  return (
    <section className="dash-attention" aria-label="Pendências do mês">
      {actionable.length > 0 && (
        <>
          <h2 className="dash-eyebrow">
            Precisa de você <span className="dash-count">{actionable.length}</span>
          </h2>
          <ul className="dash-attention-list">
            {actionable.map((item) => {
              const canGo = !!item.actionPath && canNavigate(item.actionPath);
              const body = (
                <>
                  <span className={`dash-attention-icon tone-${item.tone}`}>{TONE_ICON[item.tone]}</span>
                  <span className="dash-attention-text">
                    <strong>{item.title}</strong>
                    {item.description && <span>{item.description}</span>}
                  </span>
                  {item.amount != null && item.amount > 0 && (
                    <span className="dash-attention-amount"><Money value={item.amount} /></span>
                  )}
                  {canGo && (
                    <span className="dash-attention-go" aria-hidden>
                      {item.actionLabel} <ArrowRight size={14} />
                    </span>
                  )}
                </>
              );
              return (
                <li key={item.key} className={`dash-attention-item tone-${item.tone}`}>
                  {canGo ? (
                    <button type="button" className="dash-attention-row" onClick={() => onNavigate(item.actionPath!)}>
                      {body}
                    </button>
                  ) : (
                    <div className="dash-attention-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waiting.length > 0 && (
        <p className="dash-waiting">
          <Clock size={14} aria-hidden />
          <span>
            <strong>Aguardando o fim do mês:</strong>{" "}
            {waiting.map((w) => w.title).join(" · ")}
          </span>
        </p>
      )}
    </section>
  );
}
