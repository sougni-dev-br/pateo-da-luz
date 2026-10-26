import { BadgeDollarSign, CalendarPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppUser, cancelRevenueEntry, getCmvPeriods, getRevenue, RevenueEntry, RevenueSummary } from "../api/client";
import { MonthHeader } from "../components/MonthHeader";
import { Notice, useNotice } from "../components/Notice";
import { Button, Card, Tabs } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { currentMonthPeriod, type PeriodState } from "../utils/period";
import { buildRevenueAnalytics } from "./revenueAnalytics";
import { shiftCompetence } from "./dashboard/logic";
import { EVENT_CHANNEL } from "./revenueBits";
import { previousCompetence, type EntryGroup } from "./revenueGroups";
import { describeAppliedFilter, monthLabel, type AppliedFilter } from "./revenueView";
import { EventLaunchModal } from "./EventLaunchModal";
import { RevenueDaily } from "./RevenueDaily";
import { RevenueEntriesTable } from "./RevenueEntriesTable";
import { RevenueFilters } from "./RevenueFilters";
import { RevenueOverview, type PreviousPeriod } from "./RevenueOverview";
import "./Revenue.css";

type RevenueTab = "overview" | "daily" | "entries";

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

const usesCompetenceMonth = (period: PeriodState) => period.preset === "currentMonth" || period.preset === "previousMonth";

