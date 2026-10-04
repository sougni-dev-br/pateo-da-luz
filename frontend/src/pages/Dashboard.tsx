import { ShoppingCart, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DashboardAlert,
  DashboardData,
  DashboardSummaryData,
  getDashboard,
  getDashboardAlerts,
  getDashboardSummary,
} from "../api/client";
import { useSession } from "../context/SessionContext";
import { Alert, Button, useFormatCurrency } from "../design-system";
import { AttentionList, type AttentionItem } from "./dashboard/AttentionList";
import { PeriodBar } from "./dashboard/PeriodBar";
import { CmvStrip, ResultPanel, RevenueHero, TicketPanel } from "./dashboard/Panels";
import { PurchasesPanel, RecentPurchases } from "./dashboard/Purchases";
import { RitmoDoMes } from "./dashboard/RitmoDoMes";
import {
  buildDelta,
  classifyAlerts,
  compareRevenue,
  competenceOf,
  isValidCompetence,
  monthInfo,
  monthShortLabel,
  shiftCompetence,
  type MonthInfo,
} from "./dashboard/logic";
import "./dashboard/dashboard.css";

// Mapa path → moduleId para só oferecer navegação a quem pode abrir a tela.
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

// Título curto de cada espera de fim de mês, para caber numa linha só.
const WAITING_TITLE: Record<string, string> = {
  CMV_NO_INVENTORY: "inventário final",
  CMV_PENDING_CLOSE: "fechamento do CMV",
};

type SessionHasPermission = ReturnType<typeof useSession>["hasPermission"];

type Loaded = {
  competence: string;
  data: DashboardData;
  summary: DashboardSummaryData | null;
  alerts: DashboardAlert[];
  /** Partes que falharam — a tela avisa em vez de esconder (contas vencidas sumindo pareceria "tudo em dia"). */
  failed: Array<"alertas" | "indicadores">;
  /** Status do CMV pelo inventário final (endpoint de alertas) — o summary só olha o fechamento. */
  inventoryCmvStatus?: "closed" | "pending" | "missing" | "unknown";
};

