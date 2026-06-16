import {
  ArrowDown,
  ArrowUp,
  BadgeDollarSign,
  ExternalLink,
  Info,
  Minus,
  RefreshCw,
  ShoppingCart,
  TicketPercent,
  TrendingUp,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DashboardAlert,
  DashboardData,
  getDashboard,
  getDashboardAlerts,
} from "../api/client";
import { formatCurrency, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const MONTHS = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function monthFromPeriod(startDate: string) {
  return startDate.slice(0, 7);
}

function periodFromMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { preset: "currentMonth" as const, startDate: fmt(start), endDate: fmt(end) };
}

function safePct(current: number, previous: number): number | null {
  if (previous === 0 || current === 0) return null;
  return ((current - previous) / previous) * 100;
}

type DeltaTone = "success" | "warning" | "neutral";

function deltaInfo(pct: number | null, higherIsGood: boolean): { text: string; tone: DeltaTone } {
  if (pct === null) return { text: "Sem comparação disponível", tone: "neutral" };
  const sign = pct >= 0 ? "+" : "";
  const tone: DeltaTone =
    pct === 0 ? "neutral"
    : higherIsGood ? (pct > 0 ? "success" : "warning")
    : (pct > 0 ? "warning" : "success");
  return { text: `${sign}${pct.toFixed(1)}% vs mês anterior`, tone };
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function Dashboard() {
  const navigate = useNavigate();
  const [competence, setCompetence] = useState(monthFromPeriod(currentMonthPeriod().startDate));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendAlerts, setBackendAlerts] = useState<DashboardAlert[]>([]);

  async function load(comp = competence) {
    setLoading(true);
    setError(null);
    try {
      const [year, month] = comp.split("-");
      const p = periodFromMonth(comp);
      const [dashData, alertsData] = await Promise.allSettled([
        getDashboard({ year, month, startDate: p.startDate, endDate: p.endDate }),
        getDashboardAlerts(comp)
      ]);
      if (dashData.status === "fulfilled") setData(dashData.value);
      else throw dashData.reason;
      setBackendAlerts(alertsData.status === "fulfilled" ? alertsData.value.alerts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleMonthChange(value: string) {
    setCompetence(value);
    load(value);
  }

  // Derived state
  const rev = data?.revenue;
  const hasRevenue = !!rev && rev.grossAmount > 0;
  const hasPurchases = !!data && data.totalAmount > 0;
  const noData = !!data && !hasRevenue && !hasPurchases;

  const now = new Date();
  const isCurrentMonth = competence === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const purchasePct = data ? safePct(data.totalAmount, data.previousTotalAmount) : null;
  const purchaseDelta = deltaInfo(purchasePct, false);

  // Alertas locais de completude de dados (baseados na resposta do dashboard)
  type LocalAlert = { tone: "warning" | "info" | "danger"; text: string; actionPath?: string; actionLabel?: string };
  const localAlerts: LocalAlert[] = [];
  if (!loading && data) {
    if (noData) {
      localAlerts.push({
        tone: "info",
        text: isCurrentMonth
          ? "Nenhum dado lançado ainda neste mês."
          : "Nenhum dado encontrado para o período selecionado.",
      });
    } else {
      if (!hasRevenue) {
        localAlerts.push({
          tone: "warning",
          text: "Faturamento não lançado neste período — importe os dados de receita.",
          actionLabel: "Ver faturamento",
          actionPath: "/financeiro/faturamento"
        });
      }
      if (!hasPurchases) {
        localAlerts.push({ tone: "warning", text: "Nenhuma compra registrada neste período." });
      }
      if (hasPurchases && data.previousTotalAmount === 0) {
        localAlerts.push({ tone: "info", text: "Sem dados do mês anterior — comparação de compras indisponível." });
      }
    }
  }

  // Alertas globais do backend (contas vencidas/a vencer — independem da competência)
  const GLOBAL_CODES = ["OVERDUE_PAYABLES", "DUE_SOON_PAYABLES"];
  const globalAlerts = backendAlerts.filter((a) => GLOBAL_CODES.includes(a.code));

  // Alertas da competência do backend — com filtros conservadores para evitar falso positivo:
  // 1. MISSING_REVENUE_DAYS: só mostra quando há algum faturamento no mês (senão o alerta local já cobre)
  // 2. CMV_*: só mostra quando há dados no mês (compras ou faturamento)
  const competenceAlerts = backendAlerts.filter((a) => {
    if (GLOBAL_CODES.includes(a.code)) return false;
    if (a.code === "MISSING_REVENUE_DAYS" && !hasRevenue) return false;
    if ((a.code === "CMV_NO_INVENTORY" || a.code === "CMV_PENDING_CLOSE") && noData) return false;
    return true;
  });

  type DisplayAlert = { tone: "danger" | "warning" | "info"; label?: string; text: string; actionLabel?: string; actionPath?: string };

  const toDisplay = (a: DashboardAlert): DisplayAlert => ({
    tone: a.type === "success" ? "info" : a.type,
    label: a.title,
    text: a.description + (a.amount != null && a.amount > 0 ? ` Total: ${formatCurrency(a.amount)}.` : ""),
    actionLabel: a.actionLabel,
    actionPath: a.actionPath,
  });

  const localDisplayAlerts: DisplayAlert[] = localAlerts.map((a) => ({
    tone: a.tone as "danger" | "warning" | "info",
    text: a.text,
    actionLabel: a.actionLabel,
    actionPath: a.actionPath,
  }));
  const competenceDisplayAlerts: DisplayAlert[] = competenceAlerts.map(toDisplay);
  const globalDisplayAlerts: DisplayAlert[] = globalAlerts.map(toDisplay);

  const hasAnyAlert = localDisplayAlerts.length > 0 || competenceDisplayAlerts.length > 0 || globalDisplayAlerts.length > 0;

  const [yearPart, monthPart] = competence.split("-");

  return (
    <div className="stack">

      {/* ── Cabeçalho ── */}
      <div className="dash-header panel">
        <div className="dash-header-inner">
          <div>
            <p className="dash-header-eyebrow">Competência</p>
            <div className="dash-period-row">
              <input
                type="month"
                className="dash-month-input"
                value={competence}
                onChange={(e) => handleMonthChange(e.target.value)}
              />
              <span className="dash-month-label">
                {MONTHS[Number(monthPart) - 1]} {yearPart}
                {isCurrentMonth && <span className="dash-live-badge">Em andamento</span>}
              </span>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => load()}
            title="Atualizar"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* ── Alertas ── */}
      {hasAnyAlert && (
        <div className="dash-alerts">
          {/* Alertas locais de completude do período */}
          {localDisplayAlerts.map((a, i) => (
            <AlertRow key={`local-${i}`} alert={a} onNavigate={navigate} />
          ))}
          {/* Alertas operacionais da competência */}
          {competenceDisplayAlerts.map((a, i) => (
            <AlertRow key={`comp-${i}`} alert={a} onNavigate={navigate} />
          ))}
          {/* Alertas financeiros globais — sempre refletem a situação atual */}
          {globalDisplayAlerts.length > 0 && (
            <>
              {(localDisplayAlerts.length > 0 || competenceDisplayAlerts.length > 0) && (
                <p className="dash-alert-group-label">Situação financeira atual</p>
              )}
              {globalDisplayAlerts.map((a, i) => (
                <AlertRow key={`global-${i}`} alert={a} onNavigate={navigate} />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Skeleton enquanto carrega ── */}
      {loading && (
        <div className="dash-skeleton-wrap">
          <div className="dash-kpi-grid">
            {[1,2,3,4].map((i) => <div key={i} className="dash-skeleton" style={{ height: 120 }} />)}
          </div>
          <div className="dashboard-grid">
            {[1,2,3].map((i) => <div key={i} className="dash-skeleton" style={{ height: 280 }} />)}
          </div>
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── KPIs ── */}
          <div className="dash-kpi-grid">
            <KpiCard
              label="Faturamento Bruto"
              value={hasRevenue ? formatCurrency(rev!.grossAmount) : "—"}
              sub={hasRevenue
                ? `${formatNumber(rev!.count)} lançamento${rev!.count !== 1 ? "s" : ""}`
                : "Sem dados lançados"}
              tone={hasRevenue ? "success" : "neutral"}
              icon={<BadgeDollarSign size={18} />}
            />
            <KpiCard
              label="Faturamento Líquido"
              value={hasRevenue ? formatCurrency(rev!.netAmount) : "—"}
              sub={hasRevenue ? `Serviço: ${formatCurrency(rev!.serviceAmount)}` : "Sem dados lançados"}
              tone={hasRevenue ? "info" : "neutral"}
              icon={<TrendingUp size={18} />}
            />
            <KpiCard
              label="Compras do Período"
              value={hasPurchases ? formatCurrency(data.totalAmount) : "—"}
              sub={
                hasPurchases && data.previousTotalAmount > 0
                  ? `Anterior: ${formatCurrency(data.previousTotalAmount)}`
                  : hasPurchases
                  ? "Sem dados do mês anterior"
                  : "Sem compras lançadas"
              }
              tone="neutral"
              icon={<ShoppingCart size={18} />}
              delta={hasPurchases && data.previousTotalAmount > 0 ? purchaseDelta : undefined}
            />
            <KpiCard
              label="Ticket Médio"
              value={hasRevenue && rev!.tickets > 0 ? formatCurrency(rev!.ticketAverageGeneral) : "—"}
              sub={hasRevenue ? `${formatNumber(rev!.tickets)} ticket${rev!.tickets !== 1 ? "s" : ""}` : "Sem dados"}
              tone="neutral"
              icon={<TicketPercent size={18} />}
            />
          </div>

          {/* ── Rankings ── */}
          <div className="dashboard-grid">
            <RankingPanel
              title="Por Categoria"
              rows={[...data.byCategory].sort((a, b) => b.total - a.total).slice(0, 10)}
            />
            <RankingPanel
              title="Por Fornecedor"
              rows={[...data.bySupplier].sort((a, b) => b.total - a.total).slice(0, 10)}
            />
            <RankingPanel
              title="Por Produto"
              rows={[...data.byProduct].sort((a, b) => b.total - a.total).slice(0, 10).map((p) => ({
                name: p.name,
                total: p.total,
                sub: `${formatNumber(p.quantity)} un.`,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Alert Row
// ─────────────────────────────────────────────

function AlertRow({
  alert: a,
  onNavigate,
}: {
  alert: { tone: "danger" | "warning" | "info"; label?: string; text: string; actionLabel?: string; actionPath?: string };
  onNavigate: (path: string) => void;
}) {
  return (
    <div className={`alert ${a.tone} dash-alert-row`} style={{ marginTop: 0 }}>
      <span className="alert-icon"><Info size={15} /></span>
      <span className="dash-alert-text">
        {a.label ? <strong>{a.label}: </strong> : null}
        {a.text}
      </span>
      {a.actionPath && a.actionLabel && (
        <button
          type="button"
          className="dash-alert-action"
          onClick={() => onNavigate(a.actionPath!)}
        >
          {a.actionLabel} <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────

function KpiCard({
  label, value, sub, tone = "neutral", icon, delta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  icon?: ReactNode;
  delta?: { text: string; tone: DeltaTone };
}) {
  return (
    <article className={`dash-kpi-card summary-card tone-${tone}`}>
      <div>
        <span className="dash-kpi-label">{label}</span>
        <strong className="dash-kpi-value">{value}</strong>
        {sub && <small className="muted-inline">{sub}</small>}
        {delta && (
          <div className={`dash-delta dash-delta-${delta.tone}`}>
            {delta.tone === "success" ? <ArrowDown size={11} /> : delta.tone === "warning" ? <ArrowUp size={11} /> : <Minus size={11} />}
            <span>{delta.text}</span>
          </div>
        )}
      </div>
      {icon && <div className="summary-card-icon">{icon}</div>}
    </article>
  );
}

// ─────────────────────────────────────────────
// Ranking Panel
// ─────────────────────────────────────────────

function RankingPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; total: number; sub?: string }>;
}) {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <section className="panel">
      <h3 className="dash-ranking-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="dash-ranking-empty">Nenhum dado no período.</p>
      ) : (
        <ol className="dash-ranking-list">
          {rows.map((row, i) => {
            const pct = grandTotal > 0 ? (row.total / grandTotal) * 100 : 0;
            return (
              <li key={row.name} className="dash-ranking-row">
                <span className="dash-ranking-pos">{i + 1}</span>
                <div className="dash-ranking-body">
                  <div className="dash-ranking-top-row">
                    <span className="dash-ranking-name">{row.name}</span>
                    <strong className="dash-ranking-value">{formatCurrency(row.total)}</strong>
                  </div>
                  <div className="dash-ranking-bar-wrap">
                    <div className="dash-ranking-bar" style={{ width: `${Math.max(pct, 2)}%` }} />
                    <span className="dash-ranking-pct">{pct.toFixed(1)}%{row.sub ? ` · ${row.sub}` : ""}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
