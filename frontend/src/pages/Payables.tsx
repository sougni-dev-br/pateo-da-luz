import { CheckCircle2, Eye, FileText, History, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppUser, AuditLog, Company, CompanyBankAccount, downloadPayablesFinancialPdf, getAllBankAccounts, getCompanies, getPayableHistory, getPayables, getPaymentMethods, getPurchase, getSuppliers, payInstallment, Payable, PaymentMethod, PurchaseDetail, reverseInstallment, Supplier } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { PeriodFilter } from "../components/PeriodFilter";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago com atraso",
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
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function addDaysKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function payableAlertClass(payable: Payable) {
  if (!["OPEN", "OVERDUE"].includes(payable.status)) return "";
  const due = dateKey(payable.dueDate);
  if (!due) return "";
  if (due < todayKey()) return "payable-row overdue";
  if (due === todayKey()) return "payable-row today";
  if (due === addDaysKey(1)) return "payable-row tomorrow";
  return "";
}

type PayablesProps = {
  user: AppUser;
};

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
  const [paymentForm, setPaymentForm] = useState({ paidDate: todayKey(), paidAmount: "", paidPaymentMethod: "", paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: "" });
  const [filters, setFilters] = useState({ filter: "", supplierId: "", paymentMethodId: "", status: "" });
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [loading, setLoading] = useState(false);
  const canManage = hasPermission(user, "payables", "edit");
  const { notice, setNotice } = useNotice();

  async function load() {
    setLoading(true);
    try {
      const periodFilters = { startDate: period.startDate, endDate: period.endDate };
      const [payableRows, allRows, supplierRows, methodRows, companyRows] = await Promise.all([
        getPayables({ ...filters, ...periodFilters }),
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

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const today = todayKey();
    const next7 = addDaysKey(7);
    const next30 = addDaysKey(30);
    const monthPrefix = today.slice(0, 7);
    return {
      open: allPayables.filter((item) => item.status === "OPEN").reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      overdue: allPayables.filter((item) => item.status === "OVERDUE").reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      paidMonth: allPayables.filter((item) => ["PAID", "PAID_LATE"].includes(item.status) && dateKey(item.paidDate).startsWith(monthPrefix)).reduce((sum, item) => sum + Number(item.paidAmount ?? item.amount ?? 0), 0),
      paidToday: allPayables.filter((item) => ["PAID", "PAID_LATE"].includes(item.status) && dateKey(item.paidDate) === today).reduce((sum, item) => sum + Number(item.paidAmount ?? item.amount ?? 0), 0),
      next7: allPayables.filter((item) => ["OPEN", "OVERDUE"].includes(item.status) && dateKey(item.dueDate) >= today && dateKey(item.dueDate) <= next7).reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      next30: allPayables.filter((item) => ["OPEN", "OVERDUE"].includes(item.status) && dateKey(item.dueDate) >= today && dateKey(item.dueDate) <= next30).reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    };
  }, [allPayables]);

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
      setNotice({ tone: "success", message: "Compra aberta com sucesso." });
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
        const accounts = await getAllBankAccounts(companyId);
        setBankAccounts(accounts);
      } catch {
        setBankAccounts([]);
      }
    } else {
      setBankAccounts([]);
    }
  }

  async function submitPayment() {
    if (!paying) return;
    const originalAmount = Number(paying.amount ?? 0);
    const paidAmount = Number(paymentForm.paidAmount || 0);
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
      setNotice({ tone: "success", message: "Conta marcada como paga." });
      setPaying(null);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao marcar pagamento." });
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
      <div className="section-heading">
        <div>
          <p>Módulo financeiro</p>
          <h2>Contas a pagar</h2>
        </div>
        <div className="actions-cell">
          <button className="secondary-button" type="button" onClick={handleFinancialPdf}>
            <FileText size={16} /> PDF financeiro
          </button>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar contas">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="summary-grid financial-summary">
        <article><span>Total em aberto</span><strong>{formatCurrency(totals.open)}</strong></article>
        <article><span>Total vencido</span><strong>{formatCurrency(totals.overdue)}</strong></article>
        <article><span>Total pago no mês</span><strong>{formatCurrency(totals.paidMonth)}</strong></article>
        <article><span>Total pago hoje</span><strong>{formatCurrency(totals.paidToday)}</strong></article>
        <article><span>Próximos 7 dias</span><strong>{formatCurrency(totals.next7)}</strong></article>
        <article><span>Próximos 30 dias</span><strong>{formatCurrency(totals.next30)}</strong></article>
      </div>

      <div className="filters-row">
        <PeriodFilter value={period} onChange={setPeriod} />
        <label>Fornecedor<select value={filters.supplierId} onChange={(event) => setFilters({ ...filters, supplierId: event.target.value })}><option value="">Todos</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Forma de pagamento<select value={filters.paymentMethodId} onChange={(event) => setFilters({ ...filters, paymentMethodId: event.target.value })}><option value="">Todas</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option><option value="OPEN">Em aberto</option><option value="OVERDUE">Vencido</option><option value="PAID">Pago</option><option value="PAID_LATE">Pago com atraso</option><option value="CANCELLED">Cancelado</option></select></label>
        <button className="primary-button" type="button" onClick={load}>Filtrar</button>
      </div>

      {loading ? (
        <div className="empty-state">Carregando contas...</div>
      ) : (
        <div className="payables-grid subsection">
          {payables.map((payable) => (
            <article className={`payable-card ${payableAlertClass(payable)}`} key={payable.id}>
              <div className="payable-card-header">
                <div>
                  <strong title={payable.supplierName}>{payable.supplierName}</strong>
                  <span>{payable.purchaseNumber ? `Pedido ${payable.purchaseNumber}` : "Sem pedido interno"}{payable.invoiceNumber ? ` • NF ${payable.invoiceNumber}` : ""}</span>
                </div>
                <span className={`status-badge ${payable.status.toLowerCase()}`}>{statusLabels[payable.status] ?? payable.status}</span>
              </div>

              <div className="payable-card-body">
                <div>
                  <span>Compra</span>
                  <strong>{formatDate(payable.purchaseDate)}</strong>
                </div>
                <div>
                  <span>Vencimento</span>
                  <strong>{formatDate(payable.dueDate)}</strong>
                </div>
                <div>
                  <span>Parcela</span>
                  <strong>{payable.installment ?? "-"}</strong>
                </div>
                <div>
                  <span>Valor</span>
                  <strong>{formatCurrency(Number(payable.amount ?? 0))}</strong>
                </div>
                <div>
                  <span>Forma</span>
                  <strong title={payable.paymentMethodName ?? "-"}>{payable.paymentMethodName ?? "-"}</strong>
                </div>
                <div className="payable-card-notes">
                  <span>Observações</span>
                  <strong title={payable.paymentNotes ?? payable.notes ?? payable.rawValue ?? "-"}>{payable.paymentNotes ?? payable.notes ?? payable.rawValue ?? "-"}</strong>
                </div>
              </div>

              <div className="payable-card-actions">
                <button className="secondary-button compact-action" type="button" onClick={() => openTitle(payable)}><Eye size={15} />Ver título</button>
                {canManage && ["OPEN", "OVERDUE"].includes(payable.status) && <button className="primary-button compact-action" type="button" onClick={() => startPayment(payable)}><CheckCircle2 size={15} />Marcar pago</button>}
                {canManage && ["PAID", "PAID_LATE"].includes(payable.status) && <button className="secondary-button compact-action" type="button" onClick={() => submitReverse(payable)}><RotateCcw size={15} />Estornar</button>}
                <button className="secondary-button compact-action" type="button" onClick={() => openHistory(payable)}><History size={15} />Histórico</button>
              </div>
            </article>
          ))}
          {payables.length === 0 && <div className="empty-state">Conta a pagar não encontrada para este período.</div>}
        </div>
      )}

      {paying && (
        <div className="modal-backdrop">
          <section className="panel modal-panel payment-modal">
            <div className="section-heading">
              <div>
                <p>Baixa financeira</p>
                <h2>Marcar como pago</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setPaying(null)}>Fechar</button>
            </div>
            <div className="form-grid payment-grid">
              <label>Data do pagamento<input type="date" value={paymentForm.paidDate} onChange={(event) => setPaymentForm({ ...paymentForm, paidDate: event.target.value })} /></label>
              <label>Valor da parcela<input readOnly value={formatCurrency(paymentOriginalAmount)} /></label>
              <label>Valor efetivamente pago<input type="number" min="0" step="0.01" value={paymentForm.paidAmount} onChange={(event) => setPaymentForm({ ...paymentForm, paidAmount: event.target.value })} /></label>
              <label>Forma efetiva<select value={paymentForm.paidPaymentMethod} onChange={(event) => setPaymentForm({ ...paymentForm, paidPaymentMethod: event.target.value })}><option value="">Selecione</option>{paymentMethods.map((method) => <option key={method.id} value={`id:${method.id}`}>{method.name}</option>)}{effectivePaymentNames.map((name) => <option key={name} value={`name:${name}`}>{name}</option>)}</select></label>
              <label>Desconto calculado<input readOnly value={formatCurrency(paymentDiscount)} /></label>
              <label>Juros/acréscimo calculado<input readOnly value={formatCurrency(paymentSurcharge)} /></label>
              {Math.abs(paymentDifference) > 0.009 && (
                <label className="full-width">Justificativa da diferença<input value={paymentForm.differenceReason} onChange={(event) => setPaymentForm({ ...paymentForm, differenceReason: event.target.value })} placeholder="Obrigatória para desconto ou acréscimo" /></label>
              )}
              <label>Observação<input value={paymentForm.paymentNotes} onChange={(event) => setPaymentForm({ ...paymentForm, paymentNotes: event.target.value })} /></label>
              {companies.length > 0 && (
                <label>Empresa pagadora
                  <select value={paymentForm.payingCompanyId} onChange={(event) => void handleCompanyChange(event.target.value)}>
                    <option value="">Selecione...</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                  </select>
                </label>
              )}
              {paymentForm.payingCompanyId && (
                <label>Conta bancária utilizada
                  <select value={paymentForm.companyBankAccountId} onChange={(event) => setPaymentForm({ ...paymentForm, companyBankAccountId: event.target.value })}>
                    <option value="">Selecione...</option>
                    {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPaying(null)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={submitPayment}>Confirmar pagamento</button>
            </div>
          </section>
        </div>
      )}

      {(detail && selectedPayable) && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal purchase-modal">
            <div className="section-heading">
              <div>
                <p>Somente leitura</p>
                <h2>Ver título</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => { setDetail(null); setSelectedPayable(null); setHistoryRows([]); }}>Fechar</button>
            </div>

            <div className="summary-columns">
              <div><h3>Título</h3><p>{selectedPayable.supplierName}</p><p>{selectedPayable.purchaseNumber ?? "-"}</p><p>NF {selectedPayable.invoiceNumber ?? "-"}</p></div>
              <div><h3>Vencimento</h3><p>{formatDate(selectedPayable.dueDate)}</p><p>{formatCurrency(Number(selectedPayable.amount ?? 0))}</p><p>{statusLabels[selectedPayable.status] ?? selectedPayable.status}</p></div>
              <div><h3>Compra</h3><p>{formatDate(detail.purchaseDate)}</p><p>{detail.paymentMethodName ?? detail.paymentMethod ?? "-"}</p><p>{formatCurrency(detail.totalAmount)}</p></div>
            </div>

            <div className="subsection table-wrap">
              <h3>Itens da compra</h3>
              <table>
                <thead><tr><th>Código</th><th>Produto</th><th>Categoria</th><th>Subcategoria</th><th>Unidade</th><th>Qtd.</th><th>Unit.</th><th>Total</th></tr></thead>
                <tbody>{detail.items.map((item) => <tr key={item.id}><td>{item.rawProductCode ?? item.productCode ?? "-"}</td><td>{item.rawProductName ?? item.productName}</td><td>{item.rawCategory ?? item.categoryName ?? "-"}</td><td>{item.rawSubcategory ?? item.subcategoryName ?? "-"}</td><td>{item.unit ?? "-"}</td><td>{formatNumber(Number(item.quantity))}</td><td>{formatCurrency(Number(item.unitPrice))}</td><td>{formatCurrency(Number(item.totalPrice))}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="subsection table-wrap">
              <h3>Parcelas</h3>
              <table>
                <thead><tr><th>Forma</th><th>Vencimento</th><th>Parcela</th><th>Valor</th><th>Pago em</th><th>Valor pago</th><th>Status</th></tr></thead>
                <tbody>{detail.installments.map((installment) => <tr key={installment.id}><td>{installment.paymentMethodName ?? detail.paymentMethodName ?? "-"}</td><td>{formatDate(installment.dueDate)}</td><td>{installment.installment ?? "-"}</td><td>{formatCurrency(Number(installment.amount ?? 0))}</td><td>{formatDate(installment.paidDate)}</td><td>{formatCurrency(Number(installment.paidAmount ?? 0))}</td><td>{statusLabels[installment.status ?? "OPEN"] ?? installment.status ?? "OPEN"}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="subsection table-wrap">
              <h3>Histórico de pagamentos</h3>
              <table>
                <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                <tbody>{historyRows.filter((audit) => audit.action.includes("PAY") || audit.action.includes("REVERSE")).map((audit) => <tr key={audit.id}><td>{formatDate(audit.createdAt)}</td><td>{audit.userName ?? "-"}</td><td>{audit.action}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="subsection table-wrap">
              <h3>Auditoria resumida</h3>
              <table>
                <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                <tbody>{[...historyRows, ...detail.audits].map((audit) => <tr key={audit.id}><td>{formatDate(audit.createdAt)}</td><td>{audit.userName ?? "-"}</td><td>{audit.action}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {historyOnly && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Auditoria</p>
                <h2>Histórico</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setHistoryOnly(null)}>Fechar</button>
            </div>
            <div className="subsection table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                <tbody>{historyRows.map((audit) => <tr key={audit.id}><td>{formatDate(audit.createdAt)}</td><td>{audit.userName ?? "-"}</td><td>{audit.action}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
