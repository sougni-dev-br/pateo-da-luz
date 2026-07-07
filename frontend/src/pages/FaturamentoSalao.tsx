import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
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

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// Formato do <input type="month">: "YYYY-MM".
function todayCompetence(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftCompetence(competence: string, deltaMonths: number): string {
  const [y, m] = competence.split("-").map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function FaturamentoSalao({ user: _user }: Props) {
  const now = useMemo(() => new Date(), []);
  const [competence, setCompetence] = useState<string>(() => todayCompetence(now));

  const [status, setStatus] = useState<AgileSyncStatus | null>(null);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const formatCurrency = useFormatCurrency();
  const monthInputRef = useRef<HTMLInputElement>(null);

  const [yearPart, monthPart] = competence.split("-");
  const yearParam = yearPart;
  const monthParam = String(Number(monthPart));

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
        acc.tables += Number(e.tickets ?? 0); // 1 venda no CSV = 1 mesa atendida
        acc.people += Number(e.peopleServed ?? 0);
        acc.peopleReported += e.peopleServed != null ? 1 : 0;
        acc.shift1 += toNumber(e.salesFirstShift);
        acc.shift2 += toNumber(e.salesSecondShift);
        acc.tables1 += Number(e.ticketsFirstShift ?? 0);
        acc.tables2 += Number(e.ticketsSecondShift ?? 0);
        acc.pix += toNumber(e.pixAmount);
        acc.credit += toNumber(e.creditAmount);
        acc.debit += toNumber(e.debitAmount);
        acc.cash += toNumber(e.cashAmount);
        acc.voucher += toNumber(e.voucherAmount);
        return acc;
      },
      { gross: 0, net: 0, service: 0, tables: 0, people: 0, peopleReported: 0, shift1: 0, shift2: 0, tables1: 0, tables2: 0, pix: 0, credit: 0, debit: 0, cash: 0, voucher: 0 }
    );
  }, [agileEntries]);

  const tmPorMesa = totals.tables > 0 ? totals.gross / totals.tables : 0;
  const tmPorPessoa = totals.people > 0 ? totals.gross / totals.people : 0;
  // Nem todo dia importado tem peopleServed (dados anteriores à migração
  // ficam null). Sinalizamos isso pra evitar TM/pessoa enganoso.
  const peopleDataComplete = totals.peopleReported === agileEntries.length;
  const yesterday = agileEntries[agileEntries.length - 1] ?? null;

  const currentCompetence = todayCompetence(now);
  const isCurrentMonth = competence === currentCompetence;
  const daysInMonth = new Date(Number(yearParam), Number(monthParam), 0).getDate();
  const daysConsidered = isCurrentMonth ? now.getDate() : daysInMonth;
  const dailyAverage = daysConsidered > 0 ? totals.gross / daysConsidered : 0;

  const pgtoTotal = totals.pix + totals.credit + totals.debit + totals.cash + totals.voucher;
  const monthLabel = `${MONTHS_PT[Number(monthPart) - 1]} ${yearPart}`;

  // Se conseguimos carregar dados mas o /status falhou, é um problema pontual
  // do endpoint — não faz sentido gritar "nenhuma sync" com dados na tela.
  const hasAnyData = agileEntries.length > 0;
  const syncBanner = renderSyncBanner(status, now, hasAnyData);

  return (
    <div className="stack">
      <div className="fatsalao-toolbar">
        <div className="fatsalao-period">
          <button
            type="button"
            className="icon-button"
            aria-label="Mês anterior"
            title="Mês anterior"
            onClick={() => setCompetence((c) => shiftCompetence(c, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          {/*
            Pill de periodo — reusa o design do antigo topbar (Calendar + label +
            ChevronDown). O <input type="month"> real fica escondido atras dele
            e recebe foco quando o usuario clica no pill; assim aproveitamos o
            date picker nativo do navegador sem expor o input sem estilo.
          */}
          <button
            type="button"
            className="fatsalao-period-pill"
            aria-label={`Período atual: ${monthLabel}. Clique para trocar.`}
            onClick={() => {
              const el = monthInputRef.current;
              if (!el) return;
              // showPicker existe em Chrome/Edge/Safari recentes; fallback e focus.
              if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
                (el as HTMLInputElement & { showPicker: () => void }).showPicker();
              } else {
                el.focus();
                el.click();
              }
            }}
          >
            <Calendar size={14} strokeWidth={2} aria-hidden />
            <span className="fatsalao-period-pill-text">{monthLabel}</span>
            {isCurrentMonth && <span className="fatsalao-live-badge">Em andamento</span>}
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </button>
          <input
            ref={monthInputRef}
            type="month"
            className="fatsalao-period-input-hidden"
            value={competence}
            max={currentCompetence}
            onChange={(e) => e.target.value && setCompetence(e.target.value)}
            aria-label="Selecionar competência"
            tabIndex={-1}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Próximo mês"
            title="Próximo mês"
            disabled={isCurrentMonth}
            onClick={() => setCompetence((c) => shiftCompetence(c, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
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
              ? `${formatNumber(yesterday.tickets ?? 0)} mesas${yesterday.peopleServed ? ` · ${formatNumber(yesterday.peopleServed)} pessoas` : ""}`
              : "Sem dados"}
          />
          <SummaryCard
            label={`Faturamento (${monthLabel})`}
            value={formatCurrency(totals.gross)}
            detail={isCurrentMonth
              ? `${agileEntries.length}/${daysInMonth} dias · média ${formatCurrency(dailyAverage)}/dia`
              : `${agileEntries.length} dia${agileEntries.length === 1 ? "" : "s"} · média ${formatCurrency(dailyAverage)}/dia`}
          />
          <SummaryCard
            label="Mesas atendidas"
            value={formatNumber(totals.tables)}
            detail={`TM por mesa ${formatCurrency(tmPorMesa)}`}
          />
          <SummaryCard
            label="Pessoas atendidas"
            value={peopleDataComplete && totals.people > 0 ? formatNumber(totals.people) : "—"}
            detail={
              peopleDataComplete && totals.people > 0
                ? `TM por pessoa ${formatCurrency(tmPorPessoa)}`
                : "Dado disponível após próximo sync"
            }
          />
          <SummaryCard
            label="Serviço (10%) acumulado"
            value={formatCurrency(totals.service)}
            detail="Gorjeta sugerida do mês"
          />
        </div>
      </section>

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Por turno ({monthLabel})</PanelEyebrow>
        <div className="fatsalao-grid fatsalao-grid-turnos">
          <SummaryCard
            label="Almoço"
            value={formatCurrency(totals.shift1)}
            detail={`${formatNumber(totals.tables1)} mesas · ${pctText(totals.shift1, totals.gross)}`}
          />
          <SummaryCard
            label="Jantar"
            value={formatCurrency(totals.shift2)}
            detail={`${formatNumber(totals.tables2)} mesas · ${pctText(totals.shift2, totals.gross)}`}
          />
        </div>
      </section>

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Formas de pagamento ({monthLabel})</PanelEyebrow>
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
        <PanelEyebrow className="fatsalao-section-title">Dias importados ({monthLabel})</PanelEyebrow>
        <div className="fatsalao-table">
          <Table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Dia</th>
                <th style={{ textAlign: "right" }}>Mesas</th>
                <th style={{ textAlign: "right" }}>Pessoas</th>
                <th style={{ textAlign: "right" }}>Bruto</th>
                <th style={{ textAlign: "right" }}>Serviço</th>
                <th style={{ textAlign: "right" }}>Líquido</th>
                <th style={{ textAlign: "right" }}>TM/mesa</th>
                <th style={{ textAlign: "right" }}>TM/pessoa</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>Carregando...</td></tr>
              ) : agileEntries.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>
                  Nenhum dia importado no mês selecionado.
                </td></tr>
              ) : (
                agileEntries.map((e) => {
                  const gross = toNumber(e.grossAmount);
                  const tables = Number(e.tickets ?? 0);
                  const people = e.peopleServed;
                  const tmMesa = tables > 0 ? gross / tables : 0;
                  const tmPessoa = people && people > 0 ? gross / people : null;
                  return (
                    <tr key={e.id}>
                      <td>{formatDate(e.date)}</td>
                      <td>{e.weekdayName ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{formatNumber(tables)}</td>
                      <td style={{ textAlign: "right" }}>{people != null ? formatNumber(people) : "—"}</td>
                      <td style={{ textAlign: "right" }}><Money value={gross} /></td>
                      <td style={{ textAlign: "right" }}><Money value={toNumber(e.serviceAmount)} /></td>
                      <td style={{ textAlign: "right" }}><Money value={toNumber(e.netAmount)} /></td>
                      <td style={{ textAlign: "right" }}><Money value={tmMesa} /></td>
                      <td style={{ textAlign: "right" }}>
                        {tmPessoa != null ? <Money value={tmPessoa} /> : "—"}
                      </td>
                    </tr>
                  );
                })
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
// Quando o status endpoint falha mas existem dados, mostramos um aviso
// discreto em vez do erro forte "nunca sincronizou" (que seria enganoso).
function renderSyncBanner(status: AgileSyncStatus | null, now: Date, hasAnyData: boolean) {
  // O Alert do design system ja coloca o icone padrao do tom (Info/CheckCircle2/
  // AlertTriangle). NAO adicionar icone manual aqui — evita a duplicidade que
  // aparecia como "dois checks verdes" no banner de sucesso.
  if (!status || !status.ultimaSyncEm) {
    if (hasAnyData) {
      return (
        <Alert tone="info" style={{ marginTop: 16 }}>
          Status da sincronização indisponível no momento. Os dados exibidos foram carregados diretamente do faturamento — a barra de status volta ao normal na próxima atualização.
        </Alert>
      );
    }
    return (
      <Alert tone="error" style={{ marginTop: 16 }}>
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
        Última sync: {label} · {status.diasImportadosUltimoBatch} dia(s) no último lote · {status.totalRegistrosSalaoAgile} dias no total.
      </Alert>
    );
  }
  if (diffDays === 2) {
    return (
      <Alert tone="warning" style={{ marginTop: 16 }}>
        Última sync há {diffDays} dias ({label}). Verifique se o PDVTOUCH está ligando normalmente.
      </Alert>
    );
  }
  return (
    <Alert tone="error" style={{ marginTop: 16 }}>
      Última sync há {diffDays} dias ({label}). O agente pode estar com problema — verificar máquina PDVTOUCH.
    </Alert>
  );
}
