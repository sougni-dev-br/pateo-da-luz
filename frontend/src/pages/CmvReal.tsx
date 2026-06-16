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
  getCmvRealSuggestions,
  getMonthlyInventories,
  InventorySnapshot,
  reopenCmvPeriod,
  saveCmvPeriod
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { ConfirmDialog } from "../components/ui";
import { hasPermission } from "../lib/permissions";
import { formatCurrency, formatDate } from "../utils/format";

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function snapshotLabel(snapshot: InventorySnapshot) {
  const typeLabel = snapshot.type === "INVENTARIO_INICIAL"
    ? "Inventário inicial"
    : snapshot.type === "INVENTARIO_FINAL"
      ? "Inventário final"
      : snapshot.type;
  return `${formatDate(snapshot.countDate)} • ${typeLabel} • ${snapshot.originalFileName ?? "arquivo"}`;
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

function statusToneClass(status: string) {
  if (status === "CLOSED") return "tone-neutral";
  if (status === "OPEN") return "open";
  return "tone-info";
}

function classifyCmv(percentual: number | null | undefined) {
  if (percentual == null) return { label: "Sem cálculo", tone: "tone-neutral" };
  if (percentual <= 0.3) return { label: "Bom", tone: "tone-success" };
  if (percentual <= 0.35) return { label: "Atenção", tone: "tone-warning" };
  return { label: "Crítico", tone: "tone-danger" };
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function percentageOf(total: number, amount: number) {
  if (!total) return "-";
  return `${((amount / total) * 100).toFixed(1)}%`;
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
  return <span className={`status-badge ${statusToneClass(status)}`}>{formatStatusLabel(status)}</span>;
}

function EmptyTableRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-table-state">{message}</td>
    </tr>
  );
}

