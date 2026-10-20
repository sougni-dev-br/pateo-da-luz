import { Copy, Plus, Search, Upload, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type AppUser,
  type TaxDreCategory,
  type TaxImportPreview,
  type TaxPayment,
  type TaxPaymentDetail,
  type TaxPaymentFilters,
  type TaxPaymentSummary,
  confirmTaxImport,
  createTaxPayment,
  deleteTaxPayment,
  getTaxCategorySuggestion,
  getTaxDreCategories,
  getTaxPayment,
  getTaxPayments,
  previewTaxImportXlsx,
  updateTaxPayment,
} from "../api/client";
import { DRECategoryOptions } from "../components/DRECategoryOptions";
import { Notice, type NoticeState, useNotice } from "../components/Notice";
import { Money, StatusBadge as DsStatusBadge, useFormatCurrency } from "../design-system";
import type { StatusTone } from "../design-system";
import { competenciaSugerida } from "../lib/competencia-imposto";
import { formatarDiaDaGuia, formatarMesAno, resumoDaGuia, situacaoDaGuia } from "../lib/guia-imposto";
import { hasPermission } from "../lib/permissions";

const DOCUMENT_TYPES = [
  "FGTS", "GPS / INSS", "DARF", "DARF IR", "IRRF", "Simples Nacional / DAS", "DASN",
  "DARE", "DARE-SP", "GARE ICMS", "GARE ISS", "TFE", "IPTU", "ISS",
  "Parcelamento Tributário", "Outros",
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "A vencer",
  PAID: "Pago",
  OVERDUE: "Vencido",
  CANCELED: "Cancelado",
};

const STATUS_TONES: Record<string, StatusTone> = {
  PENDING: "warning",
  PAID: "success",
  OVERDUE: "danger",
  CANCELED: "neutral",
};

const formatDate = formatarDiaDaGuia;

function formatCnpj(cnpj: string | null | undefined): string {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return cnpj;
}

