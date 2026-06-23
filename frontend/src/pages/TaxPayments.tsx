import { Copy, Plus, Search, Upload, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type AppUser,
  type TaxImportPreview,
  type TaxPayment,
  type TaxPaymentDetail,
  type TaxPaymentFilters,
  type TaxPaymentStatus,
  type TaxPaymentSummary,
  confirmTaxImport,
  createTaxPayment,
  deleteTaxPayment,
  getTaxPayment,
  getTaxPayments,
  previewTaxImportXlsx,
  updateTaxPayment,
} from "../api/client";
import { Notice, type NoticeState, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";

const DOCUMENT_TYPES = [
  "FGTS", "GPS / INSS", "DARF", "DARF IR", "IRRF", "Simples Nacional / DAS", "DASN",
  "DARE", "DARE-SP", "GARE ICMS", "GARE ISS", "TFE", "IPTU", "ISS",
  "Parcelamento Tributário", "Outros",
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  OVERDUE: "Vencido",
  CANCELED: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#f59e0b",
  PAID: "#22c55e",
  OVERDUE: "#ef4444",
  CANCELED: "#94a3b8",
};

function formatCurrency(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return cnpj;
}

function computeEffectiveStatus(tp: TaxPayment): string {
  if (tp.paymentDate) return "PAID";
  if (new Date(tp.dueDate) < new Date() && tp.status !== "CANCELED") return "OVERDUE";
  return tp.status;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="kpi-card" style={{ borderTop: color ? `3px solid ${color}` : undefined }}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="status-badge"
      style={{
        background: `${STATUS_COLORS[status] ?? "#94a3b8"}22`,
        color: STATUS_COLORS[status] ?? "#94a3b8",
        border: `1px solid ${STATUS_COLORS[status] ?? "#94a3b8"}44`,
        borderRadius: "4px",
        padding: "2px 8px",
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─── Modal de importação XLSX ─────────────────────────────────────────────────
type ImportModalProps = {
  onClose: () => void;
  onImported: () => void;
  notify: React.Dispatch<React.SetStateAction<NoticeState | null>>;
};

function ImportModal({ onClose, onImported, notify }: ImportModalProps) {
  const [preview, setPreview] = useState<TaxImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    try {
      const p = await previewTaxImportXlsx(file);
      setPreview(p);
    } catch (err) {
      notify({ tone: "error", message: err instanceof Error ? err.message : "Erro ao processar arquivo." });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      const result = await confirmTaxImport(preview.filePath, skipDuplicates);
      notify({ tone: "success", message: `${result.imported} lançamentos importados com sucesso.` });
      onImported();
      onClose();
    } catch (err) {
      notify({ tone: "error", message: err instanceof Error ? err.message : "Erro ao confirmar importação." });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 680, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importar XLSX</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {!preview && (
          <div className="modal-body stack">
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              Selecione a planilha XLSX com as abas <strong>Empresas</strong> e <strong>Impostos</strong>.
              Campos esperados: CNPJ, RAZÃO SOCIAL, NOME FANTASIA, ÓRGÃO / DOCUMENTO, DESCRIÇÃO,
              COMPETENCIA, VENCIMENTO, VALOR, DATA PAGAMENTO, COMENTÁRIOS.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
            <button
              type="button"
              className="primary-button"
              disabled={loading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={16} />
              {loading ? "Processando..." : "Selecionar arquivo"}
            </button>
          </div>
        )}

        {preview && (
          <div className="modal-body stack">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <KpiCard label="Total de linhas" value={String(preview.totalRows)} />
              <KpiCard label="Válidas" value={String(preview.validRows)} color="#22c55e" />
              <KpiCard label="Inválidas" value={String(preview.invalidRows)} color="#ef4444" />
              <KpiCard label="Duplicadas" value={String(preview.duplicateRows)} color="#f59e0b" />
              <KpiCard label="Pendentes" value={String(preview.pendingRows)} />
              <KpiCard label="Pagas" value={String(preview.paidRows)} color="#22c55e" />
            </div>

            {Object.keys(preview.byDocumentType).length > 0 && (
              <div>
                <strong style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>POR TIPO</strong>
                <table className="data-table" style={{ marginTop: 4 }}>
                  <thead><tr><th>Tipo</th><th>Qtd</th><th>Total</th></tr></thead>
                  <tbody>
                    {Object.entries(preview.byDocumentType).map(([dt, info]) => (
                      <tr key={dt}>
                        <td>{dt}</td>
                        <td>{info.count}</td>
                        <td>{formatCurrency(info.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.invalidRows > 0 && (
              <div>
                <strong style={{ fontSize: "0.8rem", color: "#ef4444" }}>LINHAS INVÁLIDAS</strong>
                <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
                  {preview.rows.filter((r) => !r.valid).map((r) => (
                    <div key={r.rowIndex} style={{ fontSize: "0.8rem", padding: "2px 0", color: "#ef4444" }}>
                      Linha {r.rowIndex}: {r.errors.join("; ")}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="pnova-chip-check" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              <span>Ignorar duplicadas ({preview.duplicateRows})</span>
            </label>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="secondary-button" onClick={() => setPreview(null)}>Voltar</button>
              <button
                type="button"
                className="primary-button"
                disabled={confirming || preview.validRows === 0}
                onClick={() => void handleConfirm()}
              >
                {confirming ? "Importando..." : `Importar ${skipDuplicates ? preview.validRows - preview.duplicateRows : preview.validRows} registros`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal de criar / editar ──────────────────────────────────────────────────
type FormData = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  documentType: string;
  description: string;
  competenceDate: string;
  dueDate: string;
  amount: string;
  paymentDate: string;
  paidAmount: string;
  comments: string;
  dreCategoryId: string;
  status: string;
};

const EMPTY_FORM: FormData = {
  cnpj: "", legalName: "", tradeName: "", documentType: "", description: "",
  competenceDate: "", dueDate: "", amount: "", paymentDate: "", paidAmount: "",
  comments: "", dreCategoryId: "", status: "PENDING",
};

type EditModalProps = {
  editId: string | null;
  prefillData?: Partial<FormData>;
  onClose: () => void;
  onSaved: () => void;
  notify: React.Dispatch<React.SetStateAction<NoticeState | null>>;
  canEdit: boolean;
};

function EditModal({ editId, prefillData, onClose, onSaved, notify, canEdit }: EditModalProps) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<TaxPaymentDetail | null>(null);

  useEffect(() => {
    if (!editId) { setForm(prefillData ? { ...EMPTY_FORM, ...prefillData } : EMPTY_FORM); return; }
    setLoading(true);
    getTaxPayment(editId)
      .then((d) => {
        setDetail(d);
        setForm({
          cnpj: d.cnpj ?? "",
          legalName: d.legalName ?? "",
          tradeName: d.tradeName ?? "",
          documentType: d.documentType,
          description: d.description ?? "",
          competenceDate: d.competenceDate ? d.competenceDate.slice(0, 10) : "",
          dueDate: d.dueDate.slice(0, 10),
          amount: d.amount,
          paymentDate: d.paymentDate ? d.paymentDate.slice(0, 10) : "",
          paidAmount: d.paidAmount ?? "",
          comments: d.comments ?? "",
          dreCategoryId: d.dreCategoryId ?? "",
          status: d.status,
        });
      })
      .catch(() => notify({ tone: "error", message: "Erro ao carregar lançamento." }))
      .finally(() => setLoading(false));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        cnpj: form.cnpj || null,
        legalName: form.legalName || null,
        tradeName: form.tradeName || null,
        documentType: form.documentType,
        description: form.description || null,
        competenceDate: form.competenceDate || null,
        dueDate: form.dueDate,
        amount: form.amount,
        paymentDate: form.paymentDate || null,
        paidAmount: form.paidAmount || null,
        comments: form.comments || null,
        dreCategoryId: form.dreCategoryId || null,
        status: form.status as TaxPaymentStatus,
      };
      if (editId) {
        await updateTaxPayment(editId, payload);
        notify({ tone: "success", message: "Lançamento atualizado." });
      } else {
        await createTaxPayment(payload);
        notify({ tone: "success", message: "Lançamento criado com sucesso." });
      }
      onSaved();
      onClose();
    } catch (err) {
      notify({ tone: "error", message: err instanceof Error ? err.message : "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  const f = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  if (loading) return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="modal-body"><p>Carregando...</p></div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 600, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editId ? "Editar lançamento" : prefillData ? "Copiar lançamento" : "Novo lançamento"}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={(e) => void handleSave(e)}>
          <div className="modal-body stack">
            {/* Empresa */}
            <fieldset className="pnova-fieldset">
              <legend>Empresa</legend>
              <div className="pnova-field-row">
                <label className="pnova-field">
                  <span>CNPJ</span>
                  <input type="text" value={form.cnpj} onChange={f("cnpj")} placeholder="00.000.000/0000-00" disabled={!canEdit} />
                </label>
                <label className="pnova-field" style={{ flex: 2 }}>
                  <span>Razão Social</span>
                  <input type="text" value={form.legalName} onChange={f("legalName")} disabled={!canEdit} />
                </label>
              </div>
              <label className="pnova-field">
                <span>Nome Fantasia</span>
                <input type="text" value={form.tradeName} onChange={f("tradeName")} disabled={!canEdit} />
              </label>
            </fieldset>

            {/* Documento */}
            <fieldset className="pnova-fieldset">
              <legend>Documento</legend>
              <div className="pnova-field-row">
                <label className="pnova-field" style={{ flex: 1 }}>
                  <span>Tipo *</span>
                  <select value={form.documentType} onChange={f("documentType")} required disabled={!canEdit}>
                    <option value="">Selecione...</option>
                    {DOCUMENT_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
                  </select>
                </label>
                <label className="pnova-field" style={{ flex: 1 }}>
                  <span>Status</span>
                  <select value={form.status} onChange={f("status")} disabled={!canEdit}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label className="pnova-field">
                <span>Descrição</span>
                <input type="text" value={form.description} onChange={f("description")} disabled={!canEdit} />
              </label>
            </fieldset>

            {/* Datas e valores */}
            <fieldset className="pnova-fieldset">
              <legend>Datas e Valores</legend>
              <div className="pnova-field-row">
                <label className="pnova-field">
                  <span>Competência</span>
                  <input type="date" value={form.competenceDate} onChange={f("competenceDate")} disabled={!canEdit} />
                </label>
                <label className="pnova-field">
                  <span>Vencimento *</span>
                  <input type="date" value={form.dueDate} onChange={f("dueDate")} required disabled={!canEdit} />
                </label>
                <label className="pnova-field">
                  <span>Valor *</span>
                  <input type="number" step="0.01" min="0" value={form.amount} onChange={f("amount")} required disabled={!canEdit} />
                </label>
              </div>
              <div className="pnova-field-row">
                <label className="pnova-field">
                  <span>Data pagamento</span>
                  <input type="date" value={form.paymentDate} onChange={f("paymentDate")} disabled={!canEdit} />
                </label>
                <label className="pnova-field">
                  <span>Valor pago</span>
                  <input type="number" step="0.01" min="0" value={form.paidAmount} onChange={f("paidAmount")} disabled={!canEdit} />
                </label>
              </div>
            </fieldset>

            {/* Comentários */}
            <label className="pnova-field">
              <span>Comentários</span>
              <textarea value={form.comments} onChange={f("comments")} rows={2} disabled={!canEdit} style={{ resize: "vertical" }} />
            </label>

          </div>

          {canEdit && (
            <div className="modal-footer">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Salvando..." : editId ? "Salvar" : "Criar"}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type TaxPaymentsProps = { user: AppUser };

export function TaxPayments({ user }: TaxPaymentsProps) {
  const canCreate = hasPermission(user, "tax-payments", "create");
  const canEdit = hasPermission(user, "tax-payments", "edit");
  const canDelete = hasPermission(user, "tax-payments", "delete");

  const { notice, setNotice } = useNotice(5000);
  const [data, setData] = useState<TaxPayment[]>([]);
  const [summary, setSummary] = useState<TaxPaymentSummary | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [loadingList, setLoadingList] = useState(false);

  const [filters, setFilters] = useState<TaxPaymentFilters>({ page: 1, pageSize: 50 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [dueStart, setDueStart] = useState("");
  const [dueEnd, setDueEnd] = useState("");

  const [editId, setEditId] = useState<string | null | "new">(null);
  const [copyPrefill, setCopyPrefill] = useState<Partial<FormData> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async (f: TaxPaymentFilters) => {
    setLoadingList(true);
    try {
      const res = await getTaxPayments(f);
      setData(res.data);
      setSummary(res.summary);
      setPagination(res.pagination);
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao carregar." });
    } finally {
      setLoadingList(false);
    }
  }, [setNotice]);

  useEffect(() => { void load(filters); }, [filters, load]);

  function applyFilters() {
    const f: TaxPaymentFilters = {
      search: search || undefined,
      status: statusFilter || undefined,
      documentType: docTypeFilter || undefined,
      dueStart: dueStart || undefined,
      dueEnd: dueEnd || undefined,
      page: 1,
      pageSize: 50,
    };
    setFilters(f);
  }

  function clearFilters() {
    setSearch(""); setStatusFilter(""); setDocTypeFilter(""); setDueStart(""); setDueEnd("");
    setFilters({ page: 1, pageSize: 50 });
  }

  async function handleDelete(id: string) {
    try {
      await deleteTaxPayment(id);
      setNotice({ tone: "success", message: "Lançamento removido." });
      void load(filters);
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao remover." });
    } finally {
      setDeleteConfirmId(null);
    }
  }

  async function openCopy(tp: TaxPayment) {
    try {
      const d = await getTaxPayment(tp.id);
      setCopyPrefill({
        cnpj: d.cnpj ?? "",
        legalName: d.legalName ?? "",
        tradeName: d.tradeName ?? "",
        documentType: d.documentType,
        description: d.description ?? "",
        amount: d.amount,
        comments: d.comments ?? "",
        dreCategoryId: d.dreCategoryId ?? "",
        competenceDate: "",
        dueDate: "",
        paymentDate: "",
        paidAmount: "",
        status: "PENDING",
      });
      setEditId("new");
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar lançamento para cópia." });
    }
  }

  const hasFilters = !!(search || statusFilter || docTypeFilter || dueStart || dueEnd);

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* Header */}
      <div className="section-heading">
        <div style={{ flex: 1 }}>
          <p>Financeiro</p>
          <h2>Impostos e Guias</h2>
          <span className="muted">Controle de guias, tributos e obrigações fiscais.</span>
        </div>
        {canCreate && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
            <button type="button" className="secondary-button" onClick={() => setShowImport(true)}>
              <Upload size={15} /> Importar XLSX
            </button>
            <button type="button" className="primary-button" onClick={() => setEditId("new")}>
              <Plus size={15} /> Novo lançamento
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard label="Total no período" value={formatCurrency(summary.total)} />
          <KpiCard label="Pago" value={formatCurrency(summary.paid)} color={STATUS_COLORS.PAID} />
          <KpiCard label="Pendente" value={formatCurrency(summary.pending)} color={STATUS_COLORS.PENDING} />
          <KpiCard label="Vencido" value={formatCurrency(summary.overdue)} color={STATUS_COLORS.OVERDUE} />
        </div>
      )}

      {/* Filtros */}
      <div className="purchase-filters-panel">
        <label className="filter-label">FILTROS</label>
        <div className="purchase-filters-row">
          <div className="filter-input-wrap" style={{ flex: 2, minWidth: 200 }}>
            <Search size={14} />
            <input
              type="text"
              placeholder="Empresa, descrição, CNPJ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)} className="filter-select">
            <option value="">Todos os tipos</option>
            {DOCUMENT_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>Venc.</span>
            <input type="date" value={dueStart} onChange={(e) => setDueStart(e.target.value)} className="filter-date" />
            <span style={{ fontSize: "0.75rem" }}>–</span>
            <input type="date" value={dueEnd} onChange={(e) => setDueEnd(e.target.value)} className="filter-date" />
          </div>
          <button type="button" className="primary-button" onClick={applyFilters}>Filtrar</button>
          {hasFilters && (
            <button type="button" className="secondary-button" onClick={clearFilters}>
              <X size={14} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela desktop */}
      <div className="table-wrap tax-table-desktop">
        {loadingList ? (
          <p style={{ padding: 16, color: "var(--text-secondary)" }}>Carregando...</p>
        ) : data.length === 0 ? (
          <div className="empty-state">
            <p>Nenhum lançamento encontrado.</p>
            {canCreate && (
              <button type="button" className="primary-button" onClick={() => setEditId("new")}>
                <Plus size={16} /> Novo lançamento
              </button>
            )}
          </div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Empresa</th>
                  <th>Descrição</th>
                  <th>Competência</th>
                  <th>Vencimento</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th>Pagamento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tp) => {
                  const effectiveStatus = computeEffectiveStatus(tp);
                  return (
                    <tr key={tp.id} className={effectiveStatus === "OVERDUE" ? "overdue-row" : undefined}>
                      <td><strong style={{ fontSize: "0.8rem" }}>{tp.documentType}</strong></td>
                      <td>
                        <span style={{ display: "block", fontWeight: 500 }}>{tp.tradeName ?? tp.legalName ?? "—"}</span>
                        {tp.cnpj && <small style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>{formatCnpj(tp.cnpj)}</small>}
                      </td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.description ?? "—"}</td>
                      <td>{formatDate(tp.competenceDate)}</td>
                      <td style={{ color: effectiveStatus === "OVERDUE" ? "#ef4444" : undefined, fontWeight: effectiveStatus === "OVERDUE" ? 600 : undefined }}>
                        {formatDate(tp.dueDate)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(tp.amount)}</td>
                      <td>{tp.paymentDate ? formatDate(tp.paymentDate) : "—"}</td>
                      <td><StatusBadge status={effectiveStatus} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" className="action-button" onClick={() => setEditId(tp.id)}>
                            {canEdit ? "Editar" : "Ver"}
                          </button>
                          {canEdit && (
                            <button type="button" className="action-button" title="Copiar lançamento" onClick={() => void openCopy(tp)}>
                              <Copy size={13} />
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="action-button danger" onClick={() => setDeleteConfirmId(tp.id)}>
                              Excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Paginação */}
            {pagination.totalPages > 1 && (
              <div className="pagination-row">
                <span>{pagination.total} lançamentos</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pagination.page <= 1}
                    onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                  >
                    Anterior
                  </button>
                  <span style={{ display: "flex", alignItems: "center", padding: "0 8px", fontSize: "0.85rem" }}>
                    {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cards mobile */}
      <div className="mobile-cards">
        {loadingList && <p style={{ color: "var(--muted)", fontSize: 13 }}>Carregando...</p>}
        {!loadingList && data.length === 0 && (
          <div className="empty-state">
            <p>Nenhum lançamento encontrado.</p>
            {canCreate && (
              <button type="button" className="primary-button" onClick={() => setEditId("new")}>
                <Plus size={16} /> Novo lançamento
              </button>
            )}
          </div>
        )}
        {data.map((tp) => {
          const effectiveStatus = computeEffectiveStatus(tp);
          return (
            <div key={tp.id} className={`mobile-card${effectiveStatus === "OVERDUE" ? " overdue-card" : ""}`}>
              <div className="mobile-card-header">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: "0.85rem" }}>{tp.documentType}</strong>
                  <span style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.tradeName ?? tp.legalName ?? "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  <strong style={{ fontSize: "1rem" }}>{formatCurrency(tp.amount)}</strong>
                  <StatusBadge status={effectiveStatus} />
                </div>
              </div>
              <div className="mobile-card-body">
                {tp.description && (
                  <div className="mobile-card-row">
                    <span>Descrição</span>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{tp.description}</strong>
                  </div>
                )}
                <div className="mobile-card-row">
                  <span>Competência</span>
                  <strong>{formatDate(tp.competenceDate)}</strong>
                </div>
                <div className="mobile-card-row">
                  <span>Vencimento</span>
                  <strong style={{ color: effectiveStatus === "OVERDUE" ? "#ef4444" : undefined }}>{formatDate(tp.dueDate)}</strong>
                </div>
                {tp.paymentDate && (
                  <div className="mobile-card-row">
                    <span>Pago em</span>
                    <strong>{formatDate(tp.paymentDate)}</strong>
                  </div>
                )}
              </div>
              <div className="mobile-card-actions">
                <button type="button" className="action-button" onClick={() => setEditId(tp.id)}>
                  {canEdit ? "Editar" : "Ver"}
                </button>
                {canEdit && (
                  <button type="button" className="action-button" title="Copiar lançamento" onClick={() => void openCopy(tp)}>
                    <Copy size={13} />
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="action-button danger" onClick={() => setDeleteConfirmId(tp.id)}>
                    Excluir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal editar/criar */}
      {editId != null && (
        <EditModal
          editId={editId === "new" ? null : editId}
          prefillData={copyPrefill ?? undefined}
          onClose={() => { setEditId(null); setCopyPrefill(null); }}
          onSaved={() => { void load(filters); setCopyPrefill(null); }}
          notify={setNotice}
          canEdit={canEdit || canCreate}
        />
      )}

      {/* Modal importação */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => void load(filters)}
          notify={setNotice}
        />
      )}

      {/* Confirmação de exclusão */}
      {deleteConfirmId && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>Confirmar exclusão</h2></div>
            <div className="modal-body">
              <p>Deseja remover este lançamento? Esta ação não pode ser desfeita.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary-button" onClick={() => setDeleteConfirmId(null)}>Cancelar</button>
              <button type="button" className="primary-button danger" onClick={() => void handleDelete(deleteConfirmId)}>Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
