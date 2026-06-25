import { Building2, CheckCircle2, Eye, FileText, History, Receipt, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser, AuditLog, Company, CompanyBankAccount,
  downloadPayablesFinancialPdf, getAllBankAccounts, getCompanies,
  getPayableHistory, getPayables, getPaymentMethods, getPurchase,
  getTaxPaymentHistory, getSuppliers, payInstallment, payTaxPayment,
  Payable, PaymentMethod, PurchaseDetail, reverseInstallment, reverseTaxPayment, Supplier
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod, periodForPreset, PeriodPreset, PeriodState } from "../utils/period";

const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago c/ atraso",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado"
};

function isTaxPayment(p: Payable) {
  return p.sourceType === "TAX_PAYMENT";
}

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

function basePaymentName(name: string): string {
  return name.trim().replace(/\s+\d+[Xx]$/, "").toUpperCase().trim();
}

function inferTotalInstallments(methodName: string | null): number {
  if (!methodName) return 1;
  // Matches "BOLETO 2X", "BOLETO / 2x", "PIX / 1x" etc.
  const m = methodName.match(/[/ ]+(\d+)[Xx]$/);
  return m ? parseInt(m[1], 10) : 1;
}

function formatInstallment(num: number | null, total?: number | null, methodName?: string | null): string {
  if (num == null) return "";
  const inferred = inferTotalInstallments(methodName ?? null);
  const t = Math.max(total ?? inferred, num); // denominator always >= numerator
  return `${num}/${t}`;
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
  const [reversing, setReversing] = useState<Payable | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    paidDate: todayKey(), paidAmount: "", paidPaymentMethod: "",
    paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: ""
  });
  const [filters, setFilters] = useState({ filter: "", supplierId: "", paymentMethodId: "", status: "", sourceType: "", origin: "all", noDueDate: false });
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [loading, setLoading] = useState(false);
  const canManage = hasPermission(user, "payables", "edit");
  const { notice, setNotice } = useNotice();

  async function load(filterOverride?: typeof filters, periodOverride?: typeof period) {
    setLoading(true);
    setPayables([]);
    const activeFilters = filterOverride ?? filters;
    const activePeriod = periodOverride ?? period;
    try {
      const periodFilters = { startDate: activePeriod.startDate, endDate: activePeriod.endDate };
      // sourceType is client-side only; noDueDate and origin go to server
      const { sourceType: _st, noDueDate: noDueDateFlag, origin, ...apiFilters } = activeFilters;
      const dateParams = noDueDateFlag
        ? { noDueDate: true as const }
        : periodFilters;
      const [payableRows, allRows, supplierRows, methodRows, companyRows] = await Promise.all([
        getPayables({ ...apiFilters, ...dateParams, origin: origin as "all" | "purchases" | "taxes" }),
        getPayables({ ...periodFilters, origin: origin as "all" | "purchases" | "taxes" }),
        suppliers.length ? Promise.resolve(suppliers) : getSuppliers(),
        paymentMethods.length ? Promise.resolve(paymentMethods) : getPaymentMethods(),
        companies.length ? Promise.resolve(companies) : getCompanies().catch(() => [] as Company[])
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
    let result = payables;
    if (activeChip === "noduedate") result = result.filter((p) => !p.dueDate);
    if (filters.sourceType) result = result.filter((p) => p.sourceType === filters.sourceType);
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase().trim();
    return result.filter((p) =>
      p.supplierName.toLowerCase().includes(q) ||
      (p.invoiceNumber ?? "").toLowerCase().includes(q) ||
      (p.purchaseNumber ?? "").toLowerCase().includes(q) ||
      String(p.amount ?? "").includes(q) ||
      (p.taxCompanyName ?? "").toLowerCase().includes(q) ||
      (p.taxDocumentType ?? "").toLowerCase().includes(q) ||
      (p.taxDescription ?? "").toLowerCase().includes(q) ||
      (p.taxCnpj ?? "").includes(q)
    );
  }, [payables, searchQuery, filters.sourceType, activeChip]);

  const activeFilterCount = [filters.supplierId, filters.paymentMethodId, filters.status, filters.sourceType, filters.origin !== "all" ? filters.origin : ""].filter(Boolean).length + (activeChip === "noduedate" ? 1 : 0);

  const effectivePaymentOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const m of paymentMethods) {
      const base = basePaymentName(m.name);
      const existing = seen.get(base);
      if (!existing || m.name.trim().toUpperCase() === base) {
        seen.set(base, { id: m.id, label: base });
      }
    }
    return Array.from(seen.values());
  }, [paymentMethods]);

  function clearFilters() {
    const cleared = { filter: "", supplierId: "", paymentMethodId: "", status: "", sourceType: "", origin: "all", noDueDate: false };
    setFilters(cleared);
    setSearchQuery("");
    setActiveChip(null);
    setPeriod(currentMonthPeriod());
    void load(cleared, currentMonthPeriod());
  }

  function handlePeriodChange(preset: string) {
    setActiveChip(null);
    if (preset === "paidMonth") {
      const p = periodForPreset("currentMonth");
      const newPeriod: PeriodState = { ...p, preset: "paidMonth" as PeriodPreset };
      const u = { ...filters, status: "PAID" };
      setPeriod(newPeriod);
      setFilters(u);
      void load(u, newPeriod);
    } else {
      const p = periodForPreset(preset as PeriodPreset);
      setPeriod(p);
      void load(undefined, p);
    }
  }

  function applyChip(key: string) {
    if (activeChip === key) {
      clearFilters();
      return;
    }
    setActiveChip(key);
    if (key === "overdue") {
      const p = periodForPreset("overdue");
      const u = { ...filters, status: "OVERDUE", paymentMethodId: "", sourceType: "" };
      setPeriod(p);
      setFilters(u);
      void load(u, p);
    } else if (key === "today") {
      const p = periodForPreset("today");
      setPeriod(p);
      void load(undefined, p);
    } else if (key === "next7") {
      const p = periodForPreset("next7");
      setPeriod(p);
      void load(undefined, p);
    } else if (key === "boleto") {
      const opt = effectivePaymentOptions.find((o) => o.label === "BOLETO");
      if (opt) {
        const u = { ...filters, paymentMethodId: opt.id, status: "", sourceType: "" };
        setFilters(u);
        void load(u);
      }
    } else if (key === "cartao") {
      const opt = effectivePaymentOptions.find((o) => o.label === "CARTAO CREDITO");
      if (opt) {
        const u = { ...filters, paymentMethodId: opt.id, status: "", sourceType: "" };
        setFilters(u);
        void load(u);
      }
    } else if (key === "noduedate") {
      const u = { ...filters, noDueDate: true, status: "", sourceType: "" };
      setFilters(u);
      void load(u);
    }
  }

  function applyCardFilter(type: "open" | "overdue" | "paidMonth" | "paidToday" | "next7" | "next30") {
    setActiveChip(null);
    if (type === "open") {
      const u = { ...filters, status: "OPEN", sourceType: "" };
      setFilters(u);
      void load(u);
    } else if (type === "overdue") {
      const p = periodForPreset("overdue");
      const u = { ...filters, status: "OVERDUE", sourceType: "" };
      setPeriod(p);
      setFilters(u);
      void load(u, p);
    } else if (type === "paidMonth") {
      const p = periodForPreset("currentMonth");
      const newPeriod: PeriodState = { ...p, preset: "paidMonth" as PeriodPreset };
      const u = { ...filters, status: "PAID", sourceType: "" };
      setPeriod(newPeriod);
      setFilters(u);
      void load(u, newPeriod);
    } else if (type === "paidToday") {
      const p = periodForPreset("today");
      const u = { ...filters, status: "PAID", sourceType: "" };
      setPeriod(p);
      setFilters(u);
      void load(u, p);
    } else if (type === "next7") {
      const p = periodForPreset("next7");
      const u = { ...filters, status: "", sourceType: "" };
      setPeriod(p);
      setFilters(u);
      void load(u, p);
    } else if (type === "next30") {
      const p = periodForPreset("next30");
      const u = { ...filters, status: "", sourceType: "" };
      setPeriod(p);
      setFilters(u);
      void load(u, p);
    }
  }

  function selectedPaymentPayload() {
    if (paymentForm.paidPaymentMethod.startsWith("id:")) {
      return { paidPaymentMethodId: paymentForm.paidPaymentMethod.replace("id:", ""), paidPaymentMethodName: null };
    }
    return { paidPaymentMethodId: null, paidPaymentMethodName: paymentForm.paidPaymentMethod.replace("name:", "") };
  }

  async function openTitle(payable: Payable) {
    try {
      if (isTaxPayment(payable)) {
        const audits = await getTaxPaymentHistory(payable.id);
        setSelectedPayable(payable);
        setDetail(null);
        setHistoryRows(audits);
      } else {
        const [purchase, audits] = await Promise.all([getPurchase(payable.purchaseId!), getPayableHistory(payable.id)]);
        setSelectedPayable(payable);
        setDetail(purchase);
        setHistoryRows(audits);
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir conta a pagar." });
    }
  }

  async function openHistory(payable: Payable) {
    try {
      const rows = isTaxPayment(payable)
        ? await getTaxPaymentHistory(payable.id)
        : await getPayableHistory(payable.id);
      setHistoryRows(rows);
      setHistoryOnly(payable);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar histórico." });
    }
  }

  function startPayment(payable: Payable) {
    let paidPaymentMethod = "";
    if (payable.paymentMethodId) {
      const orig = paymentMethods.find((m) => m.id === payable.paymentMethodId);
      if (orig) {
        const base = basePaymentName(orig.name);
        const eff = effectivePaymentOptions.find((o) => o.label === base);
        paidPaymentMethod = eff ? `id:${eff.id}` : `name:${base}`;
      }
    }
    setPaying(payable);
    setBankAccounts([]);
    setPaymentForm({
      paidDate: todayKey(),
      paidAmount: String(payable.amount ?? ""),
      paidPaymentMethod,
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
    const paidAmount = Number(paymentForm.paidAmount || 0);
    if (paidAmount <= 0) {
      setNotice({ tone: "error", message: "Valor pago deve ser maior que zero." });
      return;
    }

    try {
      if (isTaxPayment(paying)) {
        await payTaxPayment(paying.id, {
          paymentDate: paymentForm.paidDate,
          paidAmount,
          comments: paymentForm.paymentNotes || null
        });
      } else {
        if (!paymentForm.paidPaymentMethod) {
          setNotice({ tone: "error", message: "Forma de pagamento é obrigatória." });
          return;
        }
        const originalAmount = Number(paying.amount ?? 0);
        const difference = Number((paidAmount - originalAmount).toFixed(2));
        if (Math.abs(difference) > 0.009 && !paymentForm.differenceReason.trim()) {
          setNotice({ tone: "error", message: "Informe a justificativa para desconto ou juros/acréscimo." });
          return;
        }
        await payInstallment(paying.id, {
          paidDate: paymentForm.paidDate,
          paidAmount,
          ...selectedPaymentPayload(),
          paymentNotes: paymentForm.paymentNotes || null,
          differenceReason: paymentForm.differenceReason || null,
          payingCompanyId: paymentForm.payingCompanyId || null,
          companyBankAccountId: paymentForm.companyBankAccountId || null
        });
      }
      setNotice({ tone: "success", message: "Baixa registrada com sucesso." });
      setPaying(null);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao registrar baixa." });
    }
  }

  function openReverse(payable: Payable) {
    setReverseReason("");
    setReversing(payable);
  }

  async function submitReverse() {
    if (!reversing) return;
    const reason = reverseReason.trim();
    if (!reason) { setNotice({ tone: "error", message: "Informe o motivo da reversão." }); return; }
    try {
      if (isTaxPayment(reversing)) {
        await reverseTaxPayment(reversing.id, reason);
      } else {
        await reverseInstallment(reversing.id, reason);
      }
      setNotice({ tone: "success", message: "Pagamento estornado com sucesso." });
      setReversing(null);
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
        <p className="muted">Resumo financeiro</p>
        <div className="actions-cell">
          <button className="secondary-button" type="button" onClick={handleFinancialPdf}>
            <FileText size={16} /> PDF financeiro
          </button>
          <button className="icon-button" type="button" onClick={() => load()} aria-label="Atualizar">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* ── Resumo compacto (cards clicáveis) ───────────────────── */}
      <div className="summary-grid financial-summary payables-summary">
        <article onClick={() => applyCardFilter("open")} title="Ver em aberto" style={{ cursor: "pointer" }}>
          <span>Em aberto</span><strong>{formatCurrency(totals.open)}</strong>
        </article>
        <article onClick={() => applyCardFilter("overdue")} title="Ver vencidos" style={{ cursor: "pointer" }}>
          <span>Vencido</span><strong className="payables-overdue-total">{formatCurrency(totals.overdue)}</strong>
        </article>
        <article onClick={() => applyCardFilter("paidMonth")} title="Ver pago no mês" style={{ cursor: "pointer" }}>
          <span>Pago no mês</span><strong>{formatCurrency(totals.paidMonth)}</strong>
        </article>
        <article onClick={() => applyCardFilter("paidToday")} title="Ver pago hoje" style={{ cursor: "pointer" }}>
          <span>Pago hoje</span><strong>{formatCurrency(totals.paidToday)}</strong>
        </article>
        <article onClick={() => applyCardFilter("next7")} title="Ver próximos 7 dias" style={{ cursor: "pointer" }}>
          <span>Próx. 7 dias</span><strong>{formatCurrency(totals.next7)}</strong>
        </article>
        <article onClick={() => applyCardFilter("next30")} title="Ver próximos 30 dias" style={{ cursor: "pointer" }}>
          <span>Próx. 30 dias</span><strong>{formatCurrency(totals.next30)}</strong>
        </article>
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
            {(activeFilterCount > 0 || searchQuery || activeChip) && (
              <button className="secondary-button" type="button" onClick={clearFilters}>
                <X size={14} /> Limpar
              </button>
            )}
          </div>
        </div>

        <div className="payables-filter-row">
          <label>
            Período de vencimento
            <select value={period.preset} onChange={(e) => handlePeriodChange(e.target.value)}>
              <option value="overdue">Vencidos</option>
              <option value="today">Vence hoje</option>
              <option value="next7">Próximos 7 dias</option>
              <option value="next15">Próximos 15 dias</option>
              <option value="next30">Próximos 30 dias</option>
              <option value="currentMonth">Mês atual</option>
              <option value="nextMonth">Mês seguinte</option>
              <option value="currentYear">Ano atual</option>
              <option value="paidMonth">Pago no mês</option>
              <option value="custom">Período personalizado</option>
            </select>
          </label>
          {period.preset === "custom" && (
            <>
              <label>
                Data inicial
                <input type="date" value={period.startDate} onChange={(e) => { const p = { ...period, startDate: e.target.value }; setPeriod(p); void load(undefined, p); }} />
              </label>
              <label>
                Data final
                <input type="date" value={period.endDate} onChange={(e) => { const p = { ...period, endDate: e.target.value }; setPeriod(p); void load(undefined, p); }} />
              </label>
            </>
          )}
          <label>
            Fornecedor
            <select value={filters.supplierId} onChange={(e) => { const u = { ...filters, supplierId: e.target.value }; setFilters(u); void load(u); }}>
              <option value="">Todos</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Forma de pagamento
            <select value={filters.paymentMethodId} onChange={(e) => { const u = { ...filters, paymentMethodId: e.target.value }; setFilters(u); void load(u); }}>
              <option value="">Todas</option>
              {effectivePaymentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(e) => { const u = { ...filters, status: e.target.value }; setFilters(u); void load(u); }}>
              <option value="">Todos</option>
              <option value="OPEN">Em aberto</option>
              <option value="OVERDUE">Vencido</option>
              <option value="PAID">Pago</option>
              <option value="PAID_LATE">Pago com atraso</option>
              <option value="CANCELLED">Cancelado</option>
            </select>
          </label>
          <label>
            Tipo
            <select value={filters.origin} onChange={(e) => { const u = { ...filters, origin: e.target.value, supplierId: e.target.value === "taxes" ? "" : filters.supplierId, paymentMethodId: e.target.value === "taxes" ? "" : filters.paymentMethodId, sourceType: e.target.value === "taxes" ? "" : filters.sourceType }; setFilters(u); void load(u); }}>
              <option value="all">Todos</option>
              <option value="purchases">Compras</option>
              <option value="taxes">Impostos</option>
            </select>
          </label>
          {filters.origin !== "taxes" && (
            <label>
              Sub-tipo
              <select value={filters.sourceType} onChange={(e) => { const u = { ...filters, sourceType: e.target.value }; setFilters(u); void load(u); }}>
                <option value="">Todos</option>
                <option value="DIRECT">Título normal</option>
                <option value="CARD_STATEMENT">Fatura cartão</option>
                <option value="LEGACY_CREDIT_CARD">Cartão legado</option>
                <option value="SUPPLIER_CYCLE">Ciclo fornecedor</option>
              </select>
            </label>
          )}
        </div>

        {(activeFilterCount > 0 || searchQuery) && (
          <p className="payables-filter-badge">
            {activeFilterCount > 0 && <span>{activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>}
            {searchQuery && <span>busca: "{searchQuery}"</span>}
          </p>
        )}
      </div>

      {/* ── Chips de atalho ──────────────────────────────────────── */}
      <div className="payables-chips">
        {([
          { key: "overdue", label: "Vencidos" },
          { key: "today", label: "Hoje" },
          { key: "next7", label: "Próx. 7 dias" },
          { key: "boleto", label: "Boleto" },
          { key: "cartao", label: "Cartão" },
          { key: "noduedate", label: "Sem vencimento" },
        ] as const).map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`payables-chip${activeChip === chip.key ? " payables-chip-active" : ""}`}
            onClick={() => applyChip(chip.key)}
          >
            {chip.label}
          </button>
        ))}
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
                  {isTaxPayment(payable) ? (
                    <>
                      <strong title={payable.taxDocumentType ?? payable.supplierName}>{payable.taxDocumentType ?? payable.supplierName}</strong>
                      <small>{payable.taxCompanyName ?? ""}{payable.taxDescription ? ` · ${payable.taxDescription}` : ""}</small>
                    </>
                  ) : (
                    <>
                      <strong title={payable.supplierName}>{payable.supplierName}</strong>
                      <small>
                        {payable.invoiceNumber ? `NF ${payable.invoiceNumber}` : "Sem NF"}
                        {payable.purchaseNumber ? ` · Ped. ${payable.purchaseNumber}` : ""}
                      </small>
                    </>
                  )}
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
                  {isTaxPayment(payable) ? (
                    <>
                      <span className="source-badge source-tax-payment"><Receipt size={11} /> Imposto</span>
                      {payable.taxCompetenceDate && <span>Comp.: {formatDate(payable.taxCompetenceDate)}</span>}
                      {payable.taxDreCategoryName && <span>{payable.taxDreCategoryName}</span>}
                    </>
                  ) : (
                    <>
                      {payable.installment != null && <span>Parcela: {formatInstallment(payable.installment, payable.totalInstallments, payable.paymentMethodName)}</span>}
                      {payable.paymentMethodName && <span>{payable.paymentMethodName}</span>}
                      {payable.sourceType === "CARD_STATEMENT" && (
                        <span className="source-badge source-card-statement">Fatura cartão</span>
                      )}
                      {payable.sourceType === "LEGACY_CREDIT_CARD" && (
                        <span className="source-badge source-legacy">Cartão legado</span>
                      )}
                      {payable.sourceType === "SUPPLIER_CYCLE" && (
                        <span className="source-badge source-supplier-cycle">Ciclo fornecedor</span>
                      )}
                    </>
                  )}
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
                    <button className="secondary-button compact-action" type="button" onClick={() => openReverse(payable)}>
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

            <Notice notice={notice} />

            {/* Contexto do título */}
            <div className="pay-ctx">
              <div className="pay-ctx-row">
                {isTaxPayment(paying) ? (
                  <>
                    <div><span>Tipo</span><strong>{paying.taxDocumentType ?? paying.supplierName}</strong></div>
                    {paying.taxCompanyName && <div><span>Empresa</span><strong>{paying.taxCompanyName}</strong></div>}
                    {paying.taxDescription && <div><span>Descrição</span><strong>{paying.taxDescription}</strong></div>}
                    {paying.taxCompetenceDate && <div><span>Competência</span><strong>{formatDate(paying.taxCompetenceDate)}</strong></div>}
                  </>
                ) : (
                  <>
                    <div><span>Fornecedor</span><strong>{paying.supplierName}</strong></div>
                    {paying.invoiceNumber && <div><span>NF</span><strong>{paying.invoiceNumber}</strong></div>}
                    {paying.purchaseNumber && <div><span>Pedido</span><strong>{paying.purchaseNumber}</strong></div>}
                    {paying.installment != null && <div><span>Parcela</span><strong>{formatInstallment(paying.installment, paying.totalInstallments, paying.paymentMethodName)}</strong></div>}
                  </>
                )}
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
              {!isTaxPayment(paying) && (
                <label>
                  Forma de pagamento *
                  <select value={paymentForm.paidPaymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paidPaymentMethod: e.target.value })}>
                    <option value="">Selecione</option>
                    {effectivePaymentOptions.map((opt) => (
                      <option key={opt.id} value={`id:${opt.id}`}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Observação
                <input value={paymentForm.paymentNotes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentNotes: e.target.value })} />
              </label>
              {!isTaxPayment(paying) && companies.length > 0 && (
                <label>
                  Empresa pagadora
                  <select value={paymentForm.payingCompanyId}
                    onChange={(e) => void handleCompanyChange(e.target.value)}>
                    <option value="">Selecione…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                  </select>
                </label>
              )}
              {!isTaxPayment(paying) && paymentForm.payingCompanyId && (
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

            {/* Resumo de diferença — apenas para compras */}
            {!isTaxPayment(paying) && paymentPaidAmount > 0 && (
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

            {/* Justificativa da diferença — apenas para compras */}
            {!isTaxPayment(paying) && Math.abs(paymentDifference) > 0.009 && (
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
              {isTaxPayment(paying) ? (
                <>Você está baixando <strong>{paying.taxDocumentType ?? paying.supplierName}</strong> no valor de{" "}<strong>{paymentPaidAmount > 0 ? formatCurrency(paymentPaidAmount) : formatCurrency(paymentOriginalAmount)}</strong>.</>
              ) : (
                <>
                  Você está baixando{paying.installment != null ? ` a parcela ${formatInstallment(paying.installment, paying.totalInstallments, paying.paymentMethodName)}` : ""}
                  {paying.invoiceNumber
                    ? ` da NF ${paying.invoiceNumber}`
                    : paying.purchaseNumber
                      ? ` do pedido ${paying.purchaseNumber}`
                      : ""}
                  {" "}no valor de{" "}
                  <strong>{paymentPaidAmount > 0 ? formatCurrency(paymentPaidAmount) : formatCurrency(paymentOriginalAmount)}</strong>.
                </>
              )}
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

      {/* ── Modal: Ver imposto ───────────────────────────────────── */}
      {!detail && selectedPayable && isTaxPayment(selectedPayable) && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal">
            <div className="section-heading">
              <div>
                <p>Imposto / Guia</p>
                <h2>{selectedPayable.taxDocumentType ?? selectedPayable.supplierName}</h2>
              </div>
              <button className="secondary-button" type="button"
                onClick={() => { setSelectedPayable(null); setHistoryRows([]); }}>
                <X size={16} /> Fechar
              </button>
            </div>

            <div className="modal-section">
              <p className="modal-section-title">Detalhes</p>
              <div className="summary-columns">
                <div>
                  <h3>Identificação</h3>
                  {selectedPayable.taxDocumentType && <p>Tipo: <strong>{selectedPayable.taxDocumentType}</strong></p>}
                  {selectedPayable.taxDescription && <p>Descrição: <strong>{selectedPayable.taxDescription}</strong></p>}
                  {selectedPayable.taxDreCategoryName && <p>Categoria DRE: <strong>{selectedPayable.taxDreCategoryName}</strong></p>}
                  <p>
                    <span className={`status-badge ${selectedPayable.status.toLowerCase()}`}>
                      {statusLabels[selectedPayable.status] ?? selectedPayable.status}
                    </span>
                  </p>
                </div>
                <div>
                  <h3>Empresa</h3>
                  {selectedPayable.taxCompanyName && <p>Nome: <strong>{selectedPayable.taxCompanyName}</strong></p>}
                  {selectedPayable.taxCnpj && <p>CNPJ: <strong>{selectedPayable.taxCnpj}</strong></p>}
                </div>
                <div>
                  <h3>Datas e valores</h3>
                  {selectedPayable.taxCompetenceDate && <p>Competência: <strong>{formatDate(selectedPayable.taxCompetenceDate)}</strong></p>}
                  <p>Vencimento: <strong>{formatDate(selectedPayable.dueDate)}</strong></p>
                  <p>Valor: <strong>{formatCurrency(Number(selectedPayable.amount ?? 0))}</strong></p>
                  {selectedPayable.paidDate && <p>Pago em: <strong>{formatDate(selectedPayable.paidDate)}</strong></p>}
                  {selectedPayable.paidAmount && <p>Valor pago: <strong>{formatCurrency(Number(selectedPayable.paidAmount))}</strong></p>}
                </div>
              </div>
            </div>

            {selectedPayable.paymentNotes && (
              <div className="modal-section">
                <p className="modal-section-title">Observações</p>
                <p>{selectedPayable.paymentNotes}</p>
              </div>
            )}

            {historyRows.length > 0 && (
              <div className="modal-section">
                <p className="modal-section-title">Histórico</p>
                <div className="table-wrap">
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
              </div>
            )}
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
                  {selectedPayable.installment != null && <p>Parcela: <strong>{formatInstallment(selectedPayable.installment, selectedPayable.totalInstallments, selectedPayable.paymentMethodName)}</strong></p>}
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
                        <td>{inst.installment != null ? formatInstallment(inst.installment, inst.totalInstallments, inst.paymentMethodName) : "-"}</td>
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

      {/* ── Modal: Reversão com motivo ──────────────────────────── */}
      {reversing && (
        <div className="modal-backdrop">
          <section className="panel modal-panel" style={{ maxWidth: 480 }}>
            <div className="section-heading">
              <div>
                <p>Estorno de pagamento</p>
                <h2>
                  {isTaxPayment(reversing)
                    ? (reversing.taxDocumentType ?? reversing.supplierName)
                    : reversing.supplierName}
                </h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setReversing(null)}>
                <X size={16} /> Fechar
              </button>
            </div>

            <Notice notice={notice} />

            <div className="pay-ctx" style={{ marginBottom: 16 }}>
              <div className="pay-ctx-row">
                {isTaxPayment(reversing) ? (
                  <>
                    {reversing.taxCompanyName && <div><span>Empresa</span><strong>{reversing.taxCompanyName}</strong></div>}
                    {reversing.taxCompetenceDate && <div><span>Competência</span><strong>{formatDate(reversing.taxCompetenceDate)}</strong></div>}
                  </>
                ) : (
                  <>
                    {reversing.invoiceNumber && <div><span>NF</span><strong>{reversing.invoiceNumber}</strong></div>}
                    {reversing.installment != null && <div><span>Parcela</span><strong>{formatInstallment(reversing.installment, reversing.totalInstallments, reversing.paymentMethodName)}</strong></div>}
                  </>
                )}
                <div><span>Valor pago</span><strong>{formatCurrency(Number(reversing.paidAmount ?? reversing.amount ?? 0))}</strong></div>
                <div><span>Data pagto.</span><strong>{formatDate(reversing.paidDate)}</strong></div>
              </div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Motivo da reversão *</span>
              <textarea
                rows={3}
                style={{ resize: "vertical", fontSize: "0.9rem" }}
                placeholder="Descreva o motivo do estorno..."
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                autoFocus
              />
            </label>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="secondary-button" type="button" onClick={() => setReversing(null)}>Cancelar</button>
              <button
                className="primary-button danger"
                type="button"
                disabled={!reverseReason.trim()}
                onClick={() => void submitReverse()}
              >
                <RotateCcw size={16} /> Confirmar estorno
              </button>
            </div>
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
