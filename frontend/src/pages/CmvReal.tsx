import { AlertTriangle, CheckCircle2, Download, Edit3, FileText, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppUser,
  calculateCmvPeriod,
  closeCmvPeriod,
  CmvPeriod,
  CmvPeriodDetail,
  CmvRealSuggestions,
  deleteCmvPeriod,
  downloadCmvPeriodPdf,
  getCmvPeriod,
  getCmvPeriods,
  getCmvRealBases,
  getCmvRealSuggestions,
  previewConsolidationCoverage,
  reopenCmvPeriod,
  saveCmvPeriod,
  StockBase,
  StockCoverageAudit
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { ConfirmDialog } from "../components/ui";
import { VerificacaoDoFechamento } from "../components/VerificacaoDoFechamento";
import { EquacaoDoCmv } from "../components/cmv/EquacaoDoCmv";
import { ComparacaoDeVisoes } from "../components/cmv/ComparacaoDeVisoes";
import { compararVisoes } from "../lib/visoes-do-cmv";
import { Button, IconButton, Money, StatusBadge as DsStatusBadge } from "../design-system";
import type { StatusTone } from "../design-system";
import { useSearchParams } from "react-router-dom";
import { hasPermission } from "../lib/permissions";
import { useRevealScroll } from "../lib/useRevealScroll";
import { formatDate } from "../utils/format";

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function nextDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function parseCalendarDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR");
}

const PT_MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function shortMonthPt(month: number, year: number) {
  return `${PT_MONTHS_SHORT[month - 1] ?? String(month)}/${year}`;
}

function stockBaseTypeLabel(base: StockBase): string {
  if (base.sourceType === "SESSION") {
    switch (base.inventoryType) {
      case "GERAL": return "Contagem geral";
      case "SETORIAL": return "Contagem setorial";
      case "IMPORTACAO_PLANILHA": return "Planilha importada";
      case "COMPLETO": return "Contagem completa";
      default: return base.inventoryType;
    }
  }
  switch (base.inventoryType) {
    case "INVENTARIO_FINAL": return "Inventário final";
    case "INVENTARIO_INICIAL": return "Inventário inicial";
    default: return base.inventoryType;
  }
}

function StockBaseCard({ base }: { base: StockBase }) {
  const month = base.competenceMonth != null && base.competenceYear != null
    ? shortMonthPt(base.competenceMonth, base.competenceYear) : null;
  const typeLabel = stockBaseTypeLabel(base);
  const originLabel = base.origin === "SISTEMA" ? "Sistema" : base.origin === "PLANILHA" ? "Planilha" : "Manual";
  return (
    <div className="stock-base-card">
      <div className="stock-base-card__row">
        {base.sourceType === "SESSION" && (
          <span><span className="stock-base-card__label">Código:</span> {base.code}</span>
        )}
        {month && <span><span className="stock-base-card__label">Competência:</span> {month}</span>}
        <span><span className="stock-base-card__label">Tipo:</span> {typeLabel}</span>
        <span><span className="stock-base-card__label">Itens:</span> {base.totalItems}</span>
        <span><span className="stock-base-card__label">Origem:</span> {originLabel}</span>
        {base.snapshotTotal != null && (
          <span><span className="stock-base-card__label">Total:</span> <Money value={base.snapshotTotal} /></span>
        )}
      </div>
      {base.originalFileName && (
        <div className="stock-base-card__filename">Arquivo: {base.originalFileName}</div>
      )}
    </div>
  );
}

function defaultPeriodName(startDate: string, endDate: string) {
  return `CMV ${startDate} a ${endDate}`;
}

function periodKey(period: Pick<CmvPeriod, "dataInicial" | "dataFinal">) {
  return `${period.dataInicial}|${period.dataFinal}`;
}

function rememberCmvPeriod(period: Pick<CmvPeriod, "id" | "name" | "dataInicial" | "dataFinal">) {
  localStorage.setItem("pateo_selected_cmv_period", JSON.stringify({
    id: period.id,
    name: period.name,
    dataInicial: period.dataInicial,
    dataFinal: period.dataFinal
  }));
}

function formatStatusLabel(status: string) {
  if (status === "CLOSED") return "Fechado";
  if (status === "OPEN") return "Aberto";
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w|\s\w/g, (letter) => letter.toUpperCase());
}

function statusToneClass(status: string): StatusTone {
  if (status === "CLOSED") return "neutral";
  if (status === "OPEN") return "warning";
  return "info";
}


