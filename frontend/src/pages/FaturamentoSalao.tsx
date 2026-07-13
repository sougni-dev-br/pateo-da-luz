import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal } from "lucide-react";
import { AppUser, getAgileSyncStatus, getRevenue, type AgileSyncStatus, type RevenueEntry, type RevenueSummary } from "../api/client";
import { Alert, Money, PanelEyebrow, SummaryCard, Table, useFormatCurrency } from "../design-system";
import { formatDate, formatNumber } from "../utils/format";
import "./FaturamentoSalao.css";

// Tela dedicada ao faturamento do salão vindo do Agile PDV via agente local.
// Fluxo de filtro pensado para tomada de decisão do dono:
//   1) Presets rápidos (chips): Este mês, Mês passado, Últimos 7, Últimos 30, Ontem, Hoje, Personalizado
//   2) Range custom com 2 datepickers (só quando preset=custom)
//   3) Dias da semana (multi-select): responde "como está o fim de semana?"
//   4) Turno (Todos/Almoço/Jantar): responde "qual turno performa melhor?"
//   5) Comparativo com mesmo período do mês anterior: mostra delta % em cada card

type Props = {
  user: AppUser;
};

const AGILE_PLATFORM = "AGILE_PDV";

// Ordem BR: comeca na segunda, termina no domingo. Cada entrada guarda o
// indice do JS (0=Dom, 1=Seg, ..., 6=Sab) para casar com getDay(). Manter
// o valor JS torna o filtro consistente com o Date sem precisar de mapeamentos
// espalhados pelo componente.
const WEEKDAYS_BR: Array<{ label: string; jsDay: number }> = [
  { label: "Seg", jsDay: 1 },
  { label: "Ter", jsDay: 2 },
  { label: "Qua", jsDay: 3 },
  { label: "Qui", jsDay: 4 },
  { label: "Sex", jsDay: 5 },
  { label: "Sáb", jsDay: 6 },
  { label: "Dom", jsDay: 0 }
];
const WEEKEND_DAYS = [5, 6, 0]; // sex+sáb+dom = "fim de semana" para restaurante
const WEEKDAYS_DAYS = [1, 2, 3, 4]; // seg-qui = dias úteis

type PresetKind =
  | "monthCurrent"
  | "monthPrevious"
  | "last7"
  | "last30"
  | "yesterday"
  | "today"
  | "custom";

const PRESETS: Array<{ id: PresetKind; label: string }> = [
  { id: "monthCurrent", label: "Este mês" },
  { id: "monthPrevious", label: "Mês passado" },
  { id: "last30", label: "Últimos 30 dias" },
  { id: "last7", label: "Últimos 7 dias" },
  { id: "yesterday", label: "Ontem" },
  { id: "today", label: "Hoje" },
  { id: "custom", label: "Personalizado" }
];

type ShiftFilter = "all" | "PRIMEIRO" | "SEGUNDO";

type FilterState = {
  preset: PresetKind;
  dateStart: string; // ISO YYYY-MM-DD
  dateEnd: string;   // ISO YYYY-MM-DD
  weekdays: number[]; // vazio = todos
  shift: ShiftFilter;
  compareToPrevious: boolean;
};

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function lastOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Traduz um preset em [dateStart, dateEnd]. Para "monthCurrent" o fim é
// o dia atual (não o último dia do mês) porque o dono normalmente quer
// "como estou indo até hoje neste mês".
function presetRange(preset: PresetKind, now: Date, previous?: { dateStart: string; dateEnd: string }): { dateStart: string; dateEnd: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  switch (preset) {
    case "monthCurrent":
      return { dateStart: isoDay(firstOfMonth(today)), dateEnd: isoDay(today) };
    case "monthPrevious": {
      const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { dateStart: isoDay(firstOfMonth(prev)), dateEnd: isoDay(lastOfMonth(prev)) };
    }
    case "last7":
      return { dateStart: isoDay(addDays(today, -6)), dateEnd: isoDay(today) };
    case "last30":
      return { dateStart: isoDay(addDays(today, -29)), dateEnd: isoDay(today) };
    case "yesterday":
      return { dateStart: isoDay(yesterday), dateEnd: isoDay(yesterday) };
    case "today":
      return { dateStart: isoDay(today), dateEnd: isoDay(today) };
    case "custom":
      // Custom mantém o range atual — só entra em edição via datepickers.
      return previous ?? { dateStart: isoDay(firstOfMonth(today)), dateEnd: isoDay(today) };
  }
}

