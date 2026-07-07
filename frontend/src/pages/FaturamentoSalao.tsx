import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { AppUser, getAgileSyncStatus, getRevenue, type AgileSyncStatus, type RevenueEntry, type RevenueSummary } from "../api/client";
import { Alert, Money, PanelEyebrow, SummaryCard, Table, useFormatCurrency } from "../design-system";

import { formatDate, formatNumber } from "../utils/format";
import "./FaturamentoSalao.css";

// Nova tela dedicada ao faturamento do salão vindo do Agile PDV via agente local.
// A tela existente /financeiro/faturamento continua sendo a fonte principal de
// edição manual — esta aqui é APENAS leitura, mostra o resultado da sincronização
// automatizada e o status da última execução do agente.

type Props = {
  user: AppUser;
};

const AGILE_PLATFORM = "AGILE_PDV";

export function FaturamentoSalao({ user: _user }: Props) {
  const now = useMemo(() => new Date(), []);
  const yearParam = String(now.getFullYear());
  const monthParam = String(now.getMonth() + 1);

  const [status, setStatus] = useState<AgileSyncStatus | null>(null);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const formatCurrency = useFormatCurrency();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      getAgileSyncStatus(controller.signal).catch(() => null),
      getRevenue({ year: yearParam, month: monthParam, channel: "Salão" }, controller.signal).catch(() => null)
    ])
      .then(([statusResult, revenueResult]) => {
        if (controller.signal.aborted) return;
        setStatus(statusResult);
        setSummary(revenueResult);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [yearParam, monthParam, refreshKey]);

  const agileEntries = useMemo(() => {
    if (!summary) return [] as RevenueEntry[];
    return summary.entries
      .filter((e) => e.sourcePlatform === AGILE_PLATFORM && e.status === "ACTIVE")
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [summary]);

  const totals = useMemo(() => {
    return agileEntries.reduce(
      (acc, e) => {
        acc.gross += toNumber(e.grossAmount);
        acc.net += toNumber(e.netAmount);
        acc.service += toNumber(e.serviceAmount);
        acc.tickets += Number(e.tickets ?? 0);
        acc.shift1 += toNumber(e.salesFirstShift);
        acc.shift2 += toNumber(e.salesSecondShift);
        acc.tickets1 += Number(e.ticketsFirstShift ?? 0);
        acc.tickets2 += Number(e.ticketsSecondShift ?? 0);
        acc.pix += toNumber(e.pixAmount);
        acc.credit += toNumber(e.creditAmount);
        acc.debit += toNumber(e.debitAmount);
        acc.cash += toNumber(e.cashAmount);
        acc.voucher += toNumber(e.voucherAmount);
        return acc;
      },
      { gross: 0, net: 0, service: 0, tickets: 0, shift1: 0, shift2: 0, tickets1: 0, tickets2: 0, pix: 0, credit: 0, debit: 0, cash: 0, voucher: 0 }
    );
  }, [agileEntries]);

  const ticketAverage = totals.tickets > 0 ? totals.gross / totals.tickets : 0;
  const yesterday = agileEntries[agileEntries.length - 1] ?? null;

  // Detecta se o mes filtrado eh o mes corrente para exibir contexto
  // "em andamento". Para meses passados, o breakdown por dia jah eh completo.
  const isCurrentMonth = Number(yearParam) === now.getFullYear()
    && Number(monthParam) === now.getMonth() + 1;
  const daysInMonth = new Date(Number(yearParam), Number(monthParam), 0).getDate();
  const daysConsidered = isCurrentMonth ? now.getDate() : daysInMonth;
  const dailyAverage = daysConsidered > 0 ? totals.gross / daysConsidered : 0;

  // Total base para calcular % de cada forma de pagamento no mes.
  const pgtoTotal = totals.pix + totals.credit + totals.debit + totals.cash + totals.voucher;

  const syncBanner = renderSyncBanner(status, now);

  return (
    <div className="stack">
      <div className="fatsalao-toolbar">
        <button
          type="button"
          className="icon-button"
          onClick={() => setRefreshKey((k) => k + 1)}
          aria-label="Atualizar dados da tela"
          title="Atualizar"
        >
          <RefreshCw size={18} className={loading ? "spin" : ""} />
        </button>
      </div>

      {syncBanner}

      <section className="fatsalao-section">
        <div className="fatsalao-grid">
          <SummaryCard
            label={yesterday ? `Último dia (${formatDate(yesterday.date)})` : "Último dia"}
            value={formatCurrency(yesterday ? toNumber(yesterday.grossAmount) : 0)}
            detail={yesterday
              ? `${yesterday.tickets ?? 0} comandas · TM ${formatCurrency(toNumber(yesterday.ticketAverage ?? 0))}`
              : "Sem dados"}
          />
          <SummaryCard
            label={`Faturamento (${monthParam.padStart(2, "0")}/${yearParam})`}
            value={formatCurrency(totals.gross)}
            detail={isCurrentMonth
              ? `${agileEntries.length}/${daysInMonth} dias · média ${formatCurrency(dailyAverage)}/dia`
              : `${agileEntries.length} dias · média ${formatCurrency(dailyAverage)}/dia`}
          />
          <SummaryCard
            label="Ticket médio do mês"
            value={formatCurrency(ticketAverage)}
            detail={`${formatNumber(totals.tickets)} comandas`}
          />
          <SummaryCard
            label="Serviço (10%) acumulado"
            value={formatCurrency(totals.service)}
            detail="Gorjeta sugerida do mês"
          />
        </div>
      </section>

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Por turno ({monthParam.padStart(2, "0")}/{yearParam})</PanelEyebrow>
        <div className="fatsalao-grid fatsalao-grid-turnos">
          <SummaryCard
            label="Almoço"
            value={formatCurrency(totals.shift1)}
            detail={`${formatNumber(totals.tickets1)} comandas · ${pctText(totals.shift1, totals.gross)}`}
          />
          <SummaryCard
            label="Jantar"
            value={formatCurrency(totals.shift2)}
            detail={`${formatNumber(totals.tickets2)} comandas · ${pctText(totals.shift2, totals.gross)}`}
          />
        </div>
      </section>

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Formas de pagamento ({monthParam.padStart(2, "0")}/{yearParam})</PanelEyebrow>
        <div className="fatsalao-grid fatsalao-grid-pgto">
          <PaymentCard label="Pix" value={totals.pix} total={pgtoTotal} formatCurrency={formatCurrency} />
          <PaymentCard label="Crédito" value={totals.credit} total={pgtoTotal} formatCurrency={formatCurrency} />
          <PaymentCard label="Débito" value={totals.debit} total={pgtoTotal} formatCurrency={formatCurrency} />
          <PaymentCard label="Dinheiro" value={totals.cash} total={pgtoTotal} formatCurrency={formatCurrency} />
          <PaymentCard
            label="Voucher"
            value={totals.voucher}
            total={pgtoTotal}
            formatCurrency={formatCurrency}
            hint="Vale-refeição/alimentação"
          />
        </div>
      </section>

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Dias importados ({monthParam.padStart(2, "0")}/{yearParam})</PanelEyebrow>
        <div className="fatsalao-table">
          <Table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Dia</th>
                <th style={{ textAlign: "right" }}>Comandas</th>
                <th style={{ textAlign: "right" }}>Bruto</th>
                <th style={{ textAlign: "right" }}>Serviço</th>
                <th style={{ textAlign: "right" }}>Líquido</th>
                <th style={{ textAlign: "right" }}>Ticket médio</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Carregando...</td></tr>
              ) : agileEntries.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>
                  Nenhum dia importado do Agile ainda. Configure o agente na máquina PDVTOUCH.
                </td></tr>
              ) : (
                agileEntries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.weekdayName ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{formatNumber(e.tickets ?? 0)}</td>
                    <td style={{ textAlign: "right" }}><Money value={toNumber(e.grossAmount)} /></td>
                    <td style={{ textAlign: "right" }}><Money value={toNumber(e.serviceAmount)} /></td>
                    <td style={{ textAlign: "right" }}><Money value={toNumber(e.netAmount)} /></td>
                    <td style={{ textAlign: "right" }}><Money value={toNumber(e.ticketAverage ?? 0)} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}



type PaymentCardProps = {
  label: string;
  value: number;
  total: number;
  formatCurrency: (value: number) => string;
  hint?: string;
};

function PaymentCard({ label, value, total, formatCurrency, hint }: PaymentCardProps) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <SummaryCard
      label={label}
      value={formatCurrency(value)}
      detail={
        <>
          {`${pct.toFixed(1)}% do recebido`}
          {hint ? <div className="fatsalao-hint">{hint}</div> : null}
          <div className="fatsalao-pgto-bar" aria-hidden>
            <div className="fatsalao-pgto-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
        </>
      }
    />
  );
}