// pt-BR: virgula decimal. Aceita fracao (0-1) e multiplica por 100 internamente.
function formatPercent(value: number | null | undefined) {
  if (value == null) return "-";
  return `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function percentageOf(total: number, amount: number) {
  if (!total) return "-";
  return `${((amount / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function SectionHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {actions ? <div className="actions-cell">{actions}</div> : null}
    </div>
  );
}


function StatusBadge({ status }: { status: string }) {
  return <DsStatusBadge tone={statusToneClass(status)}>{formatStatusLabel(status)}</DsStatusBadge>;
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-table-state">{message}</td>
    </tr>
  );
}

function hasInconsistentBases(period: Pick<CmvPeriod, "dataInicial" | "dataFinal" | "estoqueInicialSnapshotData" | "estoqueFinalSnapshotData">) {
  const initialCountDate = parseCalendarDate(period.estoqueInicialSnapshotData);
  const finalCountDate = parseCalendarDate(period.estoqueFinalSnapshotData);
  const periodStart = parseCalendarDate(period.dataInicial);
  const periodEnd = parseCalendarDate(period.dataFinal);

  const initialAfterFinal = Boolean(
    initialCountDate && finalCountDate && initialCountDate.getTime() > finalCountDate.getTime()
  );
  const initialOutsidePeriod = Boolean(
    initialCountDate && periodEnd && initialCountDate.getTime() > periodEnd.getTime()
  );
  const finalOutsidePeriod = Boolean(
    finalCountDate && periodStart && finalCountDate.getTime() < periodStart.getTime()
  );

  return initialAfterFinal || initialOutsidePeriod || finalOutsidePeriod;
}

function CmvPeriodMobileCard({
  period,
  isSelected,
  isDuplicate,
  isInconsistent,
  isAdmin,
  onOpen,
  onPdf,
  onDelete
}: {
  period: CmvPeriod;
  isSelected: boolean;
  isDuplicate: boolean;
  isInconsistent: boolean;
  isAdmin: boolean;
  onOpen: (period: CmvPeriod) => void;
  onPdf: (period: CmvPeriod) => void;
  onDelete: (period: CmvPeriod) => void;
}) {
  return (
    <article className={`cmv-mobile-card${isSelected ? " selected-row" : ""}`}>
      <div className="cmv-mobile-row">
        <span>Período</span>
        <strong>{formatDate(period.dataInicial)} - {formatDate(period.dataFinal)}</strong>
      </div>
      <div className="cmv-mobile-row">
        <span>Código</span>
        <span>{period.code ?? "-"}</span>
      </div>
      {/* As três pernas da equação saíram da lista (aqui e na tabela desktop):
          elas aparecem inteiras, e explicadas, na equação do detalhe. */}
      <div className="cmv-mobile-row">
        <span>Compras</span>
        <span><Money value={period.comprasTotal} /></span>
      </div>
      <div className="cmv-mobile-row">
        <span>CMV real</span>
        <strong><Money value={period.cmvReal} /></strong>
      </div>
      <div className="cmv-mobile-row">
        <span>Faturamento</span>
        <span><Money value={period.faturamentoTotal} /></span>
      </div>
      <div className="cmv-mobile-row">
        <span>CMV %</span>
        <span>{formatPercent(period.cmvPercentual)}</span>
      </div>
      <div className="cmv-mobile-row">
        <span>Status</span>
        <StatusBadge status={period.status} />
      </div>
      {isDuplicate ? (
        <div className="cmv-mobile-row">
          <span>Alerta</span>
          <span className="status-pill warning">Duplicada</span>
        </div>
      ) : null}
      {isInconsistent ? (
        <div className="cmv-mobile-row">
          <span>Alerta</span>
          <span className="status-pill warning">Bases inconsistentes</span>
        </div>
      ) : null}
      <div className="cmv-mobile-actions">
        <button className="secondary-button" type="button" onClick={() => onOpen(period)}>
          <Edit3 size={14} /> Abrir
        </button>
        <button className="secondary-button" type="button" onClick={() => onPdf(period)}>
          <Download size={14} /> PDF
        </button>
        {isAdmin ? (
          <button className="danger-button" type="button" onClick={() => onDelete(period)}>
            <Trash2 size={14} /> Excluir
          </button>
        ) : null}
      </div>
    </article>
  );
}

function warningTitle(code: string): string {
  switch (code) {
    case "PERIOD_CROSSES_MONTHS": return "Período cruza dois meses";
    case "SNAPSHOT_DATE_MISMATCH": return "Data do inventário não bate com o período";
    case "IFOOD_ZERO_WITH_ACTIVE_CREDENTIAL": return "iFood: nenhuma venda registrada";
    case "NOVENTA_NOVE_ZERO_WITH_ACTIVE_CREDENTIAL": return "99 Food: nenhuma venda registrada";
    default: return "Alerta";
  }
}

export function CmvReal({ user }: { user: AppUser }) {
  const canEdit = hasPermission(user, "cmv-real", "edit");
  const isAdmin = hasPermission(user, "cmv-real", "admin");
  const [periods, setPeriods] = useState<CmvPeriod[]>([]);
  const [cmvBases, setCmvBases] = useState<StockBase[]>([]);
  const [showAdvancedBases, setShowAdvancedBases] = useState(false);
  const [suggestions, setSuggestions] = useState<CmvRealSuggestions | null>(null);
  const [continuityLocked, setContinuityLocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CmvPeriodDetail | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ period: CmvPeriod; reason: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalSessionCoverage, setFinalSessionCoverage] = useState<StockCoverageAudit | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState({
    code: "",
    name: "",
    dataInicial: todayInput(),
    dataFinal: todayInput(),
    estoqueInicialSessionId: "",
    estoqueInicialSnapshotId: "",
    estoqueFinalSessionId: "",
    estoqueFinalSnapshotId: "",
    observacoes: ""
  });
  const { notice, setNotice } = useNotice();

  const selectedPeriod = useMemo(
    () => detail ?? periods.find((period) => period.id === selectedId) ?? null,
    [detail, periods, selectedId]
  );
  const isClosedSelected = Boolean(selectedId && selectedPeriod?.status === "CLOSED");
  const isOpenSelected = Boolean(selectedId && selectedPeriod?.status === "OPEN");


  // A diferença entre as duas visões, resumida: a visão contábil é a mesma que
  // já aparece no topo, então só a divergência merece espaço na tela.
  //
  // Os totais chegam com a listagem e as categorias só com o detalhe, que vem
  // depois. Misturar as duas fontes faz a tela subtrair números de períodos
  // diferentes entre o clique e a resposta da API — e o resto da diferença cai
  // em "fora das compras", que é justamente onde um erro de verdade apareceria.
  // Ou o detalhe do período selecionado está em mãos, ou não há comparação.
  const comparacaoDeVisoes = useMemo(() => {
    if (!detail || detail.id !== selectedId) return null;
    return compararVisoes(
      detail.views.accounting.cmvReal,
      detail.views.managerial.cmvReal,
      detail.views.accounting.cmvPercentual,
      detail.views.managerial.cmvPercentual,
      detail.viewDetails.accounting.purchaseByCategory,
      detail.viewDetails.managerial.purchaseByCategory
    );
  }, [detail, selectedId]);
  const detailRef = useRevealScroll<HTMLElement>({ when: selectedPeriod?.id });

  // A competência do período vem da data final: é o mês que o inventário fecha,
  // e é por ele que a conferência procura os snapshots.
  const competenciaDoPeriodo = useMemo(() => {
    const data = parseCalendarDate(selectedPeriod?.dataFinal ?? null);
    return data ? { year: data.getFullYear(), month: data.getMonth() + 1 } : null;
  }, [selectedPeriod?.dataFinal]);

  const initialDropdownValue = form.estoqueInicialSnapshotId ? `SNAPSHOT:${form.estoqueInicialSnapshotId}` : form.estoqueInicialSessionId;
  const finalDropdownValue = form.estoqueFinalSnapshotId ? `SNAPSHOT:${form.estoqueFinalSnapshotId}` : form.estoqueFinalSessionId;

  const selectedInitialBase = useMemo(
    () => cmvBases.find((b) => (b.sourceType === "SNAPSHOT" ? `SNAPSHOT:${b.id}` : b.id) === initialDropdownValue) ?? null,
    [cmvBases, initialDropdownValue]
  );
  const selectedFinalBase = useMemo(
    () => cmvBases.find((b) => (b.sourceType === "SNAPSHOT" ? `SNAPSHOT:${b.id}` : b.id) === finalDropdownValue) ?? null,
    [cmvBases, finalDropdownValue]
  );

  // Filtro de opções do dropdown Estoque Inicial/Final (CMV v2 — task #14):
  // Modo padrão mostra apenas snapshots INVENTARIO_INICIAL/FINAL (bases oficiais).
  // "Mostrar avancado" libera todas as contagens individuais e planilhas.
  // Sempre mantem a opcao atualmente selecionada visivel para não perder contexto ao trocar o filtro.
  const visibleBases = useMemo(() => {
    if (showAdvancedBases) return cmvBases;
    const selectedInitialKey = initialDropdownValue;
    const selectedFinalKey = finalDropdownValue;
    return cmvBases.filter((b) => {
      const key = b.sourceType === "SNAPSHOT" ? `SNAPSHOT:${b.id}` : b.id;
      if (key === selectedInitialKey || key === selectedFinalKey) return true;
      if (b.sourceType !== "SNAPSHOT") return false;
      return b.inventoryType === "INVENTARIO_INICIAL" || b.inventoryType === "INVENTARIO_FINAL";
    });
  }, [cmvBases, showAdvancedBases, initialDropdownValue, finalDropdownValue]);
  const periodConsistency = useMemo(() => {
    if (!selectedPeriod) return null;
    const initialCountDate = parseCalendarDate(selectedPeriod.estoqueInicialSnapshotData);
    const finalCountDate = parseCalendarDate(selectedPeriod.estoqueFinalSnapshotData);
    const periodStart = parseCalendarDate(selectedPeriod.dataInicial);
    const periodEnd = parseCalendarDate(selectedPeriod.dataFinal);

    const initialAfterFinal = Boolean(
      initialCountDate && finalCountDate && initialCountDate.getTime() > finalCountDate.getTime()
    );
    const initialOutsidePeriod = Boolean(
      initialCountDate && periodEnd && initialCountDate.getTime() > periodEnd.getTime()
    );
    const finalOutsidePeriod = Boolean(
      finalCountDate && periodStart && finalCountDate.getTime() < periodStart.getTime()
    );

    return {
      initialAfterFinal,
      initialOutsidePeriod,
      finalOutsidePeriod,
      hasIssue: initialAfterFinal || initialOutsidePeriod || finalOutsidePeriod
    };
  }, [selectedPeriod]);

  const duplicatePeriodKeys = useMemo(() => {
    const counts = new Map<string, number>();
    periods.forEach((period) => counts.set(periodKey(period), (counts.get(periodKey(period)) ?? 0) + 1));
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [periods]);

  const duplicatePeriods = useMemo(
    () => periods.filter((period) => duplicatePeriodKeys.has(periodKey(period))),
    [periods, duplicatePeriodKeys]
  );

  const periodStats = useMemo(() => ({
    total: periods.length,
    open: periods.filter((period) => period.status === "OPEN").length,
    closed: periods.filter((period) => period.status === "CLOSED").length,
    duplicates: duplicatePeriods.length
  }), [duplicatePeriods.length, periods]);

  const applyPeriodToForm = useCallback((period: Pick<CmvPeriod, "name" | "code" | "dataInicial" | "dataFinal" | "estoqueInicialSessionId" | "estoqueInicialSnapshotId" | "estoqueFinalSessionId" | "estoqueFinalSnapshotId" | "observacoes">) => {
    setForm({
      name: period.name,
      code: period.code ?? "",
      dataInicial: period.dataInicial,
      dataFinal: period.dataFinal,
      estoqueInicialSessionId: period.estoqueInicialSessionId ?? "",
      estoqueInicialSnapshotId: period.estoqueInicialSnapshotId ?? "",
      estoqueFinalSessionId: period.estoqueFinalSessionId ?? "",
      estoqueFinalSnapshotId: period.estoqueFinalSnapshotId ?? "",
      observacoes: period.observacoes ?? ""
    });
  }, []);

  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const pendingSnapshotRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  const startNewPeriod = useCallback((nextSuggestions: CmvRealSuggestions | null = suggestionsRef.current, options?: { estoqueFinalSnapshotId?: string }) => {
    const startDate = nextSuggestions?.suggestedStartDate ?? todayInput();
    setSelectedId(null);
    setDetail(null);
    setContinuityLocked(Boolean(nextSuggestions?.continuityLocked));
    setForm({
      name: defaultPeriodName(startDate, startDate),
      code: "",
      dataInicial: startDate,
      dataFinal: startDate,
      estoqueInicialSessionId: nextSuggestions?.suggestedInitialSessionId ?? "",
      estoqueInicialSnapshotId: nextSuggestions?.suggestedInitialSnapshotId ?? "",
      estoqueFinalSessionId: "",
      estoqueFinalSnapshotId: options?.estoqueFinalSnapshotId ?? "",
      observacoes: ""
    });
  }, []);

  const load = useCallback(async (nextSelectedId: string | null = selectedIdRef.current) => {
    setLoading(true);
    try {
      const [periodList, bases, nextSuggestions] = await Promise.all([
        getCmvPeriods(),
        getCmvRealBases(),
        getCmvRealSuggestions()
      ]);
      setPeriods(periodList);
      setCmvBases(bases);
      setSuggestions(nextSuggestions);
      const pendingSnapshot = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      if (nextSelectedId) {
        const selected = await getCmvPeriod(nextSelectedId);
        setSelectedId(nextSelectedId);
        rememberCmvPeriod(selected);
        setDetail(selected);
        setContinuityLocked(false);
        applyPeriodToForm(selected);
      } else if (pendingSnapshot) {
        startNewPeriod(nextSuggestions, { estoqueFinalSnapshotId: pendingSnapshot });
      } else if (periodList[0]) {
        const selected = await getCmvPeriod(periodList[0].id);
        setSelectedId(periodList[0].id);
        rememberCmvPeriod(selected);
        setDetail(selected);
        setContinuityLocked(false);
        applyPeriodToForm(selected);
      } else {
        startNewPeriod(nextSuggestions);
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar CMV Real." });
    } finally {
      setLoading(false);
    }
  }, [applyPeriodToForm, setNotice, startNewPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const snapshotId = searchParams.get("estoqueFinalSnapshotId");
    if (snapshotId) {
      pendingSnapshotRef.current = snapshotId;
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openPeriod = useCallback(async (period: CmvPeriod) => {
    try {
      setSelectedId(period.id);
      const data = await getCmvPeriod(period.id);
      rememberCmvPeriod(data);
      setDetail(data);
      setContinuityLocked(false);
      applyPeriodToForm(data);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir apuração." });
    }
  }, [applyPeriodToForm, setNotice]);

  async function checkFinalSessionCoverage(sessionId: string) {
    const base = cmvBases.find((b) => b.sourceType === "SESSION" && b.id === sessionId);
    if (!base?.isMonthEnd) { setFinalSessionCoverage(null); return; }
    setCheckingCoverage(true);
    try {
      const cov = await previewConsolidationCoverage([sessionId]);
      setFinalSessionCoverage(cov);
    } catch {
      setFinalSessionCoverage(null);
    } finally {
      setCheckingCoverage(false);
    }
  }

  async function handleSave() {
    if (!canEdit) return;
    const hasInicial = form.estoqueInicialSessionId || form.estoqueInicialSnapshotId;
    const hasFinal = form.estoqueFinalSessionId || form.estoqueFinalSnapshotId;
    if (!hasInicial || !hasFinal) {
      setNotice({ tone: "warning", message: "Selecione o estoque inicial e o estoque final." });
      return;
    }
    // Bloquear se a contagem final de fechamento estiver com cobertura incompleta
    if (finalSessionCoverage && !finalSessionCoverage.isComplete) {
      setNotice({
        tone: "error",
        message: `Base de estoque incompleta: ${finalSessionCoverage.coveredTotal}/${finalSessionCoverage.expectedTotal} produtos cobertos. Corrija o inventário antes de salvar.`
      });
      return;
    }
    setSaving(true);
    try {
      let continuityOverrideReason: string | null = null;
      const suggestedInitialSessionId = suggestions?.suggestedInitialSessionId ?? "";
      const suggestedInitialSnapshotId = suggestions?.suggestedInitialSnapshotId ?? "";
      const changingSuggestedContinuity = !selectedId
        && suggestions?.continuityLocked
        && (
          form.dataInicial !== suggestions.suggestedStartDate
          || form.estoqueInicialSessionId !== suggestedInitialSessionId
          || form.estoqueInicialSnapshotId !== suggestedInitialSnapshotId
        );
      if (isAdmin && changingSuggestedContinuity) {
        const reason = window.prompt("Informe o motivo para alterar a continuidade da apuração:");
        if (!reason?.trim()) {
          setNotice({ tone: "warning", message: "Motivo obrigatorio para alterar a continuidade." });
          return;
        }
        continuityOverrideReason = reason.trim();
      }
      const saved = await saveCmvPeriod({
        id: selectedId ?? undefined,
        name: form.name.trim() || defaultPeriodName(form.dataInicial, form.dataFinal),
        dataInicial: form.dataInicial,
        dataFinal: form.dataFinal,
        estoqueInicialSessionId: form.estoqueInicialSessionId || null,
        estoqueInicialSnapshotId: form.estoqueInicialSnapshotId || undefined,
        estoqueFinalSessionId: form.estoqueFinalSessionId || null,
        estoqueFinalSnapshotId: form.estoqueFinalSnapshotId || undefined,
        observacoes: form.observacoes,
        continuityOverrideReason
      });
      setNotice({ tone: "success", message: selectedId ? "Apuração atualizada com sucesso." : "Apuração criada com sucesso." });
      setSelectedId(saved.id);
      rememberCmvPeriod(saved);
      setDetail(saved);
      await load(saved.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar apuração." });
    } finally {
      setSaving(false);
    }
  }

  async function handleCalculate() {
    if (!selectedId) return;
    try {
      const updated = await calculateCmvPeriod(selectedId);
      setDetail(updated);
      setNotice({ tone: "success", message: "CMV calculado com sucesso." });
      await load(selectedId);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao calcular CMV." });
    }
  }

  async function handleClose() {
    if (!selectedId) return;
    try {
      const updated = await closeCmvPeriod(selectedId);
      setDetail(updated);
      setNotice({ tone: "success", message: "Apuração fechada com sucesso." });
      await load(selectedId);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao fechar apuração." });
    }
  }

  async function handleReopen() {
    if (!selectedId) return;
    const reason = window.prompt("Informe o motivo da reabertura:");
    if (!reason?.trim()) return;
    try {
      const updated = await reopenCmvPeriod(selectedId, reason);
      setDetail(updated);
      setNotice({ tone: "success", message: "Apuração reaberta com sucesso." });
      await load(selectedId);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao reabrir apuração." });
    }
  }

  function handleDelete(period: CmvPeriod) {
    if (!isAdmin) return;
    const isDuplicate = duplicatePeriodKeys.has(periodKey(period));
    const warning = period.status === "CLOSED"
      ? "Esta apuração esta fechada. A exclusão exige motivo e pode afetar o encadeamento com o próximo período."
      : "A exclusão pode afetar o encadeamento com o próximo período se houver apuração vinculada.";
    let reason: string | null = isDuplicate ? "Exclusão de apuração duplicada" : null;
    if (period.status === "CLOSED") {
      const typedReason = window.prompt(`${warning}\n\nDigite o motivo da exclusão:`);
      if (!typedReason?.trim()) {
        setNotice({ tone: "warning", message: "Motivo obrigatorio para excluir apuração fechada." });
        return;
      }
      reason = typedReason.trim();
    }
    setDeleteDialog({ period, reason });
  }

  async function confirmDelete() {
    if (!deleteDialog) return;
    const { period, reason } = deleteDialog;
    try {
      const result = await deleteCmvPeriod(period.id, reason);
      if (selectedId === period.id) {
        setSelectedId(null);
        setDetail(null);
      }
      setNotice({
        tone: "success",
        message: result.linkedNextPeriods > 0
          ? "Apuração excluida. Havia período seguinte vinculado, revise a continuidade."
          : "Apuração excluida com AuditLog registrado."
      });
      setDeleteDialog(null);
      await load(null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao excluir apuração." });
    }
  }

  async function handlePdf(periodId = selectedId) {
    if (!periodId) return;
    try {
      await downloadCmvPeriodPdf(periodId);
      setNotice({ tone: "success", message: "PDF do CMV Real gerado com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF." });
    }
  }

  function applySuggestedContinuity() {
    if (!suggestions) return;
    setForm((current) => ({
      ...current,
      dataInicial: suggestions.suggestedStartDate,
      estoqueInicialSessionId: suggestions.suggestedInitialSessionId ?? "",
      estoqueInicialSnapshotId: suggestions.suggestedInitialSnapshotId ?? "",
      name: defaultPeriodName(suggestions.suggestedStartDate, current.dataFinal)
    }));
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <ConfirmDialog
        open={Boolean(deleteDialog)}
        title="Excluir apuração de CMV?"
        tone="danger"
        confirmLabel="Excluir apuração"
        description={deleteDialog ? (
          <div className="stack compact-stack">
            <p>
              Período: <strong>{formatDate(deleteDialog.period.dataInicial)} a {formatDate(deleteDialog.period.dataFinal)}</strong>
            </p>
            <p>Status: <strong>{formatStatusLabel(deleteDialog.period.status)}</strong></p>
            <p>Esta acao registra auditoria e pode afetar a continuidade se houver período seguinte vinculado.</p>
          </div>
        ) : null}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />

      <section className="panel">
        <SectionHeader
          eyebrow="Situação"
          title="Períodos apurados"
          actions={(
            <>
              {canEdit && (
                <Button leadingIcon={<Plus size={16} />} onClick={() => startNewPeriod()}>Nova apuração</Button>
              )}
              <IconButton icon={<RefreshCw size={16} className={loading ? "spin" : ""} />} label="Atualizar CMV Real" onClick={() => load()} />
            </>
          )}
        />

        <div className="summary-grid dashboard-compact-grid">
          <article className="summary-card compact-summary-card">
            <div>
              <span>Apurações cadastradas</span>
              <strong>{periodStats.total}</strong>
              <small>Lista operacional do histórico de CMV.</small>
            </div>
            <FileText className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-warning">
            <div>
              <span>Abertas</span>
              <strong>{periodStats.open}</strong>
              <small>Períodos ainda passiveis de cálculo e fechamento.</small>
            </div>
            <AlertTriangle className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-success">
            <div>
              <span>Fechadas</span>
              <strong>{periodStats.closed}</strong>
              <small>Períodos concluidos e prontos para consulta.</small>
            </div>
            <CheckCircle2 className="summary-card-icon" size={20} />
          </article>
          <article className={`summary-card compact-summary-card ${periodStats.duplicates > 0 ? "tone-danger" : "tone-info"}`}>
            <div>
              <span>Duplicidades</span>
              <strong>{periodStats.duplicates}</strong>
              <small>Exigem revisão antes de consolidar a análise.</small>
            </div>
            <RefreshCw className="summary-card-icon" size={20} />
          </article>
        </div>

        {loading && <span className="muted-inline">Carregando...</span>}
        {duplicatePeriods.length > 0 && (
          <div className="alert warning compact-alert">
            <AlertTriangle className="alert-icon" size={18} />
            <div>
              <strong>Apuração duplicada encontrada.</strong>
              <span>
                {duplicatePeriods.length} registros compartilham o mesmo período. Exclua a duplicada somente apos conferir a continuidade.
              </span>
            </div>
          </div>
        )}

        <div className="alert info compact-alert">
          <FileText className="alert-icon" size={18} />
          <div>
            <strong>Regra operacional do período.</strong>
            <span>
              O inventário final de uma apuração vira o inventário inicial da próxima na mesma data de contagem.
              Compras e faturamento entram apenas entre as contagens: depois da data inicial e até a data final.
            </span>
          </div>
        </div>

      </section>

      <div className="cmv-workspace-grid">
        <section className="panel">
          <SectionHeader eyebrow="Lista" title="Escolha a apuração" />

          <div className="table-wrap subsection cmv-desktop-table operational-table">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="numeric-cell">Compras</th>
                  <th className="numeric-cell">CMV real</th>
                  <th className="numeric-cell">Faturamento</th>
                  <th className="numeric-cell">CMV %</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id} className={period.id === selectedId ? "selected-row" : ""}>
                    <td className="cmv-period-cell" title={`${formatDate(period.dataInicial)} - ${formatDate(period.dataFinal)}`}>
                      <strong>{formatDate(period.dataInicial)} - {formatDate(period.dataFinal)}</strong>
                      <small>{period.code ?? "sem código"} · {period.name}</small>
                      {duplicatePeriodKeys.has(periodKey(period)) && <span className="status-pill warning">Duplicada</span>}
                      {hasInconsistentBases(period) && <span className="status-pill warning">Bases inconsistentes</span>}
                    </td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.comprasTotal} /></td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.cmvReal} /></td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.faturamentoTotal} /></td>
                    <td className="numeric-cell nowrap-cell">{formatPercent(period.cmvPercentual)}</td>
                    <td><StatusBadge status={period.status} /></td>
                    <td>
                      <div className="actions-cell">
                        <button type="button" onClick={() => openPeriod(period)}>
                          <Edit3 size={14} /> Abrir
                        </button>
                        <button type="button" onClick={() => handlePdf(period.id)}>
                          <Download size={14} /> PDF
                        </button>
                        {isAdmin && (
                          <button className="danger-icon-button" type="button" title="Excluir apuração" onClick={() => handleDelete(period)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {periods.length === 0 && <EmptyTableRow colSpan={7} message="Nenhuma apuração cadastrada." />}
              </tbody>
            </table>
          </div>

          <div className="cmv-mobile-list subsection">
            {periods.map((period) => (
              <CmvPeriodMobileCard
                key={`${period.id}-mobile`}
                period={period}
                isSelected={period.id === selectedId}
                isDuplicate={duplicatePeriodKeys.has(periodKey(period))}
                isInconsistent={hasInconsistentBases(period)}
                isAdmin={isAdmin}
                onOpen={openPeriod}
                onPdf={(row) => handlePdf(row.id)}
                onDelete={handleDelete}
              />
            ))}
            {periods.length === 0 && <div className="alert warning">Nenhuma apuração cadastrada.</div>}
          </div>
        </section>

        <section className="panel">
          <SectionHeader
            eyebrow={selectedId ? "Edição" : "Nova"}
            title={selectedId ? "Apuração selecionada" : "Nova apuração"}
          />
          <div className="form-grid subsection">
            <label>
              Código
              <input className="locked-field" title="Código gerado automaticamente pelo sistema" value={form.code || "Gerado ao salvar"} readOnly />
            </label>
            <label>
              Nome da apuração
              <input
                value={form.name || defaultPeriodName(form.dataInicial, form.dataFinal)}
                readOnly={isClosedSelected}
                className={isClosedSelected ? "locked-field" : undefined}
                title={isClosedSelected ? "Nome bloqueado em apurações fechadas" : "Nome da apuração"}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Data inicial
              <input
                className={isClosedSelected ? "locked-field" : undefined}
                type="date"
                value={form.dataInicial}
                disabled={isClosedSelected}
                title={isClosedSelected ? "Data bloqueada em apurações fechadas" : form.dataInicial}
                onChange={(event) => setForm((current) => {
                  const newStart = event.target.value;
                  const autoName = defaultPeriodName(current.dataInicial, current.dataFinal);
                  const nameIsAuto = !current.name || current.name === autoName;
                  return { ...current, dataInicial: newStart, name: nameIsAuto ? defaultPeriodName(newStart, current.dataFinal) : current.name };
                })}
              />
            </label>
            <label>
              Data final
              <input
                className={isClosedSelected ? "locked-field" : undefined}
                type="date"
                value={form.dataFinal}
                disabled={isClosedSelected}
                onChange={(event) => setForm((current) => {
                  const newEnd = event.target.value;
                  const autoName = defaultPeriodName(current.dataInicial, current.dataFinal);
                  const nameIsAuto = !current.name || current.name === autoName;
                  return { ...current, dataFinal: newEnd, name: nameIsAuto ? defaultPeriodName(current.dataInicial, newEnd) : current.name };
                })}
              />
            </label>
            <label>
              Estoque inicial
              <select
                className={isClosedSelected ? "locked-field" : undefined}
                value={initialDropdownValue}
                disabled={isClosedSelected}
                title={selectedInitialBase ? selectedInitialBase.displayLabel : "Selecionar"}
                onChange={(event) => {
                  const val = event.target.value;
                  if (!val) {
                    setForm((f) => ({ ...f, estoqueInicialSessionId: "", estoqueInicialSnapshotId: "" }));
                  } else if (val.startsWith("SNAPSHOT:")) {
                    const snapshotId = val.slice(9);
                    const picked = cmvBases.find((b) => b.sourceType === "SNAPSHOT" && b.id === snapshotId);
                    // CMV v2 — task #20: ao escolher snapshot inicial, auto-preenche dataInicial com a data efetiva da contagem.
                    setForm((f) => ({
                      ...f,
                      estoqueInicialSnapshotId: snapshotId,
                      estoqueInicialSessionId: "",
                      dataInicial: picked?.date ?? f.dataInicial
                    }));
                  } else {
                    const picked = cmvBases.find((b) => b.sourceType === "SESSION" && b.id === val);
                    setForm((f) => ({
                      ...f,
                      estoqueInicialSessionId: val,
                      estoqueInicialSnapshotId: "",
                      dataInicial: picked?.date ?? f.dataInicial
                    }));
                  }
                }}
              >
                <option value="">Selecionar estoque</option>
                {visibleBases.map((base) => {
                  const optionValue = base.sourceType === "SNAPSHOT" ? `SNAPSHOT:${base.id}` : base.id;
                  return (
                    <option key={optionValue} value={optionValue}>
                      {base.displayLabel}
                    </option>
                  );
                })}
              </select>
              {selectedInitialBase && <StockBaseCard base={selectedInitialBase} />}
            </label>
            <label>
              Estoque final
              <select
                className={isClosedSelected ? "locked-field" : undefined}
                value={finalDropdownValue}
                disabled={isClosedSelected}
                title={selectedFinalBase ? selectedFinalBase.displayLabel : "Selecionar"}
                onChange={(event) => {
                  const val = event.target.value;
                  if (!val) {
                    setForm((f) => ({ ...f, estoqueFinalSessionId: "", estoqueFinalSnapshotId: "" }));
                    setFinalSessionCoverage(null);
                  } else if (val.startsWith("SNAPSHOT:")) {
                    const snapshotId = val.slice(9);
                    const picked = cmvBases.find((b) => b.sourceType === "SNAPSHOT" && b.id === snapshotId);
                    // CMV v2 — task #20: auto-preenche dataFinal com a data da contagem final.
                    setForm((f) => ({
                      ...f,
                      estoqueFinalSnapshotId: snapshotId,
                      estoqueFinalSessionId: "",
                      dataFinal: picked?.date ?? f.dataFinal
                    }));
                    setFinalSessionCoverage(null);
                  } else {
                    const picked = cmvBases.find((b) => b.sourceType === "SESSION" && b.id === val);
                    setForm((f) => ({
                      ...f,
                      estoqueFinalSessionId: val,
                      estoqueFinalSnapshotId: "",
                      dataFinal: picked?.date ?? f.dataFinal
                    }));
                    checkFinalSessionCoverage(val);
                  }
                }}
              >
                <option value="">Selecionar estoque</option>
                {visibleBases.map((base) => {
                  const optionValue = base.sourceType === "SNAPSHOT" ? `SNAPSHOT:${base.id}` : base.id;
                  return (
                    <option key={optionValue} value={optionValue}>
                      {base.displayLabel}
                    </option>
                  );
                })}
              </select>
              {selectedFinalBase && <StockBaseCard base={selectedFinalBase} />}
              {checkingCoverage && (
                <small style={{ color: "var(--muted)", fontSize: 12, marginTop: 4, display: "block" }}>Verificando cobertura...</small>
              )}
              {!checkingCoverage && finalSessionCoverage && (
                <div style={{
                  marginTop: 6,
                  padding: "8px 12px",
                  borderRadius: 5,
                  background: finalSessionCoverage.isComplete ? "var(--success-soft, #e6f4ea)" : "var(--error-soft, #fdecea)",
                  border: `1px solid ${finalSessionCoverage.isComplete ? "var(--success, #2e7d32)" : "var(--error, #c62828)"}`,
                  fontSize: 12
                }}>
                  {finalSessionCoverage.isComplete ? (
                    <span style={{ color: "var(--success, #2e7d32)", fontWeight: 600 }}>
                      Cobertura completa: {finalSessionCoverage.coveredTotal}/{finalSessionCoverage.expectedTotal} produtos.
                    </span>
                  ) : (
                    <>
                      <span style={{ color: "var(--error, #c62828)", fontWeight: 600 }}>
                        Base incompleta: {finalSessionCoverage.coveredTotal}/{finalSessionCoverage.expectedTotal} produtos cobertos. {finalSessionCoverage.missingTotal} sem contagem - salvar bloqueado.
                      </span>
                      {finalSessionCoverage.missingSectors.length > 0 && (
                        <div style={{ marginTop: 4 }}>Setores ausentes: <strong>{finalSessionCoverage.missingSectors.join(", ")}</strong></div>
                      )}
                    </>
                  )}
                </div>
              )}
            </label>
            <label className="full-width">
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
                <input
                  type="checkbox"
                  checked={showAdvancedBases}
                  onChange={(event) => setShowAdvancedBases(event.target.checked)}
                />
                Mostrar opções avançadas nos dropdowns (contagens individuais, planilhas). Padrão: apenas inventários oficiais (INICIAL / FINAL).
              </span>
            </label>
            <label className="full-width">
              Observações
              <input
                className={isClosedSelected ? "locked-field" : undefined}
                title={form.observacoes}
                value={form.observacoes}
                readOnly={isClosedSelected}
                onChange={(event) => setForm({ ...form, observacoes: event.target.value })}
              />
            </label>
          </div>

          {!selectedId && continuityLocked && suggestions?.latestPeriod && (
            <div className="alert info compact-alert subsection">
              <FileText className="alert-icon" size={18} />
              <div>
                <strong>Continuidade sugerida preenchida automaticamente.</strong>
                <span>
                  A sugestao usa a data e o inventário final do ultimo período como ponto de partida, mas voce pode ajustar os campos desta nova apuração conforme a operacao real.
                </span>
              </div>
              <button className="secondary-button" type="button" onClick={applySuggestedContinuity}>
                Reaplicar sugestao
              </button>
            </div>
          )}

          {isClosedSelected && (
            <div className="alert info compact-alert subsection">
              <FileText className="alert-icon" size={18} />
              <div>
                <strong>Apuração fechada em modo de consulta.</strong>
                <span>
                  Para alterar dados desta apuração, primeiro reabra o período. Enquanto estiver fechada, os campos ficam somente para leitura.
                </span>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="actions-cell subsection wrap">
              <button
                className="primary-button"
                type="button"
                onClick={handleSave}
                disabled={isClosedSelected || saving || checkingCoverage || (finalSessionCoverage != null && !finalSessionCoverage.isComplete)}
              >
                <Save size={16} /> {selectedId ? "Atualizar apuração" : "Criar apuração"}
              </button>
              <button className="secondary-button" type="button" onClick={handleCalculate} disabled={!selectedId || isClosedSelected}>
                <FileText size={16} /> Calcular
              </button>
              <button className="secondary-button" type="button" onClick={handleClose} disabled={!isOpenSelected}>
                <CheckCircle2 size={16} /> Fechar
              </button>
              {isAdmin && (
                <button className="secondary-button" type="button" onClick={handleReopen} disabled={!isClosedSelected}>
                  <RotateCcw size={16} /> Reabrir
                </button>
              )}
              <button className="secondary-button" type="button" onClick={() => handlePdf()} disabled={!selectedId}>
                <Download size={16} /> PDF
              </button>
            </div>
          )}
        </section>

        {selectedPeriod && (
          <section className="panel scroll-target" ref={detailRef}>
            <SectionHeader eyebrow="Detalhe" title={selectedPeriod.name} />
            {/* A conferência vem antes dos números: o que ela aponta muda como
                se lê o CMV logo abaixo. Deixá-la no rodapé seria o mesmo que
                não tê-la — foi assim que agosto fechou R$ 81 mil inflado. */}
            <VerificacaoDoFechamento
              year={competenciaDoPeriodo?.year ?? null}
              month={competenciaDoPeriodo?.month ?? null}
            />
            {periodConsistency?.hasIssue ? (
              <div className="alert warning compact-alert subsection">
                <AlertTriangle className="alert-icon" size={18} />
                <div>
                  <strong>Período com continuidade inconsistente.</strong>
                  <span>
                    {periodConsistency.initialAfterFinal
                      ? "A base inicial esta com data posterior a base final."
                      : "As datas das bases de estoque não batem com a janela do período."} Revise este CMV antes do fechamento.
                  </span>
                </div>
              </div>
            ) : null}
            {/* Os avisos do cálculo vinham como dois blocos amarelos do tamanho
                de um parágrafo, logo acima do número principal — gritavam mais
                que a conferência, que é o que de fato decide se dá para fechar.
                Mesmo conteúdo, peso visual de nota de rodapé. */}
            {detail?.warnings && detail.warnings.length > 0 && (
              <div className="subsection cmv-avisos">
                {detail.warnings.map((w) => (
                  <div
                    key={w.code}
                    className={`alert compact-alert ${w.severity === "warning" ? "warning" : "info"}`}
                  >
                    <AlertTriangle className="alert-icon" size={18} />
                    <div>
                      <strong>{warningTitle(w.code)}</strong>
                      <span>{w.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Código, período e status sao identificacao, não resultado: saem
                da grade de numeros e viram uma linha de contexto. */}
            <p className="cmv-identificacao">
              <StatusBadge status={selectedPeriod.status} />
              <span>{selectedPeriod.code ?? "sem código"}</span>
              <span>{formatDate(selectedPeriod.dataInicial)} a {formatDate(selectedPeriod.dataFinal)}</span>
              <span className="cmv-identificacao-nota">
                Movimentos entre {formatDate(nextDateKey(selectedPeriod.dataInicial))} e {formatDate(selectedPeriod.dataFinal)}
              </span>
            </p>

            <EquacaoDoCmv
              estoqueInicial={selectedPeriod.estoqueInicialTotal}
              compras={selectedPeriod.comprasTotal}
              estoqueFinal={selectedPeriod.estoqueFinalTotal}
              cmvReal={selectedPeriod.cmvReal}
              faturamento={selectedPeriod.faturamentoTotal}
              cmvPercentual={selectedPeriod.cmvPercentual}
              margemBruta={selectedPeriod.margemBruta}
            />

            {/* O que a receita e as compras trouxeram, e de onde vieram as bases.
                Antes eram cinco cartões de "Rastreabilidade" — três deles com "-"
                em todo período aberto — mais uma lista que repetia as datas de
                contagem que os cartões já traziam. */}
            <dl className="cmv-composicao">
              <div><dt>Receita bruta</dt><dd><Money value={detail?.revenueGrossTotal ?? 0} /></dd></div>
              <div><dt>Serviço</dt><dd><Money value={detail?.revenueServiceTotal ?? 0} /></dd></div>
              <div><dt>Receita líquida</dt><dd><Money value={detail?.revenueNetTotal ?? selectedPeriod.faturamentoTotal} /></dd></div>
              <div><dt>Dias com faturamento</dt><dd>{detail?.revenueDaysCount ?? 0}</dd></div>
              <div><dt>Compras consideradas</dt><dd>{detail?.purchasesCount ?? 0}</dd></div>
            </dl>

            <p className="cmv-rastreio">
              <span>
                Base inicial{" "}
                <strong>{selectedPeriod.estoqueInicialSessionCode ?? "inventário oficial"}</strong>
                {selectedPeriod.estoqueInicialSnapshotData
                  ? `, contada em ${formatDate(selectedPeriod.estoqueInicialSnapshotData)}`
                  : ""}
              </span>
              <span>
                Base final{" "}
                <strong>{selectedPeriod.estoqueFinalSessionCode ?? "inventário oficial"}</strong>
                {selectedPeriod.estoqueFinalSnapshotData
                  ? `, contada em ${formatDate(selectedPeriod.estoqueFinalSnapshotData)}`
                  : ""}
              </span>
              {/* Quem fechou e quem reabriu só existem depois que alguém fez isso:
                  mostrar "-" em todo período aberto é ruído, não rastreabilidade. */}
              {selectedPeriod.fechadoPorNome && (
                <span>
                  Fechado por <strong>{selectedPeriod.fechadoPorNome}</strong>
                  {selectedPeriod.fechadoEm ? ` em ${formatDateTime(selectedPeriod.fechadoEm)}` : ""}
                </span>
              )}
              {selectedPeriod.reabertoPorNome && (
                <span>
                  Reaberto por <strong>{selectedPeriod.reabertoPorNome}</strong>
                  {selectedPeriod.reabertoEm ? ` em ${formatDateTime(selectedPeriod.reabertoEm)}` : ""}
                  {selectedPeriod.motivoReabertura ? ` — ${selectedPeriod.motivoReabertura}` : ""}
                </span>
              )}
            </p>

            {/* A outra visão do cálculo.
                Aqui havia três seções e cerca de trinta cartões: "Visões do
                cálculo" e duas "Memórias de cálculo", cada uma abrindo com um
                cartão cujo VALOR era o texto "Estoque inicial + Compras -
                Estoque final" e repetindo resultado e CMV% já mostrados acima —
                o CMV% aparecia três vezes na mesma tela.

                Mostrar as duas contas lado a lado ainda repetia a do topo, que
                é a visão contábil. A única pergunta que a seção responde é
                quanto a gerencial difere e por quê — então é isso que ela diz. */}
            {comparacaoDeVisoes && detail && (
              <div className="subsection">
                <h3>{detail.views.managerial.label}</h3>
                <p className="subsection-nota">
                  A conta acima é a {detail.views.accounting.label.toLowerCase()}. A gerencial soma
                  categorias de compra que aquela deixa de fora.
                </p>
                <ComparacaoDeVisoes
                  rotulo={detail.views.managerial.label}
                  cmvGerencial={detail.views.managerial.cmvReal}
                  percentualGerencial={detail.views.managerial.cmvPercentual}
                  comparacao={comparacaoDeVisoes}
                />
              </div>
            )}

            <div className="subsection">
              <h3>Compras por categoria</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th className="col-rank">Rank</th><th>Categoria</th><th className="numeric-cell col-secundaria">Itens</th><th className="numeric-cell">Participação</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseByCategory.map((row, index) => (
                      <tr key={row.categoryName} className={index < 3 ? "ranking-row" : ""}>
                        <td className="col-rank">{index + 1}</td>
                        <td title={row.categoryName}>{row.categoryName}</td>
                        <td className="numeric-cell col-secundaria">{row.itemsCount}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.purchasesGrossTotal ?? 0, row.totalAmount)}</td>
                        <td className="numeric-cell nowrap-cell"><Money value={row.totalAmount} /></td>
                      </tr>
                    )) ?? null}
                    {detail?.purchaseByCategory.length === 0 && <EmptyTableRow colSpan={5} message="Sem dados." />}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="subsection">
              <h3>Compras por fornecedor</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th className="col-rank">Rank</th><th>Fornecedor</th><th className="col-secundaria">Documento</th><th className="numeric-cell col-secundaria">Pedidos</th><th className="numeric-cell">Participação</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseBySupplier.map((row, index) => (
                      <tr key={row.supplierId} className={index < 3 ? "ranking-row" : ""}>
                        <td className="col-rank">{index + 1}</td>
                        <td title={row.supplierName}>{row.supplierName}</td>
                        <td className="nowrap-cell col-secundaria">{row.supplierDocument ?? "-"}</td>
                        <td className="numeric-cell col-secundaria">{row.purchasesCount}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.purchasesGrossTotal ?? 0, row.totalAmount)}</td>
                        <td className="numeric-cell nowrap-cell"><Money value={row.totalAmount} /></td>
                      </tr>
                    )) ?? null}
                    {detail?.purchaseBySupplier.length === 0 && <EmptyTableRow colSpan={6} message="Sem dados." />}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="subsection">
              <h3>Faturamento por canal</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th>Canal</th><th className="numeric-cell col-secundaria">Qtd.</th><th className="numeric-cell">Participação</th><th className="numeric-cell col-secundaria">Bruto</th><th className="numeric-cell">Líquido</th></tr></thead>
                  <tbody>
                    {detail?.revenueByChannel.map((row, index) => (
                      <tr key={row.channel} className={index === 0 ? "ranking-row" : ""}>
                        <td>{row.channel}</td>
                        <td className="numeric-cell col-secundaria">{row.count}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.revenueNetTotal ?? 0, row.netAmount)}</td>
                        <td className="numeric-cell nowrap-cell col-secundaria"><Money value={row.grossAmount} /></td>
                        <td className="numeric-cell nowrap-cell"><Money value={row.netAmount} /></td>
                      </tr>
                    )) ?? null}
                    {detail?.revenueByChannel.length === 0 && <EmptyTableRow colSpan={5} message="Sem dados." />}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
