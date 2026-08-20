import { Building2, CheckCircle2, Eye, FileText, History, Receipt, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser, AuditLog, Company, CompanyBankAccount,
  downloadPayablesFinancialPdf, getAllBankAccounts, getCompanies,
  getPayableHistory, getPayables, getPaymentMethods, getPurchase,
  getTaxPaymentHistory, getSuppliers, payInstallment, payPayrollItem, payTaxPayment,
  Payable, PaymentMethod, PurchaseDetail, reverseInstallment, reversePayrollItem, reverseTaxPayment, Supplier
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import {
  Button,
  EmptyState,
  IconButton,
  Money,
  PanelEyebrow,
  Alert,
  Select,
  StatusBadge as DsStatusBadge,
  SummaryCard
} from "../design-system";
import type { StatusTone } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod, periodForPreset, PeriodPreset, PeriodState } from "../utils/period";

const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago c/ atraso",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado"
};

const statusTones: Record<string, StatusTone> = {
  OPEN: "warning",
  PAID: "success",
  PAID_LATE: "warning",
  OVERDUE: "danger",
  CANCELLED: "neutral"
};

function isTaxPayment(p: Payable) {
  return p.sourceType === "TAX_PAYMENT";
}

function isPayroll(p: Payable) {
  return p.sourceType === "PAYROLL";
}

// Títulos "simples" (imposto e folha): baixa com data + valor, sem forma de
// pagamento / empresa / diferença. A query de payables preenche os campos tax*
// para folha (tipo, funcionário, competência), então a UI é reaproveitada.
function isSimpleLedger(p: Payable) {
  return isTaxPayment(p) || isPayroll(p);
}

