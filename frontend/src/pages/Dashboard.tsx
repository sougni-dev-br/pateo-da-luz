import { BadgeDollarSign, FileSpreadsheet, ReceiptText, RefreshCw, TicketPercent, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardData, getDashboard } from "../api/client";
import { PeriodFilter } from "../components/PeriodFilter";
import { EmptyState, SummaryCard } from "../components/ui";
import { formatCurrency, formatNumber } from "../utils/format";
import { currentMonthPeriod, type PeriodState } from "../utils/period";

const logoPath = "/logo-pateo-luz.png";

export function Dashboard() {
  const [period, setPeriod] = useState<PeriodState>(currentMonthPeriod());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard(target: PeriodState = period) {
    setLoading(true);
    setError(null);

    try {
      const [year, month] = target.startDate.slice(0, 7).split("-");
      setData(await getDashboard({ year, month, startDate: target.startDate, endDate: target.endDate }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard(period);
  }, []);

  function handlePeriodChange(nextPeriod: PeriodState) {
    setPeriod(nextPeriod);
    if (nextPeriod.preset !== "custom") {
      loadDashboard(nextPeriod);
    }
  }

  return (
    <div className="stack">
      <section className="dashboard-brand panel">
        <img src={logoPath} alt="Pateo da Luz" />
        <div>
          <p>Pateo da Luz</p>
          <h2>Gestão operacional e compras</h2>
        </div>
      </section>

      <section className="panel">
        <div className="filters-row">
          <PeriodFilter value={period} onChange={handlePeriodChange} />
          <button className="primary-button" type="button" onClick={() => loadDashboard()}>
            <RefreshCw size={18} />
            Atualizar
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}
      {loading && <EmptyState title="Carregando dashboard..." description="Buscando indicadores do período selecionado." />}

      {data && !loading && (
        <>
          <div className="summary-grid dashboard-summary">
            <SummaryCard
              label="Faturamento bruto"
              value={formatCurrency(data.revenue?.grossAmount ?? 0)}
              detail={`${formatNumber(data.revenue?.count ?? 0)} lançamentos`}
              tone="success"
              icon={<BadgeDollarSign size={20} />}
            />
            <SummaryCard
              label="Compras do período"
              value={formatCurrency(data.totalAmount)}
              detail={`Anterior: ${formatCurrency(data.previousTotalAmount)}`}
              icon={<ReceiptText size={20} />}
            />
            <SummaryCard
              label="Faturamento líquido"
              value={formatCurrency(data.revenue?.netAmount ?? 0)}
              detail={`Serviço: ${formatCurrency(data.revenue?.serviceAmount ?? 0)}`}
              tone="info"
              icon={<TrendingUp size={20} />}
            />
            <SummaryCard
              label="Tickets"
              value={formatNumber(data.revenue?.tickets ?? 0)}
              detail={`Ticket médio: ${formatCurrency(data.revenue?.ticketAverageGeneral ?? 0)}`}
              icon={<TicketPercent size={20} />}
            />
            <SummaryCard
              label="Variação em R$"
              value={formatCurrency(data.comparisonAmount)}
              detail="Compras contra mês anterior"
              tone={data.comparisonAmount > 0 ? "warning" : "success"}
              icon={<FileSpreadsheet size={20} />}
            />
            <SummaryCard
              label="Variação percentual"
              value={data.comparisonPercent === null ? "-" : `${formatNumber(data.comparisonPercent.toFixed(2))}%`}
              detail="Compras contra mês anterior"
              tone={data.comparisonPercent && data.comparisonPercent > 0 ? "warning" : "success"}
              icon={<TrendingUp size={20} />}
            />
          </div>
          <div className="dashboard-grid">
            <Ranking title="Por categoria" rows={data.byCategory} />
            <Ranking title="Por fornecedor" rows={data.bySupplier} />
            <Ranking
              title="Ranking de produtos"
              rows={data.byProduct.map((item) => ({
                name: item.name,
                total: item.total,
                detail: `${formatNumber(item.quantity)} un.`
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Ranking({
  title,
  rows
}: {
  title: string;
  rows: Array<{ name: string; total: number; detail?: string }>;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="ranking-list">
        {rows.map((row) => (
          <div key={row.name}>
            <span>
              {row.name}
              {row.detail ? <small>{row.detail}</small> : null}
            </span>
            <strong>{formatCurrency(row.total)}</strong>
          </div>
        ))}
        {rows.length === 0 && <EmptyState title="Nenhum dado no período." description="Ajuste o filtro ou importe dados para este período." />}
      </div>
    </section>
  );
}
