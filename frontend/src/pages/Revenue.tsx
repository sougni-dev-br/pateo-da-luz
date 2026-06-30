import { BadgeDollarSign, CalendarPlus, ChevronDown, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppUser, cancelRevenueEntry, getCmvPeriods, getRevenue, RevenueEntry, RevenueSummary, saveRevenueEntry } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { PeriodFilter } from "../components/PeriodFilter";
import type { ImportTab } from "./ImportsHub";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod, periodForPreset, type PeriodState } from "../utils/period";

const channels = ["Salão", "Delivery", "Eventos / Empreitada", "Outros"];

const EVENT_CHANNEL = "Eventos / Empreitada";

const eventTypes = [
  "Evento — Centro de Convenções",
  "Reserva de grupo",
  "Empreitada",
  "Outros"
] as const;

const eventPaymentMethods = ["PIX", "Transferência bancária", "Dinheiro", "Boleto", "A receber", "Outro"];

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

const emptyEventForm = {
  date: todayInputDate(),
  description: "",
  eventType: eventTypes[0] as string,
  grossAmount: "",
  includeService: false,
  tickets: "",
  paymentMethod: "",
  notes: ""
};

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function buildRevenueFilters(monthValue: string, periodValue: PeriodState, channelValue: string) {
  const competence = splitMonth(monthValue);
  const useCompetenceMonth = periodValue.preset === "currentMonth" || periodValue.preset === "previousMonth";
  return {
    year: String(competence.year),
    month: String(competence.month),
    ...(useCompetenceMonth ? {} : { startDate: periodValue.startDate, endDate: periodValue.endDate }),
    channel: channelValue || undefined
  };
}

function monthFromDate(value: string) {
  return String(value ?? "").slice(0, 7);
}