function dateKey(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Data de baixa sugerida: o vencimento quando ja passou, hoje quando ainda esta por vir.
// Chaves no formato YYYY-MM-DD comparam corretamente como string.
function minDateKey(dueKey: string, todayK: string) {
  if (!dueKey) return todayK;
  return dueKey < todayK ? dueKey : todayK;
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
  // Baixa em lote: um pagamento cobrindo vários títulos (ex.: o VT de toda a
  // equipe numa quinzena). Cada título continua recebendo a sua própria baixa.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<{ ok: number; erros: Array<{ nome: string; motivo: string }> } | null>(null);
  const [reversing, setReversing] = useState<Payable | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    paidDate: todayKey(), paidAmount: "", paidPaymentMethod: "",
    paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: ""
  });
  const [filters, setFilters] = useState({ filter: "", supplierId: "", paymentMethodId: "", status: "", sourceType: "", origin: "all", noDueDate: false });
  const [viewMode, setViewMode] = useState<"open" | "paid" | "all">("open");
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
    if (viewMode === "open") result = result.filter((p) => p.status === "OPEN" || p.status === "OVERDUE");
    else if (viewMode === "paid") result = result.filter((p) => p.status === "PAID" || p.status === "PAID_LATE");
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
  }, [payables, searchQuery, filters.sourceType, activeChip, viewMode]);

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
    setViewMode("open");
    setPeriod(currentMonthPeriod());
    void load(cleared, currentMonthPeriod());
  }

  function handlePeriodChange(preset: string) {
    setActiveChip(null);
    if (preset === "paidMonth") {
      const p = periodForPreset("currentMonth");
      const newPeriod: PeriodState = { ...p, preset: "paidMonth" as PeriodPreset };
      const u = { ...filters, status: "PAID" };
      setViewMode("paid");
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
    // Sincroniza viewMode com o card clicado para não ocultar resultados
    setViewMode(type === "paidMonth" || type === "paidToday" ? "paid" : "open");
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
      } else if (isPayroll(payable)) {
        const audits = await getPayableHistory(payable.id);
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
    // 1) Match pelo paymentMethodId da origem
    if (payable.paymentMethodId) {
      const orig = paymentMethods.find((m) => m.id === payable.paymentMethodId);
      if (orig) {
        const base = basePaymentName(orig.name);
        const eff = effectivePaymentOptions.find((o) => o.label === base);
        if (eff) paidPaymentMethod = `id:${eff.id}`;
      }
    }
    // 2) Fallback pelo nome do método (caso o id não bata)
    if (!paidPaymentMethod && payable.paymentMethodName) {
      const base = basePaymentName(payable.paymentMethodName);
      const eff = effectivePaymentOptions.find((o) => o.label === base);
      if (eff) paidPaymentMethod = `id:${eff.id}`;
    }
    setPaying(payable);
    setBankAccounts([]);
    setPaymentForm({
      // Vencido: usa o vencimento (nao movimenta o mes da despesa no DRE).
      // A vencer: usa hoje — pagar adiantado e rotina, e o pagamento ocorreu hoje,
      // nao na data futura do vencimento (que o backend recusa, com razao).
      paidDate: minDateKey(dateKey(payable.dueDate), todayKey()),
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
        const accounts = await getAllBankAccounts(companyId);
        setBankAccounts(accounts);
        if (accounts.length > 0) {
          setPaymentForm((prev) => ({ ...prev, companyBankAccountId: accounts[0].id }));
        }
      } catch {
        setBankAccounts([]);
      }
    } else {
      setBankAccounts([]);
    }
  }

  // ── Baixa em lote ────────────────────────────────────────────────────────
  const podeSelecionar = (p: Payable) => canManage && ["OPEN", "OVERDUE"].includes(p.status);
  const selecionaveis = displayedPayables.filter(podeSelecionar);
  const selecionados = displayedPayables.filter((p) => selectedIds.has(p.id));
  const totalSelecionado = selecionados.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  function toggleSelecionado(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleTodos() {
    setSelectedIds((prev) => (prev.size === selecionaveis.length ? new Set() : new Set(selecionaveis.map((p) => p.id))));
  }

  async function submitBatch() {
    if (selecionados.length === 0) return;
    if (!paymentForm.paidDate) { setNotice({ tone: "error", message: "Data do pagamento é obrigatória." }); return; }
    // Impostos usam fluxo simples; os demais exigem forma de pagamento.
    if (selecionados.some((p) => !isTaxPayment(p)) && !paymentForm.paidPaymentMethod) {
      setNotice({ tone: "error", message: "Forma de pagamento é obrigatória." });
      return;
    }

    setBatchBusy(true);
    const erros: Array<{ nome: string; motivo: string }> = [];
    let ok = 0;
    const comum = {
      ...selectedPaymentPayload(),
      paymentNotes: paymentForm.paymentNotes || null,
      differenceReason: null,
      payingCompanyId: paymentForm.payingCompanyId || null,
      companyBankAccountId: paymentForm.companyBankAccountId || null
    };

    // Sequencial de propósito: cada título gera a sua baixa e o seu registro de
    // auditoria; em paralelo, uma falha no meio deixaria o lote ambíguo.
    for (const p of selecionados) {
      const valor = Number(p.amount ?? 0);
      const nome = p.supplierName ?? p.taxDocumentType ?? p.id;
      try {
        if (isTaxPayment(p)) {
          await payTaxPayment(p.id, { paymentDate: paymentForm.paidDate, paidAmount: valor, comments: paymentForm.paymentNotes || null });
        } else if (isPayroll(p)) {
          await payPayrollItem(p.id, { paymentDate: paymentForm.paidDate, paidAmount: valor, ...comum });
        } else {
          await payInstallment(p.id, { paidDate: paymentForm.paidDate, paidAmount: valor, ...comum });
        }
        ok += 1;
      } catch (error) {
        erros.push({ nome, motivo: error instanceof Error ? error.message : "erro desconhecido" });
      }
    }

    setBatchBusy(false);
    setBatchResult({ ok, erros });
    setSelectedIds(new Set());
    await load();
    if (erros.length === 0) {
      setBatchOpen(false);
      setNotice({ tone: "success", message: `${ok} título(s) baixado(s) em lote.` });
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
        // Folha e compras compartilham o mesmo fluxo: forma obrigatória + justificativa de diferença.
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
        const commonPayload = {
          ...selectedPaymentPayload(),
          paymentNotes: paymentForm.paymentNotes || null,
          differenceReason: paymentForm.differenceReason || null,
          payingCompanyId: paymentForm.payingCompanyId || null,
          companyBankAccountId: paymentForm.companyBankAccountId || null
        };
        if (isPayroll(paying)) {
          await payPayrollItem(paying.id, { paymentDate: paymentForm.paidDate, paidAmount, ...commonPayload });
        } else {
          await payInstallment(paying.id, { paidDate: paymentForm.paidDate, paidAmount, ...commonPayload });
        }
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
      } else if (isPayroll(reversing)) {
        await reversePayrollItem(reversing.id);
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
        <PanelEyebrow>Resumo financeiro</PanelEyebrow>
        <div className="actions-cell">
          <Button variant="secondary" leadingIcon={<FileText size={16} />} onClick={handleFinancialPdf}>
            PDF financeiro
          </Button>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar" onClick={() => load()} />
        </div>
      </div>

      {/* ── Resumo compacto (cards clicáveis filtram a lista) ───── */}
      <div className="kpi-counters-grid payables-kpi-grid">
        <SummaryCard label="Em aberto" moneyValue={totals.open} tone="warning" className="payables-kpi-clickable" onClick={() => applyCardFilter("open")} />
        <SummaryCard label="Vencido" moneyValue={totals.overdue} tone="danger" className="payables-kpi-clickable" onClick={() => applyCardFilter("overdue")} />
        <SummaryCard label="Pago no mês" moneyValue={totals.paidMonth} tone="success" className="payables-kpi-clickable" onClick={() => applyCardFilter("paidMonth")} />
        <SummaryCard label="Pago hoje" moneyValue={totals.paidToday} tone="success" className="payables-kpi-clickable" onClick={() => applyCardFilter("paidToday")} />
        <SummaryCard label="Próx. 7 dias" moneyValue={totals.next7} tone="info" className="payables-kpi-clickable" onClick={() => applyCardFilter("next7")} />
        <SummaryCard label="Próx. 30 dias" moneyValue={totals.next30} tone="info" className="payables-kpi-clickable" onClick={() => applyCardFilter("next30")} />
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
          <Select
            label="Período de vencimento"
            value={period.preset}
            onChange={(e) => handlePeriodChange(e.target.value)}
            options={[
              { value: "overdue", label: "Vencidos" },
              { value: "today", label: "Vence hoje" },
              { value: "next7", label: "Próximos 7 dias" },
              { value: "next15", label: "Próximos 15 dias" },
              { value: "next30", label: "Próximos 30 dias" },
              { value: "currentMonth", label: "Mês atual" },
              { value: "nextMonth", label: "Mês seguinte" },
              { value: "currentYear", label: "Ano atual" },
              { value: "paidMonth", label: "Pago no mês" },
              { value: "custom", label: "Período personalizado" }
            ]}
          />
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
          <Select
            label="Fornecedor"
            value={filters.supplierId}
            onChange={(e) => { const u = { ...filters, supplierId: e.target.value }; setFilters(u); void load(u); }}
            placeholder="Todos"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            label="Forma de pagamento"
            value={filters.paymentMethodId}
            onChange={(e) => { const u = { ...filters, paymentMethodId: e.target.value }; setFilters(u); void load(u); }}
            placeholder="Todas"
            options={effectivePaymentOptions.map((o) => ({ value: o.id, label: o.label }))}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={(e) => {
              const v = e.target.value;
              const u = { ...filters, status: v };
              if (v === "PAID" || v === "PAID_LATE") setViewMode("paid");
              else if (v === "OPEN" || v === "OVERDUE") setViewMode("open");
              else if (v === "") setViewMode("all");
              setFilters(u);
              void load(u);
            }}
            placeholder="Todos"
            options={[
              { value: "OPEN", label: "Em aberto" },
              { value: "OVERDUE", label: "Vencido" },
              { value: "PAID", label: "Pago" },
              { value: "PAID_LATE", label: "Pago com atraso" },
              { value: "CANCELLED", label: "Cancelado" }
            ]}
          />
          <Select
            label="Tipo"
            value={filters.origin}
            onChange={(e) => { const u = { ...filters, origin: e.target.value, supplierId: e.target.value === "taxes" ? "" : filters.supplierId, paymentMethodId: e.target.value === "taxes" ? "" : filters.paymentMethodId, sourceType: e.target.value === "taxes" ? "" : filters.sourceType }; setFilters(u); void load(u); }}
            options={[
              { value: "all", label: "Todos" },
              { value: "purchases", label: "Compras" },
              { value: "taxes", label: "Impostos" }
            ]}
          />
          {filters.origin !== "taxes" && (
            <Select
              label="Sub-tipo"
              value={filters.sourceType}
              onChange={(e) => { const u = { ...filters, sourceType: e.target.value }; setFilters(u); void load(u); }}
              placeholder="Todos"
              options={[
                { value: "DIRECT", label: "Título normal" },
                { value: "CARD_STATEMENT", label: "Fatura cartão" },
                { value: "LEGACY_CREDIT_CARD", label: "Cartão legado" },
                { value: "SUPPLIER_CYCLE", label: "Ciclo fornecedor" },
                { value: "PAYROLL", label: "Folha de pagamento" }
              ]}
            />
          )}
        </div>

        {(activeFilterCount > 0 || searchQuery) && (
          <p className="payables-filter-badge">
            {activeFilterCount > 0 && <span>{activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>}
            {searchQuery && <span>busca: "{searchQuery}"</span>}
          </p>
        )}
      </div>

      {/* ── Toggle Em aberto / Baixados / Todos ─────────────────── */}
      <div className="payables-chips" style={{ marginBottom: 6 }}>
        {([
          { key: "open", label: "Em aberto" },
          { key: "paid", label: "Baixados" },
          { key: "all", label: "Todos" },
        ] as const).map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={`payables-chip${viewMode === mode.key ? " payables-chip-active" : ""}`}
            onClick={() => setViewMode(mode.key)}
          >
            {mode.label}
          </button>
        ))}
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
          {canManage && selecionaveis.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "8px 12px", marginBottom: 8, borderRadius: 8,
              border: "1px solid var(--border)",
              background: selecionados.length > 0 ? "var(--gold-tint, #fdf1d6)" : "var(--surface-2)"
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === selecionaveis.length}
                  ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < selecionaveis.length; }}
                  onChange={toggleTodos}
                  style={{ width: 16, height: 16, cursor: "pointer" }}
                />
                Selecionar todos em aberto ({selecionaveis.length})
              </label>
              {selecionados.length > 0 && (
                <>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {selecionados.length} selecionado(s) · <Money value={totalSelecionado} />
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
                    <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => { setBatchResult(null); setBatchOpen(true); }}>
                      Baixar selecionados
                    </Button>
                  </span>
                </>
              )}
            </div>
          )}
          {displayedPayables.map((payable) => {
            const alert = payableAlertStatus(payable);
            return (
              <div className={`payable-row-item${alert ? ` ${alert}` : ""}`} key={payable.id}>
                {podeSelecionar(payable) ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(payable.id)}
                    onChange={() => toggleSelecionado(payable.id)}
                    aria-label={`Selecionar ${payable.supplierName ?? payable.taxDocumentType ?? "título"} para baixa em lote`}
                    style={{ alignSelf: "center", width: 16, height: 16, cursor: "pointer", flex: "0 0 auto" }}
                  />
                ) : (
                  <span style={{ width: 16, flex: "0 0 auto" }} />
                )}
                <DsStatusBadge className="pr-status" tone={statusTones[payable.status] ?? "neutral"}>
                  {statusLabels[payable.status] ?? payable.status}
                </DsStatusBadge>

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
                  <strong><Money value={Number(payable.amount ?? 0)} /></strong>
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
                      {payable.sourceType === "PAYROLL" && (
                        <span className="source-badge source-payroll">Folha</span>
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
                  <IconButton icon={<Eye size={16} />} label="Ver título" size="sm" onClick={() => openTitle(payable)} />
                  {canManage && ["OPEN", "OVERDUE"].includes(payable.status) && (
                    <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => startPayment(payable)}>
                      Baixar
                    </Button>
                  )}
                  {canManage && ["PAID", "PAID_LATE"].includes(payable.status) && (
                    <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={14} />} onClick={() => openReverse(payable)}>
                      Estornar
                    </Button>
                  )}
                  <IconButton icon={<History size={16} />} label="Histórico" size="sm" onClick={() => openHistory(payable)} />
                </div>
              </div>
            );
          })}
          {displayedPayables.length === 0 && (
            <EmptyState
              title={searchQuery
                ? `Nenhum título encontrado para "${searchQuery}".`
                : "Conta a pagar não encontrada para este período."}
              description="Ajuste o período ou os filtros acima."
            />
          )}
        </div>
      )}

      {/* ── Modal: Baixa em lote ─────────────────────────────────── */}
      {batchOpen && (
        <div className="modal-backdrop">
          <section className="panel modal-panel payment-modal">
            <div className="section-heading">
              <div>
                <p>Baixa financeira</p>
                <h2>Baixar {selecionados.length} título(s) em lote</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setBatchOpen(false)} disabled={batchBusy}>
                <X size={16} /> Fechar
              </button>
            </div>

            <Notice notice={notice} />

            {batchResult && batchResult.erros.length > 0 ? (
              <>
                <Alert tone="warning">
                  {batchResult.ok} baixado(s) com sucesso, {batchResult.erros.length} falhou(ram). Os que falharam continuam em aberto.
                </Alert>
                <ul style={{ fontSize: 13, margin: "10px 0 0", paddingLeft: 18 }}>
                  {batchResult.erros.map((e, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}><strong>{e.nome}</strong> — {e.motivo}</li>
                  ))}
                </ul>
                <div className="modal-actions" style={{ marginTop: 14 }}>
                  <Button onClick={() => { setBatchOpen(false); setBatchResult(null); }}>Fechar</Button>
                </div>
              </>
            ) : (
              <>
                <div className="pay-ctx">
                  <div className="pay-ctx-row">
                    <div><span>Títulos</span><strong>{selecionados.length}</strong></div>
                    <div><span>Total</span><strong className="pay-ctx-amount"><Money value={totalSelecionado} /></strong></div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: "var(--muted)", margin: "10px 0" }}>
                  Cada título recebe a baixa pelo <strong>seu próprio valor</strong>, com os mesmos dados abaixo.
                  Para pagar valor diferente do original (desconto ou juros), baixe aquele título individualmente.
                </p>

                <div className="form-grid">
                  <label>
                    Data do pagamento *
                    <input type="date" value={paymentForm.paidDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })} />
                  </label>
                  {selecionados.some((p) => !isTaxPayment(p)) && (
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
                  {selecionados.some((p) => !isTaxPayment(p)) && companies.length > 0 && (
                    <label>
                      Empresa pagadora
                      <select value={paymentForm.payingCompanyId}
                        onChange={(e) => void handleCompanyChange(e.target.value)}>
                        <option value="">Selecione…</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                      </select>
                    </label>
                  )}
                </div>

                <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginTop: 12, fontSize: 13 }}>
                  {selecionados.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.supplierName ?? p.taxDocumentType}
                        {p.taxDescription ? ` · ${p.taxDescription}` : ""}
                      </span>
                      <strong style={{ whiteSpace: "nowrap" }}><Money value={Number(p.amount ?? 0)} /></strong>
                    </div>
                  ))}
                </div>

                <div className="modal-actions" style={{ marginTop: 14 }}>
                  <Button variant="secondary" onClick={() => setBatchOpen(false)} disabled={batchBusy}>Cancelar</Button>
                  <Button onClick={submitBatch} disabled={batchBusy}>
                    {batchBusy ? "Baixando..." : `Confirmar baixa de ${selecionados.length}`}
                  </Button>
                </div>
              </>
            )}
          </section>
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
                {isSimpleLedger(paying) ? (
                  <>
                    <div><span>Tipo</span><strong>{paying.taxDocumentType ?? paying.supplierName}</strong></div>
                    {paying.taxCompanyName && <div><span>{isPayroll(paying) ? "Funcionário" : "Empresa"}</span><strong>{paying.taxCompanyName}</strong></div>}
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
                <div><span>Valor original</span><strong className="pay-ctx-amount"><Money value={paymentOriginalAmount} /></strong></div>
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
                <input type="number" min="0.01" step="0.01" inputMode="decimal" value={paymentForm.paidAmount}
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

            {/* Resumo de diferença — compras e folha */}
            {!isTaxPayment(paying) && paymentPaidAmount > 0 && (
              <div className="pay-diff">
                {Math.abs(paymentDifference) <= 0.009 ? (
                  <span className="pay-diff-equal">Sem diferença em relação ao valor original</span>
                ) : paymentDifference < 0 ? (
                  <span className="pay-diff-discount">Desconto: <Money value={paymentDiscount} /></span>
                ) : (
                  <span className="pay-diff-surcharge">Juros / acréscimo: <Money value={paymentSurcharge} /></span>
                )}
              </div>
            )}

            {/* Justificativa da diferença — compras e folha */}
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
              {isSimpleLedger(paying) ? (
                <>Você está baixando <strong>{paying.taxDocumentType ?? paying.supplierName}</strong> no valor de{" "}<strong><Money value={paymentPaidAmount > 0 ? paymentPaidAmount : paymentOriginalAmount} /></strong>.</>
              ) : (
                <>
                  Você está baixando{paying.installment != null ? ` a parcela ${formatInstallment(paying.installment, paying.totalInstallments, paying.paymentMethodName)}` : ""}
                  {paying.invoiceNumber
                    ? ` da NF ${paying.invoiceNumber}`
                    : paying.purchaseNumber
                      ? ` do pedido ${paying.purchaseNumber}`
                      : ""}
                  {" "}no valor de{" "}
                  <strong><Money value={paymentPaidAmount > 0 ? paymentPaidAmount : paymentOriginalAmount} /></strong>.
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

      {/* ── Modal: Ver imposto / folha ───────────────────────────── */}
      {!detail && selectedPayable && isSimpleLedger(selectedPayable) && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal">
            <div className="section-heading">
              <div>
                <p>{isPayroll(selectedPayable) ? "Folha de pagamento" : "Imposto / Guia"}</p>
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
                    <DsStatusBadge tone={statusTones[selectedPayable.status] ?? "neutral"}>
                      {statusLabels[selectedPayable.status] ?? selectedPayable.status}
                    </DsStatusBadge>
                  </p>
                </div>
                <div>
                  <h3>{isPayroll(selectedPayable) ? "Funcionário" : "Empresa"}</h3>
                  {selectedPayable.taxCompanyName && <p>Nome: <strong>{selectedPayable.taxCompanyName}</strong></p>}
                  {selectedPayable.taxCnpj && <p>CNPJ: <strong>{selectedPayable.taxCnpj}</strong></p>}
                </div>
                <div>
                  <h3>Datas e valores</h3>
                  {selectedPayable.taxCompetenceDate && <p>Competência: <strong>{formatDate(selectedPayable.taxCompetenceDate)}</strong></p>}
                  <p>Vencimento: <strong>{formatDate(selectedPayable.dueDate)}</strong></p>
                  <p>Valor: <strong><Money value={selectedPayable.amount ?? 0} /></strong></p>
                  {selectedPayable.paidDate && <p>Pago em: <strong>{formatDate(selectedPayable.paidDate)}</strong></p>}
                  {selectedPayable.paidAmount && <p>Valor pago: <strong><Money value={selectedPayable.paidAmount} /></strong></p>}
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
                    <DsStatusBadge tone={statusTones[selectedPayable.status] ?? "neutral"}>
                      {statusLabels[selectedPayable.status] ?? selectedPayable.status}
                    </DsStatusBadge>
                  </p>
                </div>
                <div>
                  <h3>Valores</h3>
                  <p>Vencimento: <strong>{formatDate(selectedPayable.dueDate)}</strong></p>
                  <p>Valor original: <strong><Money value={selectedPayable.amount ?? 0} /></strong></p>
                  {["PAID", "PAID_LATE"].includes(selectedPayable.status) && selectedPayable.paidDate && (
                    <>
                      <p>Pago em: <strong>{formatDate(selectedPayable.paidDate)}</strong></p>
                      <p>Valor pago: <strong><Money value={selectedPayable.paidAmount ?? 0} /></strong></p>
                    </>
                  )}
                </div>
                <div>
                  <h3>Compra</h3>
                  <p>Data: <strong>{formatDate(detail.purchaseDate)}</strong></p>
                  <p>Forma: <strong>{detail.paymentMethodName ?? detail.paymentMethod ?? "-"}</strong></p>
                  <p>Total NF: <strong><Money value={detail.totalAmount} /></strong></p>
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
                        <td><Money value={item.unitPrice} /></td>
                        <td><Money value={item.totalPrice} /></td>
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
                        <td><Money value={inst.amount ?? 0} /></td>
                        <td>{formatDate(inst.paidDate)}</td>
                        <td><Money value={inst.paidAmount ?? 0} /></td>
                        <td>
                          <DsStatusBadge tone={statusTones[inst.status ?? "OPEN"] ?? "neutral"}>
                            {statusLabels[inst.status ?? "OPEN"] ?? inst.status}
                          </DsStatusBadge>
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
                <div><span>Valor pago</span><strong><Money value={reversing.paidAmount ?? reversing.amount ?? 0} /></strong></div>
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