function buildRevenueFilters(monthValue: string, periodValue: PeriodState, channelValue: string) {
  const competence = splitMonth(monthValue);
  return {
    year: String(competence.year),
    month: String(competence.month),
    ...(usesCompetenceMonth(periodValue) ? {} : { startDate: periodValue.startDate, endDate: periodValue.endDate }),
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

type RevenueProps = {
  user: AppUser;
  onOpenCash?: (entryId?: string) => void;
};

export function Revenue({ user, onOpenCash }: RevenueProps) {
  const canEdit = hasPermission(user, "revenue", "edit");
  // Lançar evento cria um RevenueEntry: além da regra de negócio ("Aprovar"), precisa da
  // ação que o POST /monthly/revenue exige, senão o botão aparece e falha ao salvar.
  const canLaunchEvent = hasPermission(user, "revenue", "approve") && hasPermission(user, "revenue", "create");
  const [month, setMonth] = useState(currentMonth());
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter | null>(null);
  const [previous, setPrevious] = useState<PreviousPeriod | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<RevenueTab>("overview");
  const [showEventModal, setShowEventModal] = useState(false);
  const { notice, setNotice } = useNotice();
  const loadControllerRef = useRef<AbortController | null>(null);
  const autoLoadedInitialMonthRef = useRef(false);
  const requestSeqRef = useRef(0);

  /** `month`/`period` permitem carregar um valor recém-escolhido antes de o estado React ser atualizado. */
  async function load(options?: { allowAutoFallback?: boolean; month?: string; period?: PeriodState }) {
    const requestSeq = ++requestSeqRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    try {
      let nextMonth = options?.month ?? month;
      let nextPeriod = options?.period ?? period;
      let response = await getRevenue(buildRevenueFilters(nextMonth, nextPeriod, channelFilter), controller.signal);
      if (
        options?.allowAutoFallback === true &&
        response.entries.length === 0 &&
        nextPeriod.preset === "currentMonth" &&
        nextMonth === currentMonth()
      ) {
        const before = previousCompetence(nextMonth);
        nextMonth = `${before.year}-${String(before.month).padStart(2, "0")}`;
        setMonth(nextMonth);
        response = await getRevenue(buildRevenueFilters(nextMonth, nextPeriod, channelFilter), controller.signal);
      }
      if (requestSeq !== requestSeqRef.current) return;
      setSummary(response);
      setAppliedFilter(describeAppliedFilter({ month: nextMonth, period: nextPeriod, channel: channelFilter }));
      setUpdatedAt(new Date());

      // A comparação só faz sentido para um mês de competência; intervalo livre fica sem variação.
      if (!usesCompetenceMonth(nextPeriod)) {
        setPrevious(null);
        return;
      }
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
            inProgress: nextMonth === currentMonth()
          });
        }
      } catch (compareError) {
        if (compareError instanceof DOMException && compareError.name === "AbortError") return;
        // Sem o mês anterior a tela segue sem variação; o faturamento principal já carregou.
        if (requestSeq === requestSeqRef.current) setPrevious(null);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestSeq !== requestSeqRef.current) return;
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar faturamento." });
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

  /** Escolher um mês no cabeçalho volta ao modo "mês da competência" e já carrega, como no Dashboard. */
  function goToMonth(next: string) {
    const competencePeriod = currentMonthPeriod();
    setMonth(next);
    setPeriod(competencePeriod);
    void load({ month: next, period: competencePeriod });
  }

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

  async function useCmvPeriod() {
    try {
      let cmvPeriod = storedCmvPeriod();
      if (!cmvPeriod) {
        const latest = (await getCmvPeriods())[0];
        if (latest) cmvPeriod = { id: latest.id, name: latest.name, dataInicial: latest.dataInicial, dataFinal: latest.dataFinal };
      }
      if (!cmvPeriod) {
        setNotice({ tone: "warning", message: "Nenhuma apuração CMV encontrada." });
        return;
      }
      setMonth(monthFromDate(cmvPeriod.dataInicial));
      setPeriod({ preset: "custom", startDate: cmvPeriod.dataInicial, endDate: cmvPeriod.dataFinal });
      setNotice({ tone: "success", message: `Período CMV aplicado: ${formatDate(cmvPeriod.dataInicial)} a ${formatDate(cmvPeriod.dataFinal)}. Clique em Aplicar.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao usar período da apuração CMV." });
    }
  }

  const analytics = useMemo(() => buildRevenueAnalytics(summary), [summary]);
  const entries = (summary?.entries ?? []).filter((entry) => canLaunchEvent || entry.channel !== EVENT_CHANNEL);
  const filterIsDirty =
    appliedFilter !== null && appliedFilter.key !== describeAppliedFilter({ month, period, channel: channelFilter }).key;
  const competence = splitMonth(appliedFilter?.month ?? month);
  const tabs = [
    { value: "overview", label: "Visão geral" },
    { value: "daily", label: "Por dia" },
    { value: "entries", label: `Lançamentos (${entries.length})` }
  ];

  return (
    <div className="revenue-page">
      <MonthHeader
        eyebrow="Financeiro · Faturamento"
        competence={appliedFilter?.month ?? month}
        loading={loading}
        updatedAt={updatedAt}
        onChange={goToMonth}
        onStep={(delta) => goToMonth(shiftCompetence(appliedFilter?.month ?? month, delta))}
        onToday={() => goToMonth(currentMonth())}
        onRefresh={() => load({ allowAutoFallback: false })}
        rangeTitle={appliedFilter && !appliedFilter.isCompetence ? appliedFilter.periodLabel : undefined}
        rangeStatus="Período livre"
        actions={
          <>
            {canEdit && (
              <Button leadingIcon={<BadgeDollarSign size={16} />} onClick={() => onOpenCash?.()}>
                Caixa
              </Button>
            )}
            {canLaunchEvent && (
              <Button variant="secondary" leadingIcon={<CalendarPlus size={16} />} onClick={() => setShowEventModal(true)}>
                Lançar evento
              </Button>
            )}
          </>
        }
      />

      <Notice notice={notice} />

      <RevenueFilters
        period={period}
        onPeriodChange={setPeriod}
        channel={channelFilter}
        onChannelChange={setChannelFilter}
        loading={loading}
        onApply={() => load({ allowAutoFallback: false })}
        onUseCmvPeriod={useCmvPeriod}
      />

      <div className="revenue-tabs-row">
        <Tabs tabs={tabs} value={tab} onChange={(value) => setTab(value as RevenueTab)} aria-label="Seções do faturamento" />
        {appliedFilter && (
          <p className="revenue-contexto" aria-live="polite">
            Canal: <strong>{appliedFilter.channelLabel}</strong>
            {filterIsDirty && <span className="revenue-contexto-aviso"> — filtros alterados: clique em Aplicar</span>}
          </p>
        )}
      </div>

      {tab === "overview" && (
        <div role="tabpanel">
          <RevenueOverview
            summary={summary}
            analytics={analytics}
            previous={previous}
            year={competence.year}
            month={competence.month}
            showPlatforms={channelFilter === "Delivery" || analytics.platformRows.length > 0}
          />
        </div>
      )}

      {tab === "daily" && (
        <div role="tabpanel">
          <RevenueDaily analytics={analytics} />
        </div>
      )}

      {tab === "entries" && (
        <div role="tabpanel">
          <Card>
            <RevenueEntriesTable
              entries={entries}
              eventChannel={EVENT_CHANNEL}
              canEdit={canEdit}
              canLaunchEvent={canLaunchEvent}
              onEdit={(entryId) => onOpenCash?.(entryId)}
              onCancel={handleCancel}
              onCancelEvent={handleCancelEvent}
            />
          </Card>
        </div>
      )}

      {showEventModal && (
        <EventLaunchModal
          onClose={() => setShowEventModal(false)}
          onSaved={async (message) => {
            setShowEventModal(false);
            setNotice({ tone: "success", message });
            await load({ allowAutoFallback: false });
          }}
        />
      )}
    </div>
  );
}
