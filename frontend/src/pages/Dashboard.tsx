import { BadgeDollarSign, FileSpreadsheet, ReceiptText, RefreshCw, TicketPercent, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardData, getDashboard } from "../api/client";
import { PeriodFilter } from "../components/PeriodFilter";
import { EmptyState, SummaryCard } from "../components/ui";
import { formatCurrency, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

const logoPath = "/src/assets/logo-pateo-luz.png";

function monthFromPeriod(startDate: string) {
  return startDate.slice(0, 7);
}

function periodFromMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const format = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { preset: "currentMonth" as const, startDate: format(start), endDate: format(end) };
}

export function Dashboard() {
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [competence, setCompetence] = useState(monthFromPeriod(period.startDate));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);

    try {
      const [year, month] = period.startDate.slice(0, 7).split("-");
      setData(await getDashboard({ year, month, startDate: period.startDate, endDate: period.endDate }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function handlePeriodChange(nextPeriod: ReturnType<typeof currentMonthPeriod>) {
    setPeriod(nextPeriod);
    setCompetence(monthFromPeriod(nextPeriod.startDate));
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
          <label>
            Competencia
            <input
              type="month"
              value={competence}
              onChange={(event) => {
                const value = event.target.value;
                setCompetence(value);
                setPeriod(periodFromMonth(value));
              }}
            />
          </label>
          <PeriodFilter value={period} onChange={handlePeriodChange} />
          <button className="primary-button" type="button" onClick={loadDashboard}>
            <RefreshCw size={18} />
            Atualizar
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}
      {loading && <EmptyState title="Carregando dashboard..." description="Buscando indicadores do periodo selecionado." />}

      {data && !loading && (
        <>
          <div className="summary-grid dashboard-summary">
            <SummaryCard
              label="Faturamento bruto"
              value={formatCurrency(data.revenue?.grossAmount ?? 0)}
              detail={`${formatNumber(data.revenue?.count ?? 0)} lancamentos`}
              tone="success"
              icon={<BadgeDollarSign size={20} />}
            />
            <SummaryCard
              label="Compras do periodo"
              value={formatCurrency(data.totalAmount)}
              detail={`Anterior: ${formatCurrency(data.previousTotalAmount)}`}
              icon={<ReceiptText size={20} />}
            />
            <SummaryCard
              label="Faturamento liquido"
              value={formatCurrency(data.revenue?.netAmount ?? 0)}
              detail={`Servico: ${formatCurrency(data.revenue?.serviceAmount ?? 0)}`}
              tone="info"
              icon={<TrendingUp size={20} />}
            />
            <SummaryCard
              label="Tickets"
              value={formatNumber(data.revenue?.tickets ?? 0)}
              detail={`Ticket medio: ${formatCurrency(data.revenue?.ticketAverageGeneral ?? 0)}`}
              icon={<TicketPercent size={20} />}
            />
            <SummaryCard
              label="Variacao em R$"
              value={formatCurrency(data.comparisonAmount)}
              detail="Compras contra mes anterior"
              tone={data.comparisonAmount > 0 ? "warning" : "success"}
              icon={<FileSpreadsheet size={20} />}
            />
            <SummaryCard
              label="Variacao percentual"
              value={data.comparisonPercent === null ? "-" : `${formatNumber(data.comparisonPercent.toFixed(2))}%`}
              detail="Compras contra mes anterior"
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
        {rows.length === 0 && <EmptyState title="Nenhum dado no periodo." description="Ajuste o filtro ou importe dados para este periodo." />}
      </div>
    </section>
  );
}