function computeEffectiveStatus(tp: TaxPayment): string {
  return situacaoDaGuia(tp);
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
    <DsStatusBadge tone={STATUS_TONES[status] ?? "neutral"}>
      {STATUS_LABELS[status] ?? status}
    </DsStatusBadge>
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
  // O aviso da página fica atrás do modal: erro da importação aparece aqui dentro.
  const [erro, setErro] = useState<{ message: string; bloqueios: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setErro(null);
    try {
      const p = await previewTaxImportXlsx(file);
      setPreview(p);
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : "Erro ao processar arquivo.", bloqueios: [] });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    setErro(null);
    try {
      const result = await confirmTaxImport(preview.importFileId, skipDuplicates);
      notify({ tone: "success", message: `${result.imported} lançamentos importados com sucesso.` });
      onImported();
      onClose();
    } catch (err) {
      const bloqueios = err instanceof ApiError && Array.isArray(err.body?.bloqueios) ? (err.body.bloqueios as string[]) : [];
      setErro({ message: err instanceof Error ? err.message : "Erro ao confirmar importação.", bloqueios });
    } finally {
      setConfirming(false);
    }
  }

  const erroImportacao = erro && (
    <div className="field-hint field-hint--alerta" role="alert">
      <p style={{ margin: 0 }}>{erro.message}</p>
      {erro.bloqueios.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {erro.bloqueios.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
    </div>
  );

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
              A <strong>competência</strong> é obrigatória (dd/mm/aaaa ou mm/aaaa): sem ela a guia não entra no DRE.
            </p>
            {erroImportacao}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
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
                  <thead><tr><th>Tipo</th><th>Categoria no DRE</th><th>Qtd</th><th>Total</th></tr></thead>
                  <tbody>
                    {Object.entries(preview.byDocumentType).map(([dt, info]) => (
                      <tr key={dt}>
                        <td>{dt}</td>
                        <td>
                          {(preview.categoriasPorTipo?.[dt] ?? []).map((c, i) => (
                            <React.Fragment key={c ?? "sem"}>
                              {i > 0 && " · "}
                              {c ?? <span className="tax-sem-categoria">Sem categoria</span>}
                            </React.Fragment>
                          ))}
                        </td>
                        <td>{info.count}</td>
                        <td><Money value={info.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {Object.values(preview.categoriasPorTipo ?? {}).some((cats) => cats.includes(null)) && (
              <p className="field-hint field-hint--alerta">
                Guias sem categoria entram em "Não categorizadas" no DRE. Depois de importar, abra cada uma e escolha a categoria.
              </p>
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

            {erroImportacao}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="secondary-button" onClick={() => { setPreview(null); setErro(null); }}>Voltar</button>
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
  const [categorias, setCategorias] = useState<TaxDreCategory[]>([]);
  // Enquanto a pessoa não escolhe, categoria e competência seguem o tipo e o vencimento.
  const [categoriaEscolhida, setCategoriaEscolhida] = useState(false);
  const [competenciaDigitada, setCompetenciaDigitada] = useState(false);
  // O aviso da página fica atrás do formulário; erro ao salvar aparece aqui dentro.
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (erroAoSalvar) erroRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [erroAoSalvar]);

  useEffect(() => {
    getTaxDreCategories()
      .then(setCategorias)
      .catch(() => notify({ tone: "error", message: "Erro ao carregar as categorias do DRE." }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (categoriaEscolhida || !form.documentType) return;
    // Resposta que chega depois de a pessoa escolher a categoria é descartada.
    let descartada = false;
    const timer = setTimeout(() => {
      getTaxCategorySuggestion(form.documentType, form.description)
        .then((s) => { if (!descartada) setForm((prev) => ({ ...prev, dreCategoryId: s.dreCategoryId ?? "" })); })
        .catch(() => undefined);
    }, 300);
    return () => { descartada = true; clearTimeout(timer); };
  }, [form.documentType, form.description, categoriaEscolhida]);

  useEffect(() => {
    if (!editId) {
      const inicial = prefillData ? { ...EMPTY_FORM, ...prefillData } : EMPTY_FORM;
      setForm(inicial);
      setCategoriaEscolhida(Boolean(inicial.dreCategoryId));
      setCompetenciaDigitada(Boolean(inicial.competenceDate));
      return;
    }
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
        setCategoriaEscolhida(Boolean(d.dreCategoryId));
        setCompetenciaDigitada(true);
      })
      .catch(() => notify({ tone: "error", message: "Erro ao carregar lançamento." }))
      .finally(() => setLoading(false));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErroAoSalvar(null);
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
        comments: form.comments || null,
        // Sem escolha da pessoa vai "undefined" e o servidor aplica a regra; null é "sem categoria".
        dreCategoryId: form.dreCategoryId || (categoriaEscolhida ? null : undefined),
      };
      if (editId) {
        // Pagamento não se altera aqui (Contas a Pagar paga e estorna) e o status "vencido/pago"
        // sai das datas: a única escolha é manter a guia ativa ou cancelá-la.
        await updateTaxPayment(editId, { ...payload, status: form.status === "CANCELED" ? "CANCELED" : "PENDING" });
        notify({ tone: "success", message: "Lançamento atualizado." });
      } else {
        await createTaxPayment({ ...payload, paymentDate: form.paymentDate || null, paidAmount: form.paidAmount || null });
        notify({
          tone: "success",
          message: `Guia lançada. Já aparece em Contas a Pagar (vence em ${formatDate(form.dueDate)}) e entra no DRE de ${formatarMesAno(form.competenceDate)}.`,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setErroAoSalvar(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  const f = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  function handleTipoOuVencimento(field: "documentType" | "dueDate") {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setForm((prev) => {
        const next = { ...prev, [field]: value };
        return competenciaDigitada ? next : { ...next, competenceDate: competenciaSugerida(next.documentType, next.dueDate) };
      });
    };
  }

  function handleCompetencia(e: React.ChangeEvent<HTMLInputElement>) {
    setCompetenciaDigitada(true);
    setForm((prev) => ({ ...prev, competenceDate: e.target.value }));
  }

  function handleCategoria(e: React.ChangeEvent<HTMLSelectElement>) {
    setCategoriaEscolhida(true);
    setForm((prev) => ({ ...prev, dreCategoryId: e.target.value }));
  }

  const categoriaAtual = categorias.find((c) => c.id === form.dreCategoryId);
  const semCategoria = Boolean(form.documentType) && !form.dreCategoryId;
  const avisoCategoria = semCategoria
    ? "Sem categoria, esta guia entra em \"Não categorizadas\" no DRE, fora do grupo Impostos."
    : form.documentType && !categoriaEscolhida
      ? `Sugerida pelo tipo da guia${categoriaAtual?.dreGroup === "PESSOAL" ? " (encargo da folha, grupo Pessoal)" : ""}.`
      : null;
  const competenciaSugeridaAtiva = !competenciaDigitada && Boolean(form.competenceDate);

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
          <h2>{editId ? "Editar guia" : prefillData ? "Copiar guia" : "Lançar guia de imposto"}</h2>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
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
                  <select value={form.documentType} onChange={handleTipoOuVencimento("documentType")} required disabled={!canEdit}>
                    <option value="">Selecione...</option>
                    {DOCUMENT_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
                  </select>
                </label>
                {editId && (
                  <label className="pnova-field" style={{ flex: 1 }}>
                    <span>Situação da guia</span>
                    <select value={form.status === "CANCELED" ? "CANCELED" : "PENDING"} onChange={f("status")} disabled={!canEdit}>
                      <option value="PENDING">Ativa (a pagar ou paga)</option>
                      <option value="CANCELED">Cancelada (sai de Contas a Pagar e do DRE)</option>
                    </select>
                  </label>
                )}
              </div>
              <label className="pnova-field">
                <span>Descrição</span>
                <input type="text" value={form.description} onChange={f("description")} disabled={!canEdit} />
              </label>
              <label className="pnova-field">
                <span>Categoria no DRE</span>
                <select
                  value={form.dreCategoryId}
                  onChange={handleCategoria}
                  disabled={!canEdit}
                  aria-describedby={avisoCategoria ? "tax-categoria-aviso" : undefined}
                >
                  <option value="">Sem categoria</option>
                  <DRECategoryOptions categories={categorias} />
                </select>
                {avisoCategoria && (
                  <small
                    id="tax-categoria-aviso"
                    className={semCategoria ? "field-hint field-hint--alerta" : "field-hint"}
                    aria-live="polite"
                  >
                    {avisoCategoria}
                  </small>
                )}
              </label>
            </fieldset>

            {/* Datas e valores */}
            <fieldset className="pnova-fieldset">
              <legend>Datas e Valores</legend>
              <div className="pnova-field-row">
                <label className="pnova-field">
                  <span>Competência *</span>
                  <input
                    type="date"
                    value={form.competenceDate}
                    onChange={handleCompetencia}
                    required={form.status !== "CANCELED"}
                    disabled={!canEdit}
                    aria-describedby="tax-competencia-aviso"
                  />
                  <small id="tax-competencia-aviso" className="field-hint">
                    {competenciaSugeridaAtiva
                      ? "Sugerida: mês anterior ao vencimento. É por ela que a guia entra no DRE."
                      : "Mês a que o imposto se refere. É por ela que a guia entra no DRE."}
                  </small>
                </label>
                <label className="pnova-field">
                  <span>Vencimento *</span>
                  <input type="date" value={form.dueDate} onChange={handleTipoOuVencimento("dueDate")} required disabled={!canEdit} />
                </label>
                <label className="pnova-field">
                  <span>Valor *</span>
                  <input type="number" step="0.01" min="0.01" inputMode="decimal" value={form.amount} onChange={f("amount")} required disabled={!canEdit} />
                </label>
              </div>
              <div className="pnova-field-row">
                <label className="pnova-field">
                  <span>{editId ? "Data do pagamento" : "Já paga? Data do pagamento"}</span>
                  <input type="date" value={form.paymentDate} onChange={f("paymentDate")} disabled={!canEdit || Boolean(editId)} />
                </label>
                <label className="pnova-field">
                  <span>Valor pago</span>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={form.paidAmount} onChange={f("paidAmount")} disabled={!canEdit || Boolean(editId)} />
                </label>
              </div>
              <small className="field-hint">
                {editId
                  ? "O pagamento não se altera aqui. Para dar baixa ou estornar, use Contas a Pagar."
                  : "Deixe em branco se a guia ainda não foi paga: ela fica em Contas a Pagar até a baixa."}
              </small>
            </fieldset>

            {/* Comentários */}
            <label className="pnova-field">
              <span>Comentários</span>
              <textarea value={form.comments} onChange={f("comments")} rows={2} disabled={!canEdit} style={{ resize: "vertical" }} />
            </label>

            {canEdit && form.status !== "CANCELED" && (
              <div className="tax-resumo" aria-live="polite">
                <strong>O que acontece ao salvar</strong>
                <ul>
                  {resumoDaGuia({
                    amount: form.amount,
                    dueDate: form.dueDate,
                    competenceDate: form.competenceDate,
                    categoriaNome: categoriaAtual?.name ?? null,
                  }).map((linha) => <li key={linha}>{linha}</li>)}
                </ul>
              </div>
            )}

            {erroAoSalvar && (
              <p ref={erroRef} className="field-hint field-hint--alerta" role="alert">{erroAoSalvar}</p>
            )}
          </div>

          {canEdit && (
            <div className="modal-footer">
              <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Salvando..." : editId ? "Salvar" : "Lançar guia"}
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

  const fmt = useFormatCurrency();

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
          <KpiCard label="Total listado" value={fmt(summary.total)} />
          <KpiCard label="Pago" value={fmt(summary.paid)} color="var(--success)" />
          <KpiCard label="A vencer" value={fmt(summary.pending)} color="var(--warning)" />
          <KpiCard label="Vencido" value={fmt(summary.overdue)} color="var(--danger)" />
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
                      <td style={{ textAlign: "right", fontWeight: 600 }}><Money value={tp.amount} /></td>
                      <td>{tp.paymentDate ? formatDate(tp.paymentDate) : "—"}</td>
                      <td><StatusBadge status={effectiveStatus} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" className="action-button" onClick={() => setEditId(tp.id)}>
                            {canEdit ? "Editar" : "Ver"}
                          </button>
                          {canEdit && (
                            <button type="button" className="action-button" title="Copiar lançamento" aria-label="Copiar lançamento" onClick={() => void openCopy(tp)}>
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
                  <strong style={{ fontSize: "1rem" }}><Money value={tp.amount} /></strong>
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
          canEdit={editId === "new" ? canCreate : canEdit}
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
              <p>
                Excluir esta guia? Ela deixa de aparecer em Contas a Pagar e no DRE. A exclusão fica
                registrada na Auditoria, de onde a guia pode ser restaurada.
              </p>
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
