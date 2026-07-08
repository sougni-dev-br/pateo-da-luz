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
    case "INVENTARIO_FINAL": return "Inventario final";
    case "INVENTARIO_INICIAL": return "Inventario inicial";
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
          <span><span className="stock-base-card__label">Codigo:</span> {base.code}</span>
        )}
        {month && <span><span className="stock-base-card__label">Competencia:</span> {month}</span>}
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

function classifyCmv(percentual: number | null | undefined) {
  if (percentual == null) return { label: "Sem calculo", tone: "tone-neutral" };
  if (percentual <= 0.3) return { label: "Bom", tone: "tone-success" };
  if (percentual <= 0.35) return { label: "Atencao", tone: "tone-warning" };
  return { label: "Critico", tone: "tone-danger" };
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

function MetricCard({ label, value, detail, className = "" }: { label: string; value: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <article className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small className="muted-inline">{detail}</small> : null}
    </article>
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
        <span>Periodo</span>
        <strong>{formatDate(period.dataInicial)} - {formatDate(period.dataFinal)}</strong>
      </div>
      <div className="cmv-mobile-row">
        <span>Codigo</span>
        <span>{period.code ?? "-"}</span>
      </div>
      <div className="cmv-mobile-row">
        <span>Estoque inicial</span>
        <span><Money value={period.estoqueInicialTotal} /></span>
      </div>
      <div className="cmv-mobile-row">
        <span>Compras</span>
        <span><Money value={period.comprasTotal} /></span>
      </div>
      <div className="cmv-mobile-row">
        <span>Estoque final</span>
        <span><Money value={period.estoqueFinalTotal} /></span>
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

export function CmvReal({ user }: { user: AppUser }) {
  const canEdit = hasPermission(user, "cmv-real", "edit");
  const isAdmin = hasPermission(user, "cmv-real", "admin");
  const [periods, setPeriods] = useState<CmvPeriod[]>([]);
  const [cmvBases, setCmvBases] = useState<StockBase[]>([]);
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

  const cmvHealth = useMemo(() => classifyCmv(selectedPeriod?.cmvPercentual), [selectedPeriod?.cmvPercentual]);
  const detailRef = useRevealScroll<HTMLElement>({ when: selectedPeriod?.id });

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
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir apuracao." });
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
        message: `Base de estoque incompleta: ${finalSessionCoverage.coveredTotal}/${finalSessionCoverage.expectedTotal} produtos cobertos. Corrija o inventario antes de salvar.`
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
        const reason = window.prompt("Informe o motivo para alterar a continuidade da apuracao:");
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
      setNotice({ tone: "success", message: selectedId ? "Apuracao atualizada com sucesso." : "Apuracao criada com sucesso." });
      setSelectedId(saved.id);
      rememberCmvPeriod(saved);
      setDetail(saved);
      await load(saved.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar apuracao." });
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
      setNotice({ tone: "success", message: "Apuracao fechada com sucesso." });
      await load(selectedId);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao fechar apuracao." });
    }
  }

  async function handleReopen() {
    if (!selectedId) return;
    const reason = window.prompt("Informe o motivo da reabertura:");
    if (!reason?.trim()) return;
    try {
      const updated = await reopenCmvPeriod(selectedId, reason);
      setDetail(updated);
      setNotice({ tone: "success", message: "Apuracao reaberta com sucesso." });
      await load(selectedId);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao reabrir apuracao." });
    }
  }

  function handleDelete(period: CmvPeriod) {
    if (!isAdmin) return;
    const isDuplicate = duplicatePeriodKeys.has(periodKey(period));
    const warning = period.status === "CLOSED"
      ? "Esta apuracao esta fechada. A exclusao exige motivo e pode afetar o encadeamento com o proximo periodo."
      : "A exclusao pode afetar o encadeamento com o proximo periodo se houver apuracao vinculada.";
    let reason: string | null = isDuplicate ? "Exclusao de apuracao duplicada" : null;
    if (period.status === "CLOSED") {
      const typedReason = window.prompt(`${warning}\n\nDigite o motivo da exclusao:`);
      if (!typedReason?.trim()) {
        setNotice({ tone: "warning", message: "Motivo obrigatorio para excluir apuracao fechada." });
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
          ? "Apuracao excluida. Havia periodo seguinte vinculado, revise a continuidade."
          : "Apuracao excluida com AuditLog registrado."
      });
      setDeleteDialog(null);
      await load(null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao excluir apuracao." });
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
        title="Excluir apuracao de CMV?"
        tone="danger"
        confirmLabel="Excluir apuracao"
        description={deleteDialog ? (
          <div className="stack compact-stack">
            <p>
              Periodo: <strong>{formatDate(deleteDialog.period.dataInicial)} a {formatDate(deleteDialog.period.dataFinal)}</strong>
            </p>
            <p>Status: <strong>{formatStatusLabel(deleteDialog.period.status)}</strong></p>
            <p>Esta acao registra auditoria e pode afetar a continuidade se houver periodo seguinte vinculado.</p>
          </div>
        ) : null}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />

      <section className="panel">
        <SectionHeader
          eyebrow="Lista"
          title="Periodos apurados"
          actions={(
            <>
              {canEdit && (
                <Button leadingIcon={<Plus size={16} />} onClick={() => startNewPeriod()}>Nova apuracao</Button>
              )}
              <IconButton icon={<RefreshCw size={16} className={loading ? "spin" : ""} />} label="Atualizar CMV Real" onClick={() => load()} />
            </>
          )}
        />

        <div className="summary-grid dashboard-compact-grid">
          <article className="summary-card compact-summary-card">
            <div>
              <span>Apuracoes cadastradas</span>
              <strong>{periodStats.total}</strong>
              <small>Lista operacional do historico de CMV.</small>
            </div>
            <FileText className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-warning">
            <div>
              <span>Abertas</span>
              <strong>{periodStats.open}</strong>
              <small>Periodos ainda passiveis de calculo e fechamento.</small>
            </div>
            <AlertTriangle className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-success">
            <div>
              <span>Fechadas</span>
              <strong>{periodStats.closed}</strong>
              <small>Periodos concluidos e prontos para consulta.</small>
            </div>
            <CheckCircle2 className="summary-card-icon" size={20} />
          </article>
          <article className={`summary-card compact-summary-card ${periodStats.duplicates > 0 ? "tone-danger" : "tone-info"}`}>
            <div>
              <span>Duplicidades</span>
              <strong>{periodStats.duplicates}</strong>
              <small>Exigem revisao antes de consolidar a analise.</small>
            </div>
            <RefreshCw className="summary-card-icon" size={20} />
          </article>
        </div>

        {loading && <span className="muted-inline">Carregando...</span>}
        {duplicatePeriods.length > 0 && (
          <div className="alert warning compact-alert">
            <AlertTriangle className="alert-icon" size={18} />
            <div>
              <strong>Apuracao duplicada encontrada.</strong>
              <span>
                {duplicatePeriods.length} registros compartilham o mesmo periodo. Exclua a duplicada somente apos conferir a continuidade.
              </span>
            </div>
          </div>
        )}

        <div className="alert info compact-alert">
          <FileText className="alert-icon" size={18} />
          <div>
            <strong>Regra operacional do periodo.</strong>
            <span>
              O inventario final de uma apuracao vira o inventario inicial da proxima na mesma data de contagem.
              Compras e faturamento entram apenas entre as contagens: depois da data inicial e ate a data final.
            </span>
          </div>
        </div>

        <div className="form-grid subsection">
          <label>
            Codigo
            <input className="locked-field" title="Codigo gerado automaticamente pelo sistema" value={form.code || "Gerado ao salvar"} readOnly />
          </label>
          <label>
            Nome da apuracao
            <input
              value={form.name || defaultPeriodName(form.dataInicial, form.dataFinal)}
              readOnly={isClosedSelected}
              className={isClosedSelected ? "locked-field" : undefined}
              title={isClosedSelected ? "Nome bloqueado em apuracoes fechadas" : "Nome da apuracao"}
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
              title={isClosedSelected ? "Data bloqueada em apuracoes fechadas" : form.dataInicial}
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
                  setForm((f) => ({ ...f, estoqueInicialSnapshotId: val.slice(9), estoqueInicialSessionId: "" }));
                } else {
                  setForm((f) => ({ ...f, estoqueInicialSessionId: val, estoqueInicialSnapshotId: "" }));
                }
              }}
            >
              <option value="">Selecionar estoque</option>
              {cmvBases.map((base) => {
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
                  setForm((f) => ({ ...f, estoqueFinalSnapshotId: val.slice(9), estoqueFinalSessionId: "" }));
                  setFinalSessionCoverage(null);
                } else {
                  setForm((f) => ({ ...f, estoqueFinalSessionId: val, estoqueFinalSnapshotId: "" }));
                  checkFinalSessionCoverage(val);
                }
              }}
            >
              <option value="">Selecionar estoque</option>
              {cmvBases.map((base) => {
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
            Observacoes
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
                A sugestao usa a data e o inventario final do ultimo periodo como ponto de partida, mas voce pode ajustar os campos desta nova apuracao conforme a operacao real.
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
              <strong>Apuracao fechada em modo de consulta.</strong>
              <span>
                Para alterar dados desta apuracao, primeiro reabra o periodo. Enquanto estiver fechada, os campos ficam somente para leitura.
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
              <Save size={16} /> {selectedId ? "Atualizar apuracao" : "Criar apuracao"}
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

      <div className="cmv-workspace-grid">
        <section className="panel">
          <SectionHeader eyebrow="Resumo" title="Apuracoes cadastradas" />

          <div className="table-wrap subsection cmv-desktop-table operational-table">
            <table>
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Codigo</th>
                  <th className="numeric-cell">Estoque inicial</th>
                  <th className="numeric-cell">Compras</th>
                  <th className="numeric-cell">Estoque final</th>
                  <th className="numeric-cell">CMV real</th>
                  <th className="numeric-cell">Faturamento</th>
                  <th className="numeric-cell">CMV %</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id} className={period.id === selectedId ? "selected-row" : ""}>
                    <td className="cmv-period-cell" title={`${formatDate(period.dataInicial)} - ${formatDate(period.dataFinal)}`}>
                      <strong>{formatDate(period.dataInicial)} - {formatDate(period.dataFinal)}</strong>
                      <small>{period.name}</small>
                      {duplicatePeriodKeys.has(periodKey(period)) && <span className="status-pill warning">Duplicada</span>}
                      {hasInconsistentBases(period) && <span className="status-pill warning">Bases inconsistentes</span>}
                    </td>
                    <td className="nowrap-cell">{period.code ?? "-"}</td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.estoqueInicialTotal} /></td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.comprasTotal} /></td>
                    <td className="numeric-cell nowrap-cell"><Money value={period.estoqueFinalTotal} /></td>
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
                          <button className="danger-icon-button" type="button" title="Excluir apuracao" onClick={() => handleDelete(period)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {periods.length === 0 && <EmptyTableRow colSpan={10} message="Nenhuma apuracao cadastrada." />}
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
            {periods.length === 0 && <div className="alert warning">Nenhuma apuracao cadastrada.</div>}
          </div>
        </section>

        {selectedPeriod && (
          <section className="panel scroll-target" ref={detailRef}>
            <SectionHeader eyebrow="Detalhe" title={selectedPeriod.name} />
            {periodConsistency?.hasIssue ? (
              <div className="alert warning compact-alert subsection">
                <AlertTriangle className="alert-icon" size={18} />
                <div>
                  <strong>Periodo com continuidade inconsistente.</strong>
                  <span>
                    {periodConsistency.initialAfterFinal
                      ? "A base inicial esta com data posterior a base final."
                      : "As datas das bases de estoque nao batem com a janela do periodo."} Revise este CMV antes do fechamento.
                  </span>
                </div>
              </div>
            ) : null}
            <div className="summary-grid dashboard-compact-grid cmv-detail-grid">
              <MetricCard label="Codigo" value={selectedPeriod.code ?? "-"} />
              <MetricCard label="Periodo" value={`${formatDate(selectedPeriod.dataInicial)} a ${formatDate(selectedPeriod.dataFinal)}`} />
              <MetricCard
                label="Movimentos considerados"
                value={`${formatDate(nextDateKey(selectedPeriod.dataInicial))} a ${formatDate(selectedPeriod.dataFinal)}`}
                detail="Compras e faturamento entre as contagens"
              />
              <MetricCard label="Status" value={<StatusBadge status={selectedPeriod.status} />} />
              <MetricCard label="CMV %" value={formatPercent(selectedPeriod.cmvPercentual)} className={`cmv-highlight-card ${cmvHealth.tone}`} detail={cmvHealth.label} />
              <MetricCard label="Margem bruta" value={<Money value={selectedPeriod.margemBruta} />} className="cmv-highlight-card tone-info" />
              <MetricCard label="Estoque inicial" value={<Money value={selectedPeriod.estoqueInicialTotal} />} />
              <MetricCard label="Compras" value={<Money value={selectedPeriod.comprasTotal} />} />
              <MetricCard label="Estoque final" value={<Money value={selectedPeriod.estoqueFinalTotal} />} />
              <MetricCard label="CMV real" value={<Money value={selectedPeriod.cmvReal} />} />
              <MetricCard label="Faturamento" value={<Money value={selectedPeriod.faturamentoTotal} />} />
            </div>

            <div className="subsection">
              <h3>Rastreabilidade</h3>
              <div className="summary-grid dashboard-compact-grid financial-summary cmv-detail-grid">
                <MetricCard
                  label="Base inicial"
                  value={selectedPeriod.estoqueInicialSessionCode ?? "Inventario oficial"}
                  detail={selectedPeriod.estoqueInicialSnapshotData ? `Data da contagem: ${formatDate(selectedPeriod.estoqueInicialSnapshotData)}` : undefined}
                />
                <MetricCard
                  label="Base final"
                  value={selectedPeriod.estoqueFinalSessionCode ?? "Inventario oficial"}
                  detail={selectedPeriod.estoqueFinalSnapshotData ? `Data da contagem: ${formatDate(selectedPeriod.estoqueFinalSnapshotData)}` : undefined}
                />
                <MetricCard
                  label="Fechado por"
                  value={selectedPeriod.fechadoPorNome ?? "-"}
                  detail={formatDateTime(selectedPeriod.fechadoEm)}
                />
                <MetricCard
                  label="Reaberto por"
                  value={selectedPeriod.reabertoPorNome ?? "-"}
                  detail={formatDateTime(selectedPeriod.reabertoEm)}
                />
                <MetricCard label="Motivo da reabertura" value={selectedPeriod.motivoReabertura ?? "-"} />
              </div>
            </div>

            <div className="subsection">
              <h3>Visoes do calculo</h3>
              <div className="summary-grid dashboard-compact-grid financial-summary cmv-detail-grid">
                <MetricCard label="CMV atual" value={<Money value={selectedPeriod.views.accounting.cmvReal} />} detail={selectedPeriod.views.accounting.label} className="cmv-highlight-card tone-info" />
                <MetricCard label="Compras atuais" value={<Money value={selectedPeriod.views.accounting.comprasTotal} />} />
                <MetricCard label="CMV % atual" value={formatPercent(selectedPeriod.views.accounting.cmvPercentual)} />
                <MetricCard label="CMV gerencial" value={<Money value={selectedPeriod.views.managerial.cmvReal} />} detail={selectedPeriod.views.managerial.label} className="cmv-highlight-card tone-success" />
                <MetricCard label="Compras gerenciais" value={<Money value={selectedPeriod.views.managerial.comprasTotal} />} />
                <MetricCard label="CMV % gerencial" value={formatPercent(selectedPeriod.views.managerial.cmvPercentual)} />
              </div>
            </div>

            <div className="subsection">
              <h3>Memoria de calculo (visao atual)</h3>
              <div className="summary-grid dashboard-compact-grid financial-summary cmv-detail-grid">
                <MetricCard label="Formula" value="Estoque inicial + Compras - Estoque final" />
                <MetricCard
                  label="Aplicacao"
                  value={<><Money value={selectedPeriod.estoqueInicialTotal} /> + <Money value={selectedPeriod.comprasTotal} /> - <Money value={selectedPeriod.estoqueFinalTotal} /></>}
                />
                <MetricCard label="Resultado" value={<Money value={selectedPeriod.cmvReal} />} />
                <MetricCard label="CMV %" value={formatPercent(selectedPeriod.cmvPercentual)} detail={cmvHealth.label} />
                <MetricCard label="Faturamento liquido" value={<Money value={selectedPeriod.faturamentoTotal} />} />
                <MetricCard label="Compras consideradas" value={<Money value={detail?.purchasesGrossTotal ?? selectedPeriod.comprasTotal} />} detail={`${detail?.purchasesCount ?? 0} compras`} />
                <MetricCard label="Dias com faturamento" value={detail?.revenueDaysCount ?? 0} />
                <MetricCard label="Receita bruta" value={<Money value={detail?.revenueGrossTotal ?? 0} />} />
                <MetricCard label="Servico" value={<Money value={detail?.revenueServiceTotal ?? 0} />} />
                <MetricCard label="Receita liquida" value={<Money value={detail?.revenueNetTotal ?? selectedPeriod.faturamentoTotal} />} />
                <MetricCard label="Inventario inicial" value={selectedPeriod.estoqueInicialSnapshotData ? formatDate(selectedPeriod.estoqueInicialSnapshotData) : "-"} />
                <MetricCard label="Inventario final" value={selectedPeriod.estoqueFinalSnapshotData ? formatDate(selectedPeriod.estoqueFinalSnapshotData) : "-"} />
              </div>
            </div>

            <div className="subsection">
              <h3>Memoria de calculo (visao gerencial)</h3>
              <div className="summary-grid dashboard-compact-grid financial-summary cmv-detail-grid">
                <MetricCard label="Formula" value="Estoque inicial + Compras - Estoque final" />
                <MetricCard
                  label="Aplicacao"
                  value={<><Money value={selectedPeriod.views.managerial.estoqueInicialTotal} /> + <Money value={selectedPeriod.views.managerial.comprasTotal} /> - <Money value={selectedPeriod.views.managerial.estoqueFinalTotal} /></>}
                />
                <MetricCard label="Resultado" value={<Money value={selectedPeriod.views.managerial.cmvReal} />} />
                <MetricCard label="CMV %" value={formatPercent(selectedPeriod.views.managerial.cmvPercentual)} />
                <MetricCard label="Faturamento liquido" value={<Money value={selectedPeriod.views.managerial.faturamentoTotal} />} />
                <MetricCard label="Compras consideradas" value={<Money value={detail?.viewDetails.managerial.purchasesGrossTotal ?? selectedPeriod.views.managerial.comprasTotal} />} detail={`${detail?.viewDetails.managerial.purchasesCount ?? 0} compras`} />
              </div>
            </div>

            <div className="subsection">
              <h3>Compras por categoria</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th>Rank</th><th>Categoria</th><th className="numeric-cell">Itens</th><th className="numeric-cell">Participacao</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseByCategory.map((row, index) => (
                      <tr key={row.categoryName} className={index < 3 ? "ranking-row" : ""}>
                        <td>{index + 1}</td>
                        <td title={row.categoryName}>{row.categoryName}</td>
                        <td className="numeric-cell">{row.itemsCount}</td>
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
              <h3>Compras por categoria (visao gerencial)</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th>Rank</th><th>Categoria</th><th className="numeric-cell">Itens</th><th className="numeric-cell">Participacao</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.viewDetails.managerial.purchaseByCategory.map((row, index) => (
                      <tr key={`${row.categoryName}-managerial`} className={index < 3 ? "ranking-row" : ""}>
                        <td>{index + 1}</td>
                        <td title={row.categoryName}>{row.categoryName}</td>
                        <td className="numeric-cell">{row.itemsCount}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.viewDetails.managerial.purchasesGrossTotal ?? 0, row.totalAmount)}</td>
                        <td className="numeric-cell nowrap-cell"><Money value={row.totalAmount} /></td>
                      </tr>
                    )) ?? null}
                    {(detail?.viewDetails.managerial.purchaseByCategory.length ?? 0) === 0 && <EmptyTableRow colSpan={5} message="Sem dados." />}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="subsection">
              <h3>Compras por fornecedor</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th>Rank</th><th>Fornecedor</th><th>Documento</th><th className="numeric-cell">Pedidos</th><th className="numeric-cell">Participacao</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseBySupplier.map((row, index) => (
                      <tr key={row.supplierId} className={index < 3 ? "ranking-row" : ""}>
                        <td>{index + 1}</td>
                        <td title={row.supplierName}>{row.supplierName}</td>
                        <td className="nowrap-cell">{row.supplierDocument ?? "-"}</td>
                        <td className="numeric-cell">{row.purchasesCount}</td>
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
                  <thead><tr><th>Canal</th><th className="numeric-cell">Qtd.</th><th className="numeric-cell">Participacao</th><th className="numeric-cell">Bruto</th><th className="numeric-cell">Liquido</th></tr></thead>
                  <tbody>
                    {detail?.revenueByChannel.map((row, index) => (
                      <tr key={row.channel} className={index === 0 ? "ranking-row" : ""}>
                        <td>{row.channel}</td>
                        <td className="numeric-cell">{row.count}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.revenueNetTotal ?? 0, row.netAmount)}</td>
                        <td className="numeric-cell nowrap-cell"><Money value={row.grossAmount} /></td>
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