// Range de comparação: mesmo período do mês anterior. Ex.: [2026-07-01, 2026-07-08]
// vira [2026-06-01, 2026-06-08]. Usa new Date(y, m-1, d) que normaliza
// automaticamente meses com menos dias (ex.: 31/mar → 03/mar do "31/fev").
function previousMonthRange(dateStart: string, dateEnd: string): { dateStart: string; dateEnd: string } {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 2, d); // -2 porque m é 1-based e queremos -1 mês
  };
  const s = parse(dateStart);
  const e = parse(dateEnd);
  return { dateStart: isoDay(s), dateEnd: isoDay(e) };
}

// Rótulo humano do intervalo — "01/07/2026 → 08/07/2026" ou compacto quando
// mesmo dia ("06/07/2026").
function humanRangeLabel(dateStart: string, dateEnd: string): string {
  if (dateStart === dateEnd) return formatDate(dateStart);
  return `${formatDate(dateStart)} → ${formatDate(dateEnd)}`;
}

type Totals = {
  gross: number;
  net: number;
  service: number;
  tables: number;
  people: number;
  peopleReported: number;
  entriesCount: number;
  shift1: number;
  shift2: number;
  tables1: number;
  tables2: number;
  shift1Service: number;
  shift2Service: number;
  pix: number;
  credit: number;
  debit: number;
  cash: number;
  voucher: number;
};

function emptyTotals(): Totals {
  return {
    gross: 0, net: 0, service: 0, tables: 0, people: 0, peopleReported: 0, entriesCount: 0,
    shift1: 0, shift2: 0, tables1: 0, tables2: 0, shift1Service: 0, shift2Service: 0,
    pix: 0, credit: 0, debit: 0, cash: 0, voucher: 0
  };
}

function computeTotals(entries: RevenueEntry[]): Totals {
  return entries.reduce<Totals>((acc, e) => {
    acc.gross += toNumber(e.grossAmount);
    acc.net += toNumber(e.netAmount);
    acc.service += toNumber(e.serviceAmount);
    acc.tables += Number(e.tickets ?? 0);
    acc.people += Number(e.peopleServed ?? 0);
    acc.peopleReported += e.peopleServed != null ? 1 : 0;
    acc.entriesCount += 1;
    acc.shift1 += toNumber(e.salesFirstShift);
    acc.shift2 += toNumber(e.salesSecondShift);
    acc.tables1 += Number(e.ticketsFirstShift ?? 0);
    acc.tables2 += Number(e.ticketsSecondShift ?? 0);
    acc.shift1Service += toNumber(e.shift1Service);
    acc.shift2Service += toNumber(e.shift2Service);
    acc.pix += toNumber(e.pixAmount);
    acc.credit += toNumber(e.creditAmount);
    acc.debit += toNumber(e.debitAmount);
    acc.cash += toNumber(e.cashAmount);
    acc.voucher += toNumber(e.voucherAmount);
    return acc;
  }, emptyTotals());
}

// Retorna gross, tables e service ajustados pelo filtro de turno.
// Se turno=all, usa totais do dia; se PRIMEIRO/SEGUNDO usa split.
function withShiftView(t: Totals, shift: ShiftFilter): {
  gross: number;
  service: number;
  tables: number;
  netApprox: number;
} {
  if (shift === "PRIMEIRO") {
    return { gross: t.shift1, service: t.shift1Service, tables: t.tables1, netApprox: t.shift1 - t.shift1Service };
  }
  if (shift === "SEGUNDO") {
    return { gross: t.shift2, service: t.shift2Service, tables: t.tables2, netApprox: t.shift2 - t.shift2Service };
  }
  return { gross: t.gross, service: t.service, tables: t.tables, netApprox: t.net };
}