function CmvPeriodMobileCard({
  period,
  isSelected,
  isDuplicate,
  isAdmin,
  onOpen,
  onPdf,
  onDelete
}: {
  period: CmvPeriod;
  isSelected: boolean;
  isDuplicate: boolean;
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
      <div className="cmv-mobile-row">
        <span>Estoque inicial</span>
        <span>{formatCurrency(period.estoqueInicialTotal)}</span>
      </div>
      <div className="cmv-mobile-row">
        <span>Compras</span>
        <span>{formatCurrency(period.comprasTotal)}</span>
      </div>
      <div className="cmv-mobile-row">
        <span>Estoque final</span>
        <span>{formatCurrency(period.estoqueFinalTotal)}</span>
      </div>
      <div className="cmv-mobile-row">
        <span>CMV real</span>
        <strong>{formatCurrency(period.cmvReal)}</strong>
      </div>
      <div className="cmv-mobile-row">
        <span>Faturamento</span>
        <span>{formatCurrency(period.faturamentoTotal)}</span>
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
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [suggestions, setSuggestions] = useState<CmvRealSuggestions | null>(null);
  const [continuityLocked, setContinuityLocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CmvPeriodDetail | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ period: CmvPeriod; reason: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    dataInicial: todayInput(),
    dataFinal: todayInput(),
    estoqueInicialSnapshotId: "",
    estoqueFinalSnapshotId: "",
    observacoes: ""
  });
  const { notice, setNotice } = useNotice();

  const selectedPeriod = useMemo(
    () => detail ?? periods.find((period) => period.id === selectedId) ?? null,
    [detail, periods, selectedId]
  );

  const cmvHealth = useMemo(() => classifyCmv(selectedPeriod?.cmvPercentual), [selectedPeriod?.cmvPercentual]);

  const snapshotOptions = useMemo(
    () => inventorySnapshots
      .filter((snapshot) => snapshot.status !== "CANCELLED")
      .sort((left, right) => String(right.countDate).localeCompare(String(left.countDate))),
    [inventorySnapshots]
  );

  const snapshotLabels = useMemo(() => {
    const labels = new Map<string, string>();
    snapshotOptions.forEach((snapshot) => labels.set(snapshot.id, snapshotLabel(snapshot)));
    return labels;
  }, [snapshotOptions]);

  const selectedInitialSnapshotLabel = snapshotLabels.get(form.estoqueInicialSnapshotId) ?? "";
  const selectedFinalSnapshotLabel = snapshotLabels.get(form.estoqueFinalSnapshotId) ?? "";

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

  const applyPeriodToForm = useCallback((period: Pick<CmvPeriod, "name" | "code" | "dataInicial" | "dataFinal" | "estoqueInicialSnapshotId" | "estoqueFinalSnapshotId" | "observacoes">) => {
    setForm({
      name: period.name,
      code: period.code ?? "",
      dataInicial: period.dataInicial,
      dataFinal: period.dataFinal,
      estoqueInicialSnapshotId: period.estoqueInicialSnapshotId ?? "",
      estoqueFinalSnapshotId: period.estoqueFinalSnapshotId ?? "",
      observacoes: period.observacoes ?? ""
    });
  }, []);

  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;

  const startNewPeriod = useCallback((nextSuggestions: CmvRealSuggestions | null = suggestionsRef.current) => {
    const startDate = nextSuggestions?.suggestedStartDate ?? todayInput();
    setSelectedId(null);
    setDetail(null);
    setContinuityLocked(Boolean(nextSuggestions?.continuityLocked));
    setForm({
      name: defaultPeriodName(startDate, startDate),
      code: "",
      dataInicial: startDate,
      dataFinal: startDate,
      estoqueInicialSnapshotId: nextSuggestions?.suggestedInitialSnapshotId ?? "",
      estoqueFinalSnapshotId: "",
      observacoes: ""
    });
  }, []);

  const load = useCallback(async (nextSelectedId: string | null = selectedId) => {
    setLoading(true);
    try {
      const [periodList, snapshots, nextSuggestions] = await Promise.all([
        getCmvPeriods(),
        getMonthlyInventories({}),
        getCmvRealSuggestions()
      ]);
      setPeriods(periodList);
      setInventorySnapshots(snapshots);
      setSuggestions(nextSuggestions);
      if (nextSelectedId) {
        const selected = await getCmvPeriod(nextSelectedId);
        setSelectedId(nextSelectedId);
        rememberCmvPeriod(selected);
        setDetail(selected);
        setContinuityLocked(false);
        applyPeriodToForm(selected);
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
  }, [applyPeriodToForm, selectedId, setNotice, startNewPeriod]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function handleSave() {
    if (!canEdit) return;
    if (!form.estoqueInicialSnapshotId || !form.estoqueFinalSnapshotId) {
      setNotice({ tone: "warning", message: "Selecione os inventários inicial e final." });
      return;
    }
    setSaving(true);
    try {
      let continuityOverrideReason: string | null = null;
      const changingSuggestedContinuity = !selectedId
        && suggestions?.continuityLocked
        && (form.dataInicial !== suggestions.suggestedStartDate || form.estoqueInicialSnapshotId !== (suggestions.suggestedInitialSnapshotId ?? ""));
      if (isAdmin && changingSuggestedContinuity) {
        const reason = window.prompt("Informe o motivo para alterar a continuidade da apuração:");
        if (!reason?.trim()) {
          setNotice({ tone: "warning", message: "Motivo obrigatório para alterar a continuidade." });
          return;
        }
        continuityOverrideReason = reason.trim();
      }
      const saved = await saveCmvPeriod({
        id: selectedId ?? undefined,
        name: form.name.trim() || defaultPeriodName(form.dataInicial, form.dataFinal),
        dataInicial: form.dataInicial,
        dataFinal: form.dataFinal,
        estoqueInicialSnapshotId: form.estoqueInicialSnapshotId,
        estoqueFinalSnapshotId: form.estoqueFinalSnapshotId,
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
      ? "Esta apuração está fechada. A exclusão exige motivo e pode afetar o encadeamento com o próximo período."
      : "A exclusão pode afetar o encadeamento com o próximo período se houver apuração vinculada.";
    let reason: string | null = isDuplicate ? "Exclusão de apuração duplicada" : null;
    if (period.status === "CLOSED") {
      const typedReason = window.prompt(`${warning}\n\nDigite o motivo da exclusão:`);
      if (!typedReason?.trim()) {
        setNotice({ tone: "warning", message: "Motivo obrigatório para excluir apuração fechada." });
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
          ? "Apuração excluída. Havia período seguinte vinculado, revise a continuidade."
          : "Apuração excluída com AuditLog registrado."
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
            <p>Esta ação registra auditoria e pode afetar a continuidade se houver período seguinte vinculado.</p>
          </div>
        ) : null}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />

      <section className="panel">
        <SectionHeader
          eyebrow="Gestão operacional"
          title="CMV Real"
          actions={(
            <>
              {canEdit && (
                <button className="primary-button" type="button" onClick={() => startNewPeriod()}>
                  <Plus size={16} /> Nova apuração
                </button>
              )}
              <button className="icon-button" type="button" onClick={() => load()} aria-label="Atualizar CMV Real">
                <RefreshCw size={18} className={loading ? "spin" : ""} />
              </button>
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
              <small>Períodos ainda passíveis de cálculo e fechamento.</small>
            </div>
            <AlertTriangle className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-success">
            <div>
              <span>Fechadas</span>
              <strong>{periodStats.closed}</strong>
              <small>Períodos concluídos e prontos para consulta.</small>
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
                {duplicatePeriods.length} registros compartilham o mesmo período. Exclua a duplicada somente após conferir a continuidade.
              </span>
            </div>
          </div>
        )}

        <div className="form-grid subsection">
          <label>
            Código
            <input className="locked-field" title="Código gerado automaticamente pelo sistema" value={form.code || "Gerado ao salvar"} readOnly />
          </label>
          <label>
            Nome da apuração
            <input className="locked-field" title="Nome gerado automaticamente pelo período" value={form.name || defaultPeriodName(form.dataInicial, form.dataFinal)} readOnly />
          </label>
          <label>
            Data inicial
            <input
              className={!selectedId && continuityLocked && !isAdmin ? "locked-field" : undefined}
              type="date"
              value={form.dataInicial}
              disabled={!selectedId && continuityLocked && !isAdmin}
              title={!selectedId && continuityLocked ? "Data herdada da última apuração fechada/cadastrada" : form.dataInicial}
              onChange={(event) => setForm((current) => ({ ...current, dataInicial: event.target.value, name: defaultPeriodName(event.target.value, current.dataFinal) }))}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={form.dataFinal}
              onChange={(event) => setForm((current) => ({ ...current, dataFinal: event.target.value, name: defaultPeriodName(current.dataInicial, event.target.value) }))}
            />
          </label>
          <label>
            Inventário inicial
            <select
              className={!selectedId && continuityLocked && !isAdmin ? "locked-field" : undefined}
              value={form.estoqueInicialSnapshotId}
              disabled={!selectedId && continuityLocked && !isAdmin}
              title={selectedInitialSnapshotLabel || "Selecionar"}
              onChange={(event) => setForm({ ...form, estoqueInicialSnapshotId: event.target.value })}
            >
              <option value="">Selecionar</option>
              {snapshotOptions.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id} title={snapshotLabel(snapshot)}>
                  {snapshotLabel(snapshot)}
                </option>
              ))}
            </select>
            {selectedInitialSnapshotLabel && <small className="selected-field-label" title={selectedInitialSnapshotLabel}>{selectedInitialSnapshotLabel}</small>}
          </label>
          <label>
            Inventário final
            <select value={form.estoqueFinalSnapshotId} title={selectedFinalSnapshotLabel || "Selecionar"} onChange={(event) => setForm({ ...form, estoqueFinalSnapshotId: event.target.value })}>
              <option value="">Selecionar</option>
              {snapshotOptions.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id} title={snapshotLabel(snapshot)}>
                  {snapshotLabel(snapshot)}
                </option>
              ))}
            </select>
            {selectedFinalSnapshotLabel && <small className="selected-field-label" title={selectedFinalSnapshotLabel}>{selectedFinalSnapshotLabel}</small>}
          </label>
          <label className="full-width">
            Observações
            <input title={form.observacoes} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} />
          </label>
        </div>

        {!selectedId && continuityLocked && suggestions?.latestPeriod && (
          <p className="muted-inline subsection compact-note">
            Próxima apuração sugerida: {formatDate(suggestions.suggestedStartDate)}. O inventário final do período anterior será usado como inventário inicial quando aplicável.
          </p>
        )}

        {canEdit && (
          <div className="actions-cell subsection wrap">
            <button className="primary-button" type="button" onClick={handleSave} disabled={saving}>
              <Save size={16} /> {selectedId ? "Atualizar apuração" : "Criar apuração"}
            </button>
            <button className="secondary-button" type="button" onClick={handleCalculate} disabled={!selectedId}>
              <FileText size={16} /> Calcular
            </button>
            <button className="secondary-button" type="button" onClick={handleClose} disabled={!selectedId}>
              <CheckCircle2 size={16} /> Fechar
            </button>
            {isAdmin && (
              <button className="secondary-button" type="button" onClick={handleReopen} disabled={!selectedId}>
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
          <SectionHeader eyebrow="Resumo" title="Apurações cadastradas" />

          <div className="table-wrap subsection cmv-desktop-table operational-table">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Código</th>
                  <th className="numeric-cell">Estoque inicial</th>
                  <th className="numeric-cell">Compras</th>
                  <th className="numeric-cell">Estoque final</th>
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
                      <small>{period.name}</small>
                      {duplicatePeriodKeys.has(periodKey(period)) && <span className="status-pill warning">Duplicada</span>}
                    </td>
                    <td className="nowrap-cell">{period.code ?? "-"}</td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(period.estoqueInicialTotal)}</td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(period.comprasTotal)}</td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(period.estoqueFinalTotal)}</td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(period.cmvReal)}</td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(period.faturamentoTotal)}</td>
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
                {periods.length === 0 && <EmptyTableRow colSpan={10} message="Nenhuma apuração cadastrada." />}
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
                isAdmin={isAdmin}
                onOpen={openPeriod}
                onPdf={(row) => handlePdf(row.id)}
                onDelete={handleDelete}
              />
            ))}
            {periods.length === 0 && <div className="alert warning">Nenhuma apuração cadastrada.</div>}
          </div>
        </section>

        {selectedPeriod && (
          <section className="panel">
            <SectionHeader eyebrow="Detalhe" title={selectedPeriod.name} />
            <div className="summary-grid dashboard-compact-grid cmv-detail-grid">
              <MetricCard label="Código" value={selectedPeriod.code ?? "-"} />
              <MetricCard label="Período" value={`${formatDate(selectedPeriod.dataInicial)} a ${formatDate(selectedPeriod.dataFinal)}`} />
              <MetricCard label="Status" value={<StatusBadge status={selectedPeriod.status} />} />
              <MetricCard label="CMV %" value={formatPercent(selectedPeriod.cmvPercentual)} className={`cmv-highlight-card ${cmvHealth.tone}`} detail={cmvHealth.label} />
              <MetricCard label="Margem bruta" value={selectedPeriod.margemBruta == null ? "-" : formatCurrency(selectedPeriod.margemBruta)} className="cmv-highlight-card tone-info" />
              <MetricCard label="Estoque inicial" value={formatCurrency(selectedPeriod.estoqueInicialTotal)} />
              <MetricCard label="Compras" value={formatCurrency(selectedPeriod.comprasTotal)} />
              <MetricCard label="Estoque final" value={formatCurrency(selectedPeriod.estoqueFinalTotal)} />
              <MetricCard label="CMV real" value={formatCurrency(selectedPeriod.cmvReal)} />
              <MetricCard label="Faturamento" value={formatCurrency(selectedPeriod.faturamentoTotal)} />
            </div>

            <div className="subsection">
              <h3>Memória de cálculo</h3>
              <div className="summary-grid dashboard-compact-grid financial-summary cmv-detail-grid">
                <MetricCard label="Fórmula" value="Estoque inicial + Compras - Estoque final" />
                <MetricCard
                  label="Aplicação"
                  value={`${formatCurrency(selectedPeriod.estoqueInicialTotal)} + ${formatCurrency(selectedPeriod.comprasTotal)} - ${formatCurrency(selectedPeriod.estoqueFinalTotal)}`}
                />
                <MetricCard label="Resultado" value={formatCurrency(selectedPeriod.cmvReal)} />
                <MetricCard label="CMV %" value={formatPercent(selectedPeriod.cmvPercentual)} detail={cmvHealth.label} />
                <MetricCard label="Faturamento líquido" value={formatCurrency(selectedPeriod.faturamentoTotal)} />
                <MetricCard label="Compras consideradas" value={formatCurrency(detail?.purchasesGrossTotal ?? selectedPeriod.comprasTotal)} detail={`${detail?.purchasesCount ?? 0} compras`} />
                <MetricCard label="Dias com faturamento" value={detail?.revenueDaysCount ?? 0} />
                <MetricCard label="Receita bruta" value={formatCurrency(detail?.revenueGrossTotal ?? 0)} />
                <MetricCard label="Serviço" value={formatCurrency(detail?.revenueServiceTotal ?? 0)} />
                <MetricCard label="Receita líquida" value={formatCurrency(detail?.revenueNetTotal ?? selectedPeriod.faturamentoTotal)} />
                <MetricCard label="Inventário inicial" value={selectedPeriod.estoqueInicialSnapshotData ? formatDate(selectedPeriod.estoqueInicialSnapshotData) : "-"} />
                <MetricCard label="Inventário final" value={selectedPeriod.estoqueFinalSnapshotData ? formatDate(selectedPeriod.estoqueFinalSnapshotData) : "-"} />
              </div>
            </div>

            <div className="subsection">
              <h3>Compras por categoria</h3>
              <div className="table-wrap operational-table cmv-analysis-table">
                <table>
                  <thead><tr><th>Rank</th><th>Categoria</th><th className="numeric-cell">Itens</th><th className="numeric-cell">Participação</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseByCategory.map((row, index) => (
                      <tr key={row.categoryName} className={index < 3 ? "ranking-row" : ""}>
                        <td>{index + 1}</td>
                        <td title={row.categoryName}>{row.categoryName}</td>
                        <td className="numeric-cell">{row.itemsCount}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.purchasesGrossTotal ?? 0, row.totalAmount)}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(row.totalAmount)}</td>
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
                  <thead><tr><th>Rank</th><th>Fornecedor</th><th>Documento</th><th className="numeric-cell">Pedidos</th><th className="numeric-cell">Participação</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>
                    {detail?.purchaseBySupplier.map((row, index) => (
                      <tr key={row.supplierId} className={index < 3 ? "ranking-row" : ""}>
                        <td>{index + 1}</td>
                        <td title={row.supplierName}>{row.supplierName}</td>
                        <td className="nowrap-cell">{row.supplierDocument ?? "-"}</td>
                        <td className="numeric-cell">{row.purchasesCount}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.purchasesGrossTotal ?? 0, row.totalAmount)}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(row.totalAmount)}</td>
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
                  <thead><tr><th>Canal</th><th className="numeric-cell">Qtd.</th><th className="numeric-cell">Participação</th><th className="numeric-cell">Bruto</th><th className="numeric-cell">Líquido</th></tr></thead>
                  <tbody>
                    {detail?.revenueByChannel.map((row, index) => (
                      <tr key={row.channel} className={index === 0 ? "ranking-row" : ""}>
                        <td>{row.channel}</td>
                        <td className="numeric-cell">{row.count}</td>
                        <td className="numeric-cell nowrap-cell">{percentageOf(detail?.revenueNetTotal ?? 0, row.netAmount)}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(row.grossAmount)}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(row.netAmount)}</td>
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