function storedCmvPeriod(): { id: string; name: string; dataInicial: string; dataFinal: string } | null {
  try {
    const raw = localStorage.getItem("pateo_selected_cmv_period");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function displayChannel(value: string) {
  return value === "Salao" ? "Salão" : value;
}

function averageTicket(netAmount: number, tickets: number) {
  return tickets > 0 ? netAmount / tickets : 0;
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function formatStatusLabel(status: string) {
  if (status === "CANCELLED") return "Cancelado";
  if (status === "ACTIVE") return "Ativo";
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w|\s\w/g, (letter) => letter.toUpperCase());
}

function statusToneClass(status: string) {
  if (status === "CANCELLED") return "cancelled tone-neutral";
  if (status === "ACTIVE") return "tone-success";
  return "tone-info";
}

function SectionHeader({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small className="muted-inline">{detail}</small> : null}
    </article>
  );
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>{message}</td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${statusToneClass(status)}`}>{formatStatusLabel(status)}</span>;
}

function RevenueEntryMobileCard({
  entry,
  canEdit,
  onEdit,
  onCancel
}: {
  entry: RevenueEntry;
  canEdit: boolean;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
}) {
  return (
    <article className="revenue-mobile-card">
      <div className="revenue-mobile-row">
        <span>Data</span>
        <strong>{formatDate(entry.date)}</strong>
      </div>
      <div className="revenue-mobile-row">
        <span>Dia da semana</span>
        <span>{entry.weekdayName ?? "-"}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Canal</span>
        <span>{displayChannel(entry.channel)}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>1º turno</span>
        <span>{formatCurrency(Number(entry.salesFirstShift ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>2º turno</span>
        <span>{formatCurrency(Number(entry.salesSecondShift ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row revenue-mobile-row--highlight">
        <span>Venda total</span>
        <strong>{formatCurrency(Number(entry.grossAmount ?? 0))}</strong>
      </div>
      <div className="revenue-mobile-row">
        <span>Serviço</span>
        <span>{formatCurrency(Number(entry.serviceAmount ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>TCs</span>
        <span>{formatNumber(Number(entry.tickets ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Ticket médio</span>
        <span>{formatCurrency(Number(entry.ticketAverage ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Acumulado</span>
        <span>{formatCurrency(Number(entry.accumulatedAmount ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Status</span>
        <StatusBadge status={entry.status} />
      </div>

      {canEdit && entry.status !== "CANCELLED" ? (
        <div className="revenue-mobile-actions">
          <button className="secondary-button" type="button" onClick={() => onEdit(entry.id)}>
            <Pencil size={15} /> Editar
          </button>
          <button className="danger-button" type="button" onClick={() => onCancel(entry)}>
            <Trash2 size={15} /> Cancelar
          </button>
        </div>
      ) : null}
    </article>
  );
}

type RevenueProps = {
  user: AppUser;
  onOpenImports?: (tab: ImportTab) => void;
  onOpenCash?: (entryId?: string) => void;
};

export function Revenue({ user, onOpenImports, onOpenCash }: RevenueProps) {
  const canEdit = hasPermission(user, "revenue", "edit");
  const canLaunchEvent = hasPermission(user, "revenue", "approve");
  const [month, setMonth] = useState(currentMonth());
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [savingEvent, setSavingEvent] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { notice, setNotice } = useNotice();
  const loadControllerRef = useRef<AbortController | null>(null);
  const autoLoadedInitialMonthRef = useRef(false);
  const requestSeqRef = useRef(0);

  async function load(options?: { allowAutoFallback?: boolean }) {
    const requestSeq = ++requestSeqRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      let nextMonth = month;
      let nextPeriod = period;
      let response = await getRevenue(buildRevenueFilters(nextMonth, nextPeriod, channelFilter), controller.signal);
      if (
        options?.allowAutoFallback === true &&
        response.entries.length === 0 &&
        nextPeriod.preset === "currentMonth" &&
        nextMonth === currentMonth()
      ) {
        const fallback = periodForPreset("previousMonth");
        nextMonth = monthFromDate(fallback.startDate);
        nextPeriod = fallback;
        setMonth(nextMonth);
        setPeriod(nextPeriod);
        response = await getRevenue(buildRevenueFilters(nextMonth, nextPeriod, channelFilter), controller.signal);
      }
      if (requestSeq !== requestSeqRef.current) return;
      setSummary(response);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestSeq !== requestSeqRef.current) return;
      const message = error instanceof Error ? error.message : "Erro ao carregar faturamento.";
      setNotice({ tone: "error", message });
    } finally {
      if (requestSeq === requestSeqRef.current && loadControllerRef.current === controller) {
        loadControllerRef.current = null;
      }
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (autoLoadedInitialMonthRef.current) return;
    autoLoadedInitialMonthRef.current = true;
    void load({ allowAutoFallback: true });
  }, []);

  useEffect(() => {
    if (period.preset === "currentMonth") {
      setMonth(currentMonth());
      return;
    }
    if (period.preset === "previousMonth") {
      setMonth(monthFromDate(period.startDate));
    }
  }, [period.preset, period.startDate]);

  async function handleCancel(entry: RevenueEntry) {
    const reason = window.prompt("Informe o motivo para cancelar este faturamento:");
    if (!reason?.trim()) return;
    try {
      await cancelRevenueEntry(entry.id, reason);
      setNotice({ tone: "success", message: "Faturamento cancelado com sucesso." });
      await load({ allowAutoFallback: false });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao cancelar faturamento." });
    }
  }

  const eventGross = Number(eventForm.grossAmount || 0);
  const eventService = eventForm.includeService ? Number((eventGross * 0.1).toFixed(2)) : 0;
  const eventNet = Number((eventGross - eventService).toFixed(2));
  const eventTicketAverage = eventForm.tickets && Number(eventForm.tickets) > 0
    ? Number((eventNet / Number(eventForm.tickets)).toFixed(2))
    : null;

  async function handleSaveEvent() {
    if (!eventForm.date || !eventForm.description.trim() || !eventForm.grossAmount || eventGross <= 0) {
      setNotice({ tone: "error", message: "Preencha data, descrição e valor bruto do evento." });
      return;
    }
    const [year, month] = eventForm.date.split("-").map(Number);
    setSavingEvent(true);
    try {
      await saveRevenueEntry({
        date: eventForm.date,
        competenceYear: year,
        competenceMonth: month,
        channel: EVENT_CHANNEL,
        sourcePlatform: eventForm.eventType,
        description: eventForm.description.trim(),
        grossAmount: eventGross,
        discounts: 0,
        platformFees: 0,
        serviceAmount: eventService,
        netAmount: eventNet,
        tickets: eventForm.tickets ? Number(eventForm.tickets) : 0,
        ticketAverage: eventTicketAverage,
        paymentMethod: eventForm.paymentMethod || null,
        notes: eventForm.notes.trim() || null
      });
      setNotice({ tone: "success", message: "Evento lançado com sucesso." });
      setShowEventModal(false);
      setEventForm(emptyEventForm);
      await load({ allowAutoFallback: false });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao lançar evento." });
    } finally {
      setSavingEvent(false);
    }
  }

  async function useCmvPeriod() {
    try {
      let cmvPeriod = storedCmvPeriod();
      if (!cmvPeriod) {
        const periods = await getCmvPeriods();
        const latest = periods[0];
        if (latest) {
          cmvPeriod = {
            id: latest.id,
            name: latest.name,
            dataInicial: latest.dataInicial,
            dataFinal: latest.dataFinal
          };
        }
      }
      if (!cmvPeriod) {
        setNotice({ tone: "warning", message: "Nenhuma apuração CMV encontrada." });
        return;
      }
      setMonth(monthFromDate(cmvPeriod.dataInicial));
      setPeriod({ preset: "custom", startDate: cmvPeriod.dataInicial, endDate: cmvPeriod.dataFinal });
      setNotice({ tone: "success", message: `Período CMV aplicado: ${formatDate(cmvPeriod.dataInicial)} a ${formatDate(cmvPeriod.dataFinal)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao usar período da apuração CMV." });
    }
  }

  function setCustomPeriodField(field: "startDate" | "endDate", value: string) {
    setPeriod((current) => ({ ...current, preset: "custom", [field]: value }));
  }

  const summaryData = summary?.summary;

  const dailyAnalytics = useMemo(() => {
    const map = new Map<string, {
      date: string;
      weekdayName: string;
      grossAmount: number;
      serviceAmount: number;
      repiqueAmount: number;
      netAmount: number;
      tickets: number;
      salesFirstShift: number;
      salesSecondShift: number;
      salesTables: number;
      ticketsFirstShift: number;
      ticketsSecondShift: number;
      ticketsTables: number;
    }>();

    (summary?.entries ?? []).forEach((entry) => {
      const key = String(entry.date).slice(0, 10);
      const current = map.get(key) ?? {
        date: key,
        weekdayName: (entry.weekdayName ?? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(new Date(entry.date))).toUpperCase(),
        grossAmount: 0,
        serviceAmount: 0,
        repiqueAmount: 0,
        netAmount: 0,
        tickets: 0,
        salesFirstShift: 0,
        salesSecondShift: 0,
        salesTables: 0,
        ticketsFirstShift: 0,
        ticketsSecondShift: 0,
        ticketsTables: 0
      };
      current.grossAmount += Number(entry.grossAmount ?? 0);
      current.serviceAmount += Number(entry.serviceAmount ?? 0);
      current.repiqueAmount += Number(entry.repiqueAmount ?? 0);
      current.netAmount += Number(entry.netAmount ?? 0);
      current.tickets += Number(entry.tickets ?? 0);
      current.salesFirstShift += Number(entry.salesFirstShift ?? 0);
      current.salesSecondShift += Number(entry.salesSecondShift ?? 0);
      current.salesTables += Number(entry.salesTables ?? 0);
      current.ticketsFirstShift += Number(entry.ticketsFirstShift ?? 0);
      current.ticketsSecondShift += Number(entry.ticketsSecondShift ?? 0);
      current.ticketsTables += Number(entry.ticketsTables ?? 0);
      map.set(key, current);
    });

    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [summary]);

  const bestDays = useMemo(() => [...dailyAnalytics].sort((a, b) => b.netAmount - a.netAmount).slice(0, 5), [dailyAnalytics]);
  const worstDays = useMemo(() => [...dailyAnalytics].sort((a, b) => a.netAmount - b.netAmount).slice(0, 5), [dailyAnalytics]);
  const weekdayRows = useMemo(() => {
    const map = new Map<string, { weekdayName: string; grossAmount: number; serviceAmount: number; netAmount: number; tickets: number }>();
    dailyAnalytics.forEach((row) => {
      const key = row.weekdayName;
      const current = map.get(key) ?? { weekdayName: key, grossAmount: 0, serviceAmount: 0, netAmount: 0, tickets: 0 };
      current.grossAmount += row.grossAmount;
      current.serviceAmount += row.serviceAmount;
      current.netAmount += row.netAmount;
      current.tickets += row.tickets;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.netAmount - a.netAmount);
  }, [dailyAnalytics]);

  const topCards = useMemo(() => [
    { label: "Faturamento bruto", value: formatCurrency(summaryData?.grossAmount ?? 0) },
    { label: "Serviço", value: formatCurrency(summaryData?.serviceAmount ?? 0) },
    { label: "Faturamento líquido", value: formatCurrency(summaryData?.netAmount ?? 0) },
    { label: "TCs / Pessoas", value: formatNumber(summaryData?.tickets ?? 0) },
    { label: "Ticket médio", value: formatCurrency(summaryData?.ticketAverageGeneral ?? 0) },
    { label: "Dias operados", value: formatNumber(dailyAnalytics.length) },
    { label: "Total 1º turno", value: formatCurrency(summaryData?.salesFirstShift ?? 0) },
    { label: "Total 2º turno", value: formatCurrency(summaryData?.salesSecondShift ?? 0) }
  ], [summaryData, dailyAnalytics.length]);

  const channelCards = useMemo(() => {
    const rows = summary?.summary.byChannel ?? [];
    const map = new Map<string, Record<string, string | number | null>>();
    rows.forEach((row) => map.set(String(row.channel ?? ""), row));
    return channels.map((channel) => {
      const row = map.get(channel) ?? null;
      const gross = Number(row?.grossAmount ?? 0);
      const service = Number(row?.serviceAmount ?? 0);
      const net = Number(row?.netAmount ?? 0);
      const tickets = Number(row?.tickets ?? 0);
      return {
        channel,
        gross,
        service,
        net,
        tickets,
        average: averageTicket(net, tickets)
      };
    });
  }, [summary]);

  const platformCards = useMemo(() => {
    const rows = summary?.summary.byPlatform ?? [];
    return rows.map((row) => {
      const gross = Number(row.grossAmount ?? 0);
      const net = Number(row.netAmount ?? 0);
      const tickets = Number(row.tickets ?? 0);
      return {
        sourcePlatform: String(row.sourcePlatform ?? "Sem plataforma"),
        gross,
        net,
        tickets,
        average: averageTicket(gross, tickets)
      };
    });
  }, [summary]);

  const dailyRows = dailyAnalytics;
  const entries = (summary?.entries ?? []).filter(
    (entry) => canLaunchEvent || entry.channel !== EVENT_CHANNEL
  );
  const firstShiftShare = percent(summaryData?.salesFirstShift ?? 0, summaryData?.grossAmount ?? 0);
  const secondShiftShare = percent(summaryData?.salesSecondShift ?? 0, summaryData?.grossAmount ?? 0);
  const serviceShare = percent(summaryData?.serviceAmount ?? 0, summaryData?.grossAmount ?? 0);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div className="actions-cell revenue-header-actions">
            {canLaunchEvent && (
              <button className="secondary-button" type="button" onClick={() => setShowEventModal(true)}>
                <CalendarPlus size={16} /> Lançar evento
              </button>
            )}
            {canEdit && (
              <button className="primary-button" type="button" onClick={() => onOpenCash?.()}>
                <BadgeDollarSign size={16} /> Caixa
              </button>
            )}
            {canEdit && onOpenImports && (
              <button className="secondary-button" type="button" onClick={() => onOpenImports("revenue")}>
                Importar faturamento
              </button>
            )}
            <button className="icon-button" type="button" onClick={() => load({ allowAutoFallback: false })} aria-label="Atualizar faturamento">
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>

        <button
          className="secondary-button revenue-filter-toggle"
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <ChevronDown size={15} className={`revenue-filter-chevron${filtersOpen ? " open" : ""}`} />
          Filtros
        </button>

        <div className="filters-row revenue-filters" data-open={String(filtersOpen)}>
          <label>
            Competência
            <input
              type="month"
              value={month}
              onChange={(event) => {
                const nextMonth = event.target.value;
                setMonth(nextMonth);
              }}
            />
          </label>
          <PeriodFilter value={period} onChange={setPeriod} hideCustomFields />
          <div className="custom-period-filter">
            <span>Período personalizado</span>
            <label>
              Data inicial
              <input type="date" value={period.startDate} onChange={(event) => setCustomPeriodField("startDate", event.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={period.endDate} onChange={(event) => setCustomPeriodField("endDate", event.target.value)} />
            </label>
          </div>
          <label>
            Canal
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
              <option value="">Todos</option>
              {channels.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button revenue-filter-button" type="button" onClick={useCmvPeriod}>
            Usar período da apuração CMV
          </button>
          <button className="primary-button revenue-filter-button" type="button" onClick={() => load({ allowAutoFallback: false })} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> {loading ? "Filtrando..." : "Filtrar"}
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Resumo aplicado" title="Indicadores" />

        <div className="summary-grid financial-summary revenue-kpi-grid">
          {topCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>

        <div className="subsection">
          <h3>Canais</h3>
          <div className="summary-grid financial-summary">
            {channelCards.map((card) => (
              <MetricCard
                key={card.channel}
                label={displayChannel(card.channel)}
                value={formatCurrency(card.net)}
                detail={`Bruto ${formatCurrency(card.gross)} | Serviço ${formatCurrency(card.service)} | TCs ${formatNumber(card.tickets)} | TM ${formatCurrency(card.average)}`}
              />
            ))}
          </div>
        </div>

        {(channelFilter === "Delivery" || platformCards.length > 0) && (
          <div className="subsection">
            <h3>Resumo delivery por plataforma</h3>
            <div className="summary-grid financial-summary">
              {platformCards.map((card) => (
                <MetricCard
                  key={card.sourcePlatform}
                  label={card.sourcePlatform}
                  value={formatCurrency(card.gross)}
                  detail={`TCs ${formatNumber(card.tickets)} | TM ${formatCurrency(card.average)}`}
                />
              ))}
              <MetricCard
                label="Total geral"
                value={formatCurrency(platformCards.reduce((sum, card) => sum + card.gross, 0))}
                detail={`TCs ${formatNumber(platformCards.reduce((sum, card) => sum + card.tickets, 0))}`}
              />
            </div>
          </div>
        )}

        <div className="subsection">
          <h3>Participação e serviço</h3>
          <div className="summary-grid financial-summary">
            <MetricCard label="1º turno sobre vendas" value={`${firstShiftShare.toFixed(1)}%`} />
            <MetricCard label="2º turno sobre vendas" value={`${secondShiftShare.toFixed(1)}%`} />
            <MetricCard label="Serviço sobre vendas" value={`${serviceShare.toFixed(1)}%`} />
          </div>
        </div>

        <div className="subsection">
          <h3>Detalhamento por canal</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Bruto</th>
                  <th>Serviço</th>
                  <th>Líquido</th>
                  <th>TCs</th>
                  <th>TM</th>
                </tr>
              </thead>
              <tbody>
                {channelCards.map((card) => (
                  <tr key={`${card.channel}-row`}>
                    <td>{displayChannel(card.channel)}</td>
                    <td>{formatCurrency(card.gross)}</td>
                    <td>{formatCurrency(card.service)}</td>
                    <td>{formatCurrency(card.net)}</td>
                    <td>{formatNumber(card.tickets)}</td>
                    <td>{formatCurrency(card.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="subsection">
          <h3>Resumo por dia</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Dia da semana</th>
                  <th>1º turno</th>
                  <th>2º turno</th>
                  <th>Serviço</th>
                  <th>Bruto</th>
                  <th>TCs</th>
                  <th>Líquido</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((item) => (
                  <tr key={String(item.date)}>
                    <td>{formatDate(String(item.date ?? ""))}</td>
                    <td>{String(item.weekdayName ?? "-")}</td>
                    <td>{formatCurrency(Number(item.salesFirstShift ?? 0))}</td>
                    <td>{formatCurrency(Number(item.salesSecondShift ?? 0))}</td>
                    <td>{formatCurrency(Number(item.serviceAmount ?? 0))}</td>
                    <td>{formatCurrency(Number(item.grossAmount ?? 0))}</td>
                    <td>{formatNumber(Number(item.tickets ?? 0))}</td>
                    <td>{formatCurrency(Number(item.netAmount ?? 0))}</td>
                  </tr>
                ))}
                {dailyRows.length === 0 && <EmptyTableRow colSpan={8} message="Nenhum faturamento encontrado." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className="subsection">
          <h3>Melhores e piores dias</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ranking</th>
                  <th>Dia</th>
                  <th>Dia da semana</th>
                  <th>Bruto</th>
                  <th>Líquido</th>
                  <th>TCs</th>
                </tr>
              </thead>
              <tbody>
                {bestDays.map((item, index) => (
                  <tr key={`best-${item.date}`}>
                    <td>{index + 1}</td>
                    <td>{formatDate(item.date)}</td>
                    <td>{item.weekdayName}</td>
                    <td>{formatCurrency(item.grossAmount)}</td>
                    <td>{formatCurrency(item.netAmount)}</td>
                    <td>{formatNumber(item.tickets)}</td>
                  </tr>
                ))}
                {bestDays.length === 0 && <EmptyTableRow colSpan={6} message="Sem dados." />}
              </tbody>
            </table>
          </div>
          <div className="table-wrap subsection">
            <table>
              <thead>
                <tr>
                  <th>Ranking</th>
                  <th>Dia</th>
                  <th>Dia da semana</th>
                  <th>Bruto</th>
                  <th>Líquido</th>
                  <th>TCs</th>
                </tr>
              </thead>
              <tbody>
                {worstDays.map((item, index) => (
                  <tr key={`worst-${item.date}`}>
                    <td>{index + 1}</td>
                    <td>{formatDate(item.date)}</td>
                    <td>{item.weekdayName}</td>
                    <td>{formatCurrency(item.grossAmount)}</td>
                    <td>{formatCurrency(item.netAmount)}</td>
                    <td>{formatNumber(item.tickets)}</td>
                  </tr>
                ))}
                {worstDays.length === 0 && <EmptyTableRow colSpan={6} message="Sem dados." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className="subsection">
          <h3>Faturamento por dia da semana</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dia da semana</th>
                  <th>Bruto</th>
                  <th>Líquido</th>
                  <th>TCs</th>
                  <th>Serviço %</th>
                </tr>
              </thead>
              <tbody>
                {weekdayRows.map((row) => (
                  <tr key={row.weekdayName}>
                    <td>{row.weekdayName}</td>
                    <td>{formatCurrency(row.grossAmount)}</td>
                    <td>{formatCurrency(row.netAmount)}</td>
                    <td>{formatNumber(row.tickets)}</td>
                    <td>{row.grossAmount > 0 ? `${((row.serviceAmount / row.grossAmount) * 100).toFixed(1)}%` : "0,0%"}</td>
                  </tr>
                ))}
                {weekdayRows.length === 0 && <EmptyTableRow colSpan={5} message="Sem dados." />}
              </tbody>
            </table>
          </div>
        </div>

        <div className="subsection">
          <h3>Entradas</h3>

          <div className="table-wrap revenue-desktop-entries">
            <table className="compact-revenue-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Dia da semana</th>
                  <th>Canal</th>
                  <th>1º turno</th>
                  <th>2º turno</th>
                  <th>Serviço</th>
                  <th>Venda total</th>
                  <th>TCs</th>
                  <th>TM</th>
                  <th>Acumulado</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.date)}</td>
                    <td>{entry.weekdayName ?? "-"}</td>
                    <td>{displayChannel(entry.channel)}</td>
                    <td>{formatCurrency(Number(entry.salesFirstShift ?? 0))}</td>
                    <td>{formatCurrency(Number(entry.salesSecondShift ?? 0))}</td>
                    <td>{formatCurrency(Number(entry.serviceAmount ?? 0))}</td>
                    <td>{formatCurrency(Number(entry.grossAmount ?? 0))}</td>
                    <td>{formatNumber(Number(entry.tickets ?? 0))}</td>
                    <td>{formatCurrency(Number(entry.ticketAverage ?? 0))}</td>
                    <td>{formatCurrency(Number(entry.accumulatedAmount ?? 0))}</td>
                    <td><StatusBadge status={entry.status} /></td>
                    <td>
                      {entry.status !== "CANCELLED" && (canEdit || canLaunchEvent) ? (
                        <div className="actions-cell">
                          {canEdit && entry.channel !== EVENT_CHANNEL && (
                            <button className="secondary-button compact-action-button" type="button" onClick={() => onOpenCash?.(entry.id)}>
                              <Pencil size={15} /> Editar
                            </button>
                          )}
                          {(canEdit || (canLaunchEvent && entry.channel === EVENT_CHANNEL)) && (
                            <button className="danger-button compact-action-button" type="button" onClick={() => handleCancel(entry)}>
                              <Trash2 size={15} /> Cancelar
                            </button>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && <EmptyTableRow colSpan={12} message="Nenhum faturamento lançado." />}
              </tbody>
            </table>
          </div>

          <div className="revenue-mobile-list">
            {entries.map((entry) => (
              <RevenueEntryMobileCard
                key={`${entry.id}-mobile`}
                entry={entry}
                canEdit={canEdit && entry.channel !== EVENT_CHANNEL}
                onEdit={(entryId) => onOpenCash?.(entryId)}
                onCancel={handleCancel}
              />
            ))}
            {entries.length === 0 && <div className="alert warning">Nenhum faturamento lançado.</div>}
          </div>
        </div>
      </section>

      {showEventModal && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Gerência</p>
                <h2>Lançar evento / empreitada</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => { setShowEventModal(false); setEventForm(emptyEventForm); }}>
                Fechar
              </button>
            </div>

            <div className="form-grid">
              <label>
                Data do evento
                <input
                  type="date"
                  value={eventForm.date}
                  onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })}
                />
              </label>

              <label>
                Tipo de evento
                <select
                  value={eventForm.eventType}
                  onChange={(event) => setEventForm({ ...eventForm, eventType: event.target.value })}
                >
                  {eventTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label className="full-width">
                Descrição / Nome do evento
                <input
                  autoFocus
                  placeholder="Ex.: Casamento Silva — Salão A, Centro de Convenções..."
                  value={eventForm.description}
                  onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })}
                />
              </label>

              <label>
                Valor bruto (R$)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  value={eventForm.grossAmount}
                  onChange={(event) => setEventForm({ ...eventForm, grossAmount: event.target.value })}
                />
              </label>

              <label>
                Número de pessoas
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={eventForm.tickets}
                  onChange={(event) => setEventForm({ ...eventForm, tickets: event.target.value })}
                />
              </label>

              <label>
                Forma de recebimento
                <select
                  value={eventForm.paymentMethod}
                  onChange={(event) => setEventForm({ ...eventForm, paymentMethod: event.target.value })}
                >
                  <option value="">Não informado</option>
                  {eventPaymentMethods.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </label>

              <label className="checkbox-label full-width">
                <input
                  type="checkbox"
                  checked={eventForm.includeService}
                  onChange={(event) => setEventForm({ ...eventForm, includeService: event.target.checked })}
                />
                Cobrar taxa de serviço (10%)
              </label>

              {eventGross > 0 && (
                <div className="summary-grid event-launch-preview">
                  <article>
                    <span>Valor bruto</span>
                    <strong>{formatCurrency(eventGross)}</strong>
                  </article>
                  <article>
                    <span>Taxa de serviço</span>
                    <strong>{formatCurrency(eventService)}</strong>
                  </article>
                  <article>
                    <span>Valor líquido</span>
                    <strong>{formatCurrency(eventNet)}</strong>
                  </article>
                  {eventTicketAverage !== null && Number(eventForm.tickets) > 0 && (
                    <article>
                      <span>Ticket médio</span>
                      <strong>{formatCurrency(eventTicketAverage)}</strong>
                    </article>
                  )}
                </div>
              )}

              <label className="full-width">
                Observações internas
                <textarea
                  rows={2}
                  placeholder="Informações adicionais — visível apenas à gerência"
                  value={eventForm.notes}
                  onChange={(event) => setEventForm({ ...eventForm, notes: event.target.value })}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => { setShowEventModal(false); setEventForm(emptyEventForm); }}>
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={savingEvent || !eventForm.date || !eventForm.description.trim() || eventGross <= 0}
                onClick={handleSaveEvent}
              >
                {savingEvent ? "Salvando..." : "Confirmar lançamento"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