// Aplica filtro de dias da semana. Vazio = todos. O RevenueEntry.date vem
// como ISO "YYYY-MM-DD" — usamos UTC pra não perder o dia por fuso horário.
function filterByWeekdays(entries: RevenueEntry[], weekdays: number[]): RevenueEntry[] {
  if (weekdays.length === 0) return entries;
  const set = new Set(weekdays);
  return entries.filter((e) => {
    // e.date vem como ISO datetime "YYYY-MM-DDTHH:MM:SSZ" do backend — precisamos
    // pegar apenas os 10 primeiros chars (a parte YYYY-MM-DD) para nao contaminar
    // o parse com o "T12:00:00Z" que sobra.
    const dateOnly = String(e.date).slice(0, 10);
    const [y, m, d] = dateOnly.split("-").map(Number);
    if (!y || !m || !d) return false;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return set.has(dow);
  });
}

export function FaturamentoSalao({ user: _user }: Props) {
  const now = useMemo(() => new Date(), []);

  // Default: mês corrente. Comparativo desligado.
  const [filter, setFilter] = useState<FilterState>(() => {
    const range = presetRange("monthCurrent", now);
    return {
      preset: "monthCurrent",
      dateStart: range.dateStart,
      dateEnd: range.dateEnd,
      weekdays: [],
      shift: "all",
      compareToPrevious: false
    };
  });

  const [status, setStatus] = useState<AgileSyncStatus | null>(null);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [previousSummary, setPreviousSummary] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Filtros avancados escondidos por padrao — o botao "Filtros" abre.
  // Se o usuario ja modificou algum, comeca aberto para nao "sumir" o
  // estado com que ele configurou anteriormente.
  const [refineOpen, setRefineOpen] = useState(false);
  // Paginacao da tabela — comeca com 10 dias, botao "Ver mais" cresce +10.
  const TABLE_PAGE_SIZE = 10;
  const [visibleTableRows, setVisibleTableRows] = useState(TABLE_PAGE_SIZE);
  const formatCurrency = useFormatCurrency();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const promises: Array<Promise<unknown>> = [
      getAgileSyncStatus(controller.signal).catch(() => null),
      getRevenue({ year: "", month: "", startDate: filter.dateStart, endDate: filter.dateEnd, channel: "Salão" }, controller.signal).catch(() => null)
    ];
    if (filter.compareToPrevious) {
      const prev = previousMonthRange(filter.dateStart, filter.dateEnd);
      promises.push(
        getRevenue({ year: "", month: "", startDate: prev.dateStart, endDate: prev.dateEnd, channel: "Salão" }, controller.signal).catch(() => null)
      );
    } else {
      promises.push(Promise.resolve(null));
    }
    Promise.all(promises)
      .then(([statusResult, revenueResult, prevResult]) => {
        if (controller.signal.aborted) return;
        setStatus(statusResult as AgileSyncStatus | null);
        setSummary(revenueResult as RevenueSummary | null);
        setPreviousSummary(prevResult as RevenueSummary | null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter.dateStart, filter.dateEnd, filter.compareToPrevious, refreshKey]);

  // Entries do PDV, filtradas por sourcePlatform e ordenadas por data.
  const rawEntries = useMemo(() => {
    if (!summary) return [] as RevenueEntry[];
    return summary.entries
      .filter((e) => e.sourcePlatform === AGILE_PLATFORM && e.status === "ACTIVE")
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [summary]);

  const rawPreviousEntries = useMemo(() => {
    if (!previousSummary) return [] as RevenueEntry[];
    return previousSummary.entries
      .filter((e) => e.sourcePlatform === AGILE_PLATFORM && e.status === "ACTIVE");
  }, [previousSummary]);

  // Aplica filtro de dias da semana (mesmo pro comparativo).
  const filteredEntries = useMemo(() => filterByWeekdays(rawEntries, filter.weekdays), [rawEntries, filter.weekdays]);
  // Reseta paginacao da tabela quando o filtro muda para nao acontecer de
  // ver "mais 10 dias" de um conjunto anterior maior.
  useEffect(() => {
    setVisibleTableRows(TABLE_PAGE_SIZE);
  }, [filter.dateStart, filter.dateEnd, filter.weekdays, filter.shift]);
  // Copia ordenada em ordem descendente para exibicao na tabela — os cards
  // de totais e comparativos continuam usando `filteredEntries` (ascendente).
  const filteredEntriesDesc = useMemo(
    () => [...filteredEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [filteredEntries]
  );
  const visibleTableEntries = useMemo(
    () => filteredEntriesDesc.slice(0, visibleTableRows),
    [filteredEntriesDesc, visibleTableRows]
  );
  const hasMoreTableRows = visibleTableRows < filteredEntriesDesc.length;
  const filteredPreviousEntries = useMemo(() => filterByWeekdays(rawPreviousEntries, filter.weekdays), [rawPreviousEntries, filter.weekdays]);

  const totals = useMemo(() => computeTotals(filteredEntries), [filteredEntries]);
  const previousTotals = useMemo(() => computeTotals(filteredPreviousEntries), [filteredPreviousEntries]);
  const shiftView = withShiftView(totals, filter.shift);
  const previousShiftView = withShiftView(previousTotals, filter.shift);

  const tmPorMesa = shiftView.tables > 0 ? shiftView.gross / shiftView.tables : 0;
  const tmPorPessoa = totals.people > 0 && filter.shift === "all" ? totals.gross / totals.people : 0;
  const peopleDataComplete = totals.peopleReported === filteredEntries.length && filteredEntries.length > 0;
  const yesterday = filteredEntries[filteredEntries.length - 1] ?? null;

  const pgtoTotal = totals.pix + totals.credit + totals.debit + totals.cash + totals.voucher;

  const dailyAverage = filteredEntries.length > 0 ? shiftView.gross / filteredEntries.length : 0;
  const rangeLabel = humanRangeLabel(filter.dateStart, filter.dateEnd);
  // Range REAL dos dados presentes (primeiro e ultimo dia com registro).
  // Quando o filtro pede 01→10/07 mas so ha dados ate 09/07, o titulo da
  // tabela usa 01→09/07 — evita insinuar que o dia 10 existe.
  const dataRangeLabel = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    const dates = filteredEntries.map((e) => e.date.slice(0, 10)).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first === filter.dateStart && last === filter.dateEnd) return null; // igual ao filtro, nao precisa duplicar
    return humanRangeLabel(first, last);
  }, [filteredEntries, filter.dateStart, filter.dateEnd]);

  const hasAnyData = filteredEntries.length > 0;
  const syncBanner = renderSyncBanner(status, now, hasAnyData);
  // Detecta dias esperados no range filtrado que nao tem RevenueEntry —
  // provavelmente sync falhou naquele dia. Ignora dias >= hoje (nao rodou
  // ainda) e o filtro por dia da semana e turno (ai ha razoes legitimas
  // para nao ter entrada). Se algum dia sumir sem justificativa, mostramos
  // um alerta amarelo com a lista.
  const missingDays = useMemo(() => {
    if (filter.weekdays.length > 0 || filter.shift !== "all") return [] as string[];
    if (filteredEntries.length === 0) return [] as string[];
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const startIso = filter.dateStart;
    const dates = filteredEntries.map((e) => e.date.slice(0, 10));
    const rangeEndIso = filter.dateEnd < todayIso ? filter.dateEnd : todayIso;
    if (startIso > rangeEndIso) return [];
    const existing = new Set(dates);
    const missing: string[] = [];
    const cursor = new Date(`${startIso}T00:00:00`);
    const end = new Date(`${rangeEndIso}T00:00:00`);
    // Sanity cap para nao loopar 100 anos se o filtro estiver estranho.
    let iterations = 0;
    while (cursor.getTime() <= end.getTime() && iterations < 400) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      // Nao alertar sobre HOJE nao ter dado ainda (sync do dia so roda 22h).
      if (iso !== todayIso && !existing.has(iso)) missing.push(iso);
      cursor.setDate(cursor.getDate() + 1);
      iterations += 1;
    }
    return missing;
  }, [filteredEntries, filter.dateStart, filter.dateEnd, filter.weekdays.length, filter.shift, now]);

  // Helper de delta % — só renderiza quando compareToPrevious está ligado
  // e o valor anterior é diferente de zero (evita divisão por zero).
  function deltaDetail(current: number, previous: number, higherIsBetter = true): string | null {
    if (!filter.compareToPrevious) return null;
    if (previous === 0) return "sem base de comparação";
    const pct = ((current - previous) / previous) * 100;
    const sign = pct > 0 ? "+" : "";
    const label = higherIsBetter
      ? (pct >= 0 ? " ▲" : " ▼")
      : (pct >= 0 ? " ▼" : " ▲");
    return `${sign}${pct.toFixed(1)}%${label} vs mês anterior`;
  }

  function applyPreset(preset: PresetKind) {
    const range = presetRange(preset, now, filter);
    setFilter((f) => ({
      ...f,
      preset,
      dateStart: range.dateStart,
      dateEnd: range.dateEnd
    }));
  }

  // Conta quantos refinamentos NÃO-default estão ativos (para mostrar badge no botão).
  const activeRefineCount =
    (filter.weekdays.length > 0 ? 1 : 0) +
    (filter.shift !== "all" ? 1 : 0) +
    (filter.compareToPrevious ? 1 : 0);

  function toggleWeekday(day: number) {
    setFilter((f) => {
      const has = f.weekdays.includes(day);
      const next = has ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day];
      return { ...f, weekdays: next };
    });
  }

  return (
    <div className="stack">
      <div className="fatsalao-filter">
        <div className="fatsalao-filter-row fatsalao-filter-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`fatsalao-chip${filter.preset === preset.id ? " fatsalao-chip-active" : ""}`}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
          <span className="fatsalao-filter-spacer" />
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

        {filter.preset === "custom" && (
          <div className="fatsalao-filter-row fatsalao-filter-custom">
            <label className="fatsalao-field">
              De
              <input
                type="date"
                value={filter.dateStart}
                max={filter.dateEnd}
                onChange={(e) => e.target.value && setFilter((f) => ({ ...f, dateStart: e.target.value }))}
              />
            </label>
            <label className="fatsalao-field">
              Até
              <input
                type="date"
                value={filter.dateEnd}
                min={filter.dateStart}
                max={isoDay(now)}
                onChange={(e) => e.target.value && setFilter((f) => ({ ...f, dateEnd: e.target.value }))}
              />
            </label>
          </div>
        )}

        <div className="fatsalao-filter-row fatsalao-refine-toggle-row">
          <button
            type="button"
            className={`fatsalao-refine-toggle${activeRefineCount > 0 ? " fatsalao-refine-toggle-active" : ""}`}
            onClick={() => setRefineOpen((v) => !v)}
            aria-expanded={refineOpen}
          >
            <SlidersHorizontal size={14} strokeWidth={2} aria-hidden />
            Filtros avançados
            {activeRefineCount > 0 && (
              <span className="fatsalao-refine-badge" aria-label={`${activeRefineCount} filtro(s) ativo(s)`}>
                {activeRefineCount}
              </span>
            )}
            {refineOpen
              ? <ChevronUp size={14} strokeWidth={2} aria-hidden />
              : <ChevronDown size={14} strokeWidth={2} aria-hidden />}
          </button>
        </div>

        {refineOpen && (
        <div className="fatsalao-filter-refine">
          <div className="fatsalao-refine-block">
            <span className="fatsalao-filter-label">Dias</span>
            <div className="fatsalao-refine-row">
              {WEEKDAYS_BR.map(({ label, jsDay }) => (
                <button
                  key={label}
                  type="button"
                  className={`fatsalao-chip fatsalao-chip-sm${filter.weekdays.includes(jsDay) ? " fatsalao-chip-active" : ""}`}
                  onClick={() => toggleWeekday(jsDay)}
                  aria-pressed={filter.weekdays.includes(jsDay)}
                >
                  {label}
                </button>
              ))}
              <span className="fatsalao-refine-divider" aria-hidden />
              <button
                type="button"
                className="fatsalao-chip fatsalao-chip-sm fatsalao-chip-ghost"
                onClick={() => setFilter((f) => ({ ...f, weekdays: WEEKEND_DAYS }))}
                title="Sex, Sáb, Dom"
              >
                Fim de semana
              </button>
              <button
                type="button"
                className="fatsalao-chip fatsalao-chip-sm fatsalao-chip-ghost"
                onClick={() => setFilter((f) => ({ ...f, weekdays: WEEKDAYS_DAYS }))}
                title="Seg, Ter, Qua, Qui"
              >
                Dias úteis
              </button>
              {filter.weekdays.length > 0 && (
                <button
                  type="button"
                  className="fatsalao-link-btn"
                  onClick={() => setFilter((f) => ({ ...f, weekdays: [] }))}
                >
                  limpar
                </button>
              )}
            </div>
          </div>

          <div className="fatsalao-refine-block">
            <span className="fatsalao-filter-label">Turno</span>
            <div className="fatsalao-refine-row">
              {(
                [
                  { id: "all", label: "Todos" },
                  { id: "PRIMEIRO", label: "Almoço" },
                  { id: "SEGUNDO", label: "Jantar" }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`fatsalao-chip fatsalao-chip-sm${filter.shift === opt.id ? " fatsalao-chip-active" : ""}`}
                  onClick={() => setFilter((f) => ({ ...f, shift: opt.id as ShiftFilter }))}
                  aria-pressed={filter.shift === opt.id}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="fatsalao-refine-block">
            <button
              type="button"
              className={`fatsalao-chip fatsalao-chip-sm${filter.compareToPrevious ? " fatsalao-chip-active" : ""}`}
              onClick={() => setFilter((f) => ({ ...f, compareToPrevious: !f.compareToPrevious }))}
              aria-pressed={filter.compareToPrevious}
            >
              {filter.compareToPrevious ? "✓ " : ""}Comparar com mês anterior
            </button>
          </div>
        </div>
        )}
      </div>

      {syncBanner}

      {missingDays.length > 0 && (
        <Alert tone="warning" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <strong>
                {missingDays.length === 1 ? "1 dia sem dado" : `${missingDays.length} dias sem dado`}
              </strong>
              {" no período filtrado: "}
              {missingDays.slice(0, 8).map((iso, idx) => (
                <span key={iso}>
                  {formatDate(iso)}
                  {idx < Math.min(missingDays.length, 8) - 1 ? ", " : ""}
                </span>
              ))}
              {missingDays.length > 8 && ` e mais ${missingDays.length - 8}`}.
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
                Provavelmente o agente não conseguiu sincronizar esses dias. Rode manualmente na
                PDVTOUCH:{" "}
                <code style={{ fontFamily: "monospace" }}>
                  node C:\PateoAgent\src\sync.js --data={missingDays[0]}
                </code>
              </div>
            </div>
          </div>
        </Alert>
      )}

      {/* Linha 1 — financeiro: Bruto, Serviço, Líquido em posicoes destacadas. */}
      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Financeiro ({rangeLabel})</PanelEyebrow>
        <div className="fatsalao-grid fatsalao-grid-financeiro">
          <SummaryCard
            label="Faturamento bruto"
            value={formatCurrency(shiftView.gross)}
            detail={
              <>
                {`${filteredEntries.length} dia${filteredEntries.length === 1 ? "" : "s"} · média ${formatCurrency(dailyAverage)}/dia`}
                <div className="fatsalao-hint">Total pago pelo cliente (inclui 10% de serviço)</div>
                {renderDeltaLine(deltaDetail(shiftView.gross, previousShiftView.gross))}
              </>
            }
          />
          <SummaryCard
            label="Serviço (10%)"
            value={formatCurrency(shiftView.service)}
            detail={
              <>
                {"Gorjeta acumulada (garçom)"}
                {renderDeltaLine(deltaDetail(shiftView.service, previousShiftView.service))}
              </>
            }
          />
          <SummaryCard
            label="Faturamento líquido"
            value={formatCurrency(shiftView.gross - shiftView.service)}
            detail={
              <>
                {"Fica para a casa (bruto − serviço)"}
                {renderDeltaLine(deltaDetail(
                  shiftView.gross - shiftView.service,
                  previousShiftView.gross - previousShiftView.service
                ))}
              </>
            }
          />
        </div>
      </section>

      {/* Linha 2 — operacao: Mesas, Pessoas, Ultimo dia como snapshot. */}
      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Operação ({rangeLabel})</PanelEyebrow>
        <div className="fatsalao-grid fatsalao-grid-operacao">
          <SummaryCard
            label={filter.shift === "all" ? "Mesas atendidas" : `Mesas (${filter.shift === "PRIMEIRO" ? "Almoço" : "Jantar"})`}
            value={formatNumber(shiftView.tables)}
            detail={
              <>
                {`TM por mesa ${formatCurrency(tmPorMesa)}`}
                {renderDeltaLine(deltaDetail(shiftView.tables, previousShiftView.tables))}
              </>
            }
          />
          <SummaryCard
            label="Pessoas atendidas"
            value={
              filter.shift !== "all"
                ? "—"
                : peopleDataComplete && totals.people > 0 ? formatNumber(totals.people) : "—"
            }
            detail={
              filter.shift !== "all"
                ? "Não disponível por turno"
                : peopleDataComplete && totals.people > 0
                  ? (
                    <>
                      {`TM por pessoa ${formatCurrency(tmPorPessoa)}`}
                      {renderDeltaLine(deltaDetail(totals.people, previousTotals.people))}
                    </>
                  )
                  : "Dado disponível após próximo sync"
            }
          />
          <SummaryCard
            label={yesterday ? `Último dia (${formatDate(yesterday.date)})` : "Último dia"}
            value={formatCurrency(yesterday ? toNumber(yesterday.grossAmount) : 0)}
            detail={yesterday
              ? `${formatNumber(yesterday.tickets ?? 0)} mesas${yesterday.peopleServed ? ` · ${formatNumber(yesterday.peopleServed)} pessoas` : ""}`
              : "Sem dados"}
          />
        </div>
      </section>

      {filter.shift === "all" && (
        <section className="fatsalao-section">
          <PanelEyebrow className="fatsalao-section-title">Por turno ({rangeLabel})</PanelEyebrow>
          <div className="fatsalao-grid fatsalao-grid-turnos">
            <SummaryCard
              label="Almoço"
              value={formatCurrency(totals.shift1)}
              detail={
                <>
                  {`${formatNumber(totals.tables1)} mesas · ${pctText(totals.shift1, totals.gross)}`}
                  {renderDeltaLine(deltaDetail(totals.shift1, previousTotals.shift1))}
                </>
              }
            />
            <SummaryCard
              label="Jantar"
              value={formatCurrency(totals.shift2)}
              detail={
                <>
                  {`${formatNumber(totals.tables2)} mesas · ${pctText(totals.shift2, totals.gross)}`}
                  {renderDeltaLine(deltaDetail(totals.shift2, previousTotals.shift2))}
                </>
              }
            />
          </div>
        </section>
      )}

      <section className="fatsalao-section">
        <PanelEyebrow className="fatsalao-section-title">Formas de pagamento ({rangeLabel})</PanelEyebrow>
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
        <PanelEyebrow className="fatsalao-section-title">
          Dias importados ({dataRangeLabel ?? rangeLabel})
        </PanelEyebrow>
        <p className="fatsalao-table-legend">
          <strong>Bruto</strong> = valor total pago pelo cliente (inclui 10% de taxa de serviço).{" "}
          <strong>Líquido</strong> = fica para a casa (bruto menos serviço). <strong>Serviço</strong> = 10% do garçom.
        </p>
        <div className="fatsalao-table">
          <Table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Dia</th>
                <th style={{ textAlign: "right" }}>Mesas</th>
                <th style={{ textAlign: "right" }}>Pessoas</th>
                <th style={{ textAlign: "right" }} title="Total pago pelo cliente (com 10% de serviço)">
                  Bruto <span className="fatsalao-th-hint">(c/ serviço)</span>
                </th>
                <th style={{ textAlign: "right" }} title="Faturamento bruto e nº de mesas do 1º turno (Almoço)"
                    className="fatsalao-col-shift1">
                  Almoço <span className="fatsalao-th-hint">(1º turno)</span>
                </th>
                <th style={{ textAlign: "right" }} title="Faturamento bruto e nº de mesas do 2º turno (Jantar)"
                    className="fatsalao-col-shift2">
                  Jantar <span className="fatsalao-th-hint">(2º turno)</span>
                </th>
                <th style={{ textAlign: "right" }} title="Taxa de serviço 10% — vai para os garçons">
                  Serviço <span className="fatsalao-th-hint">(10%)</span>
                </th>
                <th style={{ textAlign: "right" }} title="Fica para a casa (bruto menos serviço)">
                  Líquido <span className="fatsalao-th-hint">(casa)</span>
                </th>
                <th style={{ textAlign: "right" }}>TM/mesa</th>
                <th style={{ textAlign: "right" }}>TM/pessoa</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 24 }}>Carregando...</td></tr>
              ) : filteredEntriesDesc.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", padding: 24 }}>
                  Nenhum dia encontrado com os filtros atuais.
                </td></tr>
              ) : (
                visibleTableEntries.map((e) => {
                  const gross = toNumber(e.grossAmount);
                  const tables = Number(e.tickets ?? 0);
                  const people = e.peopleServed;
                  const shift1Gross = toNumber(e.salesFirstShift);
                  const shift1Tables = Number(e.ticketsFirstShift ?? 0);
                  const shift2Gross = toNumber(e.salesSecondShift);
                  const shift2Tables = Number(e.ticketsSecondShift ?? 0);
                  const tmMesa = tables > 0 ? gross / tables : 0;
                  const tmPessoa = people && people > 0 ? gross / people : null;
                  return (
                    <tr key={e.id}>
                      <td>{formatDate(e.date)}</td>
                      <td>{e.weekdayName ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{formatNumber(tables)}</td>
                      <td style={{ textAlign: "right" }}>{people != null ? formatNumber(people) : "—"}</td>
                      <td style={{ textAlign: "right" }}><Money value={gross} /></td>
                      <td style={{ textAlign: "right" }} className="fatsalao-col-shift1">
                        <div className="fatsalao-cell-shift">
                          <Money value={shift1Gross} />
                          <span className="fatsalao-cell-shift-sub">{formatNumber(shift1Tables)} mesa{shift1Tables === 1 ? "" : "s"}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} className="fatsalao-col-shift2">
                        <div className="fatsalao-cell-shift">
                          <Money value={shift2Gross} />
                          <span className="fatsalao-cell-shift-sub">{formatNumber(shift2Tables)} mesa{shift2Tables === 1 ? "" : "s"}</span>
                        </div>
                      </td>
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
        {filteredEntriesDesc.length > 0 && (
          <div className="fatsalao-table-more">
            <span className="fatsalao-table-more-count">
              Mostrando {visibleTableEntries.length} de {filteredEntriesDesc.length} dia{filteredEntriesDesc.length === 1 ? "" : "s"}
            </span>
            {hasMoreTableRows && (
              <button
                type="button"
                className="fatsalao-chip fatsalao-chip-sm"
                onClick={() => setVisibleTableRows((v) => v + TABLE_PAGE_SIZE)}
              >
                Ver mais {Math.min(TABLE_PAGE_SIZE, filteredEntriesDesc.length - visibleTableRows)} dias
              </button>
            )}
            {!hasMoreTableRows && filteredEntriesDesc.length > TABLE_PAGE_SIZE && (
              <button
                type="button"
                className="fatsalao-chip fatsalao-chip-sm fatsalao-chip-ghost"
                onClick={() => setVisibleTableRows(TABLE_PAGE_SIZE)}
              >
                Ver menos
              </button>
            )}
          </div>
        )}
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

function renderDeltaLine(text: string | null) {
  if (!text) return null;
  const tone = text.startsWith("+") ? "up" : text.startsWith("-") ? "down" : "neutral";
  return <div className={`fatsalao-delta fatsalao-delta-${tone}`}>{text}</div>;
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

function renderSyncBanner(status: AgileSyncStatus | null, now: Date, hasAnyData: boolean) {
  // O Alert do design system ja coloca o icone padrao do tom (Info/CheckCircle2/
  // AlertTriangle). NAO adicionar icone manual aqui — evita duplicidade.
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
