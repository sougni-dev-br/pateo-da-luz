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
  DashboardSummaryData,
  getDashboard,
  getDashboardAlerts,
  getDashboardSummary,
  Purchase,
} from "../api/client";
import { useSession } from "../context/SessionContext";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
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

// Mapa path → moduleId para verificação de permissão nos botões de ação
const MODULE_BY_PATH: Record<string, string> = {
  "/financeiro/faturamento": "revenue",
  "/compras": "purchases",
  "/financeiro/caixa": "cash",
  "/financeiro/contas-a-pagar": "payables",
  "/cmv/fechamento-mensal": "monthly-closing",
  "/estoque/produtos": "products",
  "/cadastros/fornecedores": "suppliers",
  "/fornecedores": "suppliers",
};

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function Dashboard() {
  const navigate = useNavigate();
  const { canAccessSection, hasPermission } = useSession();

  const [competence, setCompetence] = useState(monthFromPeriod(currentMonthPeriod().startDate));
  const [data, setData] = useState<DashboardData | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendAlerts, setBackendAlerts] = useState<DashboardAlert[]>([]);

  // Verifica se o usuário pode navegar para um path antes de exibir o botão
  function pathAllowed(path: string): boolean {
    const moduleId = MODULE_BY_PATH[path];
    if (!moduleId) return true;
    return canAccessSection(moduleId);
  }

  async function load(comp = competence) {
    setLoading(true);
    setError(null);
    try {
      const [yearStr, monthStr] = comp.split("-");
      const p = periodFromMonth(comp);
      const yearNum = Number(yearStr);
      const monthNum = Number(monthStr);
      const [dashData, alertsData, summaryData] = await Promise.allSettled([
        getDashboard({ year: yearStr, month: monthStr, startDate: p.startDate, endDate: p.endDate }),
        getDashboardAlerts(comp),
        getDashboardSummary(yearNum, monthNum),
      ]);
      if (dashData.status === "fulfilled") setData(dashData.value);
      else throw dashData.reason;
      setBackendAlerts(alertsData.status === "fulfilled" ? alertsData.value.alerts : []);
      setSummary(summaryData.status === "fulfilled" ? summaryData.value : null);
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

  const [yearPart, monthPart] = competence.split("-");
  const monthLabel = `${MONTHS[Number(monthPart) - 1]}/${yearPart}`;

  // Permissões por módulo
  // view  → pode acessar a tela (usado em alertas e botões de navegação)
  // create → pode lançar dados (usado em ações rápidas e botões de criação nos KPIs)
  const canViewRevenue   = canAccessSection("revenue");
  const canCreateRevenue = hasPermission("revenue", "create");
  const canViewPurchases  = canAccessSection("purchases");
  const canCreatePurchases = hasPermission("purchases", "create");
  const canViewPayables  = canAccessSection("payables");
  const canCreateCash    = hasPermission("cash", "create");

  // ── Alertas locais de completude do período ──
  type LocalAlert = {
    tone: "warning" | "info" | "danger";
    text: string;
    actionPath?: string;
    actionLabel?: string;
  };

  // Indica se o usuário pode criar em algum dos módulos principais do período
  const canCreateAnything = canCreateRevenue || canCreatePurchases || canCreateCash;

  const localAlerts: LocalAlert[] = [];
  if (!loading && data) {
    if (noData) {
      localAlerts.push({
        tone: "info",
        text: isCurrentMonth
          ? canCreateAnything
            ? `${monthLabel} ainda não tem lançamentos suficientes para análise. Lance faturamento ou compras para liberar os indicadores.`
            : `${monthLabel} ainda não tem lançamentos suficientes para análise.`
          : `Nenhum dado encontrado para ${monthLabel}. Verifique se houve movimento neste período.`,
      });
    } else {
      if (!hasRevenue && canViewRevenue) {
        localAlerts.push({
          tone: "warning",
          text: "Faturamento ainda não lançado neste período — importe os dados para liberar os indicadores de receita.",
          actionLabel: "Ir para faturamento",
          actionPath: "/financeiro/faturamento",
        });
      }
      if (!hasPurchases) {
        localAlerts.push({
          tone: "warning",
          text: "Aguardando lançamentos de compras neste período.",
        });
      }
      if (hasPurchases && data.previousTotalAmount === 0) {
        localAlerts.push({
          tone: "info",
          text: "Sem dados do mês anterior — comparação de compras indisponível.",
        });
      }
    }
  }

  // ── Alertas globais do backend ──
  const GLOBAL_CODES = ["OVERDUE_PAYABLES", "DUE_SOON_PAYABLES"];
  const globalAlerts = backendAlerts.filter((a) => GLOBAL_CODES.includes(a.code));

  // ── Alertas da competência do backend ──
  const competenceAlerts = backendAlerts.filter((a) => {
    if (GLOBAL_CODES.includes(a.code)) return false;
    if (a.code === "MISSING_REVENUE_DAYS" && !hasRevenue) return false;
    if ((a.code === "CMV_NO_INVENTORY" || a.code === "CMV_PENDING_CLOSE") && noData) return false;
    return true;
  });

  type DisplayAlert = {
    tone: "danger" | "warning" | "info";
    label?: string;
    text: string;
    actionLabel?: string;
    actionPath?: string;
  };

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

  const hasAnyAlert =
    localDisplayAlerts.length > 0 ||
    competenceDisplayAlerts.length > 0 ||
    globalDisplayAlerts.length > 0;

  // ── Ações rápidas — só módulos onde o usuário pode criar ──
  const quickActions = [
    canCreateRevenue   && { label: "Lançar faturamento", icon: <TrendingUp   size={16} />, path: "/financeiro/faturamento" },
    canCreatePurchases && { label: "Nova compra",         icon: <ShoppingCart size={16} />, path: "/compras" },
  ].filter(Boolean) as { label: string; icon: ReactNode; path: string }[];

  return (
    <div className="stack">

      {/* ── Cabeçalho ── */}
      <div className="dash-header panel">
        <div className="dash-header-inner">
          <div className="dash-header-left">
            <p className="dash-header-eyebrow">Visão geral</p>
            <h1 className="dash-header-title">Dashboard</h1>
          </div>
          <div className="dash-header-controls">
            <div className="dash-period-row">
              <label className="dash-period-label">Competência</label>
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
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* ── Alertas importantes ── */}
      {hasAnyAlert && (
        <div className="dash-alerts">
          <p className="dash-alert-group-label">Alertas importantes</p>
          {localDisplayAlerts.map((a, i) => (
            <AlertRow
              key={`local-${i}`}
              alert={a}
              onNavigate={navigate}
              allowed={!a.actionPath || pathAllowed(a.actionPath)}
            />
          ))}
          {competenceDisplayAlerts.map((a, i) => (
            <AlertRow
              key={`comp-${i}`}
              alert={a}
              onNavigate={navigate}
              allowed={!a.actionPath || pathAllowed(a.actionPath)}
            />
          ))}
          {globalDisplayAlerts.length > 0 && (
            <>
              {(localDisplayAlerts.length > 0 || competenceDisplayAlerts.length > 0) && (
                <p className="dash-alert-group-label" style={{ marginTop: 4 }}>Situação financeira atual</p>
              )}
              {globalDisplayAlerts.map((a, i) => (
                <AlertRow
                  key={`global-${i}`}
                  alert={a}
                  onNavigate={navigate}
                  allowed={!a.actionPath || pathAllowed(a.actionPath)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Ações rápidas (mês atual sem dados, somente módulos permitidos) ── */}
      {noData && !loading && isCurrentMonth && quickActions.length > 0 && (
        <div className="panel dash-quick-actions">
          <p className="dash-quick-actions-title">Ações rápidas para começar</p>
          <div className="dash-quick-actions-row">
            {quickActions.map((a) => (
              <button
                key={a.path}
                className="primary-button"
                type="button"
                onClick={() => navigate(a.path)}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
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
          {/* ── Resumo financeiro ── */}
          <div className="dash-section">
            <p className="dash-section-label">Resumo financeiro</p>
            <div className="dash-kpi-grid">
              <KpiCard
                label="Faturamento Bruto"
                value={hasRevenue ? formatCurrency(rev!.grossAmount) : "—"}
                sub={
                  hasRevenue
                    ? `${formatNumber(rev!.count)} lançamento${rev!.count !== 1 ? "s" : ""}`
                    : "Sem lançamentos no período"
                }
                tone={hasRevenue ? "success" : "neutral"}
                icon={<BadgeDollarSign size={18} />}
                delta={summary && summary.revenue.deltaPercent !== null ? deltaInfo(summary.revenue.deltaPercent, true) : undefined}
                actionLabel={!hasRevenue && canCreateRevenue ? "Lançar faturamento" : undefined}
                onAction={!hasRevenue && canCreateRevenue ? () => navigate("/financeiro/faturamento") : undefined}
              />
              <KpiCard
                label="Ticket Médio"
                value={hasRevenue && rev!.tickets > 0 ? formatCurrency(rev!.ticketAverageGeneral) : "—"}
                sub={
                  hasRevenue
                    ? `${formatNumber(rev!.tickets)} ticket${rev!.tickets !== 1 ? "s" : ""}`
                    : "Aguardando faturamento"
                }
                tone="neutral"
                icon={<TicketPercent size={18} />}
              />
              <KpiCard
                label="Compras do Período"
                value={summary ? formatCurrency(summary.purchases.total) : hasPurchases ? formatCurrency(data.totalAmount) : "—"}
                sub={
                  summary && summary.purchases.prev.total > 0
                    ? `Anterior: ${formatCurrency(summary.purchases.prev.total)}`
                    : summary && summary.purchases.total > 0
                    ? "Sem dados do mês anterior"
                    : "Sem compras no período"
                }
                tone="neutral"
                icon={<ShoppingCart size={18} />}
                delta={
                  summary && summary.purchases.deltaPercent !== null
                    ? deltaInfo(summary.purchases.deltaPercent, false)
                    : hasPurchases && data.previousTotalAmount > 0 ? purchaseDelta : undefined
                }
                actionLabel={!hasPurchases && !summary?.purchases.total && canCreatePurchases ? "Registrar compra" : undefined}
                onAction={!hasPurchases && !summary?.purchases.total && canCreatePurchases ? () => navigate("/compras") : undefined}
              />
              <KpiCard
                label="CMV Real"
                value={
                  summary?.cmvReal.status === "closed" && summary.cmvReal.value !== null
                    ? formatCurrency(summary.cmvReal.value)
                    : "—"
                }
                sub={
                  summary?.cmvReal.status === "closed"
                    ? summary.cmvReal.percent !== null
                      ? `${summary.cmvReal.percent.toFixed(1)}% do faturamento`
                      : "Período fechado"
                    : summary?.cmvReal.status === "pending"
                    ? "Inventário aberto — fechamento pendente"
                    : "Sem inventário final neste período"
                }
                tone={
                  summary?.cmvReal.status === "closed" ? "info"
                  : "neutral"
                }
                icon={<TrendingUp size={18} />}
                actionLabel={
                  summary && summary.cmvReal.status !== "closed" && canAccessSection("monthly-closing")
                    ? "Fechar período"
                    : undefined
                }
                onAction={
                  summary && summary.cmvReal.status !== "closed" && canAccessSection("monthly-closing")
                    ? () => navigate("/cmv/fechamento-mensal")
                    : undefined
                }
              />
              <KpiCard
                label="Resultado Estimado"
                value={summary ? formatCurrency(summary.estimatedResult.value) : "—"}
                sub={
                  summary
                    ? summary.estimatedResult.marginPercent !== null
                      ? `Margem: ${summary.estimatedResult.marginPercent.toFixed(1)}%`
                      : "Faturamento − Compras do período"
                    : "Aguardando dados"
                }
                tone={
                  summary
                    ? summary.estimatedResult.value > 0 ? "success"
                    : summary.estimatedResult.value < 0 ? "danger"
                    : "neutral"
                  : "neutral"
                }
                icon={<BadgeDollarSign size={18} />}
              />
            </div>
          </div>

          {/* ── Distribuição de compras ── */}
          <div className="dash-section">
            <p className="dash-section-label">Distribuição de compras</p>
            <div className="dashboard-grid">
              <RankingPanel
                title="Por Categoria"
                rows={[...data.byCategory].sort((a, b) => b.total - a.total).slice(0, 10)}
                emptyText="Nenhuma compra registrada neste período."
                emptyActionLabel={canViewPurchases ? "Ver compras" : undefined}
                emptyActionPath={canViewPurchases ? "/compras" : undefined}
                onNavigate={navigate}
              />
              <RankingPanel
                title="Por Fornecedor"
                rows={[...data.bySupplier].sort((a, b) => b.total - a.total).slice(0, 10)}
                emptyText="Nenhuma compra registrada neste período."
                emptyActionLabel={canViewPurchases ? "Ver fornecedores" : undefined}
                emptyActionPath={canViewPurchases ? "/compras" : undefined}
                onNavigate={navigate}
              />
              <RankingPanel
                title="Por Produto"
                rows={[...data.byProduct].sort((a, b) => b.total - a.total).slice(0, 10).map((p) => ({
                  name: p.name,
                  total: p.total,
                  sub: `${formatNumber(p.quantity)} un.`,
                }))}
                emptyText="Nenhum produto registrado neste período."
                emptyActionLabel={canViewPurchases ? "Ver compras" : undefined}
                emptyActionPath={canViewPurchases ? "/compras" : undefined}
                onNavigate={navigate}
              />
            </div>
          </div>

          {/* ── Compras recentes ── */}
          {data.recentPurchases.length > 0 && canViewPurchases && (
            <div className="dash-section">
              <p className="dash-section-label">Compras recentes</p>
              <div className="panel">
                <RecentPurchasesList
                  purchases={data.recentPurchases.slice(0, 6)}
                  onNavigate={navigate}
                />
              </div>
            </div>
          )}
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
  allowed = true,
}: {
  alert: {
    tone: "danger" | "warning" | "info";
    label?: string;
    text: string;
    actionLabel?: string;
    actionPath?: string;
  };
  onNavigate: (path: string) => void;
  allowed?: boolean;
}) {
  return (
    <div className={`alert ${a.tone} dash-alert-row`} style={{ marginTop: 0 }}>
      <span className="alert-icon"><Info size={15} /></span>
      <span className="dash-alert-text">
        {a.label ? <strong>{a.label}: </strong> : null}
        {a.text}
      </span>
      {allowed && a.actionPath && a.actionLabel && (
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
  label, value, sub, tone = "neutral", icon, delta, actionLabel, onAction,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  icon?: ReactNode;
  delta?: { text: string; tone: DeltaTone };
  actionLabel?: string;
  onAction?: () => void;
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
        {actionLabel && onAction && (
          <button type="button" className="dash-kpi-action" onClick={onAction}>
            {actionLabel} <ExternalLink size={11} />
          </button>
        )}
      </div>
      {icon && <div className="summary-card-icon">{icon}</div>}
    </article>
  );
}

// ─────────────────────────────────────────────
// Recent Purchases List
// ─────────────────────────────────────────────

function RecentPurchasesList({
  purchases,
  onNavigate,
}: {
  purchases: Purchase[];
  onNavigate: (path: string) => void;
}) {
  return (
    <ul className="dash-recent-list">
      {purchases.map((p) => (
        <li key={p.id} className="dash-recent-row">
          <span className="dash-recent-supplier">{p.supplier?.name ?? "—"}</span>
          <span className="dash-recent-meta">
            {p.invoiceNumber ? `NF ${p.invoiceNumber}` : p.purchaseNumber ? `#${p.purchaseNumber}` : ""}
          </span>
          <span className="dash-recent-date">{formatDate(p.purchaseDate)}</span>
          <strong className="dash-recent-amount">{formatCurrency(Number(p.totalAmount))}</strong>
        </li>
      ))}
      <li className="dash-recent-footer">
        <button
          type="button"
          className="dash-alert-action"
          onClick={() => onNavigate("/compras")}
        >
          Ver todas as compras <ExternalLink size={12} />
        </button>
      </li>
    </ul>
  );
}

// ─────────────────────────────────────────────
// Ranking Panel
// ─────────────────────────────────────────────

function RankingPanel({
  title,
  rows,
  emptyText = "Nenhum dado no período.",
  emptyActionLabel,
  emptyActionPath,
  onNavigate,
}: {
  title: string;
  rows: Array<{ name: string; total: number; sub?: string }>;
  emptyText?: string;
  emptyActionLabel?: string;
  emptyActionPath?: string;
  onNavigate?: (path: string) => void;
}) {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <section className="panel">
      <h3 className="dash-ranking-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="dash-ranking-empty">
          <p>{emptyText}</p>
          {emptyActionLabel && emptyActionPath && onNavigate && (
            <button
              type="button"
              className="dash-alert-action"
              onClick={() => onNavigate(emptyActionPath)}
            >
              {emptyActionLabel} <ExternalLink size={12} />
            </button>
          )}
        </div>
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
