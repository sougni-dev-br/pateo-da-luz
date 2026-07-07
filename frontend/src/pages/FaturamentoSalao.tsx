import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { AppUser, getAgileSyncStatus, getRevenue, type AgileSyncStatus, type RevenueEntry, type RevenueSummary } from "../api/client";
import { Alert, Money, PanelEyebrow, SummaryCard, Table, useFormatCurrency } from "../design-system";
import { formatDate, formatNumber } from "../utils/format";

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

  const syncBanner = renderSyncBanner(status, now);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <PanelEyebrow>Faturamento Salão</PanelEyebrow>
          <h1 style={{ margin: 0 }}>Salão — Agile PDV</h1>
          <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)" }}>
            Dados sincronizados automaticamente do PDV. Somente leitura — para
            editar, use a tela de Faturamento principal.
          </p>
        </div>
        <button
          type="button"
          className="ds-button ds-button-secondary"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {syncBanner}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 24 }}>
        <SummaryCard
          label={yesterday ? `Último dia (${formatDate(yesterday.date)})` : "Último dia"}
          value={formatCurrency(yesterday ? toNumber(yesterday.grossAmount) : 0)}
          detail={yesterday ? `${yesterday.tickets ?? 0} comandas · ticket médio ${formatCurrency(toNumber(yesterday.ticketAverage ?? 0))}` : "Sem dados"}
        />
        <SummaryCard
          label={`Faturamento do mês (${monthParam.padStart(2, "0")}/${yearParam})`}
          value={formatCurrency(totals.gross)}
          detail={`${formatNumber(agileEntries.length)} dias importados`}
        />
        <SummaryCard
          label="Ticket médio do mês"
          value={formatCurrency(ticketAverage)}
          detail={`${formatNumber(totals.tickets)} comandas`}
        />
        <SummaryCard
          label="Serviço acumulado"
          value={formatCurrency(totals.service)}
          detail="10% cobrado"
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <PanelEyebrow>Por turno (mês)</PanelEyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 8 }}>
          <SummaryCard
            label="Almoço"
            value={formatCurrency(totals.shift1)}
            detail={`${formatNumber(totals.tickets1)} comandas`}
          />
          <SummaryCard
            label="Jantar"
            value={formatCurrency(totals.shift2)}
            detail={`${formatNumber(totals.tickets2)} comandas`}
          />
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <PanelEyebrow>Formas de pagamento (mês)</PanelEyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginTop: 8 }}>
          <SummaryCard label="Pix" value={formatCurrency(totals.pix)} />
          <SummaryCard label="Crédito" value={formatCurrency(totals.credit)} />
          <SummaryCard label="Débito" value={formatCurrency(totals.debit)} />
          <SummaryCard label="Dinheiro" value={formatCurrency(totals.cash)} />
          <SummaryCard label="Outros" value={formatCurrency(totals.voucher)} />
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <PanelEyebrow>Dias importados ({monthParam.padStart(2, "0")}/{yearParam})</PanelEyebrow>
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
      </section>
    </div>
  );
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
