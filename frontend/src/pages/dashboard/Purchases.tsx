import { ArrowRight } from "lucide-react";
import { useState } from "react";
import type { Purchase } from "../../api/client";
import { Money, Tabs } from "../../design-system";
import { formatDate, formatNumber, formatPercent } from "../../utils/format";
import { DeltaChip } from "./Panels";
import { withRemainder, type Delta, type RankingRow } from "./logic";

type Dimension = "category" | "supplier" | "product";

type Props = {
  total: number;
  /** null quando o resumo não carregou — aí a legenda de notas some. */
  count: number | null;
  delta: Delta | null;
  reference?: string;
  rankings: Record<Dimension, { rows: RankingRow[]; total?: number }>;
  emptyAction?: { label: string; onClick: () => void };
};

const TABS: Array<{ value: Dimension; label: string }> = [
  { value: "category", label: "Categoria" },
  { value: "supplier", label: "Fornecedor" },
  { value: "product", label: "Produto" },
];

export function PurchasesPanel({ total, count, delta, reference, rankings, emptyAction }: Props) {
  const [dimension, setDimension] = useState<Dimension>("category");
  const current = rankings[dimension];
  const rows = withRemainder(current.rows, current.total);
  const base = current.total ?? rows.reduce((s, r) => s + r.total, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);

  return (
    <section className="dash-card dash-purchases" aria-labelledby="dash-purchases-title">
      <div className="dash-purchases-head">
        <div>
          <h2 id="dash-purchases-title" className="dash-eyebrow">Compras do mês</h2>
          <p className="dash-stat-value dash-stat-value--lg">{total > 0 ? <Money value={total} /> : "—"}</p>
          <p className="dash-stat-label">
            {count === null ? "" : count > 0 ? `${formatNumber(count)} nota${count !== 1 ? "s" : ""}` : "Nenhuma compra lançada"}
            {reference && <> · {reference}</>}
          </p>
        </div>
        <DeltaChip delta={delta} />
      </div>

      {rows.length === 0 ? (
        <div className="dash-empty">
          <p>Nenhuma compra registrada neste mês.</p>
          {emptyAction && (
            <button type="button" className="dash-link-btn" onClick={emptyAction.onClick}>
              {emptyAction.label} <ArrowRight size={14} />
            </button>
          )}
        </div>
      ) : (
        <>
          <Tabs
            className="dash-purchases-tabs"
            tabs={TABS}
            value={dimension}
            onChange={(v) => setDimension(v as Dimension)}
            aria-label="Distribuir compras por"
          />
          <div role="tabpanel" aria-label={`Compras por ${TABS.find((t) => t.value === dimension)?.label.toLowerCase()}`}>
          <ol className="dash-bars">
            {rows.map((row, i) => {
              const share = base > 0 ? (row.total / base) * 100 : 0;
              const width = max > 0 ? Math.max((row.total / max) * 100, 1.5) : 0;
              return (
                <li key={`${dimension}-${row.name}`} className={`dash-bar-row${row.isRemainder ? " is-remainder" : ""}`}>
                  <span className="dash-bar-rank" aria-hidden>{row.isRemainder ? "" : i + 1}</span>
                  <span className="dash-bar-name" title={row.name}>{row.name}</span>
                  <span className="dash-bar-value"><Money value={row.total} /></span>
                  <span className="dash-bar-share">{formatPercent(share)}</span>
                  <span className="dash-bar-track" aria-hidden>
                    <span className="dash-bar-fill" style={{ width: `${width}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
          </div>
        </>
      )}
    </section>
  );
}

export function RecentPurchases({ purchases, onOpenAll }: { purchases: Purchase[]; onOpenAll: () => void }) {
  return (
    <section className="dash-card dash-recent" aria-labelledby="dash-recent-title">
      <h2 id="dash-recent-title" className="dash-eyebrow">Últimas compras</h2>
      <ul className="dash-recent-list">
        {purchases.map((p) => (
          <li key={p.id} className="dash-recent-row">
            <span className="dash-recent-supplier">{p.supplier?.name ?? "—"}</span>
            <span className="dash-recent-meta">
              {formatDate(p.purchaseDate)}
              {p.invoiceNumber ? ` · NF ${p.invoiceNumber}` : p.purchaseNumber ? ` · #${p.purchaseNumber}` : ""}
            </span>
            <strong className="dash-recent-amount"><Money value={p.totalAmount} /></strong>
          </li>
        ))}
      </ul>
      <button type="button" className="dash-link-btn" onClick={onOpenAll}>
        Ver todas as compras <ArrowRight size={14} />
      </button>
    </section>
  );
}
