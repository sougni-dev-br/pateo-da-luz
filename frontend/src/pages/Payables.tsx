import { CheckCircle2, Eye, FileText, History, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser, AuditLog, Company, CompanyBankAccount,
  downloadPayablesFinancialPdf, getAllBankAccounts, getCompanies,
  getPayableHistory, getPayables, getPaymentMethods, getPurchase,
  getSuppliers, payInstallment, Payable, PaymentMethod,
  PurchaseDetail, reverseInstallment, Supplier
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { PeriodFilter } from "../components/PeriodFilter";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago c/ atraso",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado"
};

const effectivePaymentNames = ["PIX", "Boleto", "Dinheiro", "Debito", "Credito", "Transferencia", "Outro"];

function dateKey(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDaysKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function payableAlertStatus(payable: Payable): "overdue" | "today" | "tomorrow" | "" {
  if (!["OPEN", "OVERDUE"].includes(payable.status)) return "";
  const due = dateKey(payable.dueDate);
  if (!due) return "";
  if (due < todayKey()) return "overdue";
  if (due === todayKey()) return "today";
  if (due === addDaysKey(1)) return "tomorrow";
  return "";
}

type PayablesProps = { user: AppUser };

export function Payables({ user }: PayablesProps) {
  const [payables, setPayables] = useState<Payable[]>([]);
  const [allPayables, setAllPayables] = useState<Payable[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>([]);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [selectedPayable, setSelectedPayable] = useState<Payable | null>(null);
  const [historyRows, setHistoryRows] = useState<AuditLog[]>([]);
  const [historyOnly, setHistoryOnly] = useState<Payable | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    paidDate: todayKey(), paidAmount: "", paidPaymentMethod: "",
    paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: ""
  });
  const [filters, setFilters] = useState({ filter: "", supplierId: "", paymentMethodId: "", status: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [loading, setLoading] = useState(false);
  const canManage = hasPermission(user, "payables", "edit");
  const { notice, setNotice } = useNotice();

  async function load(filterOverride?: typeof filters) {
    setLoading(true);
    const activeFilters = filterOverride ?? filters;
    try {
      const periodFilters = { startDate: period.startDate, endDate: period.endDate };
      const [payableRows, allRows, supplierRows, methodRows, companyRows] = await Promise.all([
        getPayables({ ...activeFilters, ...periodFilters }),
        getPayables(periodFilters),
        suppliers.length ? Promise.resolve(suppliers) : getSuppliers(),
        paymentMethods.length ? Promise.resolve(paymentMethods) : getPaymentMethods(),
        companies.length ? Promise.resolve(companies) : getCompanies()
      ]);
      setPayables(payableRows);
      setAllPayables(allRows);
      setSuppliers(supplierRows);
      setPaymentMethods(methodRows);
      setCompanies(companyRows.filter((c) => c.isActive));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar contas a pagar." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    const today = todayKey();
    const next7 = addDaysKey(7);
    const next30 = addDaysKey(30);
    const monthPrefix = today.slice(0, 7);
    return {
      open: allPayables.filter((i) => i.status === "OPEN").reduce((s, i) => s + Number(i.amount ?? 0), 0),
      overdue: allPayables.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + Number(i.amount ?? 0), 0),
      paidMonth: allPayables.filter((i) => ["PAID", "PAID_LATE"].includes(i.status) && dateKey(i.paidDate).startsWith(monthPrefix)).reduce((s, i) => s + Number(i.paidAmount ?? i.amount ?? 0), 0),
      paidToday: allPayables.filter((i) => ["PAID", "PAID_LATE"].includes(i.status) && dateKey(i.paidDate) === today).reduce((s, i) => s + Number(i.paidAmount ?? i.amount ?? 0), 0),
      next7: allPayables.filter((i) => ["OPEN", "OVERDUE"].includes(i.status) && dateKey(i.dueDate) >= today && dateKey(i.dueDate) <= next7).reduce((s, i) => s + Number(i.amount ?? 0), 0),
      next30: allPayables.filter((i) => ["OPEN", "OVERDUE"].includes(i.status) && dateKey(i.dueDate) >= today && dateKey(i.dueDate) <= next30).reduce((s, i) => s + Number(i.amount ?? 0), 0)
    };
  }, [allPayables]);

  const displayedPayables = useMemo(() => {
    if (!searchQuery.trim()) return payables;
    const q = searchQuery.toLowerCase().trim();
    return payables.filter((p) =>
      p.supplierName.toLowerCase().includes(q) ||
      (p.invoiceNumber ?? "").toLowerCase().includes(q) ||
      (p.purchaseNumber ?? "").toLowerCase().includes(q) ||
      String(p.amount ?? "").includes(q)
    );
  }, [payables, searchQuery]);

  const activeFilterCount = [filters.supplierId, filters.paymentMethodId, filters.status].filter(Boolean).length;

  function clearFilters() {
    const cleared = { filter: "", supplierId: "", paymentMethodId: "", status: "" };
    setFilters(cleared);
    setSearchQuery("");
    void load(cleared);
  }

  function selectedPaymentPayload() {
    if (paymentForm.paidPaymentMethod.startsWith("id:")) {
      return { paidPaymentMethodId: paymentForm.paidPaymentMethod.replace("id:", ""), paidPaymentMethodName: null };
    }
    return { paidPaymentMethodId: null, paidPaymentMethodName: paymentForm.paidPaymentMethod.replace("name:", "") };
  }

  async function openTitle(payable: Payable) {
    try {
      const [purchase, audits] = await Promise.all([getPurchase(payable.purchaseId), getPayableHistory(payable.id)]);
      setSelectedPayable(payable);
      setDetail(purchase);
      setHistoryRows(audits);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir conta a pagar." });
    }
  }

  async function openHistory(payable: Payable) {
    try {
      setHistoryRows(await getPayableHistory(payable.id));
      setHistoryOnly(payable);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar histórico." });
    }
  }

  function startPayment(payable: Payable) {
    setPaying(payable);
    setBankAccounts([]);
    setPaymentForm({
      paidDate: todayKey(),
      paidAmount: String(payable.amount ?? ""),
      paidPaymentMethod: payable.paymentMethodId ? `id:${payable.paymentMethodId}` : "",
      paymentNotes: "",
      differenceReason: "",
      payingCompanyId: "",
      companyBankAccountId: ""
    });
  }

  async function handleCompanyChange(companyId: string) {
    setPaymentForm((prev) => ({ ...prev, payingCompanyId: companyId, companyBankAccountId: "" }));
    if (companyId) {
      try {
        setBankAccounts(await getAllBankAccounts(companyId));
      } catch {
        setBankAccounts([]);
      }
    } else {
      setBankAccounts([]);
    }
  }

  async function submitPayment() {
    if (!paying) return;
    if (!paymentForm.paidDate) {
      setNotice({ tone: "error", message: "Data do pagamento é obrigatória." });
      return;
    }
    if (!paymentForm.paidPaymentMethod) {
      setNotice({ tone: "error", message: "Forma de pagamento é obrigatória." });
      return;
    }
    const paidAmount = Number(paymentForm.paidAmount || 0);
    if (paidAmount <= 0) {
      setNotice({ tone: "error", message: "Valor pago deve ser maior que zero." });
      return;
    }
    const originalAmount = Number(paying.amount ?? 0);
    const difference = Number((paidAmount - originalAmount).toFixed(2));
    if (Math.abs(difference) > 0.009 && !paymentForm.differenceReason.trim()) {
      setNotice({ tone: "error", message: "Informe a justificativa para desconto ou juros/acréscimo." });
      return;
    }
    try {
      await payInstallment(paying.id, {
        paidDate: paymentForm.paidDate,
        paidAmount,
        ...selectedPaymentPayload(),
        paymentNotes: paymentForm.paymentNotes || null,
        differenceReason: paymentForm.differenceReason || null,
        payingCompanyId: paymentForm.payingCompanyId || null,
        companyBankAccountId: paymentForm.companyBankAccountId || null
      });
      setNotice({ tone: "success", message: "Baixa registrada com sucesso." });
      setPaying(null);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao registrar baixa." });
    }
  }

  async function submitReverse(payable: Payable) {
    const reason = window.prompt("Informe o motivo do estorno:");
    if (!reason?.trim()) return;
    try {
      await reverseInstallment(payable.id, reason);
      setNotice({ tone: "success", message: "Pagamento estornado com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao estornar pagamento." });
    }
  }

  async function handleFinancialPdf() {
    try {
      await downloadPayablesFinancialPdf({
        supplierId: filters.supplierId || undefined,
        paymentMethodId: filters.paymentMethodId || undefined,
        status: filters.status || undefined,
        startDate: period.startDate,
        endDate: period.endDate
      });
      setNotice({ tone: "success", message: "PDF financeiro gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF financeiro." });
    }
  }

  const paymentOriginalAmount = Number(paying?.amount ?? 0);
  const paymentPaidAmount = Number(paymentForm.paidAmount || 0);
  const paymentDifference = Number((paymentPaidAmount - paymentOriginalAmount).toFixed(2));
  const paymentDiscount = paymentDifference < 0 ? Math.abs(paymentDifference) : 0;
  const paymentSurcharge = paymentDifference > 0 ? paymentDifference : 0;

  return (
    <section className="panel">
      <Notice notice={notice} />

      {/* ── Cabeçalho ───────────────────────────────────────────── */}
      <div className="section-heading">
        <div>
          <p>Módulo financeiro</p>
          <h2>Contas a pagar</h2>
        </div>
        <div className="actions-cell">
          <button className="secondary-button" type="button" onClick={handleFinancialPdf}>
            <FileText size={16} /> PDF financeiro
          </button>
          <button className="icon-button" type="button" onClick={() => load()} aria-label="Atualizar">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* ── Resumo compacto ──────────────────────────────────────── */}
      <div className="summary-grid financial-summary payables-summary">
        <article><span>Em aberto</span><strong>{formatCurrency(totals.open)}</strong></article>
        <article><span>Vencido</span><strong className="payables-overdue-total">{formatCurrency(totals.overdue)}</strong></article>
        <article><span>Pago no mês</span><strong>{formatCurrency(totals.paidMonth)}</strong></article>
        <article><span>Pago hoje</span><strong>{formatCurrency(totals.paidToday)}</strong></article>
        <article><span>Próx. 7 dias</span><strong>{formatCurrency(totals.next7)}</strong></article>
        <article><span>Próx. 30 dias</span><strong>{formatCurrency(totals.next30)}</strong></article>
      </div>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <div className="payables-filters">
        <div className="payables-search-row">
          <div className="payables-search-wrap">
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar por fornecedor, NF, pedido ou valor…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="payables-filter-actions">
            <button className="primary-button" type="button" onClick={() => load()}>Filtrar</button>
            {(activeFilterCount > 0 || searchQuery) && (
              <button className="secondary-button" type="button" onClick={clearFilters}>
                <X size={14} /> Limpar
              </button>
            )}
          </div>
        </div>

        <div className="payables-filter-row">
          <PeriodFilter value={period} onChange={setPeriod} />
          <label>
            Fornecedor
            <select value={filters.supplierId} onChange={(e) => setFilters({ ...filters, supplierId: e.target.value })}>
              <option value="">Todos</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Forma de pagamento
            <select value={filters.paymentMethodId} onChange={(e) => setFilters({ ...filters, paymentMethodId: e.target.value })}>
              <option value="">Todas</option>
              {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Todos</option>
              <option value="OPEN">Em aberto</option>
              <option value="OVERDUE">Vencido</option>
              <option value="PAID">Pago</option>
              <option value="PAID_LATE">Pago com atraso</option>
              <option value="CANCELLED">Cancelado</option>
            </select>
          </label>
        </div>

        {(activeFilterCount > 0 || searchQuery) && (
          <p className="payables-filter-badge">
            {activeFilterCount > 0 && <span>{activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>}
            {searchQuery && <span>busca: "{searchQuery}"</span>}
          </p>
        )}
      </div>

      {/* ── Lista de títulos ─────────────────────────────────────── */}
      {loading ? (
        <div className="empty-state">Carregando contas…</div>
      ) : (
        <div className="payables-list">
          {displayedPayables.map((payable) => {
            const alert = payableAlertStatus(payable);
            return (
              <div className={`payable-row-item${alert ? ` ${alert}` : ""}`} key={payable.id}>
                <span className={`status-badge ${payable.status.toLowerCase()} pr-status`}>
                  {statusLabels[payable.status] ?? payable.status}
                </span>

                <div className="pr-supplier">
                  <strong title={payable.supplierName}>{payable.supplierName}</strong>
                  <small>
                    {payable.invoiceNumber ? `NF ${payable.invoiceNumber}` : "Sem NF"}
                    {payable.purchaseNumber ? ` · Ped. ${payable.purchaseNumber}` : ""}
                  </small>
                </div>

                <div className="pr-due">
                  <span className="pr-label">Vencimento</span>
                  <strong>{formatDate(payable.dueDate)}</strong>
                </div>

                <div className="pr-amount">
                  <span className="pr-label">Valor</span>
                  <strong>{formatCurrency(Number(payable.amount ?? 0))}</strong>
                </div>

                <div className="pr-meta">
                  {payable.installment != null && <span>Parcela {payable.installment}</span>}
                  {payable.paymentMethodName && <span>{payable.paymentMethodName}</span>}
                  {(payable.paymentNotes ?? payable.notes) && (
                    <span className="pr-notes" title={payable.paymentNotes ?? payable.notes ?? ""}>
                      {payable.paymentNotes ?? payable.notes}
                    </span>
                  )}
                </div>

                <div className="pr-actions">
                  <button className="secondary-button compact-action" type="button" onClick={() => openTitle(payable)}>
                    <Eye size={14} /> Ver
                  </button>
                  {canManage && ["OPEN", "OVERDUE"].includes(payable.status) && (
                    <button className="primary-button compact-action" type="button" onClick={() => startPayment(payable)}>
                      <CheckCircle2 size={14} /> Baixar
                    </button>
                  )}
                  {canManage && ["PAID", "PAID_LATE"].includes(payable.status) && (
                    <button className="secondary-button compact-action" type="button" onClick={() => submitReverse(payable)}>
                      <RotateCcw size={14} /> Estornar
                    </button>
                  )}
                  <button className="secondary-button compact-action" type="button" onClick={() => openHistory(payable)}>
                    <History size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {displayedPayables.length === 0 && (
            <div className="empty-state">
              {searchQuery
                ? `Nenhum título encontrado para "${searchQuery}".`
                : "Conta a pagar não encontrada para este período."}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: Baixa financeira ──────────────────────────────── */}
      {paying && (
        <div className="modal-backdrop">
          <section className="panel modal-panel payment-modal">
            <div className="section-heading">
              <div>
                <p>Baixa financeira</p>
                <h2>Confirmar baixa</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setPaying(null)}>
                <X size={16} /> Fechar
              </button>
            </div>

            {/* Contexto do título */}
            <div className="pay-ctx">
              <div className="pay-ctx-row">
                <div><span>Fornecedor</span><strong>{paying.supplierName}</strong></div>
                {paying.invoiceNumber && <div><span>NF</span><strong>{paying.invoiceNumber}</strong></div>}
                {paying.purchaseNumber && <div><span>Pedido</span><strong>{paying.purchaseNumber}</strong></div>}
                {paying.installment != null && <div><span>Parcela</span><strong>{paying.installment}</strong></div>}
                <div><span>Vencimento</span><strong>{formatDate(paying.dueDate)}</strong></div>
                <div><span>Valor original</span><strong className="pay-ctx-amount">{formatCurrency(paymentOriginalAmount)}</strong></div>
              </div>
            </div>

            {/* Campos da baixa */}
            <div className="form-grid payment-grid">
              <label>
                Data do pagamento *
                <input type="date" value={paymentForm.paidDate}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })} />
              </label>
              <label>
                Valor pago *
                <input type="number" min="0.01" step="0.01" value={paymentForm.paidAmount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidAmount: e.target.value })} />
              </label>
              <label>
                Forma de pagamento *
                <select value={paymentForm.paidPaymentMethod}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidPaymentMethod: e.target.value })}>
                  <option value="">Selecione</option>
                  {paymentMethods.map((m) => <option key={m.id} value={`id:${m.id}`}>{m.name}</option>)}
                  {effectivePaymentNames.map((n) => <option key={n} value={`name:${n}`}>{n}</option>)}
                </select>
              </label>
              <label>
                Observação
                <input value={paymentForm.paymentNotes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentNotes: e.target.value })} />
              </label>
              {companies.length > 0 && (
                <label>
                  Empresa pagadora
                  <select value={paymentForm.payingCompanyId}
                    onChange={(e) => void handleCompanyChange(e.target.value)}>
                    <option value="">Selecione…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                  </select>
                </label>
              )}
              {paymentForm.payingCompanyId && (
                <label>
                  Conta bancária
                  <select value={paymentForm.companyBankAccountId}
                    onChange={(e) => setPaymentForm({ ...paymentForm, companyBankAccountId: e.target.value })}>
                    <option value="">Selecione…</option>
                    {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            {/* Resumo de diferença */}
            {paymentPaidAmount > 0 && (
              <div className="pay-diff">
                {Math.abs(paymentDifference) <= 0.009 ? (
                  <span className="pay-diff-equal">Sem diferença em relação ao valor original</span>
                ) : paymentDifference < 0 ? (
                  <span className="pay-diff-discount">Desconto: {formatCurrency(paymentDiscount)}</span>
                ) : (
                  <span className="pay-diff-surcharge">Juros / acréscimo: {formatCurrency(paymentSurcharge)}</span>
                )}
              </div>
            )}

            {/* Justificativa da diferença */}
            {Math.abs(paymentDifference) > 0.009 && (
              <label className="pay-diff-reason">
                Justificativa da diferença *
                <input
                  value={paymentForm.differenceReason}
                  onChange={(e) => setPaymentForm({ ...paymentForm, differenceReason: e.target.value })}
                  placeholder="Informe o motivo do desconto ou acréscimo"
                />
              </label>
            )}

            {/* Frase de confirmação */}
            <p className="pay-confirm-phrase">
              Você está baixando{paying.installment != null ? ` a parcela ${paying.installment}` : ""}
              {paying.invoiceNumber
                ? ` da NF ${paying.invoiceNumber}`
                : paying.purchaseNumber
                  ? ` do pedido ${paying.purchaseNumber}`
                  : ""}
              {" "}no valor de{" "}
              <strong>{paymentPaidAmount > 0 ? formatCurrency(paymentPaidAmount) : formatCurrency(paymentOriginalAmount)}</strong>.
            </p>

            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPaying(null)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={submitPayment}>
                <CheckCircle2 size={16} /> Confirmar baixa
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Modal: Ver título ────────────────────────────────────── */}
      {detail && selectedPayable && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal">
            <div className="section-heading">
              <div>
                <p>Somente leitura</p>
                <h2>{selectedPayable.supplierName}</h2>
              </div>
              <button className="secondary-button" type="button"
                onClick={() => { setDetail(null); setSelectedPayable(null); setHistoryRows([]); }}>
                <X size={16} /> Fechar
              </button>
            </div>

            {/* Seção 1: Resumo */}
            <div className="modal-section">
              <p className="modal-section-title">Resumo do título</p>
              <div className="summary-columns">
                <div>
                  <h3>Identificação</h3>
                  {selectedPayable.invoiceNumber && <p>NF: <strong>{selectedPayable.invoiceNumber}</strong></p>}
                  {selectedPayable.purchaseNumber && <p>Pedido: <strong>{selectedPayable.purchaseNumber}</strong></p>}
                  {selectedPayable.installment != null && <p>Parcela: <strong>{selectedPayable.installment}</strong></p>}
                  <p>
                    <span className={`status-badge ${selectedPayable.status.toLowerCase()}`}>
                      {statusLabels[selectedPayable.status] ?? selectedPayable.status}
                    </span>
                  </p>
                </div>
                <div>
                  <h3>Valores</h3>
                  <p>Vencimento: <strong>{formatDate(selectedPayable.dueDate)}</strong></p>
                  <p>Valor original: <strong>{formatCurrency(Number(selectedPayable.amount ?? 0))}</strong></p>
                  {["PAID", "PAID_LATE"].includes(selectedPayable.status) && selectedPayable.paidDate && (
                    <>
                      <p>Pago em: <strong>{formatDate(selectedPayable.paidDate)}</strong></p>
                      <p>Valor pago: <strong>{formatCurrency(Number(selectedPayable.paidAmount ?? 0))}</strong></p>
                    </>
                  )}
                </div>
                <div>
                  <h3>Compra</h3>
                  <p>Data: <strong>{formatDate(detail.purchaseDate)}</strong></p>
                  <p>Forma: <strong>{detail.paymentMethodName ?? detail.paymentMethod ?? "-"}</strong></p>
                  <p>Total NF: <strong>{formatCurrency(detail.totalAmount)}</strong></p>
                </div>
              </div>
            </div>

            {/* Seção 2: Itens */}
            <div className="modal-section">
              <p className="modal-section-title">Itens da compra</p>
              <div className="table-wrap modal-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th><th>Produto</th><th>Categoria</th>
                      <th>Unidade</th><th>Qtd.</th><th>Unit.</th><th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.rawProductCode ?? item.productCode ?? "-"}</td>
                        <td>{item.rawProductName ?? item.productName}</td>
                        <td>{item.rawCategory ?? item.categoryName ?? "-"}</td>
                        <td>{item.unit ?? "-"}</td>
                        <td>{formatNumber(Number(item.quantity))}</td>
                        <td>{formatCurrency(Number(item.unitPrice))}</td>
                        <td>{formatCurrency(Number(item.totalPrice))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Seção 3: Parcelas */}
            <div className="modal-section">
              <p className="modal-section-title">Parcelas</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Forma</th><th>Vencimento</th><th>Parcela</th>
                      <th>Valor</th><th>Pago em</th><th>Valor pago</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.installments.map((inst) => (
                      <tr key={inst.id}>
                        <td>{inst.paymentMethodName ?? detail.paymentMethodName ?? "-"}</td>
                        <td>{formatDate(inst.dueDate)}</td>
                        <td>{inst.installment ?? "-"}</td>
                        <td>{formatCurrency(Number(inst.amount ?? 0))}</td>
                        <td>{formatDate(inst.paidDate)}</td>
                        <td>{formatCurrency(Number(inst.paidAmount ?? 0))}</td>
                        <td>
                          <span className={`status-badge ${(inst.status ?? "OPEN").toLowerCase()}`}>
                            {statusLabels[inst.status ?? "OPEN"] ?? inst.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Seção 4: Histórico de baixas */}
            {historyRows.some((a) => a.action.includes("PAY") || a.action.includes("REVERSE")) && (
              <div className="modal-section">
                <p className="modal-section-title">Histórico de baixas</p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                    <tbody>
                      {historyRows
                        .filter((a) => a.action.includes("PAY") || a.action.includes("REVERSE"))
                        .map((a) => (
                          <tr key={a.id}>
                            <td>{formatDate(a.createdAt)}</td>
                            <td>{a.userName ?? "-"}</td>
                            <td>{a.action}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Seção 5: Auditoria completa (colapsável) */}
            <details className="modal-section modal-section-audit">
              <summary className="modal-section-title modal-section-summary">
                Auditoria completa
              </summary>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                  <tbody>
                    {[...historyRows, ...detail.audits].map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.createdAt)}</td>
                        <td>{a.userName ?? "-"}</td>
                        <td>{a.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </div>
      )}

      {/* ── Modal: Histórico ─────────────────────────────────────── */}
      {historyOnly && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Auditoria</p>
                <h2>Histórico — {historyOnly.supplierName}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setHistoryOnly(null)}>
                <X size={16} /> Fechar
              </button>
            </div>
            <div className="subsection table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                <tbody>
                  {historyRows.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDate(a.createdAt)}</td>
                      <td>{a.userName ?? "-"}</td>
                      <td>{a.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
