import { BadgeDollarSign, CalendarPlus, ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppUser, cancelRevenueEntry, getCmvPeriods, getRevenue, RevenueEntry, RevenueSummary, saveRevenueEntry } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import {
  Money,
  PanelEyebrow,
  SummaryCard,
  Tabs,
  useFormatCurrency
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { PeriodFilter } from "../components/PeriodFilter";
import type { ImportTab } from "./ImportsHub";
import { formatDate, formatNumber, formatPercent } from "../utils/format";
import { currentMonthPeriod, periodForPreset, type PeriodState } from "../utils/period";
import { hojeLocalIso } from "../lib/datas";
import { CoberturaPorCanal } from "./CoberturaPorCanal";
import { describeAppliedFilter, hasAnyValue, monthLabel, pickBestAndWorstDay, weekdayFromIso } from "./revenueView";
import { buildDailySeries, deltaPercent, previousCompetence, type EntryGroup } from "./revenueGroups";
import { displayChannel, MoneyOrDash } from "./revenueBits";
import { RevenueEntriesTable } from "./RevenueEntriesTable";
import { RevenueDailyChart } from "./RevenueDailyChart";
import {
  buildVoucherEntries,
  defaultVoucherCategories,
  voucherTotals,
  type VoucherCategory,
  type VoucherDay
} from "./eventVouchers";

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
  return hojeLocalIso();
}

type EventLaunchMode = "valor" | "vouchers";

type RevenueTab = "overview" | "daily" | "entries";

const REVENUE_TABS: Array<{ value: RevenueTab; label: string }> = [
  { value: "overview", label: "Visão geral" },
  { value: "daily", label: "Por dia" },
  { value: "entries", label: "Lançamentos" }
];

function emptyVoucherDays(): VoucherDay[] {
  return [{ date: todayInputDate(), qty: {} }];
}

const emptyEventForm = {
  mode: "valor" as EventLaunchMode,
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

function averageTicket(netAmount: number, tickets: number) {
  return tickets > 0 ? netAmount / tickets : 0;
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function SectionHeader({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <PanelEyebrow>{eyebrow}</PanelEyebrow> : null}
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, className }: { label: string; value: string; detail?: ReactNode; className?: string }) {
  return <SummaryCard label={label} value={value} detail={detail} className={className} />;
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>{message}</td>
    </tr>
  );
}

type RevenueProps = {
  user: AppUser;
  onOpenImports?: (tab: ImportTab) => void;
  onOpenCash?: (entryId?: string) => void;
};