export function Dashboard() {
  const navigate = useNavigate();
  const { canAccessSection, hasPermission } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = new Date();
  const urlMonth = searchParams.get("mes");
  const competence = isValidCompetence(urlMonth) ? urlMonth : competenceOf(today);
  const info = monthInfo(competence, today);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (comp: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const [year, month] = comp.split("-");
    const [dash, alerts, summary] = await Promise.allSettled([
      // Sem startDate/endDate de propósito: só assim o backend usa competência,
      // a mesma base do card de compras e do mês anterior.
      getDashboard({ year, month }),
      getDashboardAlerts(comp),
      getDashboardSummary(Number(year), Number(month)),
    ]);
    // Troca rápida de mês: a resposta antiga não pode sobrescrever a nova.
    if (id !== requestId.current) return;
    if (dash.status === "rejected") {
      setError(dash.reason instanceof Error ? dash.reason.message : "Erro ao carregar o painel.");
    } else {
      const rawAlerts = alerts.status === "fulfilled" ? alerts.value?.alerts : undefined;
      setLoaded({
        competence: comp,
        data: dash.value,
        summary: summary.status === "fulfilled" ? summary.value : null,
        alerts: Array.isArray(rawAlerts) ? rawAlerts : [],
        inventoryCmvStatus: alerts.status === "fulfilled" ? alerts.value?.summary?.cmvStatus : undefined,
        failed: [
          ...(alerts.status === "rejected" ? (["alertas"] as const) : []),
          ...(summary.status === "rejected" ? (["indicadores"] as const) : []),
        ],
      });
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(competence); }, [competence, load]);

  function goTo(comp: string) {
    const next = new URLSearchParams(searchParams);
    if (comp === competenceOf(new Date())) next.delete("mes");
    else next.set("mes", comp);
    setSearchParams(next, { replace: true });
  }

  const pathAllowed = (path: string) => {
    const moduleId = MODULE_BY_PATH[path.split("?")[0]];
    return !moduleId || canAccessSection(moduleId);
  };

  return (
    <div className="dash">
      <PeriodBar
        competence={competence}
        info={info}
        loading={loading}
        updatedAt={updatedAt}
        onChange={goTo}
        onStep={(delta) => goTo(shiftCompetence(competence, delta))}
        onToday={() => goTo(competenceOf(new Date()))}
        onRefresh={() => void load(competence)}
      />

      {error && (
        <Alert tone="error">
          {error}{" "}
          <button type="button" className="dash-inline-retry" onClick={() => void load(competence)}>Tentar de novo</button>
        </Alert>
      )}

      {!loaded && loading && <DashboardSkeleton />}

      {loaded && loaded.failed.length > 0 && loaded.competence === competence && (
        <Alert tone="warning">
          Não foi possível carregar {loaded.failed.join(" e ")} deste mês — o que aparece abaixo está incompleto.{" "}
          <button type="button" className="dash-inline-retry" onClick={() => void load(competence)}>Tentar de novo</button>
        </Alert>
      )}

      {/* Com erro na troca de mês, o conteúdo do mês anterior não fica sob o título novo. */}
      {loaded && !(error && loaded.competence !== competence) && (
        <div className="dash-body" aria-busy={loading} data-stale={loading || loaded.competence !== competence}>
          <DashboardContent
            loaded={loaded}
            info={monthInfo(loaded.competence, today)}
            navigate={navigate}
            pathAllowed={pathAllowed}
            canAccessSection={canAccessSection}
            hasPermission={hasPermission}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────

type ContentProps = {
  loaded: Loaded;
  info: MonthInfo;
  navigate: (path: string) => void;
  pathAllowed: (path: string) => boolean;
  canAccessSection: (moduleId: string) => boolean;
  hasPermission: SessionHasPermission;
};

function DashboardContent({ loaded, info, navigate, pathAllowed, canAccessSection, hasPermission }: ContentProps) {
  const fmt = useFormatCurrency();
  const { data, summary, alerts, competence } = loaded;
  const prevLabel = monthShortLabel(shiftCompetence(competence, -1));

  const canCreateRevenue = hasPermission("revenue", "create");
  const canCreatePurchases = hasPermission("purchases", "create");
  const canViewPurchases = canAccessSection("purchases");
  const canViewClosing = canAccessSection("monthly-closing");

  const rev = summary?.revenue;
  const gross = rev?.grossAmount ?? data.revenue?.grossAmount ?? 0;
  const net = rev?.netAmount ?? data.revenue?.netAmount ?? 0;
  const service = rev?.serviceAmount ?? data.revenue?.serviceAmount ?? 0;
  const hasRevenue = gross > 0;
  const purchasesTotal = summary?.purchases.total ?? data.totalAmount;
  const hasPurchases = purchasesTotal > 0;
  const noData = !hasRevenue && !hasPurchases;

  // ── Comparação do faturamento: mesmo trecho no mês em andamento ──
  const daily = summary?.revenueDaily;
  let revenueDelta = null;
  if (!summary) {
    // sem o resumo não há base — o chip some em vez de dizer "sem comparação"
  } else if (daily) {
    const cmp = compareRevenue(daily.current, daily.previous, "netAmount", info.isCurrent);
    const against = cmp.throughDay ? `vs 1–${cmp.throughDay} de ${prevLabel}` : `vs ${prevLabel}`;
    revenueDelta = buildDelta(cmp.pct, true, against);
  } else if (rev) {
    revenueDelta = buildDelta(rev.deltaPercent, true, `vs ${prevLabel}`);
  }

  // Compras são por competência, sem dia: no mês em andamento, o total parcial
  // contra o mês anterior inteiro não é comparação — fica só a referência.
  const purchasesPrev = summary?.purchases.prev.total ?? data.previousTotalAmount;
  const purchasesDelta = info.isCurrent ? null : buildDelta(summary?.purchases.deltaPercent ?? null, false, `vs ${prevLabel}`);
  const purchasesReference = purchasesPrev > 0 && info.isCurrent ? `${prevLabel} fechou em ${fmt(purchasesPrev, { decimals: 0 })}` : undefined;

  // ── Alertas ──
  const attention: AttentionItem[] = [];
  // Como no Dashboard anterior: o aviso só aparece para quem pode ver o faturamento.
  if (!noData && !hasRevenue && canAccessSection("revenue")) {
    attention.push({
      key: "local-revenue",
      bucket: "attention",
      tone: "warning",
      title: "Faturamento ainda não lançado",
      description: "Sem ele os indicadores de receita e o resultado ficam zerados.",
      actionLabel: "Lançar",
      actionPath: canCreateRevenue ? "/financeiro/faturamento" : undefined,
    });
  }
  for (const a of classifyAlerts(alerts, { isInProgress: info.isCurrent, hasRevenue, hasAnyData: !noData })) {
    attention.push({
      key: a.code,
      bucket: a.bucket,
      tone: a.type === "success" ? "info" : a.type,
      title: a.bucket === "waiting" ? WAITING_TITLE[a.code] ?? a.title : a.title,
      description: a.description,
      amount: a.amount,
      actionLabel: shortAction(a.actionLabel),
      actionPath: a.actionPath,
    });
  }

  const quickActions = [
    canCreateRevenue && { label: "Lançar faturamento", icon: <TrendingUp size={16} />, path: "/financeiro/faturamento" },
    canCreatePurchases && { label: "Nova compra", icon: <ShoppingCart size={16} />, path: "/compras" },
  ].filter(Boolean) as { label: string; icon: ReactNode; path: string }[];

  return (
    <>
      <AttentionList items={attention} canNavigate={pathAllowed} onNavigate={navigate} />

      {noData && (
        <section className="dash-card dash-nodata">
          <p>
            {info.isCurrent
              ? `${info.label} ainda não tem lançamentos. Os indicadores aparecem conforme faturamento e compras entram.`
              : info.isFuture
              ? `${info.label} ainda não começou.`
              : `Nenhum lançamento em ${info.label}.`}
          </p>
          {info.isCurrent && quickActions.length > 0 && (
            <div className="dash-nodata-actions">
              {quickActions.map((a) => (
                <Button key={a.path} leadingIcon={a.icon} onClick={() => navigate(a.path)}>{a.label}</Button>
              ))}
            </div>
          )}
        </section>
      )}

      {!noData && (
        <div className="dash-grid">
          <RevenueHero
            gross={gross}
            service={service}
            net={net}
            delta={revenueDelta}
            noDeltaText={summary ? "Sem base de comparação" : undefined}
            emptyAction={canCreateRevenue ? { label: "Lançar faturamento", onClick: () => navigate("/financeiro/faturamento") } : undefined}
            chart={
              daily && (
                <RitmoDoMes
                  current={daily.current}
                  previous={daily.previous}
                  daysInMonth={info.daysInMonth}
                  previousDaysInMonth={monthInfo(shiftCompetence(competence, -1), new Date()).daysInMonth}
                  currentUntil={info.isCurrent ? info.elapsedDays : info.daysInMonth}
                  currentLabel={info.shortLabel}
                  previousLabel={prevLabel}
                />
              )
            }
          />
          <div className="dash-side">
            {summary && (
              <TicketPanel
                perTable={summary.revenue.ticketAveragePerTable}
                perPerson={summary.revenue.ticketAveragePerPerson}
                tables={summary.revenue.tickets}
                people={summary.revenue.peopleServed}
                deltaTable={buildDelta(summary.revenue.deltaTicketAvgPerTablePercent, true, `vs ${prevLabel}`)}
                deltaPerson={buildDelta(summary.revenue.deltaTicketAvgPerPersonPercent, true, `vs ${prevLabel}`)}
              />
            )}
            {summary && (
              <ResultPanel
                net={net}
                purchases={summary.purchases.total}
                smallExpenses={summary.smallExpenses.total}
                result={summary.estimatedResult.value}
                margin={summary.estimatedResult.marginPercent}
              />
            )}
          </div>
        </div>
      )}

      {!noData && summary && (
        <CmvStrip
          status={cmvStatus(summary.cmvReal.status, loaded.inventoryCmvStatus)}
          isInProgress={info.isCurrent}
          accounting={{ value: summary.cmvReal.value, percent: summary.cmvReal.percent }}
          managerial={{
            value: summary.cmvReal.views.managerial?.realCmvValue ?? null,
            percent: summary.cmvReal.views.managerial?.cmvPercent ?? null,
          }}
          onOpen={canViewClosing ? () => navigate("/cmv/fechamento-mensal") : undefined}
        />
      )}

      {!noData && (
        <div className="dash-grid dash-grid--purchases">
          <PurchasesPanel
            total={purchasesTotal}
            count={summary ? summary.purchases.count : null}
            delta={purchasesDelta}
            reference={purchasesReference}
            rankings={{
              category: { rows: data.byCategory, total: data.byCategoryTotal },
              supplier: { rows: data.bySupplier, total: data.bySupplierTotal },
              product: { rows: data.byProduct, total: data.byProductTotal },
            }}
            emptyAction={canCreatePurchases ? { label: "Registrar compra", onClick: () => navigate("/compras") } : undefined}
          />
          {canViewPurchases && data.recentPurchases.length > 0 && (
            <RecentPurchases purchases={data.recentPurchases.slice(0, 7)} onOpenAll={() => navigate("/compras")} />
          )}
        </div>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dash-skeleton-wrap" aria-hidden>
      <div className="dash-grid">
        <div className="dash-skeleton" style={{ height: 360 }} />
        <div className="dash-side">
          <div className="dash-skeleton" style={{ height: 160 }} />
          <div className="dash-skeleton" style={{ height: 184 }} />
        </div>
      </div>
      <div className="dash-skeleton" style={{ height: 320 }} />
    </div>
  );
}

// O summary diz "missing" sempre que não há apuração; os alertas sabem se o
// inventário final já foi lançado. Sem combinar, a faixa dizia "sem inventário"
// logo abaixo do alerta "inventário final registrado".
function cmvStatus(
  fromSummary: "closed" | "pending" | "missing",
  fromInventory?: "closed" | "pending" | "missing" | "unknown",
): "closed" | "pending" | "missing" {
  if (fromSummary === "closed") return "closed";
  if (fromSummary === "pending" || fromInventory === "pending") return "pending";
  return "missing";
}

// "Ver contas a pagar" → "Contas a pagar": o verbo é a seta.
function shortAction(label?: string) {
  if (!label) return undefined;
  const trimmed = label.replace(/^Ver\s+/i, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
