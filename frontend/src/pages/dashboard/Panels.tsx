import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Money } from "../../design-system";
import { formatNumber, formatPercent } from "../../utils/format";
import type { Delta } from "./logic";

export function DeltaChip({ delta, fallback }: { delta: Delta | null; fallback?: string }) {
  if (!delta) return fallback ? <span className="dash-delta dash-delta--neutral">{fallback}</span> : null;
  const Icon = delta.direction === "up" ? ArrowUp : delta.direction === "down" ? ArrowDown : Minus;
  const sign = delta.pct > 0 ? "+" : "";
  return (
    <span className={`dash-delta dash-delta--${delta.tone}`}>
      <Icon size={12} aria-hidden />
      <strong>{sign}{formatPercent(delta.pct)}</strong>
      <span>{delta.against}</span>
    </span>
  );
}

// ── Faturamento ────────────────────────────────────────────

type RevenueProps = {
  gross: number;
  service: number;
  net: number;
  delta: Delta | null;
  /** Texto quando não há variação; omitido quando nem a base carregou. */
  noDeltaText?: string;
  chart?: ReactNode;
  emptyAction?: { label: string; onClick: () => void };
};

/**
 * Bruto − serviço = líquido: os três são termos de uma conta, não três cartões.
 * O delivery grava o líquido já sem comissão, promoção e entrega — o que o
 * serviço não explica entra como um termo próprio, para a conta fechar.
 */
export function RevenueHero({ gross, service, net, delta, noDeltaText, chart, emptyAction }: RevenueProps) {
  const hasRevenue = gross > 0;
  const otherDeductions = gross - service - net;
  const hasOther = Math.abs(otherDeductions) >= 0.5;
  return (
    <section className="dash-card dash-revenue" aria-labelledby="dash-revenue-title">
      <div className="dash-revenue-head">
        <div>
          <h2 id="dash-revenue-title" className="dash-eyebrow">Faturamento líquido</h2>
          <p className="dash-hero-value">{hasRevenue ? <Money value={net} /> : "—"}</p>
          <p className="dash-hero-caption">
            {hasRevenue ? "O que fica para a casa depois do serviço e das deduções" : "Nenhum faturamento lançado neste mês"}
          </p>
        </div>
        {hasRevenue && <DeltaChip delta={delta} fallback={noDeltaText} />}
        {!hasRevenue && emptyAction && (
          <button type="button" className="dash-link-btn" onClick={emptyAction.onClick}>
            {emptyAction.label} <ArrowRight size={14} />
          </button>
        )}
      </div>

      {hasRevenue && (
        <dl className="dash-equation" aria-label="Composição do faturamento">
          <div><dt>Bruto</dt><dd><Money value={gross} /></dd></div>
          <span className="dash-equation-op" aria-hidden>−</span>
          <div className="dash-equation-minus"><dt>Serviço</dt><dd><Money value={service} /></dd></div>
          {hasOther && (
            <>
              <span className="dash-equation-op" aria-hidden>−</span>
              <div className="dash-equation-minus"><dt>Deduções do delivery e outras</dt><dd><Money value={otherDeductions} /></dd></div>
            </>
          )}
          <span className="dash-equation-op" aria-hidden>=</span>
          <div className="dash-equation-result"><dt>Líquido</dt><dd><Money value={net} /></dd></div>
        </dl>
      )}

      {hasRevenue && chart}
    </section>
  );
}

// ── Ticket médio ───────────────────────────────────────────

type TicketProps = {
  perTable: number;
  perPerson: number;
  tables: number;
  people: number;
  deltaTable: Delta | null;
  deltaPerson: Delta | null;
};