function pctText(part: number, total: number): string {
  if (total <= 0) return "0% do bruto";
  return `${((part / total) * 100).toFixed(1)}% do bruto`;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value) || 0;
}

// Escolhe o tom do banner baseado no gap entre a última sync e "agora".
// Verde: sync feita hoje ou ontem. Amarelo: 2 dias. Vermelho: 3+ dias ou nunca.
function renderSyncBanner(status: AgileSyncStatus | null, now: Date) {
  if (!status || !status.ultimaSyncEm) {
    return (
      <Alert tone="error" style={{ marginTop: 16 }}>
        <AlertTriangle size={16} style={{ marginRight: 8 }} />
        Nenhuma sincronização registrada ainda. O agente precisa rodar pelo menos uma vez no PDVTOUCH.
      </Alert>
    );
  }
  const last = new Date(status.ultimaSyncEm);
  const diffMs = now.getTime() - last.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const label = last.toLocaleString("pt-BR");
  if (diffDays <= 1) {
    return (
      <Alert tone="success" style={{ marginTop: 16 }}>
        <CheckCircle2 size={16} style={{ marginRight: 8 }} />
        Última sync: {label} · {status.diasImportadosUltimoBatch} dia(s) no último lote · {status.totalRegistrosSalaoAgile} dias no total.
      </Alert>
    );
  }
  if (diffDays === 2) {
    return (
      <Alert tone="warning" style={{ marginTop: 16 }}>
        <AlertTriangle size={16} style={{ marginRight: 8 }} />
        Última sync há {diffDays} dias ({label}). Verifique se o PDVTOUCH está ligando normalmente.
      </Alert>
    );
  }
  return (
    <Alert tone="error" style={{ marginTop: 16 }}>
      <AlertTriangle size={16} style={{ marginRight: 8 }} />
      Última sync há {diffDays} dias ({label}). O agente pode estar com problema — verificar máquina PDVTOUCH.
    </Alert>
  );
}
