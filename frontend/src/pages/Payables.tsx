import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser, AuditLog, Company, CompanyBankAccount, checkPayrollPayBatch,
  downloadPayablesFinancialPdf, deletePayrollItem, getAllBankAccounts, getCompanies,
  getPayableHistory, getPayables, getPaymentMethods, getPurchase,
  getTaxPaymentHistory, getSuppliers, payExtraPayment, payInstallment, payPayrollItem, payTaxPayment,
  Payable, PaymentMethod, PurchaseDetail, reverseExtraPayment, reverseInstallment, reversePayrollItem, reverseTaxPayment, Supplier
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Button, EmptyState, IconButton, Money, PanelEyebrow } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { currentMonthPeriod, periodForPreset, PeriodPreset, PeriodState } from "../utils/period";
import { DetalheSimples } from "./payables/DetalheSimples";
import { DetalheTitulo } from "./payables/DetalheTitulo";
import { ListaTitulos } from "./payables/ListaTitulos";
import { ModalBaixa, type FormBaixa } from "./payables/ModalBaixa";
import { ModalBaixaLote, type ResultadoLote } from "./payables/ModalBaixaLote";
import { ModalEstorno, ModalHistorico } from "./payables/ModalEstorno";
import { PainelFiltros } from "./payables/PainelFiltros";
import { ResumoKpis, type CartaoResumo } from "./payables/ResumoKpis";
import {
  addDaysKey, agruparPorVencimento, basePaymentName, combinaSubtipo, contarFiltrosAtivos, dateKey,
  isExtra, isPayroll, isSimpleLedger, isTaxPayment, minDateKey, rotuloPeriodo, somarValores, todayKey,
  type FiltrosPagar
} from "./payables/regras";
import { ConfirmaBaixaDuplicada } from "./payables/ConfirmaBaixaDuplicada";
import { recusaDaFolha, type RecusaFolha, type SuspeitoLote } from "../lib/folha-duplicidade";
import "./payables/payables.css";

function payPessoal(p: Payable, payload: Parameters<typeof payPayrollItem>[1]) {
  return isExtra(p) ? payExtraPayment(p.id, payload) : payPayrollItem(p.id, payload);
}

// Filtros avançados começam recolhidos; a escolha fica neste navegador.
const CHAVE_FILTROS_ABERTOS = "contas-a-pagar-filtros-abertos";

const MODOS_VISTA = [
  { key: "open", label: "Em aberto" },
  { key: "paid", label: "Baixados" },
  { key: "all", label: "Todos" }
] as const;

const ATALHOS = [
  { key: "overdue", label: "Vencidos" },
  { key: "today", label: "Hoje" },
  { key: "next7", label: "Próx. 7 dias" },
  { key: "boleto", label: "Boleto" },
  { key: "cartao", label: "Cartão" },
  { key: "noduedate", label: "Sem vencimento" }
] as const;