export function TicketPanel({ perTable, perPerson, tables, people, deltaTable, deltaPerson }: TicketProps) {
  return (
    <section className="dash-card dash-ticket" aria-labelledby="dash-ticket-title">
      <h2 id="dash-ticket-title" className="dash-eyebrow">Ticket médio</h2>
      <div className="dash-ticket-grid">
        <div>
          <p className="dash-stat-value">{perTable > 0 ? <Money value={perTable} /> : "—"}</p>
          <p className="dash-stat-label">por mesa · {formatNumber(tables)} mesa{tables !== 1 ? "s" : ""}</p>
          <DeltaChip delta={deltaTable} />
        </div>
        <div>
          <p className="dash-stat-value">{perPerson > 0 ? <Money value={perPerson} /> : "—"}</p>
          <p className="dash-stat-label">por pessoa · {formatNumber(people)} pessoa{people !== 1 ? "s" : ""}</p>
          <DeltaChip delta={deltaPerson} />
        </div>
      </div>
    </section>
  );
}

// ── Resultado estimado ─────────────────────────────────────

type ResultProps = {
  net: number;
  purchases: number;
  smallExpenses: number;
  result: number;
  margin: number | null;
};

export function ResultPanel({ net, purchases, smallExpenses, result, margin }: ResultProps) {
  const tone = result > 0 ? "success" : result < 0 ? "danger" : "neutral";
  return (
    <section className="dash-card dash-result" aria-labelledby="dash-result-title">
      <h2 id="dash-result-title" className="dash-eyebrow">Resultado estimado</h2>
      <dl className="dash-ledger">
        <div><dt>Faturamento líquido</dt><dd><Money value={net} /></dd></div>
        <div><dt>− Compras</dt><dd><Money value={purchases} /></dd></div>
        {smallExpenses > 0 && <div><dt>− Pequenos gastos</dt><dd><Money value={smallExpenses} /></dd></div>}
        <div className={`dash-ledger-total tone-${tone}`}>
          <dt>= Resultado{margin !== null && <span className="dash-ledger-margin">margem {formatPercent(margin)}</span>}</dt>
          <dd><Money value={result} /></dd>
        </div>
      </dl>
      <p className="dash-footnote">Conta de caixa do mês: compras lançadas, não o CMV. Folha, impostos e ocupação ficam de fora.</p>
    </section>
  );
}

// ── CMV ────────────────────────────────────────────────────

type CmvProps = {
  status: "closed" | "pending" | "missing" | undefined;
  isInProgress: boolean;
  accounting: { value: number | null; percent: number | null };
  managerial: { value: number | null; percent: number | null };
  onOpen?: () => void;
};

/**
 * CMV só existe com inventário final. Antes disso, uma linha dizendo quando ele
 * sai — dois cartões com "-" o mês inteiro não informam nada.
 */
export function CmvStrip({ status, isInProgress, accounting, managerial, onOpen }: CmvProps) {
  const closed = status === "closed";
  const message =
    status === "pending" ? "Inventário final lançado — falta concluir o fechamento."
    : isInProgress ? "O CMV do mês sai no fechamento, depois do inventário final."
    : "Sem inventário final neste mês — o CMV não foi apurado.";

  return (
    <section className={`dash-card dash-cmv ${closed ? "" : "dash-cmv--open"}`} aria-labelledby="dash-cmv-title">
      <h2 id="dash-cmv-title" className="dash-eyebrow">CMV do mês</h2>
      {closed ? (
        <dl className="dash-cmv-values">
          <div>
            <dt>Contábil</dt>
            <dd><Money value={accounting.value} /> <span>{formatPercent(accounting.percent)} do faturamento</span></dd>
          </div>
          <div>
            <dt>Gerencial</dt>
            <dd><Money value={managerial.value} /> <span>{formatPercent(managerial.percent)} do faturamento</span></dd>
          </div>
        </dl>
      ) : (
        <p className="dash-cmv-message">{message}</p>
      )}
      {onOpen && (
        <button type="button" className="dash-link-btn" onClick={onOpen}>
          {closed ? "Ver apuração" : "Ir para o fechamento"} <ArrowRight size={14} />
        </button>
      )}
    </section>
  );
}