export function Revenue({ user, onOpenImports, onOpenCash }: RevenueProps) {
  const fmt = useFormatCurrency();
  const canEdit = hasPermission(user, "revenue", "edit");
  // Lancar evento cria um RevenueEntry: alem da regra de negocio ("Aprovar"), precisa da
  // acao que o POST /monthly/revenue exige, senao o botao aparece e falha ao salvar.
  const canLaunchEvent = hasPermission(user, "revenue", "approve") && hasPermission(user, "revenue", "create");
  const [month, setMonth] = useState(currentMonth());
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<ReturnType<typeof describeAppliedFilter> | null>(null);
  const [previous, setPrevious] = useState<{ label: string; summary: RevenueSummary["summary"]; inProgress: boolean } | null>(null);
  const [tab, setTab] = useState<RevenueTab>("overview");
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [savingEvent, setSavingEvent] = useState(false);
  const [voucherCategories, setVoucherCategories] = useState<VoucherCategory[]>(defaultVoucherCategories);
  const [voucherDays, setVoucherDays] = useState<VoucherDay[]>(emptyVoucherDays);
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
      setAppliedFilter(describeAppliedFilter({ month: nextMonth, period: nextPeriod, channel: channelFilter }));

      // A comparação só faz sentido para um mês de competência; intervalo livre fica sem variação.
      const comparesMonths = nextPeriod.preset === "currentMonth" || nextPeriod.preset === "previousMonth";
      if (!comparesMonths) {
        setPrevious(null);
      } else {
        const before = previousCompetence(nextMonth);
        try {
          const beforeResponse = await getRevenue(
            { year: String(before.year), month: String(before.month), channel: channelFilter || undefined },
            controller.signal
          );
          if (requestSeq === requestSeqRef.current) {
            setPrevious({
              label: monthLabel(before.year, before.month),
              summary: beforeResponse.summary,
              inProgress: nextPeriod.preset === "currentMonth"
            });
          }
        } catch (compareError) {
          if (compareError instanceof DOMException && compareError.name === "AbortError") return;
          // Sem o mês anterior a tela segue sem variação; o faturamento principal já carregou.
          if (requestSeq === requestSeqRef.current) setPrevious(null);
        }
      }
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

  async function handleCancelEvent(group: EntryGroup) {
    const reason = window.prompt(`Informe o motivo para cancelar o evento "${group.name}" (${group.entries.length} lançamentos):`);
    if (!reason?.trim()) return;
    let cancelled = 0;
    try {
      for (const entry of group.entries) {
        await cancelRevenueEntry(entry.id, reason);
        cancelled += 1;
      }
      setNotice({ tone: "success", message: `Evento cancelado: ${cancelled} lançamentos.` });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro ao cancelar o evento.";
      setNotice({ tone: "error", message: `${detail} Foram cancelados ${cancelled} de ${group.entries.length}; confira a lista.` });
    } finally {
      await load({ allowAutoFallback: false });
    }
  }

  const isVoucherMode = eventForm.mode === "vouchers";
  const voucherSummary = voucherTotals(voucherCategories, voucherDays);
  const eventGross = isVoucherMode ? voucherSummary.gross : Number(eventForm.grossAmount || 0);
  const eventService = eventForm.includeService ? Number((eventGross * 0.1).toFixed(2)) : 0;
  const eventNet = Number((eventGross - eventService).toFixed(2));
  const eventPeople = isVoucherMode ? voucherSummary.people : Number(eventForm.tickets || 0);
  const eventTicketAverage = eventPeople > 0 ? Number((eventNet / eventPeople).toFixed(2)) : null;
  const canSaveEvent = !!eventForm.description.trim() && eventGross > 0 && (isVoucherMode || !!eventForm.date);

  function closeEventModal() {
    setShowEventModal(false);
    setEventForm(emptyEventForm);
    setVoucherCategories(defaultVoucherCategories);
    setVoucherDays(emptyVoucherDays());
  }

  function updateVoucherDay(index: number, patch: (day: VoucherDay) => VoucherDay) {
    setVoucherDays((days) => days.map((day, i) => (i === index ? patch(day) : day)));
  }

  function addVoucherDay() {
    setVoucherDays((days) => {
      const last = days[days.length - 1]?.date;
      const next = last ? new Date(`${last}T12:00:00`) : new Date();
      if (last) next.setDate(next.getDate() + 1);
      const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      return [...days, { date: iso, qty: {} }];
    });
  }

  async function handleSaveVoucherEvent() {
    const entries = buildVoucherEntries({
      channel: EVENT_CHANNEL,
      eventType: eventForm.eventType,
      eventName: eventForm.description,
      categories: voucherCategories,
      days: voucherDays,
      includeService: eventForm.includeService,
      paymentMethod: eventForm.paymentMethod,
      notes: eventForm.notes
    });
    if (entries.length === 0) {
      setNotice({ tone: "error", message: "Informe a data e a quantidade de pelo menos um dia." });
      return;
    }
    setSavingEvent(true);
    const saved: number[] = [];
    try {
      // Sequencial: se um falhar, o aviso diz quantos já entraram para não duplicar ao tentar de novo.
      for (const entry of entries) {
        await saveRevenueEntry(entry);
        saved.push(1);
      }
      setNotice({ tone: "success", message: `Evento lançado: ${entries.length} lançamentos (${voucherSummary.people} pessoas).` });
      closeEventModal();
      await load({ allowAutoFallback: false });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erro ao lançar evento.";
      setNotice({
        tone: "error",
        message: saved.length > 0
          ? `${detail} Já foram lançados ${saved.length} de ${entries.length}; confira a lista antes de tentar de novo.`
          : detail
      });
      if (saved.length > 0) await load({ allowAutoFallback: false });
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleSaveEvent() {
    if (isVoucherMode) return handleSaveVoucherEvent();
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
      closeEventModal();
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
        weekdayName: (entry.weekdayName ?? weekdayFromIso(entry.date)).toUpperCase(),
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

  const currentFilter = describeAppliedFilter({ month, period, channel: channelFilter });
  const filterIsDirty = appliedFilter !== null && appliedFilter.key !== currentFilter.key;

  const activeChannelRows = channelCards.filter((card) => card.gross !== 0 || card.net !== 0 || card.tickets !== 0);
  const idleChannelNames = channelCards.filter((card) => !activeChannelRows.includes(card)).map((card) => displayChannel(card.channel));
  const channelNetTotal = activeChannelRows.reduce((sum, card) => sum + card.net, 0);
  const sortedChannelRows = [...activeChannelRows].sort((a, b) => b.net - a.net);

  const hasShiftSales = hasAnyValue([summaryData?.salesFirstShift, summaryData?.salesSecondShift]);
  const dailyShowsShifts = hasAnyValue(dailyRows.flatMap((row) => [row.salesFirstShift, row.salesSecondShift]));
  const dailyShowsService = hasAnyValue(dailyRows.map((row) => row.serviceAmount));
  const weekdayShowsService = hasAnyValue(weekdayRows.map((row) => row.serviceAmount));
  const dayMarks = pickBestAndWorstDay(dailyRows);

  const dailySeries = useMemo(() => buildDailySeries(summary?.entries ?? []), [summary]);
  const revenueTabs = REVENUE_TABS.map((item) => (item.value === "entries" ? { ...item, label: `${item.label} (${entries.length})` } : item));

  function deltaNote(current: number, prior: number | undefined): ReactNode {
    if (!previous) return null;
    const delta = deltaPercent(current, prior ?? null);
    if (delta === null) return null;
    // Mês em andamento contra mês fechado: a queda é esperada, então não pinta de vermelho/verde.
    const tone = previous.inProgress ? "" : delta >= 0 ? " revenue-kpi-delta--up" : " revenue-kpi-delta--down";
    return (
      <span className={`revenue-kpi-delta${tone}`}>
        {delta >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(delta))} vs. {previous.label}
        {previous.inProgress ? " · mês em andamento" : ""}
      </span>
    );
  }

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
          {period.preset === "custom" && (
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
          )}
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

      <section className="panel revenue-tabs-panel">
        {appliedFilter && (
          <p className="revenue-applied-filter" aria-live="polite">
            Exibindo <strong>{appliedFilter.periodLabel}</strong> · <strong>{appliedFilter.channelLabel}</strong> ·{" "}
            {formatNumber(entries.length)} {entries.length === 1 ? "lançamento" : "lançamentos"}
            {filterIsDirty && <span className="revenue-filter-dirty"> — filtros alterados, clique em Filtrar para atualizar</span>}
          </p>
        )}
        <Tabs
          className="revenue-tabs"
          aria-label="Seções do faturamento"
          tabs={revenueTabs}
          value={tab}
          onChange={(value) => setTab(value as RevenueTab)}
        />
      </section>

      {tab === "overview" && (
        <div className="revenue-tabpanel" role="tabpanel">
      <section className="panel">
        <SectionHeader eyebrow="Resumo aplicado" title="Indicadores" />

        <div className="revenue-kpi-hero">
          <MetricCard
            className="revenue-kpi-primary"
            label="Faturamento líquido"
            value={fmt(summaryData?.netAmount ?? 0)}
            detail={
              <>
                {`Bruto ${fmt(summaryData?.grossAmount ?? 0)} · Serviço ${fmt(summaryData?.serviceAmount ?? 0)} (${formatPercent(serviceShare)} das vendas)`}
                {deltaNote(summaryData?.netAmount ?? 0, previous?.summary.netAmount)}
              </>
            }
          />
          <MetricCard
            label="Ticket médio"
            value={fmt(summaryData?.ticketAverageGeneral ?? 0)}
            detail={deltaNote(summaryData?.ticketAverageGeneral ?? 0, previous?.summary.ticketAverageGeneral)}
          />
          <MetricCard
            label="TCs / Pessoas"
            value={formatNumber(summaryData?.tickets ?? 0)}
            detail={deltaNote(summaryData?.tickets ?? 0, previous?.summary.tickets)}
          />
          <MetricCard label="Dias operados" value={formatNumber(dailyAnalytics.length)} />
          {hasShiftSales && (
            <>
              <MetricCard label="1º turno" value={fmt(summaryData?.salesFirstShift ?? 0)} detail={`${formatPercent(firstShiftShare)} das vendas`} />
              <MetricCard label="2º turno" value={fmt(summaryData?.salesSecondShift ?? 0)} detail={`${formatPercent(secondShiftShare)} das vendas`} />
            </>
          )}
        </div>

        <div className="subsection">
          <RevenueDailyChart series={dailySeries} channelOrder={channels} />
        </div>

        <div className="subsection">
          <h3>Por canal</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Líquido</th>
                  <th>% do total</th>
                  <th>Bruto</th>
                  <th>Serviço</th>
                  <th>TCs</th>
                  <th>TM</th>
                </tr>
              </thead>
              <tbody>
                {sortedChannelRows.map((card) => (
                  <tr key={`${card.channel}-row`}>
                    <td>{displayChannel(card.channel)}</td>
                    <td><strong><Money value={card.net} /></strong></td>
                    <td>{formatPercent(percent(card.net, channelNetTotal))}</td>
                    <td><MoneyOrDash value={card.gross} /></td>
                    <td><MoneyOrDash value={card.service} /></td>
                    <td>{formatNumber(card.tickets)}</td>
                    <td><MoneyOrDash value={card.average} /></td>
                  </tr>
                ))}
                {sortedChannelRows.length === 0 && <EmptyTableRow colSpan={7} message="Nenhum canal com movimento no período." />}
              </tbody>
            </table>
          </div>
          {idleChannelNames.length > 0 && sortedChannelRows.length > 0 && (
            <p className="hint">Sem movimento no período: {idleChannelNames.join(", ")}.</p>
          )}
        </div>

        {(channelFilter === "Delivery" || platformCards.length > 0) && (
          <div className="subsection">
            <h3>Resumo delivery por plataforma</h3>
            <div className="summary-grid financial-summary">
              {platformCards.map((card) => (
                <MetricCard
                  key={card.sourcePlatform}
                  label={card.sourcePlatform}
                  value={fmt(card.gross)}
                  detail={`TCs ${formatNumber(card.tickets)} | TM ${fmt(card.average)}`}
                />
              ))}
              <MetricCard
                label="Total geral"
                value={fmt(platformCards.reduce((sum, card) => sum + card.gross, 0))}
                detail={`TCs ${formatNumber(platformCards.reduce((sum, card) => sum + card.tickets, 0))}`}
              />
            </div>
          </div>
        )}

      </section>

      <CoberturaPorCanal year={splitMonth(month).year} month={splitMonth(month).month} />
        </div>
      )}

      {tab === "daily" && (
        <div className="revenue-tabpanel" role="tabpanel">
      <section className="panel">
        <SectionHeader eyebrow="Detalhamento" title="Dia a dia" />

        <div className="subsection">
          <h3>Resumo por dia</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Dia da semana</th>
                  {dailyShowsShifts && <th>1º turno</th>}
                  {dailyShowsShifts && <th>2º turno</th>}
                  {dailyShowsService && <th>Serviço</th>}
                  <th>Bruto</th>
                  <th>TCs</th>
                  <th>Líquido</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((item) => (
                  <tr key={String(item.date)}>
                    <td>
                      {formatDate(String(item.date ?? ""))}
                      {item.date === dayMarks.best && <span className="revenue-day-mark revenue-day-mark--best">Melhor dia</span>}
                      {item.date === dayMarks.worst && <span className="revenue-day-mark revenue-day-mark--worst">Menor dia</span>}
                    </td>
                    <td>{String(item.weekdayName ?? "-")}</td>
                    {dailyShowsShifts && <td><MoneyOrDash value={item.salesFirstShift ?? 0} /></td>}
                    {dailyShowsShifts && <td><MoneyOrDash value={item.salesSecondShift ?? 0} /></td>}
                    {dailyShowsService && <td><MoneyOrDash value={item.serviceAmount ?? 0} /></td>}
                    <td><MoneyOrDash value={item.grossAmount ?? 0} /></td>
                    <td>{formatNumber(Number(item.tickets ?? 0))}</td>
                    <td><strong><MoneyOrDash value={item.netAmount ?? 0} /></strong></td>
                  </tr>
                ))}
                {dailyRows.length === 0 && (
                  <EmptyTableRow colSpan={5 + Number(dailyShowsShifts) * 2 + Number(dailyShowsService)} message="Nenhum faturamento encontrado." />
                )}
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
                  {weekdayShowsService && <th>Serviço %</th>}
                </tr>
              </thead>
              <tbody>
                {weekdayRows.map((row) => (
                  <tr key={row.weekdayName}>
                    <td>{row.weekdayName}</td>
                    <td><Money value={row.grossAmount} /></td>
                    <td><Money value={row.netAmount} /></td>
                    <td>{formatNumber(row.tickets)}</td>
                    {weekdayShowsService && <td>{row.grossAmount > 0 ? formatPercent((row.serviceAmount / row.grossAmount) * 100) : "—"}</td>}
                  </tr>
                ))}
                {weekdayRows.length === 0 && <EmptyTableRow colSpan={4 + Number(weekdayShowsService)} message="Sem dados." />}
              </tbody>
            </table>
          </div>
        </div>

      </section>
        </div>
      )}

      {tab === "entries" && (
        <div className="revenue-tabpanel" role="tabpanel">
          <section className="panel">
            <SectionHeader eyebrow="Detalhamento" title="Lançamentos" />
            <RevenueEntriesTable
              entries={entries}
              eventChannel={EVENT_CHANNEL}
              canEdit={canEdit}
              canLaunchEvent={canLaunchEvent}
              onEdit={(entryId) => onOpenCash?.(entryId)}
              onCancel={handleCancel}
              onCancelEvent={handleCancelEvent}
            />
          </section>
        </div>
      )}

      {showEventModal && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Gerência</p>
                <h2>Lançar evento / empreitada</h2>
              </div>
              <button className="secondary-button" type="button" onClick={closeEventModal}>
                Fechar
              </button>
            </div>

            <div className="form-grid">
              <div className="full-width" role="group" aria-label="Como lançar">
                <button
                  type="button"
                  className={isVoucherMode ? "secondary-button" : "primary-button"}
                  aria-pressed={!isVoucherMode}
                  onClick={() => setEventForm({ ...eventForm, mode: "valor" })}
                >
                  Valor fechado
                </button>{" "}
                <button
                  type="button"
                  className={isVoucherMode ? "primary-button" : "secondary-button"}
                  aria-pressed={isVoucherMode}
                  onClick={() => setEventForm({ ...eventForm, mode: "vouchers" })}
                >
                  Consumo por voucher (por dia)
                </button>
              </div>

              {!isVoucherMode && (
                <label>
                  Data do evento
                  <input
                    type="date"
                    value={eventForm.date}
                    onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })}
                  />
                </label>
              )}

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

              {!isVoucherMode && (
                <>
                  <label>
                    Valor bruto (R$)
                    <input
                      type="number"
                      inputMode="decimal"
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
                      inputMode="numeric"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={eventForm.tickets}
                      onChange={(event) => setEventForm({ ...eventForm, tickets: event.target.value })}
                    />
                  </label>
                </>
              )}

              {isVoucherMode && (
                <div className="full-width">
                  <p className="hint">
                    Pacote de almoço por voucher da organização. Informe o preço de cada público e, por dia, quantos vouchers foram usados.
                  </p>
                  <div className="table-wrap voucher-table"><table>
                    <thead>
                      <tr>
                        <th scope="col">Dia</th>
                        {voucherCategories.map((cat) => (
                          <th scope="col" key={cat.id}>
                            {cat.label}
                            <input
                              aria-label={`Preço unitário — ${cat.label}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={cat.price}
                              onChange={(event) =>
                                setVoucherCategories((cats) =>
                                  cats.map((c) => (c.id === cat.id ? { ...c, price: event.target.value } : c))
                                )
                              }
                            />
                          </th>
                        ))}
                        <th scope="col">Total do dia</th>
                        <th scope="col" aria-label="Remover dia" />
                      </tr>
                    </thead>
                    <tbody>
                      {voucherDays.map((day, index) => {
                        const dayTotals = voucherTotals(voucherCategories, [day]);
                        return (
                          <tr key={index}>
                            <td>
                              <input
                                aria-label={`Data do dia ${index + 1}`}
                                type="date"
                                value={day.date}
                                onChange={(event) => updateVoucherDay(index, (d) => ({ ...d, date: event.target.value }))}
                              />
                            </td>
                            {voucherCategories.map((cat) => (
                              <td key={cat.id}>
                                <input
                                  aria-label={`${cat.label} em ${day.date || `dia ${index + 1}`}`}
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  step="1"
                                  placeholder="0"
                                  value={day.qty[cat.id] ?? ""}
                                  onChange={(event) =>
                                    updateVoucherDay(index, (d) => ({ ...d, qty: { ...d.qty, [cat.id]: event.target.value } }))
                                  }
                                />
                              </td>
                            ))}
                            <td>
                              {dayTotals.people} pessoas · <Money value={dayTotals.gross} />
                            </td>
                            <td>
                              {voucherDays.length > 1 && (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  aria-label={`Remover dia ${index + 1}`}
                                  onClick={() => setVoucherDays((days) => days.filter((_, i) => i !== index))}
                                >
                                  Remover
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                  <button type="button" className="secondary-button" onClick={addVoucherDay}>
                    + Adicionar dia
                  </button>
                </div>
              )}

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
                    <strong><Money value={eventGross} /></strong>
                  </article>
                  <article>
                    <span>Taxa de serviço</span>
                    <strong><Money value={eventService} /></strong>
                  </article>
                  <article>
                    <span>Valor líquido</span>
                    <strong><Money value={eventNet} /></strong>
                  </article>
                  {isVoucherMode && (
                    <article>
                      <span>Pessoas</span>
                      <strong>{eventPeople}</strong>
                    </article>
                  )}
                  {eventTicketAverage !== null && (
                    <article>
                      <span>Ticket médio</span>
                      <strong><Money value={eventTicketAverage} /></strong>
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
              <button className="secondary-button" type="button" onClick={closeEventModal}>
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={savingEvent || !canSaveEvent}
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