const FORM_VAZIO: FormBaixa = {
  paidDate: todayKey(), paidAmount: "", paidPaymentMethod: "",
  paymentNotes: "", differenceReason: "", payingCompanyId: "", companyBankAccountId: ""
};

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
  // Exclusão de lançamento da Folha não pago (ex.: VT que não vai ser pago); null = formulário fechado.
  const [excluirMotivo, setExcluirMotivo] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [historyOnly, setHistoryOnly] = useState<Payable | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);
  // Baixa em lote: um pagamento cobrindo vários títulos (ex.: o VT de toda a
  // equipe numa quinzena). Cada título continua recebendo a sua própria baixa.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<ResultadoLote | null>(null);
  // Travas de baixa em duplicidade da folha: a recusa da baixa individual (409) e os
  // suspeitos do lote, conferidos antes de baixar qualquer título.
  const [baixaDuplicada, setBaixaDuplicada] = useState<RecusaFolha | null>(null);
  const [suspeitosLote, setSuspeitosLote] = useState<SuspeitoLote[] | null>(null);
  const [reversing, setReversing] = useState<Payable | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [estornando, setEstornando] = useState(false);
  const [paymentForm, setPaymentForm] = useState<FormBaixa>(FORM_VAZIO);
  // Le o filtro da URL na abertura. Sem isto o alerta do Dashboard levava para
  // esta tela com os filtros padrao, e as parcelas sem vencimento continuavam
  // enterradas — o link existia mas nao resolvia nada.
  const filtroInicialSemVencimento = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("noDueDate") === "1";
  const [filters, setFilters] = useState<FiltrosPagar>({ filter: "", supplierId: "", paymentMethodId: "", status: "", sourceType: "", origin: "all", noDueDate: filtroInicialSemVencimento });
  const [viewMode, setViewMode] = useState<"open" | "paid" | "all">("open");
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [loading, setLoading] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(() => {
    try { return window.localStorage.getItem(CHAVE_FILTROS_ABERTOS) === "1"; } catch { return false; }
  });
  const canManage = hasPermission(user, "payables", "edit");
  const { notice, setNotice } = useNotice();

  function alternarFiltros() {
    setFiltrosAbertos((aberto) => {
      try { window.localStorage.setItem(CHAVE_FILTROS_ABERTOS, aberto ? "0" : "1"); } catch { /* só não lembra */ }
      return !aberto;
    });
  }

  async function load(filterOverride?: typeof filters, periodOverride?: typeof period) {
    setLoading(true);
    setErroCarga(null);
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
      const message = error instanceof Error ? error.message : "Erro ao carregar contas a pagar.";
      setErroCarga(message);
      setNotice({ tone: "error", message });
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
    if (filters.sourceType) result = result.filter((p) => combinaSubtipo(p, filters.sourceType));
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

  const hoje = todayKey();
  const grupos = useMemo(() => agruparPorVencimento(displayedPayables, hoje), [displayedPayables, hoje]);
  const totalExibido = useMemo(() => somarValores(displayedPayables), [displayedPayables]);

  const activeFilterCount = contarFiltrosAtivos(filters, activeChip);

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

  function alterarDataPersonalizada(campo: "startDate" | "endDate", valor: string) {
    const p = { ...period, [campo]: valor };
    setPeriod(p);
    void load(undefined, p);
  }

  function alterarFiltros(u: FiltrosPagar) {
    setFilters(u);
    void load(u);
  }

  function alterarStatus(v: string) {
    const u = { ...filters, status: v };
    if (v === "PAID" || v === "PAID_LATE") setViewMode("paid");
    else if (v === "OPEN" || v === "OVERDUE") setViewMode("open");
    else if (v === "") setViewMode("all");
    setFilters(u);
    void load(u);
  }

  function alterarTipo(origin: string) {
    const impostos = origin === "taxes";
    alterarFiltros({
      ...filters,
      origin,
      supplierId: impostos ? "" : filters.supplierId,
      paymentMethodId: impostos ? "" : filters.paymentMethodId,
      sourceType: impostos ? "" : filters.sourceType
    });
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

  function applyCardFilter(type: CartaoResumo) {
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

  function alterarCampo<K extends keyof FormBaixa>(campo: K, valor: FormBaixa[K]) {
    setPaymentForm((prev) => ({ ...prev, [campo]: valor }));
  }

  async function openTitle(payable: Payable) {
    try {
      if (isTaxPayment(payable)) {
        const audits = await getTaxPaymentHistory(payable.id);
        setSelectedPayable(payable);
        setDetail(null);
        setHistoryRows(audits);
      } else if (isPayroll(payable) || isExtra(payable)) {
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
  function alternarGrupo(ids: string[], marcar: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (marcar) next.add(id); else next.delete(id);
      }
      return next;
    });
  }

  // Antes de baixar QUALQUER título do lote, a folha confere tudo de uma vez: o que já
  // tem o mesmo pagamento pago e o que se repete dentro do próprio lote. Havendo
  // suspeito, nada é baixado: a pessoa confirma ou tira os itens. Devolve se pode seguir.
  async function conferirLoteDaFolha(): Promise<boolean> {
    const idsFolha = selecionados.filter((p) => isPayroll(p)).map((p) => p.id);
    if (idsFolha.length === 0) return true;
    try {
      const { suspeitos } = await checkPayrollPayBatch(idsFolha);
      if (suspeitos.length === 0) return true;
      setSuspeitosLote(suspeitos);
      return false;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Não consegui conferir o lote antes de baixar." });
      return false;
    }
  }

  function tirarSuspeitosDoLote() {
    const fora = new Set((suspeitosLote ?? []).map((s) => s.item.id));
    const ficam = [...selectedIds].filter((id) => !fora.has(id));
    setSelectedIds(new Set(ficam));
    setSuspeitosLote(null);
    // Lote ficou vazio: não há o que baixar, a janela fecha.
    if (ficam.length === 0) {
      setBatchOpen(false);
      setNotice({ tone: "info", message: "Os títulos suspeitos saíram do lote; nada foi baixado." });
    }
  }

  async function submitBatch(confirmaSuspeitos = false) {
    if (selecionados.length === 0) return;
    if (!paymentForm.paidDate) { setNotice({ tone: "error", message: "Data do pagamento é obrigatória." }); return; }
    // Impostos usam fluxo simples; os demais exigem forma de pagamento.
    if (selecionados.some((p) => !isTaxPayment(p)) && !paymentForm.paidPaymentMethod) {
      setNotice({ tone: "error", message: "Forma de pagamento é obrigatória." });
      return;
    }

    setBatchBusy(true);
    if (!confirmaSuspeitos && !(await conferirLoteDaFolha())) { setBatchBusy(false); return; }
    // Só os suspeitos que a pessoa viu e confirmou vão com a confirmação.
    const confirmados = new Set(confirmaSuspeitos ? (suspeitosLote ?? []).map((s) => s.item.id) : []);
    setSuspeitosLote(null);
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
        } else if (isPayroll(p) || isExtra(p)) {
          await payPessoal(p, { paymentDate: paymentForm.paidDate, paidAmount: valor, ...comum, ...(confirmados.has(p.id) ? { confirmaDuplicidade: true } : {}) });
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

  async function submitPayment(confirmaDuplicidade = false) {
    if (!paying) return;
    setBaixaDuplicada(null);
    if (!paymentForm.paidDate) {
      setNotice({ tone: "error", message: "Data do pagamento é obrigatória." });
      return;
    }
    const paidAmount = Number(paymentForm.paidAmount || 0);
    if (paidAmount <= 0) {
      setNotice({ tone: "error", message: "Valor pago deve ser maior que zero." });
      return;
    }

    setSalvandoBaixa(true);
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
        if (isPayroll(paying) || isExtra(paying)) {
          await payPessoal(paying, { paymentDate: paymentForm.paidDate, paidAmount, ...commonPayload, ...(confirmaDuplicidade ? { confirmaDuplicidade: true } : {}) });
        } else {
          await payInstallment(paying.id, { paidDate: paymentForm.paidDate, paidAmount, ...commonPayload });
        }
      }
      setNotice({ tone: "success", message: "Baixa registrada com sucesso." });
      setPaying(null);
      await load();
    } catch (error) {
      // Mesmo pagamento já pago em outro título da folha: pergunta antes de baixar de novo.
      const duplicada = recusaDaFolha(error, "BAIXA_DUPLICADA");
      if (duplicada) setBaixaDuplicada(duplicada);
      else setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao registrar baixa." });
    } finally {
      setSalvandoBaixa(false);
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
    setEstornando(true);
    try {
      if (isTaxPayment(reversing)) {
        await reverseTaxPayment(reversing.id, reason);
      } else if (isPayroll(reversing)) {
        await reversePayrollItem(reversing.id, reason);
      } else if (isExtra(reversing)) {
        await reverseExtraPayment(reversing.id, reason);
      } else {
        await reverseInstallment(reversing.id, reason);
      }
      setNotice({ tone: "success", message: "Pagamento estornado com sucesso." });
      setReversing(null);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao estornar pagamento." });
    } finally {
      setEstornando(false);
    }
  }

  function fecharDetalheSimples() {
    setSelectedPayable(null);
    setHistoryRows([]);
    setExcluirMotivo(null);
  }

  function fecharDetalheCompra() {
    setDetail(null);
    setSelectedPayable(null);
    setHistoryRows([]);
  }

  async function submitExcluirFolha() {
    if (!selectedPayable || excluirMotivo === null) return;
    const reason = excluirMotivo.trim();
    if (reason.length < 3) { setNotice({ tone: "error", message: "Informe o motivo da exclusão (mín. 3 letras)." }); return; }
    setExcluindo(true);
    try {
      await deletePayrollItem(selectedPayable.id, reason);
      setNotice({ tone: "success", message: `Lançamento excluído: ${selectedPayable.taxDocumentType ?? "Folha"} de ${selectedPayable.taxCompanyName ?? selectedPayable.supplierName}.` });
      fecharDetalheSimples();
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao excluir o lançamento." });
    } finally {
      setExcluindo(false);
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

  const temFiltroOuBusca = activeFilterCount > 0 || Boolean(searchQuery) || Boolean(activeChip);
  const descricaoPeriodo = filters.noDueDate
    ? "Sem vencimento"
    : `${rotuloPeriodo(period.preset)} · ${formatDate(period.startDate)} a ${formatDate(period.endDate)}`;
  const todosMarcados = selecionaveis.length > 0 && selectedIds.size === selecionaveis.length;

  return (
    <section className="panel pg-tela">
      <Notice notice={notice} />

      {/* ── Topo: título da seção e ações ───────────────────────── */}
      <div className="pg-topo">
        <PanelEyebrow>Resumo financeiro</PanelEyebrow>
        <div className="pg-topo-acoes">
          <Button variant="secondary" size="sm" leadingIcon={<FileText size={15} />} onClick={handleFinancialPdf}>
            PDF financeiro
          </Button>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar" size="sm" onClick={() => load()} disabled={loading} />
        </div>
      </div>

      {/* ── Totais (clicáveis: filtram a lista) ─────────────────── */}
      <ResumoKpis totais={totals} onCartao={applyCardFilter} />

      {/* ── Busca + filtros ─────────────────────────────────────── */}
      <div className="pg-barra">
        <div className="pg-busca">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar títulos"
            placeholder="Buscar fornecedor, funcionário, NF, pedido ou valor…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="pg-busca-limpar" onClick={() => setSearchQuery("")} aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`pg-botao-filtros${activeFilterCount > 0 ? " pg-botao-filtros--ativo" : ""}`}
          aria-expanded={filtrosAbertos}
          aria-controls="pg-filtros-avancados"
          onClick={alternarFiltros}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Filtros
          {activeFilterCount > 0 && <span className="pg-contador" aria-label={`${activeFilterCount} ativos`}>{activeFilterCount}</span>}
        </button>
        {temFiltroOuBusca && (
          <button type="button" className="pg-link" onClick={clearFilters}>Limpar</button>
        )}
      </div>

      {filtrosAbertos && (
        <PainelFiltros
          id="pg-filtros-avancados"
          filtros={filters}
          periodo={period}
          fornecedores={suppliers}
          formas={effectivePaymentOptions}
          onPeriodo={handlePeriodChange}
          onData={alterarDataPersonalizada}
          onFiltros={alterarFiltros}
          onStatus={alterarStatus}
          onTipo={alterarTipo}
        />
      )}

      <div className="pg-vistas">
        <div className="pg-segmento" role="group" aria-label="Situação dos títulos">
          {MODOS_VISTA.map((mode) => (
            <button key={mode.key} type="button" aria-pressed={viewMode === mode.key} onClick={() => setViewMode(mode.key)}>
              {mode.label}
            </button>
          ))}
        </div>
        <div className="pg-atalhos" role="group" aria-label="Atalhos">
          {ATALHOS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="pg-chip"
              aria-pressed={activeChip === chip.key}
              onClick={() => applyChip(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Resumo do que está na tela ──────────────────────────── */}
      <div className="pg-resultado" aria-live="polite">
        {canManage && selecionaveis.length > 0 && !loading && (
          <input
            type="checkbox"
            className="pg-check"
            checked={todosMarcados}
            ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && !todosMarcados; }}
            onChange={toggleTodos}
            aria-label={`Selecionar todos em aberto (${selecionaveis.length})`}
            title={`Selecionar todos em aberto (${selecionaveis.length})`}
          />
        )}
        <span className="pg-resultado-qtd">
          {loading ? "Carregando…" : `${displayedPayables.length} ${displayedPayables.length === 1 ? "título" : "títulos"}`}
        </span>
        {!loading && displayedPayables.length > 0 && (
          <strong className="pg-num"><Money value={totalExibido} /></strong>
        )}
        <span className="pg-resultado-periodo">{descricaoPeriodo}</span>
      </div>

      {/* ── Lista de títulos ─────────────────────────────────────── */}
      {loading ? (
        <div className="pg-carregando" role="status" aria-label="Carregando contas">
          {[0, 1, 2, 3].map((i) => <div key={i} className="pg-esqueleto" />)}
        </div>
      ) : erroCarga ? (
        <div className="pg-erro" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Não foi possível carregar as contas a pagar.</strong>
            <p>{erroCarga}</p>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => load()}>Tentar de novo</Button>
        </div>
      ) : displayedPayables.length === 0 ? (
        <EmptyState
          title={searchQuery
            ? `Nenhum título encontrado para "${searchQuery}".`
            : viewMode === "open"
              ? "Nada em aberto neste período."
              : "Nenhum título neste período."}
          description={temFiltroOuBusca ? "Ajuste a busca ou limpe os filtros." : "Mude o período em Filtros ou veja os baixados."}
        />
      ) : (
        <ListaTitulos
          grupos={grupos}
          hoje={hoje}
          podeGerir={canManage}
          podeSelecionar={podeSelecionar}
          selecionados={selectedIds}
          onAlternar={toggleSelecionado}
          onAlternarGrupo={alternarGrupo}
          onVer={openTitle}
          onBaixar={startPayment}
          onEstornar={openReverse}
          onHistorico={openHistory}
        />
      )}

      {/* ── Barra da seleção (fica presa embaixo enquanto houver seleção) ── */}
      {canManage && selecionados.length > 0 && (
        <div className="pg-selecao" role="region" aria-label="Títulos selecionados">
          <span className="pg-selecao-info">
            <strong>{selecionados.length}</strong> selecionado(s) · <strong className="pg-num"><Money value={totalSelecionado} /></strong>
          </span>
          <span className="pg-selecao-acoes">
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
            <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => { setBatchResult(null); setBatchOpen(true); }}>
              Baixar selecionados
            </Button>
          </span>
        </div>
      )}

      {batchOpen && (
        <ModalBaixaLote
          selecionados={selecionados}
          total={totalSelecionado}
          form={paymentForm}
          onCampo={alterarCampo}
          onEmpresa={(id) => void handleCompanyChange(id)}
          formas={effectivePaymentOptions}
          companies={companies}
          notice={notice}
          ocupado={batchBusy}
          resultado={batchResult}
          suspeitos={suspeitosLote}
          onTirarSuspeitos={tirarSuspeitosDoLote}
          onBaixarMesmoAssim={() => void submitBatch(true)}
          onFechar={() => { setBatchOpen(false); setSuspeitosLote(null); }}
          onFecharResultado={() => { setBatchOpen(false); setBatchResult(null); }}
          onConfirmar={() => void submitBatch()}
        />
      )}

      {paying && (
        <ModalBaixa
          paying={paying}
          form={paymentForm}
          onCampo={alterarCampo}
          onEmpresa={(id) => void handleCompanyChange(id)}
          formas={effectivePaymentOptions}
          companies={companies}
          bankAccounts={bankAccounts}
          notice={notice}
          enviando={salvandoBaixa}
          onFechar={() => { setPaying(null); setBaixaDuplicada(null); }}
          onConfirmar={() => void submitPayment()}
        />
      )}

      {paying && baixaDuplicada && (
        <ConfirmaBaixaDuplicada
          recusa={baixaDuplicada}
          enviando={salvandoBaixa}
          onCancelar={() => setBaixaDuplicada(null)}
          onConfirmar={() => void submitPayment(true)}
        />
      )}

      {!detail && selectedPayable && isSimpleLedger(selectedPayable) && (
        <DetalheSimples
          titulo={selectedPayable}
          historico={historyRows}
          notice={notice}
          excluirMotivo={excluirMotivo}
          excluindo={excluindo}
          onMotivo={setExcluirMotivo}
          onExcluir={() => void submitExcluirFolha()}
          onFechar={fecharDetalheSimples}
        />
      )}

      {detail && selectedPayable && (
        <DetalheTitulo titulo={selectedPayable} compra={detail} historico={historyRows} onFechar={fecharDetalheCompra} />
      )}

      {reversing && (
        <ModalEstorno
          titulo={reversing}
          motivo={reverseReason}
          onMotivo={setReverseReason}
          notice={notice}
          enviando={estornando}
          onFechar={() => setReversing(null)}
          onConfirmar={() => void submitReverse()}
        />
      )}

      {historyOnly && (
        <ModalHistorico titulo={historyOnly} linhas={historyRows} onFechar={() => setHistoryOnly(null)} />
      )}
    </section>
  );
}
