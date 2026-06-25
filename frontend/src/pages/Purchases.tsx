import { ChevronDown, Copy, Eye, FileText, Package, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { UNSAFE_NavigationContext, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AppUser,
  checkPurchaseDuplicate,
  cancelPurchase,
  createPurchase,
  CreditCard,
  CreditCardStatement,
  downloadSmallExpensesPdf,
  downloadSupplierPositionPdf,
  getCards,
  getCardStatements,
  getPaymentMethods,
  getProducts,
  getPurchase,
  getPurchases,
  getSmallExpenseReport,
  getSmallExpenseTypes,
  getSuppliers,
  getUnits,
  PaymentMethod,
  Product,
  Purchase,
  PurchaseDuplicateCheck,
  PurchaseDetail,
  restorePurchase,
  SmallExpenseReport,
  SmallExpenseType,
  Supplier,
  UnitMeasure,
  updatePurchase,
  Company,
  getCompanies
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PeriodFilter } from "../components/PeriodFilter";
import { hasPermission } from "../lib/permissions";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

type PurchaseItemForm = {
  productCode: string;
  productId: string;
  productName: string;
  categoryName: string;
  subcategoryName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  notes: string;
};

type InstallmentForm = {
  installment: number;
  dueDate: string;
  amount: string;
};

type PurchaseSortOption = "recent" | "oldest" | "highest" | "lowest";

type ProductStep = "produtos" | "quantidades" | "valores" | "conferencia";

const STEP_LABELS: Record<ProductStep, string> = {
  produtos: "1 Produtos",
  quantidades: "2 Quantidades",
  valores: "3 Valores",
  conferencia: "4 Conferência"
};
const STEP_ORDER: ProductStep[] = ["produtos", "quantidades", "valores", "conferencia"];

type EntryLine = {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string;
  subcategoryName: string;
  unit: string;
  query: string;
  editingIndex: number | null;
};

const emptyEntry: EntryLine = {
  productId: "", productName: "", productCode: "",
  categoryName: "", subcategoryName: "",
  unit: "", query: "", editingIndex: null
};


function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizePurchaseReference(value?: string | null) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/g, ""));
}

function parseLegacyInstallmentCount(name?: string | null) {
  const match = normalize(name).match(/^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/);
  if (!match) return null;
  const count = Number(match[2]);
  return count > 0 ? count : null;
}

function basePaymentMethodName(name?: string | null) {
  const raw = String(name ?? "").trim();
  const normalized = normalize(raw);
  const match = normalized.match(/^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/);
  const base = match ? normalize(match[1]) : normalized;
  if (base.includes("boleto")) return "BOLETO";
  if (base.includes("faturado") || base.includes("prazo")) return "FATURADO";
  if (base.includes("cartao") && base.includes("credito")) return "CARTÃO CRÉDITO";
  if (base.includes("cartao") && base.includes("debito")) return "CARTÃO DÉBITO";
  if (base.includes("pix")) return "PIX";
  if (base.includes("dinheiro") || base.includes("caixa")) return "DINHEIRO";
  return raw || "";
}

function isLegacyInstallmentMethod(method?: PaymentMethod | null) {
  return Boolean(parseLegacyInstallmentCount(method?.name));
}

function allowsInstallments(method?: PaymentMethod | null) {
  const baseName = normalize(basePaymentMethodName(method?.name));
  if (["boleto", "faturado", "cartao credito"].includes(baseName)) return true;
  if (normalize(method?.group) === "faturado") return true;
  return ["credit_card", "bank_slip"].includes(normalize(method?.type));
}

function installmentCountFromPurchase(methodName?: string | null, totalInstallments?: number | null) {
  return totalInstallments ?? parseLegacyInstallmentCount(methodName) ?? 1;
}

function splitAmount(total: number, parts: number) {
  if (parts <= 0) return [];
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  // Última parcela absorve os centavos restantes
  return Array.from({ length: parts }, (_, index) => {
    const isLast = index === parts - 1;
    return ((base + (isLast ? remainder : 0)) / 100).toFixed(2);
  });
}

function addDaysToInputDate(inputDate: string, days: number) {
  const baseDate = inputDate ? new Date(`${inputDate}T12:00:00`) : new Date();
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate.toISOString().slice(0, 10);
}

function installmentStatusLabel(status?: string | null) {
  if (status === "PAID") return "Pago";
  if (status === "PAID_LATE") return "Pago com atraso";
  if (status === "OVERDUE") return "Atrasado";
  if (status === "CANCELLED") return "Cancelado";
  return "Em aberto";
}

function installmentStatusTone(status?: string | null) {
  if (status === "PAID") return "paid";
  if (status === "PAID_LATE") return "paid_late";
  if (status === "OVERDUE") return "overdue";
  if (status === "CANCELLED") return "cancelled";
  return "open";
}

function purchaseStatusLabel(status?: string | null) {
  return status === "CANCELLED" ? "Cancelada" : "Ativa";
}

function purchaseStatusTone(status?: string | null) {
  return status === "CANCELLED" ? "cancelled" : "paid";
}

function statementStatusLabel(status?: string | null) {
  if (status === "CHECKED") return "Conferida";
  if (status === "CLOSED") return "Fechada";
  if (status === "PAID") return "Paga";
  if (status === "CANCELLED") return "Cancelada";
  return "Aberta";
}

function statementStatusTone(status?: string | null) {
  if (status === "CHECKED") return "warning";
  if (status === "CLOSED") return "warning";
  if (status === "PAID") return "paid";
  if (status === "CANCELLED") return "cancelled";
  return "open";
}

function purchaseSortValue(sort: PurchaseSortOption, purchase: Purchase) {
  if (sort === "recent" || sort === "oldest") return new Date(purchase.purchaseDate).getTime();
  return Number(purchase.totalAmount || 0);
}

function useNavigationPrompt(when: boolean, message: string) {
  const navigationContext = useContext(UNSAFE_NavigationContext);

  useEffect(() => {
    const navigator = navigationContext?.navigator as { block?: (listener: (tx: { retry(): void }) => void) => () => void } | undefined;
    if (!when || !navigator?.block) return;

    const unblock = navigator.block((transaction) => {
      if (!window.confirm(message)) return;
      unblock();
      transaction.retry();
    });

    return unblock;
  }, [message, navigationContext, when]);
}

export function Purchases({ user }: { user: AppUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [units, setUnits] = useState<UnitMeasure[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [openCardStatement, setOpenCardStatement] = useState<CreditCardStatement | null>(null);
  const [smallExpenseTypes, setSmallExpenseTypes] = useState<SmallExpenseType[]>([]);
  const [filters, setFilters] = useState({
    supplierId: "",
    category: "",
    paymentMethod: "",
    search: "",
    showCancelled: ""
  });
  const [sortBy, setSortBy] = useState<PurchaseSortOption>("recent");
  const [supplierFilterQuery, setSupplierFilterQuery] = useState("");
  const [supplierFilterOpen, setSupplierFilterOpen] = useState(false);
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [form, setForm] = useState({
    supplierCode: "",
    supplierId: "",
    supplierName: "",
    supplierDocument: "",
    purchaseDate: todayInputDate(),
    invoiceNumber: "",
    purchaseOrderNumber: "",
    noInvoiceReason: "",
    paymentMethodId: "",
    installmentCount: "1",
    paymentNotes: "",
    notes: "",
    isSmallExpense: false,
    smallExpenseTypeId: "",
    smallExpenseResponsibleName: "",
    smallExpenseAuthorizedBy: "",
    smallExpenseMoneyOrigin: "",
    smallExpenseNotes: "",
    creditCardId: "",
    ccNumberOfInstallments: "1",
    paymentDifferenceReason: "",
    companyId: ""
  });
  const [items, setItems] = useState<PurchaseItemForm[]>([]);
  const [entry, setEntry] = useState<EntryLine>({ ...emptyEntry });
  const [entryDropdownOpen, setEntryDropdownOpen] = useState(false);
  const [entryDropdownCursor, setEntryDropdownCursor] = useState(-1);
  const [showPendingPopover, setShowPendingPopover] = useState(false);
  const [installments, setInstallments] = useState<InstallmentForm[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [showSmallExpenses, setShowSmallExpenses] = useState(false);
  const [smallExpenseReport, setSmallExpenseReport] = useState<SmallExpenseReport | null>(null);
  const [smallExpenseFilters, setSmallExpenseFilters] = useState({
    employee: "",
    authorizedBy: "",
    origin: "",
    type: "",
    supplier: "",
    paymentMethod: "",
    category: "",
    product: ""
  });
  const [showNoInvoiceReason, setShowNoInvoiceReason] = useState(false);
  const [showExtraNotes, setShowExtraNotes] = useState(false);
  const [showPaymentNotes, setShowPaymentNotes] = useState(false);
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const [productStep, setProductStep] = useState<ProductStep>("produtos");
  const [filtersExpanded, setFiltersExpanded] = useState(() => window.innerWidth > 640);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [productSheetQuery, setProductSheetQuery] = useState("");
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);
  const [supplierSheetQuery, setSupplierSheetQuery] = useState("");
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);
  const [entryFeedback, setEntryFeedback] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [pasteReport, setPasteReport] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicateCheck, setDuplicateCheck] = useState<PurchaseDuplicateCheck | null>(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalTopRef = useRef<HTMLDivElement | null>(null);
  const supplierFilterRef = useRef<HTMLDivElement | null>(null);
  const supplierFormRef = useRef<HTMLDivElement | null>(null);
  const productRef = useRef<HTMLDivElement | null>(null);
  const entryProductRef = useRef<HTMLInputElement | null>(null);
  const gridQtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const gridPriceRefs = useRef<(HTMLInputElement | null)[]>([]);
  const paymentBlockRef = useRef<HTMLDivElement | null>(null);
  const productSheetSearchRef = useRef<HTMLInputElement | null>(null);
  const supplierSheetSearchRef = useRef<HTMLInputElement | null>(null);
  const { notice, setNotice } = useNotice();

  const isAdmin = hasPermission(user, "purchases", "admin");
  const canEditPurchase = hasPermission(user, "purchases", "edit");
  const canManageSupplier = hasPermission(user, "suppliers", "edit");
  const isCreateRoute = location.pathname === "/compras/nova";
  const isEditRoute = /\/compras\/[^/]+\/editar$/.test(location.pathname);
  const isFormRoute = isCreateRoute || isEditRoute;

  async function loadPurchases() {
    setLoading(true);
    setError(null);
    try {
      setPurchases(await getPurchases({ ...filters, startDate: period.startDate, endDate: period.endDate }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar compras.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSmallExpenses() {
    try {
      setSmallExpenseReport(await getSmallExpenseReport({ startDate: period.startDate, endDate: period.endDate, ...smallExpenseFilters }));
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao carregar pequenos gastos." });
    }
  }

  async function handleSmallExpensesPdf() {
    try {
      await downloadSmallExpensesPdf({ startDate: period.startDate, endDate: period.endDate, ...smallExpenseFilters });
      setNotice({ tone: "success", message: "PDF de pequenos gastos gerado." });
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao gerar PDF de pequenos gastos." });
    }
  }

  useEffect(() => {
    void loadPurchases();
    Promise.all([getSuppliers({ activeOnly: true }), getProducts(), getPaymentMethods(), getUnits(), getCards(), getSmallExpenseTypes(), getCompanies().catch(() => [] as Company[])]).then(
      ([supplierList, productList, methodList, unitList, cardList, smallExpenseTypeList, companyList]) => {
        setSuppliers(supplierList);
        setProducts(productList);
        setPaymentMethods(methodList.filter((method) => method.isActive));
        setUnits(unitList.filter((unit) => unit.isActive));
        setCreditCards(cardList.filter((card) => card.isActive));
        setSmallExpenseTypes(smallExpenseTypeList.filter((type) => type.isActive));
        setCompanies(companyList.filter((c) => c.isActive));
      }
    );
  }, []);

  useEffect(() => {
    if (showSmallExpenses) void loadSmallExpenses();
  }, [showSmallExpenses, period.startDate, period.endDate]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (supplierFilterRef.current && !supplierFilterRef.current.contains(target)) setSupplierFilterOpen(false);
      if (supplierFormRef.current && !supplierFormRef.current.contains(target)) setSupplierFilterOpen(false);
      if (productRef.current && !productRef.current.contains(target)) setEntryDropdownOpen(false);
      if (!(event.target as Element).closest?.(".pnova-pending-wrap")) setShowPendingPopover(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (error && showForm) modalTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [error, showForm]);

  useEffect(() => {
    if (isCreateRoute) {
      type CopyData = { form: typeof form; items: PurchaseItemForm[]; showExtraNotes: boolean };
      const copyData = (location.state as { copyData?: CopyData } | null)?.copyData;
      if (copyData) {
        // Limpa location.state para não reaplicar em re-render
        navigate({ pathname: "/compras/nova", search: location.search }, { replace: true, state: null });
        setForm(copyData.form);
        setItems(copyData.items);
        setInstallments([]);
        setShowExtraNotes(copyData.showExtraNotes);
        setShowNoInvoiceReason(false);
        setShowPaymentNotes(false);
        setFieldErrors({});
        setDuplicateCheck(null);
        setEditingId(null);
        setError(null);
        setProductStep("conferencia");
        setPaymentExpanded(true);
        setShowForm(true);
        markFormClean({ formState: copyData.form, itemState: copyData.items, installmentState: [] });
        return;
      }
      resetForm();
      setError(null);
      setEditingId(null);
      setShowForm(true);
      window.setTimeout(() => supplierFormRef.current?.querySelector("input")?.focus(), 80);
      markFormClean({
        formState: {
          supplierCode: "",
          supplierId: "",
          supplierName: "",
          supplierDocument: "",
          purchaseDate: todayInputDate(),
          invoiceNumber: "",
          purchaseOrderNumber: "",
          noInvoiceReason: "",
          paymentMethodId: "",
          installmentCount: "1",
          paymentNotes: "",
          notes: "",
          isSmallExpense: false,
          smallExpenseTypeId: "",
          smallExpenseResponsibleName: "",
          smallExpenseAuthorizedBy: "",
          smallExpenseMoneyOrigin: "",
          smallExpenseNotes: "",
          creditCardId: "",
          ccNumberOfInstallments: "1",
          paymentDifferenceReason: "",
          companyId: ""
        },
        itemState: [],
        installmentState: [],
        extraNotes: false,
        noInvoice: false,
        paymentNotes: false
      });
      return;
    }
    if (isEditRoute && params.id) {
      void loadPurchaseForEdit(params.id);
      return;
    }
    setShowForm(false);
    setEditingId(null);
  }, [isCreateRoute, isEditRoute, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSupplier = suppliers.find((supplier) => supplier.id === form.supplierId) ?? null;
  const selectedSupplierIsCycle = selectedSupplier?.billingMode === "CYCLE";
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;
  const selectedPaymentMethodBaseName = basePaymentMethodName(selectedPaymentMethod?.name);
  const availablePaymentMethods = useMemo(() => {
    const baseMethods = paymentMethods.filter((method) => !isLegacyInstallmentMethod(method));
    return baseMethods.length > 0 ? baseMethods : paymentMethods;
  }, [paymentMethods]);
  const categories = useMemo(() => [...new Set(products.map((product) => product.category?.name).filter(Boolean))] as string[], [products]);
  const smallExpenseUsesCreditCard = form.isSmallExpense && selectedPaymentMethod ? selectedPaymentMethod.type === "CREDIT_CARD" : false;
  const normalPurchaseUsesCreditCard = !form.isSmallExpense && selectedPaymentMethod ? selectedPaymentMethod.type === "CREDIT_CARD" : false;
  const usesCreditCard = smallExpenseUsesCreditCard || normalPurchaseUsesCreditCard;
  const selectedPaymentMethodAllowsInstallments = allowsInstallments(selectedPaymentMethod);
  const totalAmount = useMemo(() => items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0), [items]);
  const installmentTotal = useMemo(() => installments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0), [installments]);
  const amountDifference = totalAmount - installmentTotal;
  const installmentLeadDays = selectedSupplier?.defaultPaymentTermDays ?? (selectedPaymentMethodAllowsInstallments ? 30 : 0);
  const currentSnapshot = buildFormSnapshot();
  const isDirty = isFormRoute && baselineSnapshot !== "" && currentSnapshot !== baselineSnapshot;
  useNavigationPrompt(isDirty, "Existem alterações não salvas. Deseja sair sem salvar?");

  const ccInstallmentPreview = useMemo(() => {
    if (!normalPurchaseUsesCreditCard || !form.creditCardId || totalAmount <= 0) return [];
    const card = creditCards.find((c) => c.id === form.creditCardId);
    if (!card) return [];
    const n = Math.max(1, Math.floor(Number(form.ccNumberOfInstallments) || 1));
    const purchaseDate = new Date(`${form.purchaseDate}T12:00:00`);
    const day = purchaseDate.getDate();
    const baseDateForPeriod = day <= card.closingDay
      ? purchaseDate
      : new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + 1, 1);
    const baseYear = baseDateForPeriod.getFullYear();
    const baseMonthIndex = baseDateForPeriod.getMonth();
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / n);
    const extraCents = totalCents - baseCents * n;
    const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    return Array.from({ length: n }, (_, i) => {
      const totalMonths = baseYear * 12 + baseMonthIndex + i;
      const targetYear = Math.floor(totalMonths / 12);
      const targetMonth = (totalMonths % 12) + 1;
      const lastDayDue = new Date(targetYear, targetMonth, 0).getDate();
      const dueDate = new Date(targetYear, targetMonth - 1, Math.min(card.dueDay, lastDayDue));
      const value = (baseCents + (i === 0 ? extraCents : 0)) / 100;
      return { installment: i + 1, label: `Fatura ${monthNames[targetMonth - 1]}/${targetYear}`, dueDate, value };
    });
  }, [normalPurchaseUsesCreditCard, form.creditCardId, form.ccNumberOfInstallments, form.purchaseDate, totalAmount, creditCards]);

  const filteredSupplierOptions = useMemo(() => {
    const query = normalize(supplierFilterQuery);
    const queryDigits = supplierFilterQuery.replace(/\D/g, "");
    // Sem busca: mostra a lista inteira de ativos (com fallback a uma prévia se a base crescer muito).
    if (!query && !queryDigits) {
      return suppliers.length <= 100 ? suppliers : suppliers.slice(0, 50);
    }
    // Com busca: pontua cada fornecedor por melhor correspondência (código exato → começa →
    // nome começa → nome contém → CNPJ/CPF por dígitos → código contém) e ordena.
    return suppliers
      .map((supplier) => {
        const code = normalize(supplier.externalCode);
        const name = normalize(supplier.name);
        const docDigits = (supplier.document ?? "").replace(/\D/g, "");
        let rank = 99;
        if (query) {
          if (code && code === query) rank = 0;
          else if (code && code.startsWith(query)) rank = 1;
          else if (name.startsWith(query)) rank = 2;
          else if (name.includes(query)) rank = 3;
          else if (code && code.includes(query)) rank = 5;
        }
        // Documento: compara só dígitos, ignorando . / - do formato salvo.
        // Exige ≥4 dígitos para não poluir buscas por nome com dígito solto (ex.: "wp3").
        if (queryDigits.length >= 4 && docDigits.includes(queryDigits)) rank = Math.min(rank, 4);
        return { supplier, rank };
      })
      .filter((entry) => entry.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.supplier.name.localeCompare(b.supplier.name))
      .map((entry) => entry.supplier);
  }, [supplierFilterQuery, suppliers]);

  const supplierProductIds = useMemo(() => {
    if (!form.supplierId) return new Set<string>();
    const ids = new Set<string>();
    // Coleta IDs de produtos já comprados deste fornecedor (via lista de compras carregada)
    purchases.forEach((purchase) => {
      if (purchase.supplierId === form.supplierId) {
        purchase.items.forEach((item) => { if (item.product?.id) ids.add(item.product.id); });
      }
    });
    return ids;
  }, [form.supplierId, purchases]);

  const entryFilteredProducts = useMemo(() => {
    const query = normalize(entry.query);
    if (!query) return products.filter((p) => p.isActive).slice(0, 10);
    return products
      .filter((product) => {
        const haystack = [
          product.name,
          product.externalCode,
          product.category?.name,
          product.subcategory?.name,
          ...(product.aliases?.map((alias) => alias.alias) ?? [])
        ].map(normalize).join(" ");
        return haystack.includes(query);
      })
      .map((product) => {
        const normCode = normalize(product.externalCode ?? "");
        const normName = normalize(product.name);
        let score = 0;
        if (normCode === query) score += 100;
        else if (normCode.startsWith(query)) score += 60;
        if (supplierProductIds.has(product.id)) score += 40;
        if (normName.startsWith(query)) score += 20;
        if (!product.isActive) score -= 50;
        return { product, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ product }) => product)
      .slice(0, 10);
  }, [entry.query, products, supplierProductIds]);

  const activeFilterCount = [filters.supplierId, filters.category, filters.paymentMethod, filters.search, filters.showCancelled].filter(Boolean).length;

  const displayedPurchases = useMemo(() => {
    const base = purchases.filter((purchase) => {
      if (!filters.showCancelled && purchase.status === "CANCELLED") return false;
      if (filters.showCancelled === "active" && purchase.status === "CANCELLED") return false;
      if (filters.showCancelled === "cancelled" && purchase.status !== "CANCELLED") return false;
      return true;
    });
    return [...base].sort((left, right) => {
      const leftValue = purchaseSortValue(sortBy, left);
      const rightValue = purchaseSortValue(sortBy, right);
      if (sortBy === "recent" || sortBy === "highest") return rightValue - leftValue;
      return leftValue - rightValue;
    });
  }, [filters.showCancelled, purchases, sortBy]);


  useEffect(() => {
    let active = true;
    if (!usesCreditCard || !form.creditCardId) {
      setOpenCardStatement(null);
      return () => { active = false; };
    }
    getCardStatements({ creditCardId: form.creditCardId, status: "OPEN" })
      .then((rows) => { if (active) setOpenCardStatement(rows[0] ?? null); })
      .catch(() => { if (active) setOpenCardStatement(null); });
    return () => { active = false; };
  }, [form.creditCardId, usesCreditCard]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setKeyboardOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Sync sheet queries into the existing filter states so shared useMemos are reused
  useEffect(() => {
    if (productSheetOpen) setEntry((e) => ({ ...e, query: productSheetQuery }));
  }, [productSheetQuery, productSheetOpen]);

  useEffect(() => {
    if (supplierSheetOpen) setSupplierFilterQuery(supplierSheetQuery);
  }, [supplierSheetQuery, supplierSheetOpen]);

  useEffect(() => {
    if (!isFormRoute || !form.supplierId) {
      setDuplicateCheck(null);
      return;
    }

    const normalizedInvoiceNumber = normalizePurchaseReference(form.invoiceNumber);
    const normalizedPurchaseOrderNumber = normalizePurchaseReference(form.purchaseOrderNumber);
    if (!normalizedInvoiceNumber && !normalizedPurchaseOrderNumber) {
      setDuplicateCheck(null);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      checkPurchaseDuplicate({
        supplierId: form.supplierId,
        invoiceNumber: form.invoiceNumber,
        purchaseOrderNumber: form.purchaseOrderNumber,
        excludePurchaseId: editingId ?? undefined
      })
        .then((result) => {
          if (active) setDuplicateCheck(result);
        })
        .catch(() => {
          if (active) setDuplicateCheck(null);
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [editingId, form.invoiceNumber, form.purchaseOrderNumber, form.supplierId, isFormRoute]);

  function selectSupplier(supplierId: string, scope: "filter" | "form") {
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    if (!supplier) return;
    if (scope === "filter") {
      setFilters((current) => ({ ...current, supplierId }));
      setSupplierFilterQuery(`${supplier.externalCode ? `${supplier.externalCode} • ` : ""}${supplier.name}`);
      setSupplierFilterOpen(false);
      return;
    }

    // Fornecedor por ciclo: não resolve método de pagamento nem gera parcelas
    if (supplier.billingMode === "CYCLE") {
      setForm((current) => ({
        ...current,
        supplierId,
        supplierCode: supplier.externalCode ?? "",
        supplierName: supplier.name,
        supplierDocument: supplier.document ?? "",
        paymentMethodId: "",
        installmentCount: "1"
      }));
      setInstallments([]);
      return;
    }

    // Resolve método de pagamento padrão do fornecedor
    const resolvedMethodId = supplier.defaultPaymentMethodId
      ? resolveBasePaymentMethodId(supplier.defaultPaymentMethodId, null)
      : (() => {
          // Fallback global: BOLETO
          const boletoMethod = availablePaymentMethods.find(
            (m) => normalize(basePaymentMethodName(m.name)) === "boleto"
          );
          return boletoMethod?.id ?? form.paymentMethodId ?? "";
        })();

    const supplierInstallmentCount = supplier.defaultInstallmentCount
      ?? (Array.isArray(supplier.defaultInstallmentDays) ? supplier.defaultInstallmentDays.length : null)
      ?? 2;

    const resolvedMethod = paymentMethods.find((m) => m.id === resolvedMethodId) ?? null;
    const count = allowsInstallments(resolvedMethod) ? Math.max(1, supplierInstallmentCount) : 1;
    const resolvedNotes = supplier.defaultFinancialNotes ?? "";

    setForm((current) => ({
      ...current,
      supplierId,
      supplierCode: supplier.externalCode ?? "",
      supplierName: supplier.name,
      supplierDocument: supplier.document ?? "",
      paymentMethodId: resolvedMethodId || current.paymentMethodId,
      installmentCount: String(count),
      paymentNotes: resolvedNotes || current.paymentNotes
    }));

    // Gerar parcelas com os dias customizados do fornecedor
    const days: number[] = Array.isArray(supplier.defaultInstallmentDays) && supplier.defaultInstallmentDays.length > 0
      ? supplier.defaultInstallmentDays as number[]
      : [15, 30]; // fallback global

    if (resolvedNotes) setShowPaymentNotes(true);

    window.setTimeout(() => {
      rebuildInstallmentsWithDays(resolvedMethodId || form.paymentMethodId, totalAmount, count, days, form.purchaseDate);
    }, 0);
  }

  function clearFilterSupplier() {
    setFilters((current) => ({ ...current, supplierId: "" }));
    setSupplierFilterQuery("");
    setSupplierFilterOpen(false);
  }

  function resolveBasePaymentMethodId(paymentMethodId?: string | null, paymentMethodName?: string | null) {
    const direct = paymentMethods.find((method) => method.id === paymentMethodId && !isLegacyInstallmentMethod(method));
    if (direct) return direct.id;
    const baseName = normalize(basePaymentMethodName(paymentMethodName ?? paymentMethods.find((method) => method.id === paymentMethodId)?.name));
    const baseMethod = paymentMethods.find((method) => !isLegacyInstallmentMethod(method) && normalize(basePaymentMethodName(method.name)) === baseName);
    return baseMethod?.id ?? paymentMethodId ?? "";
  }

  function productDefaults(product?: Product) {
    return {
      productCode: product?.externalCode ?? "",
      productId: product?.id ?? "",
      productName: product?.name ?? "",
      categoryName: product?.category?.name ?? "",
      subcategoryName: product?.subcategory?.name ?? "",
      unit: product?.purchaseUnit ?? product?.unit ?? ""
    };
  }



  function removeItemRow(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
    if (entry.editingIndex === index) setEntry({ ...emptyEntry });
    else if (entry.editingIndex !== null && entry.editingIndex > index) {
      setEntry((e) => ({ ...e, editingIndex: (e.editingIndex as number) - 1 }));
    }
  }

  function updateGridItem(index: number, next: Partial<PurchaseItemForm>) {
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item;
      const merged = { ...item, ...next };
      const qty = Number(merged.quantity || 0);
      const price = Number(merged.unitPrice || 0);
      merged.totalPrice = qty > 0 && price > 0 ? (qty * price).toFixed(2) : "";
      return merged;
    }));
  }

  function selectEntryProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const defaults = productDefaults(product);

    if (entry.editingIndex !== null) {
      // Edit-product-identity mode: update only product fields, keep qty/price
      const idx = entry.editingIndex;
      setItems((current) => current.map((item, i) => {
        if (i !== idx) return item;
        const qty = item.quantity;
        const price = item.unitPrice;
        const total = qty && price ? (Number(qty) * Number(price)).toFixed(2) : "";
        return { ...item, ...defaults, quantity: qty, unitPrice: price, totalPrice: total };
      }));
      setEntry({ ...emptyEntry });
      setEntryDropdownOpen(false);
      setEntryDropdownCursor(-1);
      window.setTimeout(() => gridQtyRefs.current[idx]?.focus(), 0);
      return;
    }

    // Duplicate: show notice, focus existing row qty
    const dupIdx = items.findIndex((item) => item.productId === productId);
    if (dupIdx >= 0) {
      setEntry({ ...emptyEntry });
      setEntryDropdownOpen(false);
      setEntryDropdownCursor(-1);
      setEntryFeedback({ tone: "warning", message: `"${product.name}" já lançado — linha ${dupIdx + 1} selecionada.` });
      window.setTimeout(() => setEntryFeedback(null), 3000);
      window.setTimeout(() => {
        gridQtyRefs.current[dupIdx]?.focus();
        gridQtyRefs.current[dupIdx]?.select();
      }, 0);
      return;
    }

    // New product: add to grid with qty=1, price empty, focus back to product field
    const newItem: PurchaseItemForm = {
      productCode: defaults.productCode,
      productId: defaults.productId,
      productName: defaults.productName,
      categoryName: defaults.categoryName,
      subcategoryName: defaults.subcategoryName,
      quantity: "1",
      unit: defaults.unit,
      unitPrice: "",
      totalPrice: "",
      notes: ""
    };
    const newIdx = items.length;
    setItems((current) => [...current, newItem]);
    setHighlightedRow(newIdx);
    window.setTimeout(() => setHighlightedRow(null), 1200);
    setEntryFeedback({ tone: "success", message: "Produto adicionado. Continue digitando o próximo código." });
    window.setTimeout(() => setEntryFeedback(null), 2500);
    setEntry({ ...emptyEntry });
    setEntryDropdownOpen(false);
    setEntryDropdownCursor(-1);
    window.setTimeout(() => entryProductRef.current?.focus(), 0);
  }

  function loadProductIntoEntry(index: number) {
    const item = items[index];
    setEntry({
      productId: item.productId,
      productName: item.productName,
      productCode: item.productCode,
      categoryName: item.categoryName,
      subcategoryName: item.subcategoryName,
      unit: item.unit,
      query: item.productName,
      editingIndex: index
    });
    setEntryDropdownOpen(false);
    setProductStep("produtos");
    if (isMobile) {
      setProductSheetQuery(item.productName);
      setProductSheetOpen(true);
      window.setTimeout(() => productSheetSearchRef.current?.focus(), 100);
    } else {
      window.setTimeout(() => {
        entryProductRef.current?.focus();
        entryProductRef.current?.select();
      }, 0);
    }
  }

  function handleSheetProductSelect(productId: string) {
    const wasEditing = entry.editingIndex !== null;
    selectEntryProduct(productId);
    setProductSheetQuery("");
    if (wasEditing) {
      setProductSheetOpen(false);
    } else {
      window.setTimeout(() => productSheetSearchRef.current?.focus(), 150);
    }
  }

  function closeProductSheet() {
    setProductSheetOpen(false);
    setProductSheetQuery("");
    if (entry.editingIndex !== null) setEntry({ ...emptyEntry });
  }

  function handleSheetSupplierSelect(supplierId: string) {
    selectSupplier(supplierId, "form");
    setSupplierSheetOpen(false);
    setSupplierSheetQuery("");
  }

  function goToStep(step: ProductStep) {
    setProductStep(step);
    if (step === "quantidades") {
      window.setTimeout(() => {
        const first = gridQtyRefs.current[0];
        if (first) { first.focus(); first.select(); }
      }, 0);
    } else if (step === "valores") {
      window.setTimeout(() => {
        const first = gridPriceRefs.current[0];
        if (first) { first.focus(); first.select(); }
      }, 0);
    } else if (step === "produtos") {
      window.setTimeout(() => entryProductRef.current?.focus(), 0);
    } else if (step === "conferencia") {
      setPaymentExpanded(true);
      window.setTimeout(() => paymentBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    }
  }

  function resetForm() {
    setForm({
      supplierCode: "",
      supplierId: "",
      supplierName: "",
      supplierDocument: "",
      purchaseDate: todayInputDate(),
      invoiceNumber: "",
      purchaseOrderNumber: "",
      noInvoiceReason: "",
      paymentMethodId: "",
      installmentCount: "1",
      paymentNotes: "",
      notes: "",
      isSmallExpense: false,
      smallExpenseTypeId: "",
      smallExpenseResponsibleName: "",
      smallExpenseAuthorizedBy: "",
      smallExpenseMoneyOrigin: "",
      smallExpenseNotes: "",
      creditCardId: "",
      ccNumberOfInstallments: "1",
      paymentDifferenceReason: "",
      companyId: ""
    });
    setItems([]);
    setEntry({ ...emptyEntry });
    setInstallments([]);
    setEditingId(null);
    setFieldErrors({});
    setDuplicateCheck(null);
    setShowNoInvoiceReason(false);
    setShowExtraNotes(false);
    setShowPaymentNotes(false);
    setPaymentExpanded(false);
    setProductStep("produtos");
    setHighlightedRow(null);
    setEntryFeedback(null);
    setPasteReport([]);
    setSupplierFilterQuery("");
    setSupplierFilterOpen(false);
  }

  function buildFormSnapshot(next?: {
    formState?: typeof form;
    itemState?: PurchaseItemForm[];
    installmentState?: InstallmentForm[];
    extraNotes?: boolean;
    noInvoice?: boolean;
    paymentNotes?: boolean;
  }) {
    return JSON.stringify({
      form: next?.formState ?? form,
      items: next?.itemState ?? items,
      installments: next?.installmentState ?? installments,
      showExtraNotes: next?.extraNotes ?? showExtraNotes,
      showNoInvoiceReason: next?.noInvoice ?? showNoInvoiceReason,
      showPaymentNotes: next?.paymentNotes ?? showPaymentNotes
    });
  }

  function markFormClean(next?: {
    formState?: typeof form;
    itemState?: PurchaseItemForm[];
    installmentState?: InstallmentForm[];
    extraNotes?: boolean;
    noInvoice?: boolean;
    paymentNotes?: boolean;
  }) {
    setBaselineSnapshot(buildFormSnapshot(next));
  }

  function openNewPurchase() {
    resetForm();
    setError(null);
    navigate({ pathname: "/compras/nova", search: location.search });
  }

  async function openDetail(purchase: Purchase) {
    try {
      setDetail(await getPurchase(purchase.id));
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao abrir compra." });
    }
  }

  async function loadPurchaseForEdit(purchaseId: string) {
    try {
      const data = await getPurchase(purchaseId);
      setEditingId(purchaseId);
      const resolvedPaymentMethodId = resolveBasePaymentMethodId(data.paymentMethodId, data.paymentMethodName ?? data.paymentMethod);
      const nextInstallmentCount = installmentCountFromPurchase(data.paymentMethodName ?? data.paymentMethod, data.installments.length || null);
      const nextForm = {
        supplierCode: data.rawSupplierCode ?? data.supplier.externalCode ?? "",
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        supplierDocument: data.supplierDocument ?? "",
        purchaseDate: String(data.purchaseDate).slice(0, 10),
        invoiceNumber: data.invoiceNumber ?? "",
        purchaseOrderNumber: data.purchaseOrderNumber ?? "",
        noInvoiceReason: data.noInvoiceReason ?? "",
        paymentMethodId: resolvedPaymentMethodId,
        installmentCount: String(nextInstallmentCount),
        paymentNotes: "",
        notes: (data.rawRow as { notes?: string } | null)?.notes ?? "",
        isSmallExpense: Boolean(data.isSmallExpense),
        smallExpenseTypeId: data.smallExpenseTypeId ?? "",
        smallExpenseResponsibleName: data.smallExpenseResponsibleName ?? "",
        smallExpenseAuthorizedBy: data.smallExpenseAuthorizedBy ?? "",
        smallExpenseMoneyOrigin: data.smallExpenseMoneyOrigin ?? "",
        smallExpenseNotes: data.smallExpenseNotes ?? "",
        creditCardId: data.creditCardId ?? "",
        ccNumberOfInstallments: "1",
        paymentDifferenceReason: "",
        companyId: (data as Record<string, unknown>).companyId ? String((data as Record<string, unknown>).companyId) : ""
      };
      const nextShowNoInvoiceReason = Boolean((data.rawRow as { noInvoiceReason?: string } | null)?.noInvoiceReason) || (Boolean(data.isSmallExpense) && !data.invoiceNumber);
      const nextShowExtraNotes = Boolean((data.rawRow as { notes?: string } | null)?.notes);
      const nextShowPaymentNotes = Boolean(nextForm.paymentNotes);
      const mappedItems = data.items.map((item) => ({
        productCode: item.rawProductCode ?? item.productCode ?? "",
        productId: item.productId,
        productName: item.rawProductName ?? item.productName,
        categoryName: item.rawCategory ?? item.categoryName ?? "",
        subcategoryName: item.rawSubcategory ?? item.subcategoryName ?? "",
        quantity: String(item.quantity ?? ""),
        unit: item.unit ?? "",
        unitPrice: String(item.unitPrice ?? ""),
        totalPrice: String(item.totalPrice ?? ""),
        notes: ""
      }));
      const nextInstallments = data.installments.map((installment, index) => ({
        installment: installment.installment ?? index + 1,
        dueDate: installment.dueDate ? String(installment.dueDate).slice(0, 10) : "",
        amount: String(installment.amount ?? "")
      }));
      setForm(nextForm);
      setShowNoInvoiceReason(nextShowNoInvoiceReason);
      setShowExtraNotes(nextShowExtraNotes);
      setShowPaymentNotes(nextShowPaymentNotes);
      setItems(mappedItems);
      setEntry({ ...emptyEntry });
      setPaymentExpanded(true);
      setProductStep("conferencia");
      setInstallments(nextInstallments);
      setFieldErrors({});
      setShowForm(true);
      setError(null);
      markFormClean({
        formState: nextForm,
        itemState: mappedItems,
        installmentState: nextInstallments,
        extraNotes: nextShowExtraNotes,
        noInvoice: nextShowNoInvoiceReason,
        paymentNotes: nextShowPaymentNotes
      });
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao carregar compra para edição." });
    }
  }

  function openEdit(purchase: Purchase) {
    navigate({ pathname: `/compras/${purchase.id}/editar`, search: location.search });
  }

  async function openCopyPurchase(id: string) {
    try {
      const data = await getPurchase(id);
      const resolvedPaymentMethodId = resolveBasePaymentMethodId(data.paymentMethodId, data.paymentMethodName ?? data.paymentMethod);
      const nextInstallmentCount = installmentCountFromPurchase(data.paymentMethodName ?? data.paymentMethod, data.installments.length || null);
      const copyForm = {
        supplierCode: data.rawSupplierCode ?? data.supplier.externalCode ?? "",
        supplierId: data.supplierId,
        supplierName: data.supplierName,
        supplierDocument: data.supplierDocument ?? "",
        purchaseDate: todayInputDate(),
        invoiceNumber: "",
        purchaseOrderNumber: "",
        noInvoiceReason: "",
        paymentMethodId: resolvedPaymentMethodId,
        installmentCount: String(nextInstallmentCount),
        paymentNotes: "",
        notes: (data.rawRow as { notes?: string } | null)?.notes ?? "",
        isSmallExpense: Boolean(data.isSmallExpense),
        smallExpenseTypeId: data.smallExpenseTypeId ?? "",
        smallExpenseResponsibleName: data.smallExpenseResponsibleName ?? "",
        smallExpenseAuthorizedBy: data.smallExpenseAuthorizedBy ?? "",
        smallExpenseMoneyOrigin: data.smallExpenseMoneyOrigin ?? "",
        smallExpenseNotes: data.smallExpenseNotes ?? "",
        creditCardId: "",
        ccNumberOfInstallments: "1",
        paymentDifferenceReason: "",
        companyId: (data as Record<string, unknown>).companyId ? String((data as Record<string, unknown>).companyId) : ""
      };
      const copyItems = data.items.map((item) => ({
        productCode: item.rawProductCode ?? item.productCode ?? "",
        productId: item.productId,
        productName: item.rawProductName ?? item.productName,
        categoryName: item.rawCategory ?? item.categoryName ?? "",
        subcategoryName: item.rawSubcategory ?? item.subcategoryName ?? "",
        quantity: String(item.quantity ?? ""),
        unit: item.unit ?? "",
        unitPrice: String(item.unitPrice ?? ""),
        totalPrice: String(item.totalPrice ?? ""),
        notes: ""
      }));
      const showExtraCopy = Boolean((data.rawRow as { notes?: string } | null)?.notes);
      // Dados passados via location.state; o useEffect de isCreateRoute vai aplicá-los
      navigate(
        { pathname: "/compras/nova", search: location.search },
        { state: { copyData: { form: copyForm, items: copyItems, showExtraNotes: showExtraCopy } } }
      );
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao copiar compra." });
    }
  }

  function rebuildInstallments(methodId = form.paymentMethodId, total = totalAmount, explicitCount?: number) {
    if (usesCreditCard) {
      setInstallments([]);
      return;
    }
    const method = paymentMethods.find((entry) => entry.id === methodId);
    if (!method) {
      setInstallments([]);
      return;
    }
    const requestedCount = explicitCount ?? Number(form.installmentCount || 1);
    const count = allowsInstallments(method) ? Math.max(1, requestedCount || 1) : 1;
    const amounts = splitAmount(total, count);
    const baseDueDate = addDaysToInputDate(form.purchaseDate, installmentLeadDays);
    setInstallments(amounts.map((amount, index) => ({
      installment: index + 1,
      dueDate: installments[index]?.dueDate || addDaysToInputDate(baseDueDate, index * 30),
      amount
    })));
  }

  function rebuildInstallmentsWithDays(
    methodId: string,
    total: number,
    count: number,
    days: number[],
    purchaseDate: string
  ) {
    if (smallExpenseUsesCreditCard) { setInstallments([]); return; }
    const method = paymentMethods.find((entry) => entry.id === methodId);
    if (!method) { setInstallments([]); return; }
    const effectiveCount = allowsInstallments(method) ? Math.max(1, count) : 1;
    const amounts = splitAmount(total, effectiveCount);
    setInstallments(amounts.map((amount, index) => {
      const dayOffset = days[index] ?? (days[days.length - 1] ?? 30) + (index - days.length + 1) * 30;
      return {
        installment: index + 1,
        dueDate: addDaysToInputDate(purchaseDate, dayOffset),
        amount
      };
    }));
  }

  useEffect(() => {
    if (!showForm || !form.paymentMethodId) return;
    const count = selectedPaymentMethodAllowsInstallments ? Math.max(1, Number(form.installmentCount || 1)) : 1;
    rebuildInstallments(form.paymentMethodId, totalAmount, count);
  }, [form.paymentMethodId, form.installmentCount, form.purchaseDate, installmentLeadDays, selectedPaymentMethodAllowsInstallments, showForm, smallExpenseUsesCreditCard, totalAmount]);

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    const validItems = items.filter((item) => item.productId || item.quantity || item.unitPrice || item.totalPrice);
    if (!form.supplierId) messages.push("Selecione o fornecedor da compra.");
    if (!form.purchaseDate) messages.push("Preencha a data da compra.");
    if (!selectedSupplierIsCycle && !form.paymentMethodId) messages.push("Selecione a forma de pagamento.");
    if (!showNoInvoiceReason && !form.isSmallExpense && !form.invoiceNumber.trim()) messages.push("Informe o número da NF ou marque compra sem NF.");
    if (showNoInvoiceReason && !form.isSmallExpense && !form.noInvoiceReason.trim()) messages.push("Explique o motivo da compra sem NF.");
    if (validItems.length === 0) messages.push("Adicione pelo menos um produto.");
    if (validItems.some((item) => !item.productId)) messages.push("Revise as linhas com produto não selecionado.");
    if (validItems.some((item) => !item.quantity.trim() || Number(item.quantity) <= 0)) messages.push("Informe quantidade dos produtos.");
    if (validItems.some((item) => !item.unitPrice.trim() || Number(item.unitPrice) <= 0)) messages.push("Informe valor unitário dos produtos.");
    if (validItems.some((item) => !item.unit.trim())) messages.push("Informe a unidade de todos os produtos.");
    if (form.isSmallExpense && !form.smallExpenseTypeId) messages.push("Selecione o tipo de pequeno gasto.");
    if (smallExpenseUsesCreditCard && !form.creditCardId) messages.push("Selecione o cartão para lançar na fatura.");
    if (smallExpenseUsesCreditCard && form.creditCardId && !openCardStatement) messages.push("Abra uma fatura do cartão antes de salvar.");
    if (normalPurchaseUsesCreditCard && !form.creditCardId) messages.push("Selecione o cartão de crédito para esta compra.");
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.length === 0) messages.push("Confira o parcelamento antes de salvar.");
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.some((installment) => !installment.dueDate)) messages.push("Preencha o vencimento de todas as parcelas.");
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.some((installment) => Number(installment.amount) < 0)) messages.push("Os valores das parcelas não podem ser negativos.");
    if (!selectedSupplierIsCycle && !usesCreditCard && Math.round(amountDifference * 100) !== 0) messages.push("O total das parcelas precisa fechar com o total da compra.");
    if (duplicateCheck?.hasActiveDuplicate) messages.push("Já existe uma compra ativa para este fornecedor com esta NF/pedido.");
    return [...new Set(messages)];
  }, [
    amountDifference,
    duplicateCheck?.hasActiveDuplicate,
    form.creditCardId,
    form.invoiceNumber,
    form.isSmallExpense,
    form.noInvoiceReason,
    form.paymentDifferenceReason,
    form.paymentMethodId,
    form.purchaseDate,
    form.smallExpenseTypeId,
    form.supplierId,
    installments,
    items,
    normalPurchaseUsesCreditCard,
    openCardStatement,
    selectedSupplierIsCycle,
    showNoInvoiceReason,
    smallExpenseUsesCreditCard,
    usesCreditCard
  ]);

  const canSavePurchase = validationMessages.length === 0 && !saving;

  // Ctrl+Enter para salvar a compra de qualquer campo
  useEffect(() => {
    if (!isFormRoute) return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (canSavePurchase && !saving) void handleCreatePurchase();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFormRoute, canSavePurchase, saving]);

  function validateForm() {
    const errors: Record<string, string> = {};
    const validItems = items.filter((item) => item.productId || item.quantity || item.unitPrice || item.totalPrice);
    if (!form.supplierId) errors.supplier = "Fornecedor obrigatório.";
    if (!form.purchaseDate) errors.purchaseDate = "Data obrigatória.";
    if (!form.invoiceNumber.trim() && !showNoInvoiceReason && !form.isSmallExpense) errors.invoiceNumber = "Informe o número da NF ou marque compra sem NF.";
    if ((showNoInvoiceReason || form.isSmallExpense) && !form.noInvoiceReason.trim() && !form.isSmallExpense) errors.noInvoiceReason = "Informe o motivo para compra sem NF.";
    if (!selectedSupplierIsCycle && !form.paymentMethodId) errors.paymentMethodId = "Forma de pagamento obrigatória.";
    const requestedInstallments = Math.max(1, Number(form.installmentCount || 1));
    if (!selectedSupplierIsCycle && selectedPaymentMethod && !usesCreditCard) {
      if (selectedPaymentMethodAllowsInstallments && requestedInstallments < 1) errors.installmentCount = "Informe ao menos 1 parcela.";
      if (!selectedPaymentMethodAllowsInstallments && requestedInstallments !== 1) errors.installmentCount = "Esta forma aceita apenas 1 parcela.";
    }
    if (validItems.length === 0) errors.items = "Adicione pelo menos um produto.";
    const missingProductIndex = validItems.findIndex((item) => !item.productId);
    if (missingProductIndex >= 0) errors[`item-${missingProductIndex}`] = `Produto da linha ${missingProductIndex + 1} não informado.`;
    if (validItems.some((item) => !item.unit.trim())) errors.items = "Unidade obrigatória em todos os itens.";
    if (validItems.some((item) => !item.quantity.trim() || Number(item.quantity) <= 0)) errors.items = "Informe quantidade dos produtos.";
    if (validItems.some((item) => !item.unitPrice.trim() || Number(item.unitPrice) <= 0)) errors.items = "Informe valor unitário dos produtos.";
    if (form.isSmallExpense && !form.smallExpenseTypeId) errors.smallExpenseTypeId = "Informe o tipo de pequeno gasto.";
    if (smallExpenseUsesCreditCard && !form.creditCardId.trim()) errors.creditCardId = "Selecione o cartão.";
    if (smallExpenseUsesCreditCard && form.creditCardId && !openCardStatement) errors.creditCardId = "Não há fatura aberta para este cartão.";
    if (normalPurchaseUsesCreditCard && !form.creditCardId.trim()) errors.creditCardId = "Selecione o cartão de crédito.";
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.length !== requestedInstallments) errors.installments = "Revise a quantidade de parcelas informada.";
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.length > 0 && Math.round(amountDifference * 100) !== 0) {
      errors.installments = "Total das parcelas não confere com o total da compra.";
    }
    if (!selectedSupplierIsCycle && !usesCreditCard && installments.some((installment) => !installment.dueDate)) errors.installments = "Informe todos os vencimentos.";
    setFieldErrors(errors);
    return Object.values(errors)[0] ?? null;
  }

  async function handleCreatePurchase() {
    const validation = validateForm();
    if (validation) {
      setError(validation);
      return;
    }
    const validItems = items.filter((item) => item.productId && Number(item.quantity) > 0);
    setSaving(true);
    setError(null);
    try {
      const payload = {
        supplierId: form.supplierId,
        companyId: form.companyId || null,
        rawSupplierCode: form.supplierCode || selectedSupplier?.externalCode || null,
        purchaseDate: form.purchaseDate,
        invoiceNumber: form.invoiceNumber || null,
        purchaseOrderNumber: form.purchaseOrderNumber || null,
        noInvoiceReason: showNoInvoiceReason ? form.noInvoiceReason || null : null,
        paymentMethodId: selectedSupplierIsCycle ? null : (selectedPaymentMethod?.id ?? null),
        paymentMethod: selectedSupplierIsCycle ? null : (basePaymentMethodName(selectedPaymentMethod?.name) || selectedPaymentMethod?.name || null),
        notes: form.notes || null,
        isSmallExpense: form.isSmallExpense,
        smallExpenseTypeId: form.isSmallExpense ? form.smallExpenseTypeId || null : null,
        smallExpenseResponsibleName: null,
        smallExpenseAuthorizedBy: null,
        smallExpenseMoneyOrigin: form.isSmallExpense ? selectedPaymentMethod?.name ?? null : null,
        smallExpenseNotes: form.isSmallExpense ? form.smallExpenseNotes || form.notes || null : null,
        creditCardId: usesCreditCard ? form.creditCardId || null : null,
        numberOfInstallments: normalPurchaseUsesCreditCard ? Math.max(1, Number(form.ccNumberOfInstallments) || 1) : undefined,
        paymentDifferenceReason: form.paymentDifferenceReason || null,
        workflowStatus: "confirmed",
        totalAmount,
        installments: (selectedSupplierIsCycle || usesCreditCard)
          ? []
          : installments.map((installment) => ({
              installment: installment.installment,
              dueDate: installment.dueDate,
              amount: Number(installment.amount || 0),
              paymentMethodId: selectedPaymentMethod?.id ?? null,
              paymentMethodName: basePaymentMethodName(selectedPaymentMethod?.name) || selectedPaymentMethod?.name || null,
              status: "OPEN"
            })),
        items: validItems.map((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          return {
            productId: item.productId,
            rawProductCode: item.productCode || product?.externalCode || null,
            rawProductName: item.productName || product?.name,
            unit: item.unit || null,
            unitMeasureId: units.find((unit) => unit.code === item.unit)?.id ?? product?.unitMeasureId ?? null,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice || 0),
            totalPrice: Number(item.totalPrice || 0),
            rawCategory: product?.category?.name ?? null,
            rawSubcategory: product?.subcategory?.name ?? null,
            notes: item.notes || null
          };
        })
      };
      await (editingId ? updatePurchase(editingId, payload) : createPurchase(payload));
      setNotice({ tone: "success", message: editingId ? "Compra atualizada com sucesso." : "Compra inserida com sucesso." });
      if (!editingId && installments.length > 0) {
        setNotice({ tone: "success", message: "Parcelas enviadas para contas a pagar." });
      }
      markFormClean();
      resetForm();
      await loadPurchases();
      navigate({ pathname: "/compras", search: location.search });
    } catch (saveError) {
      const rawMessage = saveError instanceof Error ? saveError.message : "Erro ao salvar compra.";
      const message = rawMessage.includes("NF/pedido")
        ? "Já existe uma compra ativa para este fornecedor com esta NF/pedido."
        : rawMessage;
      setError(message);
      setNotice({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(purchase: Purchase) {
    const reason = window.prompt("Informe o motivo obrigatório para cancelar esta compra:");
    if (!reason?.trim()) return;
    const confirmMessage = purchase.cycleStatus != null
      ? "Esta compra pertence a um ciclo de fornecedor. Ao cancelar, os títulos gerados ainda em aberto também serão cancelados e o ciclo será encerrado. Confirmar?"
      : "Cancelar esta compra vai estornar a entrada de estoque vinculada. Confirmar?";
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
    await cancelPurchase(purchase.id, reason);
    setNotice({ tone: "success", message: "Compra cancelada com sucesso." });
    await loadPurchases();
  }

  async function handleRestore(purchase: Purchase) {
    const confirmed = window.confirm("Restaurar esta compra vai reativar a entrada de estoque vinculada. Confirmar?");
    if (!confirmed) return;
    await restorePurchase(purchase.id);
    setNotice({ tone: "success", message: "Compra restaurada com sucesso." });
    await loadPurchases();
  }

  async function handleSupplierPositionPdf() {
    try {
      await downloadSupplierPositionPdf({
        supplierId: filters.supplierId || undefined,
        startDate: period.startDate,
        endDate: period.endDate
      });
      setNotice({ tone: "success", message: "PDF de posição de fornecedor gerado." });
    } catch (loadError) {
      setNotice({ tone: "error", message: loadError instanceof Error ? loadError.message : "Erro ao gerar PDF." });
    }
  }

  function goBackToList() {
    if (isDirty && !window.confirm("Existem alterações não salvas. Deseja sair sem salvar?")) return;
    resetForm();
    setError(null);
    navigate({ pathname: "/compras", search: location.search });
  }


  const paymentPreviewMessage = useMemo(() => {
    const methodName = selectedPaymentMethodBaseName || "forma selecionada";
    const firstDue = new Date(`${addDaysToInputDate(form.purchaseDate, installmentLeadDays)}T12:00:00`).toLocaleDateString("pt-BR");
    const count = Number(form.installmentCount || 1);
    if (!selectedPaymentMethodAllowsInstallments) return `Pagamento à vista em ${methodName}. Vencimento: ${firstDue}.`;
    const supplierDays = Array.isArray(selectedSupplier?.defaultInstallmentDays) && (selectedSupplier.defaultInstallmentDays as number[]).length > 0
      ? (selectedSupplier.defaultInstallmentDays as number[]).slice(0, count).join("/")
      : null;
    const daysLabel = supplierDays ? ` (dias: ${supplierDays})` : "";
    return `${methodName} em ${count}x${daysLabel} — 1ª parcela em ${firstDue}.`;
  }, [form.installmentCount, form.purchaseDate, installmentLeadDays, selectedPaymentMethodAllowsInstallments, selectedPaymentMethodBaseName, selectedSupplier?.defaultInstallmentDays]);

  return (
    <section className="panel">
      <Notice notice={notice} />

      {!isFormRoute && (
        <>
      <div className="purch-page-header">
        <div className="purch-page-header-left">
          <p className="purch-eyebrow">Operações</p>
          <h1 className="purch-page-title">Compras</h1>
          <p className="purch-page-subtitle">Registro e controle de compras do período</p>
        </div>
        <div className="purch-page-actions">
          <button className="icon-button" type="button" onClick={loadPurchases} aria-label="Atualizar compras">
            <RefreshCw size={18} />
          </button>
          <button className="secondary-button" type="button" onClick={handleSupplierPositionPdf}>
            <FileText size={16} /> PDF
          </button>
          <button className="primary-button" type="button" onClick={openNewPurchase}>
            <Plus size={16} /> Nova compra
          </button>
        </div>
      </div>

      <section className="purchase-filters-panel">
        <div className="purch-filters-header">
          <p className="purch-filters-label">
            Filtros{activeFilterCount > 0 ? <span className="purch-filters-badge">{activeFilterCount}</span> : null}
          </p>
          <button
            type="button"
            className="purch-filters-toggle"
            onClick={() => setFiltersExpanded((v) => !v)}
            aria-expanded={filtersExpanded}
          >
            {filtersExpanded ? "Recolher ▲" : `Filtros${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""} ▼`}
          </button>
        </div>
        {filtersExpanded && (
          <>
            <div className="purchase-filters-grid">
              <PeriodFilter value={period} onChange={setPeriod} />
              <div className="purchase-autocomplete-field" ref={supplierFilterRef}>
                <label>
                  Fornecedor
                  <div className={`autocomplete-shell${supplierFilterOpen ? " active" : ""}`}>
                    <input
                      autoComplete="off"
                      name="purchase-supplier-filter"
                      placeholder="Nome, código ou CNPJ/CPF"
                      value={supplierFilterQuery}
                      onChange={(event) => {
                        setSupplierFilterQuery(event.target.value);
                        setSupplierFilterOpen(true);
                        if (!event.target.value.trim()) setFilters((current) => ({ ...current, supplierId: "" }));
                      }}
                      onFocus={() => setSupplierFilterOpen(true)}
                    />
                    {supplierFilterQuery && (
                      <button className="autocomplete-clear" type="button" aria-label="Limpar fornecedor" onClick={clearFilterSupplier}>
                        <X size={14} />
                      </button>
                    )}
                    <ChevronDown size={16} className="autocomplete-chevron" />
                  </div>
                </label>
                {supplierFilterOpen && (
                  <div className="autocomplete-dropdown">
                    {filteredSupplierOptions.length === 0 && <div className="autocomplete-empty">Nenhum fornecedor encontrado. Verifique o código, nome ou CNPJ.</div>}
                    {filteredSupplierOptions.map((supplier) => (
                      <button key={supplier.id} className="autocomplete-option" type="button" onClick={() => selectSupplier(supplier.id, "filter")}>
                        <strong>{supplier.externalCode ? `${supplier.externalCode} • ` : ""}{supplier.name}</strong>
                        <small>{supplier.document || "Sem documento"}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label>
                Categoria
                <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
                  <option value="">Todas</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={filters.showCancelled} onChange={(event) => setFilters({ ...filters, showCancelled: event.target.value })}>
                  <option value="">Ativas</option>
                  <option value="true">Todas</option>
                  <option value="cancelled">Somente canceladas</option>
                </select>
              </label>
              <label>
                Forma de pagamento
                <input autoComplete="off" placeholder="PIX, boleto, cartão..." value={filters.paymentMethod} onChange={(event) => setFilters({ ...filters, paymentMethod: event.target.value })} />
              </label>
              <label>
                Busca geral
                <input autoComplete="off" placeholder="NF, produto, fornecedor..." value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
              </label>
              <label>
                Ordenação
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as PurchaseSortOption)}>
                  <option value="recent">Mais recente</option>
                  <option value="oldest">Mais antigo</option>
                  <option value="highest">Maior valor</option>
                  <option value="lowest">Menor valor</option>
                </select>
              </label>
            </div>
            <div className="purchase-filter-actions">
              <button className="primary-button" type="button" onClick={loadPurchases}>Filtrar</button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setFilters({ supplierId: "", category: "", paymentMethod: "", search: "", showCancelled: "" });
                  setSupplierFilterQuery("");
                  setSortBy("recent");
                }}
              >
                Limpar filtros
              </button>
            </div>
          </>
        )}
      </section>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="empty-state">Carregando compras...</div>}

      {!loading && (
        <>
          <div className="table-wrap operational-table purchases-list-table purchases-desktop-list">
            <table>
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Fornecedor</th>
                  <th>Itens</th>
                  <th>Pagamento</th>
                  <th className="numeric-cell">Total</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {displayedPurchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="purchase-main-cell">
                      <strong>{purchase.invoiceNumber ? `NF ${purchase.invoiceNumber}` : purchase.purchaseNumber ?? "Compra manual"}</strong>
                      <small>{formatDate(purchase.purchaseDate)} • {String(purchase.competenceMonth).padStart(2, "0")}/{purchase.competenceYear}</small>
                    </td>
                    <td className="purchase-supplier-cell" title={purchase.supplier.name}>
                      <strong className="truncate-cell">{purchase.supplier.name}</strong>
                      <small>{purchase.supplier.document ?? purchase.rawSupplierCode ?? "Sem documento"}</small>
                    </td>
                    <td className="purchase-items-summary">
                      <strong>{purchase.items.length} item(ns)</strong>
                      <small className="truncate-cell" title={purchase.items.map((item) => item.rawProductName).join(", ")}>
                        {purchase.items[0]?.rawProductCode ? `${purchase.items[0].rawProductCode} • ` : ""}
                        {purchase.items[0]?.rawProductName ?? "-"}
                        {purchase.items.length > 1 ? ` +${purchase.items.length - 1}` : ""}
                      </small>
                    </td>
                    <td className="purchase-payment-cell">
                      {purchase.cycleStatus != null ? (
                        <>
                          <strong>Ciclo fornecedor</strong>
                          <small>{{OPEN:"Aberto",CHECKED:"Conferido",CLOSED:"Fechado",PAID:"Pago",CANCELLED:"Cancelado"}[purchase.cycleStatus] ?? purchase.cycleStatus}</small>
                        </>
                      ) : (
                        <>
                          <strong>{purchase.installments[0]?.paymentMethodName ?? purchase.paymentMethod ?? "-"}</strong>
                          <small>{purchase.creditCardId && purchase.installments.length === 0 ? "Fatura(s) cartão" : `${purchase.installments.length} parcela(s)`}</small>
                        </>
                      )}
                    </td>
                    <td className="numeric-cell nowrap-cell">{formatCurrency(purchase.totalAmount)}</td>
                    <td>
                      <span className={`status-badge ${purchaseStatusTone(purchase.status)}`}>{purchaseStatusLabel(purchase.status)}</span>
                      {purchase.cancellationReason && <small className="block-note" title={purchase.cancellationReason}>{purchase.cancellationReason}</small>}
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button type="button" onClick={() => openDetail(purchase)}><Eye size={15} /> Ver</button>
                        {canEditPurchase && purchase.status !== "CANCELLED" && <button type="button" onClick={() => openEdit(purchase)}><Pencil size={15} /> Editar</button>}
                        {canEditPurchase && <button type="button" title="Copiar esta compra para nova" onClick={() => void openCopyPurchase(purchase.id)}><Copy size={14} /> Copiar</button>}
                        {isAdmin && (
                          purchase.status === "CANCELLED"
                            ? <button type="button" onClick={() => handleRestore(purchase)}>Restaurar</button>
                            : <button className="danger-icon-button" type="button" title="Cancelar compra" onClick={() => handleCancel(purchase)}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {displayedPurchases.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="purch-empty-state">
                        <Package size={40} className="purch-empty-icon" />
                        <p className="purch-empty-title">Nenhuma compra encontrada</p>
                        <p className="purch-empty-desc">Ajuste os filtros ou cadastre uma nova compra.</p>
                        <button className="primary-button" type="button" onClick={openNewPurchase}>
                          <Plus size={15} /> Cadastrar nova compra
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="purchases-mobile-list">
            {displayedPurchases.map((purchase) => (
              <article className={`purch-mobile-card${purchase.status === "CANCELLED" ? " purch-card-cancelled" : ""}`} key={`${purchase.id}-mobile`}>
                <div className="purch-mobile-card-header">
                  <div className="purch-mobile-card-title">
                    <strong className="purch-mobile-supplier">{purchase.supplier.name}</strong>
                    <div className="purch-mobile-meta-row">
                      <span className="purch-mobile-ref">{purchase.invoiceNumber ? `NF ${purchase.invoiceNumber}` : purchase.purchaseNumber ?? "Compra manual"}</span>
                      <span className="purch-mobile-date">{formatDate(purchase.purchaseDate)}</span>
                    </div>
                  </div>
                  <div className="purch-mobile-card-right">
                    <strong className="purch-mobile-amount">{formatCurrency(purchase.totalAmount)}</strong>
                    <span className={`status-badge purch-mobile-status ${purchaseStatusTone(purchase.status)}`}>{purchaseStatusLabel(purchase.status)}</span>
                  </div>
                </div>
                <div className="purch-mobile-card-body">
                  <div className="purch-mobile-row">
                    <span>Itens</span>
                    <span>
                      {purchase.items.length} item{purchase.items.length !== 1 ? "ns" : ""}
                      {purchase.items[0]?.rawProductName ? ` · ${purchase.items[0].rawProductName}${purchase.items.length > 1 ? ` +${purchase.items.length - 1}` : ""}` : ""}
                    </span>
                  </div>
                  <div className="purch-mobile-row">
                    <span>Pagamento</span>
                    {purchase.cycleStatus != null ? (
                      <span>Ciclo · {{OPEN:"Aberto",CHECKED:"Conferido",CLOSED:"Fechado",PAID:"Pago",CANCELLED:"Cancelado"}[purchase.cycleStatus] ?? purchase.cycleStatus}</span>
                    ) : (
                      <span>{purchase.installments[0]?.paymentMethodName ?? purchase.paymentMethod ?? "-"} · {purchase.installments.length > 0 ? `${purchase.installments.length}x` : "à vista"}</span>
                    )}
                  </div>
                </div>
                <div className="purch-mobile-card-footer">
                  <div className="purch-mobile-actions">
                    <button className="purch-mobile-btn" type="button" onClick={() => openDetail(purchase)}><Eye size={15} /> Ver</button>
                    {canEditPurchase && purchase.status !== "CANCELLED" && <button className="purch-mobile-btn" type="button" onClick={() => openEdit(purchase)}><Pencil size={15} /> Editar</button>}
                    {canEditPurchase && <button className="purch-mobile-btn purch-mobile-btn-ghost" type="button" title="Copiar" onClick={() => void openCopyPurchase(purchase.id)}><Copy size={14} /></button>}
                    {isAdmin && (
                      purchase.status === "CANCELLED"
                        ? <button className="purch-mobile-btn purch-mobile-btn-ghost" type="button" onClick={() => handleRestore(purchase)}>Restaurar</button>
                        : <button className="purch-mobile-btn purch-mobile-btn-danger" type="button" title="Cancelar" onClick={() => handleCancel(purchase)}><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {displayedPurchases.length === 0 && (
              <div className="purch-empty-state purch-empty-state-mobile">
                <Package size={36} className="purch-empty-icon" />
                <p className="purch-empty-title">Nenhuma compra encontrada</p>
                <p className="purch-empty-desc">Ajuste os filtros ou cadastre uma nova compra.</p>
                <button className="primary-button" type="button" onClick={openNewPurchase}>
                  <Plus size={15} /> Nova compra
                </button>
              </div>
            )}
          </div>
        </>
      )}
        </>
      )}

      {detail && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal purchase-modal purchase-detail-modal">
            <div ref={modalTopRef} />
            <div className="section-heading purchase-editor-header">
              <div>
                <p>Detalhe da compra</p>
                <h2>{detail.supplierName}</h2>
                <div className="purchase-detail-headline">
                  <span>{detail.invoiceNumber ? `NF ${detail.invoiceNumber}` : detail.purchaseNumber ?? "Compra manual"}</span>
                  <span>{formatDate(detail.purchaseDate)}</span>
                  <span>{String(detail.competenceMonth).padStart(2, "0")}/{detail.competenceYear}</span>
                  <strong>{formatCurrency(detail.totalAmount)}</strong>
                </div>
              </div>
              <button className="secondary-button" type="button" onClick={() => setDetail(null)}>Fechar</button>
            </div>

            <div className="purchase-detail-infobar">
              <div className="purchase-detail-infobar-item">
                <span className="detail-label">Fornecedor</span>
                <strong title={detail.supplierName}>{detail.supplierName}</strong>
                <small>{detail.supplierDocument ?? "Sem documento"}</small>
              </div>
              <div className="purchase-detail-infobar-item">
                <span className="detail-label">Pagamento</span>
                {detail.cardStatementItems && detail.cardStatementItems.length > 0 ? (
                  <>
                    <strong>CARTÃO CRÉDITO</strong>
                    <small>
                      {detail.cardStatementItems[0].creditCardName ?? detail.creditCardName ?? ""}
                      {detail.cardStatementItems[0].creditCardLast4Digits ?? detail.creditCardLast4Digits ? ` — final ${detail.cardStatementItems[0].creditCardLast4Digits ?? detail.creditCardLast4Digits}` : ""}
                      {" · "}{detail.importBatchId ? "Importação" : "Manual"}
                    </small>
                  </>
                ) : (
                  <>
                    <strong>{detail.smallExpenseMoneyOrigin ?? detail.paymentMethodName ?? detail.paymentMethod ?? "-"}</strong>
                    <small>{detail.installments.length} parcela(s) · {detail.importBatchId ? "Importação" : "Manual"}</small>
                  </>
                )}
              </div>
              <div className="purchase-detail-infobar-item">
                <span className="detail-label">Status</span>
                <strong><span className={`status-badge ${purchaseStatusTone(detail.status)}`}>{purchaseStatusLabel(detail.status)}</span></strong>
                <small>{detail.purchaseNumber ?? "Sem pedido interno"}</small>
              </div>
              <div className="purchase-detail-infobar-item purchase-detail-infobar-amount">
                <span className="detail-label">Total</span>
                <strong>{formatCurrency(Number(detail.totalAmount))}</strong>
                <small>{detail.isSmallExpense ? "Pequeno gasto" : `${detail.items.length} item(s)`}</small>
              </div>
            </div>

            <div className="subsection">
              <h3>Itens</h3>
              <div className="table-wrap operational-table">
                <table>
                  <thead><tr><th>Produto</th><th>Classificação</th><th>Un.</th><th className="numeric-cell">Qtd.</th><th className="numeric-cell">Unit.</th><th className="numeric-cell">Total</th></tr></thead>
                  <tbody>{detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="purchase-detail-product" title={item.rawProductName ?? item.productName}>
                        <strong>{item.rawProductName ?? item.productName}</strong>
                        <small>{item.rawProductCode ?? item.productCode ?? "Sem código"}</small>
                      </td>
                      <td><small>{item.rawCategory ?? item.categoryName ?? "-"}</small><small>{item.rawSubcategory ?? item.subcategoryName ?? "-"}</small></td>
                      <td>{item.unit ?? "-"}</td>
                      <td className="numeric-cell">{formatNumber(Number(item.quantity))}</td>
                      <td className="numeric-cell nowrap-cell">{formatCurrency(Number(item.unitPrice))}</td>
                      <td className="numeric-cell nowrap-cell">{formatCurrency(Number(item.totalPrice))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            <div className="subsection">
              <h3>{detail.cardStatementItems && detail.cardStatementItems.length > 0 ? "Faturas do cartão" : "Parcelas"}</h3>
              <div className="table-wrap operational-table">
                {detail.cardStatementItems && detail.cardStatementItems.length > 0 ? (
                  <table>
                    <thead><tr><th>Parcela</th><th>Fatura</th><th>Vencimento</th><th className="numeric-cell">Valor</th><th>Status fatura</th></tr></thead>
                    <tbody>{detail.cardStatementItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.installment != null && item.totalInstallments != null ? `${item.installment}/${item.totalInstallments}` : "À vista"}</td>
                        <td>{item.statementName ?? `${String(item.competenceMonth).padStart(2, "0")}/${item.competenceYear}`}</td>
                        <td>{item.statementDueDate ? formatDate(item.statementDueDate) : "-"}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(Number(item.value))}</td>
                        <td><span className={`status-badge ${statementStatusTone(item.statementStatus)}`}>{statementStatusLabel(item.statementStatus)}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : (
                  <table>
                    <thead><tr><th>Parcela</th><th>Forma</th><th>Vencimento</th><th className="numeric-cell">Valor</th><th>Status</th></tr></thead>
                    <tbody>{detail.installments.map((installment) => (
                      <tr key={installment.id}>
                        <td>{installment.installment ?? "-"}</td>
                        <td>{installment.paymentMethodName ?? detail.paymentMethodName ?? "-"}</td>
                        <td>{formatDate(installment.dueDate)}</td>
                        <td className="numeric-cell nowrap-cell">{formatCurrency(Number(installment.amount ?? 0))}</td>
                        <td><span className={`status-badge ${installmentStatusTone(installment.status)}`}>{installmentStatusLabel(installment.status)}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="subsection">
              <h3>Auditoria resumida</h3>
              <div className="table-wrap operational-table">
                <table>
                  <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
                  <tbody>{detail.audits.map((audit) => <tr key={audit.id}><td>{formatDate(audit.createdAt)}</td><td>{audit.userName ?? "-"}</td><td>{audit.action}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {isFormRoute && !showForm && (
        <section className="purchase-editor-screen">
          <div className="empty-state">Carregando compra...</div>
        </section>
      )}

      {showForm && isFormRoute && (
          <section className="purchase-editor-screen purchase-modal purchase-modal-shell">
            <div ref={modalTopRef} />
            <div className="section-heading purchase-editor-header">
              <div>
                <p>Compras</p>
                <h2>{editingId ? "Editar compra" : "Nova compra"}</h2>
                <div className="purchase-editor-context">
                  <span>{selectedSupplier?.name ?? "Fornecedor"}</span>
                  {(form.invoiceNumber || form.purchaseOrderNumber) && (
                    <span>{form.invoiceNumber || "Sem NF"}{form.purchaseOrderNumber ? ` · Ped. ${form.purchaseOrderNumber}` : ""}</span>
                  )}
                  {totalAmount > 0 && <span>{formatCurrency(totalAmount)}</span>}
                  <span className={validationMessages.length === 0 ? "purchase-context-ok" : "purchase-context-pending"}>
                    {validationMessages.length === 0 ? "✓ Conferida" : `${validationMessages.length} pendência${validationMessages.length > 1 ? "s" : ""}`}
                  </span>
                </div>
              </div>
              <div className="actions-cell">
                <button className="secondary-button" type="button" onClick={goBackToList}>Voltar</button>
                <button className="primary-button" type="button" disabled={!canSavePurchase} onClick={handleCreatePurchase}>
                  {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar compra"}
                </button>
              </div>
            </div>

            {error && <div className="alert error prominent-alert">{error}</div>}
            {duplicateCheck?.existingPurchase && (
              <div className="alert error prominent-alert">
                <strong>Já existe uma compra ativa para este fornecedor com esta NF/pedido.</strong>
                <div>
                  {formatDate(duplicateCheck.existingPurchase.purchaseDate)} • {duplicateCheck.existingPurchase.referenceLabel} • {formatCurrency(Number(duplicateCheck.existingPurchase.totalAmount))}
                </div>
                <div className="actions-cell">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => navigate({ pathname: `/compras/${duplicateCheck.existingPurchase?.id}/editar`, search: location.search })}
                  >
                    Abrir compra existente
                  </button>
                </div>
              </div>
            )}
            {!duplicateCheck?.existingPurchase && duplicateCheck?.cancelledPurchase && (
              <div className="alert warning">
                Existe uma compra cancelada com esta NF/pedido: {formatDate(duplicateCheck.cancelledPurchase.purchaseDate)} • {duplicateCheck.cancelledPurchase.referenceLabel} • {formatCurrency(Number(duplicateCheck.cancelledPurchase.totalAmount))}
              </div>
            )}

            <div className="pnova-layout">

              {/* ─── 1. FORNECEDOR ─── */}
              <div className={`pnova-supplier-card${form.supplierId ? " has-supplier" : ""}`} ref={supplierFormRef}>
                {form.supplierId && selectedSupplier ? (
                  /* Estado confirmado: strip compacto */
                  <div className="pnova-supplier-confirmed">
                    <div className="pnova-supplier-confirmed-body">
                      <strong className="pnova-supplier-confirmed-name">{selectedSupplier.name}</strong>
                      <span className="pnova-supplier-confirmed-meta">
                        {form.supplierCode && <span>{form.supplierCode}</span>}
                        {selectedSupplier.document && <span>{selectedSupplier.document}</span>}
                        {selectedSupplier.defaultPaymentMethodId ? (
                          <span>
                            {basePaymentMethodName(selectedPaymentMethod?.name) || "–"}
                            {selectedPaymentMethodAllowsInstallments && (() => {
                              const days = Array.isArray(selectedSupplier.defaultInstallmentDays) && (selectedSupplier.defaultInstallmentDays as number[]).length > 0
                                ? (selectedSupplier.defaultInstallmentDays as number[]).join("/")
                                : null;
                              const count = selectedSupplier.defaultInstallmentCount ?? (Array.isArray(selectedSupplier.defaultInstallmentDays) ? (selectedSupplier.defaultInstallmentDays as number[]).length : 2);
                              return ` · ${count}x${days ? ` (${days}d)` : ""}`;
                            })()}
                          </span>
                        ) : null}
                        {selectedSupplier.defaultFinancialNotes && (
                          <span className="pnova-supplier-confirmed-notes" title={selectedSupplier.defaultFinancialNotes}>
                            {selectedSupplier.defaultFinancialNotes}
                          </span>
                        )}
                      </span>
                    </div>
                    <button
                      className="pnova-supplier-change-btn"
                      type="button"
                      onClick={() => {
                        setForm((current) => ({ ...current, supplierId: "", supplierCode: "", supplierName: "", supplierDocument: "" }));
                        if (isMobile) {
                          setSupplierSheetQuery("");
                          setSupplierSheetOpen(true);
                          window.setTimeout(() => supplierSheetSearchRef.current?.focus(), 100);
                        } else {
                          window.setTimeout(() => setSupplierFilterOpen(true), 0);
                        }
                      }}
                    >
                      Trocar
                    </button>
                  </div>
                ) : (
                  /* Estado busca */
                  <>
                    <div className="pnova-block-title">Fornecedor</div>
                    <div className={`pnova-supplier-search${fieldErrors.supplier ? " field-error" : ""}`}>
                      {isMobile ? (
                        /* Mobile: botão trigger que abre bottom sheet */
                        <button
                          type="button"
                          className={`pnova-supplier-mobile-trigger${!(form.supplierName || form.supplierCode) ? " empty" : ""}`}
                          onClick={() => {
                            setSupplierSheetQuery(form.supplierName || form.supplierCode);
                            setSupplierSheetOpen(true);
                            window.setTimeout(() => supplierSheetSearchRef.current?.focus(), 100);
                          }}
                        >
                          <span>{form.supplierName || form.supplierCode || "Toque para buscar fornecedor…"}</span>
                          <ChevronDown size={16} style={{ flexShrink: 0, marginLeft: "auto", opacity: 0.5 }} />
                        </button>
                      ) : (
                        /* Desktop: autocomplete inline */
                        <div className="autocomplete-shell active">
                          <input
                            autoComplete="off"
                            name="purchase-supplier-form"
                            placeholder="Buscar fornecedor por nome, código ou CNPJ…"
                            value={form.supplierName || form.supplierCode}
                            onChange={(event) => {
                              setForm((current) => ({ ...current, supplierId: "", supplierCode: event.target.value, supplierName: event.target.value, supplierDocument: "" }));
                              setSupplierFilterQuery(event.target.value);
                              setSupplierFilterOpen(true);
                            }}
                            onFocus={() => { setSupplierFilterQuery(form.supplierName || form.supplierCode); setSupplierFilterOpen(true); }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") { setSupplierFilterOpen(false); return; }
                              if (event.key === "Enter") {
                                event.preventDefault();
                                if (filteredSupplierOptions.length === 1) { selectSupplier(filteredSupplierOptions[0].id, "form"); setSupplierFilterOpen(false); }
                                else if (filteredSupplierOptions.length > 0) {
                                  const q = normalize(supplierFilterQuery);
                                  const exact = filteredSupplierOptions.find((s) => normalize(s.name) === q || normalize(s.externalCode ?? "") === q);
                                  if (exact) { selectSupplier(exact.id, "form"); setSupplierFilterOpen(false); }
                                  else setSupplierFilterOpen(true);
                                }
                              }
                            }}
                          />
                          {(form.supplierName || form.supplierCode) && (
                            <button className="autocomplete-clear" type="button" aria-label="Limpar fornecedor"
                              onClick={() => { setForm((current) => ({ ...current, supplierId: "", supplierCode: "", supplierName: "", supplierDocument: "" })); }}>
                              <X size={14} />
                            </button>
                          )}
                          <ChevronDown size={16} className="autocomplete-chevron" />
                          {supplierFilterOpen && (
                            <div className="autocomplete-dropdown">
                              {filteredSupplierOptions.length === 0 && <div className="autocomplete-empty">Nenhum fornecedor encontrado. Verifique o código, nome ou CNPJ.</div>}
                              {filteredSupplierOptions.map((supplier) => (
                                <button key={supplier.id} className="autocomplete-option" type="button"
                                  onClick={() => { selectSupplier(supplier.id, "form"); setSupplierFilterOpen(false); }}>
                                  <strong>{supplier.externalCode ? `${supplier.externalCode} • ` : ""}{supplier.name}</strong>
                                  <small>{supplier.document || "Sem documento"}</small>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {!isMobile && !form.supplierId && (form.supplierName || form.supplierCode) && (
                        <p className="pnova-supplier-hint">Selecione um fornecedor da lista.</p>
                      )}
                    </div>
                    {!form.supplierName && !form.supplierCode && (
                      <p className="pnova-supplier-empty">Selecione um fornecedor para iniciar o lançamento</p>
                    )}
                  </>
                )}
              </div>

              {/* ─── 2. DADOS DA COMPRA ─── */}
              <div className="pnova-data-block">
                {/* Barra horizontal compacta */}
                <div className="pnova-data-bar">
                  <div className="pnova-data-field pnova-data-field-company">
                    <span>Empresa (NF emitida para)</span>
                    <select
                      value={form.companyId}
                      onChange={(event) => setForm({ ...form, companyId: event.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.tradeName}</option>
                      ))}
                    </select>
                  </div>
                  <div className={`pnova-data-field${fieldErrors.purchaseDate ? " field-error" : ""}`}>
                    <span>Data</span>
                    <input type="date" value={form.purchaseDate}
                      onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} />
                  </div>
                  <div className={`pnova-data-field${fieldErrors.invoiceNumber ? " field-error" : ""}`}>
                    <span>NF</span>
                    <input autoComplete="off" placeholder="Número" value={form.invoiceNumber} disabled={showNoInvoiceReason}
                      onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} />
                  </div>
                  <div className="pnova-data-field">
                    <span>Pedido</span>
                    <input autoComplete="off" placeholder="Opcional" value={form.purchaseOrderNumber}
                      onChange={(event) => setForm({ ...form, purchaseOrderNumber: event.target.value })} />
                  </div>
                  <div className="pnova-data-chips">
                    <label className="pnova-chip-check">
                      <input type="checkbox" checked={showNoInvoiceReason}
                        onChange={(event) => { setShowNoInvoiceReason(event.target.checked); if (event.target.checked) setForm({ ...form, invoiceNumber: "" }); }} />
                      <span>Sem NF</span>
                    </label>
                  </div>
                </div>

                {/* Linhas extras condicionais */}
                {showNoInvoiceReason && (
                  <div className="pnova-data-extra-row">
                    <div className={`pnova-data-field pnova-data-field-wide${fieldErrors.noInvoiceReason ? " field-error" : ""}`}>
                      <span>Motivo sem NF</span>
                      <input autoComplete="off" value={form.noInvoiceReason}
                        onChange={(event) => setForm({ ...form, noInvoiceReason: event.target.value })} />
                    </div>
                  </div>
                )}

                {form.isSmallExpense && (
                  <div className="pnova-data-extra-row">
                    <div className={`pnova-data-field${fieldErrors.smallExpenseTypeId ? " field-error" : ""}`}>
                      <span>Tipo pequeno gasto</span>
                      <select value={form.smallExpenseTypeId}
                        onChange={(event) => setForm({ ...form, smallExpenseTypeId: event.target.value })}>
                        <option value="">Selecione</option>
                        {smallExpenseTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </div>
                    {selectedPaymentMethod && selectedPaymentMethod.type === "CREDIT_CARD" ? (
                      <div className={`pnova-data-field${fieldErrors.creditCardId ? " field-error" : ""}`}>
                        <span>Cartão</span>
                        <select value={form.creditCardId}
                          onChange={(event) => setForm({ ...form, creditCardId: event.target.value })}>
                          <option value="">Selecione</option>
                          {creditCards.map((card) => <option key={card.id} value={card.id}>{card.name} - {card.bankName} {card.last4Digits}</option>)}
                        </select>
                      </div>
                    ) : null}
                    <div className="pnova-data-field pnova-data-field-wide">
                      <span>Obs. pequeno gasto</span>
                      <input autoComplete="off" value={form.smallExpenseNotes}
                        onChange={(event) => setForm({ ...form, smallExpenseNotes: event.target.value })} />
                    </div>
                  </div>
                )}

                {form.creditCardId && openCardStatement && smallExpenseUsesCreditCard && (
                  <div className="pnova-data-extra-row">
                    <div className="alert info" style={{ margin: "0 16px 0" }}>
                      Fatura aberta: {openCardStatement.creditCard?.name ?? "Cartão"} • {String(openCardStatement.competenceMonth).padStart(2, "0")}/{openCardStatement.competenceYear} • venc. {formatDate(openCardStatement.dueDate)} • {openCardStatement.status} • {formatCurrency(openCardStatement.totalAmount)}
                    </div>
                  </div>
                )}
                {form.creditCardId && !openCardStatement && smallExpenseUsesCreditCard && (
                  <div className="pnova-data-extra-row">
                    <div className="alert warning" style={{ margin: "0 16px 0" }}>Não há fatura aberta para este cartão.</div>
                  </div>
                )}
                {normalPurchaseUsesCreditCard && form.creditCardId && ccInstallmentPreview.length > 0 && (
                  <div className="pnova-data-extra-row">
                    <div className="pnova-cc-preview">
                      {ccInstallmentPreview.map((item) => (
                        <div key={item.installment} className="pnova-cc-preview-row">
                          {ccInstallmentPreview.length > 1 && (
                            <span className="pnova-cc-preview-installment">{item.installment}/{ccInstallmentPreview.length}</span>
                          )}
                          <span className="pnova-cc-preview-fatura">{item.label}</span>
                          <span className="pnova-cc-preview-due">venc. {item.dueDate.toLocaleDateString("pt-BR")}</span>
                          <span className="pnova-cc-preview-value">{formatCurrency(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pnova-obs-row">
                  <button
                    className={`pnova-obs-toggle${form.notes.trim() && !showExtraNotes ? " has-content-indicator" : ""}`}
                    type="button"
                    onClick={() => setShowExtraNotes(!showExtraNotes)}
                  >
                    {form.notes.trim() && !showExtraNotes
                      ? `✓ Obs: ${form.notes.slice(0, 50)}${form.notes.length > 50 ? "…" : ""}`
                      : "+ Observação da compra"}
                  </button>
                  {showExtraNotes && (
                    <input
                      autoComplete="off"
                      className="pnova-obs-input"
                      placeholder="Observação da compra"
                      value={form.notes}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                      onBlur={() => { if (!form.notes.trim()) setShowExtraNotes(false); }}
                    />
                  )}
                </div>
              </div>

              {/* ─── 3. PRODUTOS ─── */}
              <div className="pnova-products-block">
                <div className="section-heading compact-heading">
                  <div><h3>Produtos</h3></div>
                </div>

                {/* Barra de etapas */}
                <div className="pnova-steps-bar">
                  {STEP_ORDER.map((step) => (
                    <button
                      key={step}
                      type="button"
                      className={`pnova-step-chip${productStep === step ? " active" : ""}`}
                      onClick={() => goToStep(step)}
                      disabled={step !== "produtos" && items.length === 0}
                    >
                      {STEP_LABELS[step]}
                    </button>
                  ))}
                </div>

                {fieldErrors.items && <div className="alert error">{fieldErrors.items}</div>}

                {entryFeedback ? (
                  <div className={`pnova-entry-feedback ${entryFeedback.tone}`}>
                    {entryFeedback.tone === "warning" ? "⚠ " : "✓ "}{entryFeedback.message}
                  </div>
                ) : items.length === 0 ? (
                  <p className="pnova-entry-hint">Digite o código do produto e pressione Enter para adicionar.</p>
                ) : null}

                {/* Linha de entrada rápida — só produto */}
                <div className="pnova-entry-wrap" ref={productRef}>
                  {entry.editingIndex !== null && (
                    <div className="pnova-entry-editing-banner">
                      Trocando produto do item {entry.editingIndex + 1} —{" "}
                      <strong>{items[entry.editingIndex]?.productName}</strong>
                      <button
                        type="button"
                        className="pnova-entry-cancel-inline"
                        onClick={() => setEntry({ ...emptyEntry })}
                      >✕ cancelar</button>
                    </div>
                  )}
                  <div className="pnova-entry-line">
                    <div className="pnova-entry-product-wrap">
                      {isMobile ? (
                        /* Mobile: botão trigger que abre bottom sheet */
                        <button
                          type="button"
                          className={`pnova-entry-mobile-trigger${!entry.query ? " empty" : ""}`}
                          onClick={() => {
                            setProductSheetQuery(entry.query);
                            setProductSheetOpen(true);
                            window.setTimeout(() => productSheetSearchRef.current?.focus(), 100);
                          }}
                        >
                          {entry.query || (entry.editingIndex !== null ? "Toque para trocar produto…" : "Toque para adicionar produto…")}
                        </button>
                      ) : (
                        /* Desktop: input com dropdown inline */
                        <>
                          <input
                            ref={entryProductRef}
                            className="pnova-entry-product-input"
                            autoComplete="off"
                            placeholder={entry.editingIndex !== null ? "Digite o novo produto..." : "Código ou nome — Enter para adicionar"}
                            value={entry.query}
                            onFocus={() => {
                              setEntryDropdownCursor(-1);
                              setProductStep("produtos");
                              if (entry.query.trim()) setEntryDropdownOpen(true);
                            }}
                            onClick={() => { setEntryDropdownOpen(true); }}
                            onChange={(event) => {
                              const val = event.target.value;
                              setEntry((e) => ({ ...e, query: val, productId: "", productName: val, productCode: "" }));
                              setEntryDropdownOpen(val.trim().length > 0);
                              setEntryDropdownCursor(-1);
                            }}
                            onPaste={(event) => {
                              const text = event.clipboardData.getData("text");
                              const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
                              if (lines.length <= 1) return;
                              event.preventDefault();
                              const notFound: string[] = [];
                              const newItems: PurchaseItemForm[] = [];
                              const existingIds = new Set(items.map((i) => i.productId));
                              for (const line of lines) {
                                const q = normalize(line);
                                if (!q) continue;
                                const match = products.filter((p) => p.isActive).find((p) => {
                                  const code = normalize(p.externalCode ?? "");
                                  const name = normalize(p.name);
                                  const aliases = p.aliases?.map((a) => normalize(a.alias)) ?? [];
                                  return (
                                    code === q || name === q ||
                                    (q.length >= 4 && (name.startsWith(q) || name.includes(q))) ||
                                    aliases.some((a) => a === q || (q.length >= 4 && a.includes(q)))
                                  );
                                });
                                if (match && !existingIds.has(match.id)) {
                                  existingIds.add(match.id);
                                  const def = productDefaults(match);
                                  newItems.push({ ...def, quantity: "1", unitPrice: "", totalPrice: "", notes: "" });
                                } else if (!match) {
                                  notFound.push(line);
                                }
                              }
                              if (newItems.length > 0) {
                                const startIdx = items.length;
                                setItems((current) => [...current, ...newItems]);
                                setHighlightedRow(startIdx);
                                window.setTimeout(() => setHighlightedRow(null), 1500);
                              }
                              setPasteReport(notFound);
                              setEntry({ ...emptyEntry });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") { event.preventDefault(); setEntryDropdownOpen(false); setEntryDropdownCursor(-1); if (entry.editingIndex !== null) setEntry({ ...emptyEntry }); return; }
                              if (event.key === "ArrowDown") { event.preventDefault(); setEntryDropdownOpen(true); setEntryDropdownCursor((c) => Math.min(c + 1, entryFilteredProducts.length - 1)); return; }
                              if (event.key === "ArrowUp") { event.preventDefault(); setEntryDropdownCursor((c) => Math.max(c - 1, -1)); return; }
                              if (event.key === "Enter") {
                                event.preventDefault();
                                if (entryDropdownCursor >= 0 && entryFilteredProducts[entryDropdownCursor]) {
                                  selectEntryProduct(entryFilteredProducts[entryDropdownCursor].id); return;
                                }
                                if (entryFilteredProducts.length > 0) {
                                  selectEntryProduct(entryFilteredProducts[0].id); return;
                                }
                                setEntryDropdownOpen(true);
                              }
                            }}
                          />
                          {entryDropdownOpen && (
                            <div className="autocomplete-dropdown product-autocomplete-dropdown pnova-product-dropdown">
                              {entryFilteredProducts.length === 0 ? (
                                <div className="autocomplete-empty-actions">
                                  <p>Nenhum produto encontrado para "{entry.query}"</p>
                                  <button type="button" onClick={() => setEntry((e) => ({ ...e, query: "" }))}>✕ Limpar busca</button>
                                  <button type="button" onClick={() => window.open("/products/new", "_blank")}>+ Cadastrar produto</button>
                                </div>
                              ) : (
                                <>
                                  {entryFilteredProducts.slice(0, 8).map((option, optIdx) => (
                                    <button
                                      key={option.id}
                                      className={`autocomplete-option pnova-product-option${optIdx === entryDropdownCursor ? " autocomplete-option-active" : ""}`}
                                      type="button"
                                      onClick={() => selectEntryProduct(option.id)}
                                      title={option.name}
                                    >
                                      <span className="pnova-option-code">{option.externalCode || ""}</span>
                                      <span className="pnova-option-name">{option.name}</span>
                                      <span className="pnova-option-meta">{option.category?.name ?? ""}{option.unit ? ` · ${option.unit}` : ""}{!option.isActive ? " · INATIVO" : ""}</span>
                                    </button>
                                  ))}
                                  {entryFilteredProducts.length > 8 && (
                                    <div className="pnova-dropdown-more">+{entryFilteredProducts.length - 8} mais — refine a busca</div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Relatório de produtos não encontrados no paste */}
                {pasteReport.length > 0 && (
                  <div className="pnova-paste-report">
                    <strong>Não encontrados ({pasteReport.length}):</strong>{" "}
                    {pasteReport.join(", ")}
                    <button type="button" className="pnova-paste-report-close" onClick={() => setPasteReport([])}>✕</button>
                  </div>
                )}

                {/* Botão contextual de avanço de etapa */}
                {productStep === "produtos" && items.length > 0 && (
                  <button type="button" className="pnova-step-advance" onClick={() => goToStep("quantidades")}>
                    → Preencher quantidades
                  </button>
                )}
                {productStep === "quantidades" && items.length > 0 && (
                  <button type="button" className="pnova-step-advance" onClick={() => goToStep("valores")}>
                    → Preencher valores
                  </button>
                )}
                {productStep === "valores" && items.length > 0 && (
                  <button type="button" className="pnova-step-advance" onClick={() => goToStep("conferencia")}>
                    {selectedSupplierIsCycle ? "→ Revisar e salvar" : "→ Conferir pagamento"}
                  </button>
                )}

                {/* Grade editável — planilha compacta */}
                {items.length > 0 && (
                  <div className="pnova-items-grid">
                    <div className="pnova-grid-header">
                      <span className="pnova-gh-code">Cód.</span>
                      <span className="pnova-gh-name">Produto</span>
                      <span className="pnova-gh-qty">Qtd.</span>
                      <span className="pnova-gh-unit">Un.</span>
                      <span className="pnova-gh-price">Valor unit.</span>
                      <span className="pnova-gh-total">Total</span>
                      <span className="pnova-gh-obs">Obs</span>
                      <span className="pnova-gh-actions"></span>
                    </div>
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className={`pnova-grid-row${entry.editingIndex === index ? " is-editing" : ""}${fieldErrors[`item-${index}`] ? " row-error" : ""}${(!item.unitPrice || Number(item.unitPrice) <= 0) && item.productId ? " row-warn" : ""}${highlightedRow === index ? " row-highlight" : ""}`}
                      >
                        {/* Código */}
                        <span className="pnova-gr-code" title={item.productCode}>{item.productCode || "–"}</span>

                        {/* Produto — clique troca via entry line */}
                        <button
                          type="button"
                          className="pnova-gr-name pnova-gr-product-btn"
                          title={`${item.productName} — clique para trocar produto`}
                          onClick={() => loadProductIntoEntry(index)}
                        >
                          {item.productName}
                        </button>

                        {/* Quantidade editável */}
                        <input
                          ref={(el) => { gridQtyRefs.current[index] = el; }}
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          className={`pnova-gr-input pnova-gr-qty-input${productStep === "quantidades" ? " col-active" : ""}${!item.quantity || Number(item.quantity) <= 0 ? " cell-warn" : ""}`}
                          value={item.quantity}
                          onFocus={(ev) => { ev.target.select(); setProductStep("quantidades"); }}
                          onChange={(ev) => updateGridItem(index, { quantity: ev.target.value.replace(",", ".") })}
                          onBlur={(ev) => {
                            const raw = ev.target.value.trim();
                            if (raw && !isNaN(Number(raw))) {
                              const num = parseFloat(raw);
                              if (!isNaN(num)) updateGridItem(index, { quantity: String(num) });
                            }
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.preventDefault();
                              if (ev.shiftKey) {
                                const prev = gridQtyRefs.current[index - 1];
                                if (prev) { prev.focus(); prev.select(); }
                                return;
                              }
                              const next = gridQtyRefs.current[index + 1];
                              if (next) { next.focus(); next.select(); }
                              else goToStep("valores");
                            }
                            if (ev.key === "Tab" && !ev.shiftKey) {
                              ev.preventDefault();
                              const price = gridPriceRefs.current[index];
                              if (price) { price.focus(); price.select(); }
                            }
                            if (ev.key === "ArrowDown") { ev.preventDefault(); const next = gridQtyRefs.current[index + 1]; if (next) { next.focus(); next.select(); } }
                            if (ev.key === "ArrowUp") { ev.preventDefault(); const prev = gridQtyRefs.current[index - 1]; if (prev) { prev.focus(); prev.select(); } }
                          }}
                        />

                        {/* Unidade */}
                        <select
                          className="pnova-gr-select"
                          value={item.unit}
                          onChange={(ev) => updateGridItem(index, { unit: ev.target.value })}
                        >
                          <option value="">–</option>
                          {units.map((u) => <option key={u.id} value={u.code}>{u.code}</option>)}
                        </select>

                        {/* Valor unitário editável */}
                        <input
                          ref={(el) => { gridPriceRefs.current[index] = el; }}
                          type="number"
                          min="0"
                          step="0.01"
                          className={`pnova-gr-input pnova-gr-price-input${productStep === "valores" ? " col-active" : ""}${!item.unitPrice || Number(item.unitPrice) <= 0 ? " cell-warn" : ""}`}
                          value={item.unitPrice}
                          placeholder="0,00"
                          onFocus={(ev) => { ev.target.select(); setProductStep("valores"); }}
                          onChange={(ev) => updateGridItem(index, { unitPrice: ev.target.value.replace(",", ".") })}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.preventDefault();
                              if (ev.shiftKey) {
                                const prev = gridPriceRefs.current[index - 1];
                                if (prev) { prev.focus(); prev.select(); }
                                return;
                              }
                              const next = gridPriceRefs.current[index + 1];
                              if (next) { next.focus(); next.select(); }
                              else entryProductRef.current?.focus();
                            }
                            if (ev.key === "Tab") {
                              ev.preventDefault();
                              if (ev.shiftKey) {
                                const qty = gridQtyRefs.current[index];
                                if (qty) { qty.focus(); qty.select(); }
                              } else {
                                const nextQty = gridQtyRefs.current[index + 1];
                                if (nextQty) { nextQty.focus(); nextQty.select(); }
                                else entryProductRef.current?.focus();
                              }
                            }
                            if (ev.key === "ArrowDown") { ev.preventDefault(); const next = gridPriceRefs.current[index + 1]; if (next) { next.focus(); next.select(); } }
                            if (ev.key === "ArrowUp") { ev.preventDefault(); const prev = gridPriceRefs.current[index - 1]; if (prev) { prev.focus(); prev.select(); } }
                          }}
                        />

                        {/* Total calculado */}
                        <span className="pnova-gr-total">
                          {item.totalPrice ? formatCurrency(Number(item.totalPrice)) : <span className="pnova-gr-empty">–</span>}
                        </span>

                        {/* Obs inline */}
                        <input
                          type="text"
                          className="pnova-gr-obs-input"
                          value={item.notes}
                          placeholder="+"
                          title={item.notes || "Observação"}
                          onChange={(ev) => updateGridItem(index, { notes: ev.target.value })}
                        />

                        {/* Excluir */}
                        <span className="pnova-gr-actions">
                          <button type="button" aria-label="Remover item" onClick={() => removeItemRow(index)}>
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ─── 4. FAIXA DE RESUMO + PENDÊNCIAS ─── */}
              <div className="pnova-summary-strip">
                <div className="pnova-summary-pill">
                  <span>{items.filter((item) => item.productId).length} itens</span>
                  <strong>{formatCurrency(totalAmount)}</strong>
                </div>
                {installments.length > 0 && (
                  <div className="pnova-summary-pill">
                    <span>{installments.length}x</span>
                    <strong>{formatCurrency(installmentTotal)}</strong>
                  </div>
                )}
                {!selectedSupplierIsCycle && Math.round(amountDifference * 100) !== 0 && (
                  <div className="pnova-summary-pill pnova-summary-warn">
                    <span>Dif.</span>
                    <strong>{formatCurrency(amountDifference)}</strong>
                  </div>
                )}
                <div className="pnova-pending-wrap">
                  <button
                    className={`pnova-pending-btn${validationMessages.length === 0 ? " is-ok" : ""}`}
                    type="button"
                    onClick={() => setShowPendingPopover((v) => !v)}
                  >
                    {validationMessages.length === 0 ? "✓ Conferida" : `Ver pendências (${validationMessages.length})`}
                  </button>
                  {showPendingPopover && (
                    <div className="pnova-pending-popover">
                      {validationMessages.length === 0 ? (
                        <p className="pnova-pending-ok">✓ Nenhuma pendência. Compra pronta para salvar.</p>
                      ) : (
                        <ul className="pnova-pending-list">
                          {validationMessages.map((msg) => <li key={msg}>{msg}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ─── 5. PAGAMENTO ─── */}
              <div className="pnova-payment-block" ref={paymentBlockRef}>
                {selectedSupplierIsCycle && form.supplierId ? (
                  <div className="pnova-cycle-info">
                    <div className="pnova-cycle-info-header">
                      <span className="pnova-cycle-info-icon">↻</span>
                      <span className="pnova-cycle-info-title">Fornecedor por ciclo/fatura</span>
                    </div>
                    <p className="pnova-cycle-info-body">
                      A compra entrará no ciclo aberto do fornecedor e não gerará título direto no Contas a Pagar.
                    </p>
                    <p className="pnova-cycle-info-hint">
                      Fechamento em <strong>Financeiro › Ciclos de fornecedor</strong>.
                    </p>
                  </div>
                ) : !form.supplierId || totalAmount <= 0 ? (
                  <p className="pnova-payment-placeholder">
                    {!form.supplierId
                      ? "Selecione o fornecedor para liberar as condições de pagamento."
                      : "Informe ao menos um produto com valor para calcular o pagamento."}
                  </p>
                ) : (
                  <>
                    {/* Cabeçalho compacto clicável */}
                    <button
                      type="button"
                      className={`pnova-payment-header${Math.round(amountDifference * 100) !== 0 ? " has-diff" : ""}`}
                      onClick={() => setPaymentExpanded((v) => !v)}
                    >
                      <span className="pnova-payment-header-method">
                        {basePaymentMethodName(selectedPaymentMethod?.name) || "Selecionar forma"}
                      </span>
                      {normalPurchaseUsesCreditCard && form.creditCardId && ccInstallmentPreview.length > 0 ? (
                        <span className="pnova-payment-header-info">
                          {creditCards.find((c) => c.id === form.creditCardId)?.name ?? "Cartão"}
                          {ccInstallmentPreview.length > 1 && ` · ${ccInstallmentPreview.length}x`}
                          {" · "}{ccInstallmentPreview[0]?.label}
                          {ccInstallmentPreview.length > 1 && ` → ${ccInstallmentPreview[ccInstallmentPreview.length - 1]?.label}`}
                          {" · "}{formatCurrency(totalAmount)}
                        </span>
                      ) : normalPurchaseUsesCreditCard ? (
                        <span className="pnova-payment-header-info">Selecione o cartão</span>
                      ) : installments.length > 0 ? (
                        <span className="pnova-payment-header-info">
                          {installments.length === 1 ? "1 parcela" : `${installments.length} parcelas`}
                          {installments[0]?.dueDate && (
                            <> · 1ª em {new Date(`${installments[0].dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</>
                          )}
                          {" · "}{formatCurrency(totalAmount)}
                        </span>
                      ) : null}
                      {Math.round(amountDifference * 100) !== 0 && (
                        <span className="pnova-payment-header-diff">⚠ dif. {formatCurrency(amountDifference)}</span>
                      )}
                      <span className="pnova-payment-header-toggle">{paymentExpanded ? "▲ recolher" : "▼ editar"}</span>
                    </button>

                    {/* Campos de edição — recolhido por padrão */}
                    {paymentExpanded && <div className="pnova-payment-fields">
                      <div className="pnova-payment-grid">
                        <label className={fieldErrors.paymentMethodId ? "field-error" : ""}>
                          Forma de pagamento
                          <select value={form.paymentMethodId} onChange={(event) => {
                            const nextMethod = availablePaymentMethods.find((method) => method.id === event.target.value) ?? null;
                            const nextCount = nextMethod && allowsInstallments(nextMethod) ? Math.max(1, Number(form.installmentCount || 1)) : 1;
                            setForm({ ...form, paymentMethodId: event.target.value, installmentCount: String(nextCount), creditCardId: "", ccNumberOfInstallments: "1" });
                            rebuildInstallments(event.target.value, totalAmount, nextCount);
                          }}>
                            <option value="">Selecione</option>
                            {availablePaymentMethods.map((method) => <option key={method.id} value={method.id}>{basePaymentMethodName(method.name) || method.name}</option>)}
                          </select>
                        </label>
                        {normalPurchaseUsesCreditCard ? (
                          <>
                            <label className={fieldErrors.creditCardId ? "field-error" : ""}>
                              Cartão de crédito
                              <select value={form.creditCardId}
                                onChange={(event) => setForm({ ...form, creditCardId: event.target.value })}>
                                <option value="">Selecione</option>
                                {creditCards.map((card) => <option key={card.id} value={card.id}>{card.name} — {card.bankName} {card.last4Digits}</option>)}
                              </select>
                            </label>
                            <label>
                              Parcelas no cartão
                              <div className="pnova-installment-count-wrap">
                                <input type="number" min="1" max="24" step="1"
                                  value={form.ccNumberOfInstallments}
                                  onChange={(event) => setForm((current) => ({ ...current, ccNumberOfInstallments: String(Math.max(1, Math.min(24, Number(event.target.value || 1)))) }))} />
                              </div>
                            </label>
                          </>
                        ) : (
                          <>
                            <label className={fieldErrors.installmentCount ? "field-error" : ""}>
                              Quantidade de parcelas
                              <div className="pnova-installment-count-wrap">
                                <input type="number" min="1" step="1" value={form.installmentCount}
                                  disabled={!selectedPaymentMethod || !selectedPaymentMethodAllowsInstallments || smallExpenseUsesCreditCard}
                                  onChange={(event) => setForm((current) => ({ ...current, installmentCount: String(Math.max(1, Number(event.target.value || 1))) }))} />
                              </div>
                            </label>
                            <label>
                              Primeiro vencimento
                              <input className="locked-field"
                                value={installments[0]?.dueDate
                                  ? new Date(`${installments[0].dueDate}T12:00:00`).toLocaleDateString("pt-BR")
                                  : "–"}
                                disabled />
                            </label>
                          </>
                        )}
                        {!showPaymentNotes ? (
                          <button className="secondary-button pnova-payment-obs-btn" type="button" onClick={() => setShowPaymentNotes(true)}>
                            {form.paymentNotes.trim() ? "✓ Obs financeira" : "+ Obs financeira"}
                          </button>
                        ) : (
                          <label className="full-width">
                            Obs financeira
                            <input autoComplete="off" value={form.paymentNotes}
                              onChange={(event) => setForm({ ...form, paymentNotes: event.target.value })}
                              onBlur={() => { if (!form.paymentNotes.trim()) setShowPaymentNotes(false); }} />
                          </label>
                        )}
                        {isAdmin && Math.round(amountDifference * 100) !== 0 && (
                          <label className="full-width">
                            Motivo da diferença
                            <input autoComplete="off" value={form.paymentDifferenceReason}
                              onChange={(event) => setForm({ ...form, paymentDifferenceReason: event.target.value })} />
                          </label>
                        )}
                      </div>
                      {fieldErrors.installments && !usesCreditCard && <div className="alert error" style={{ margin: "0 0 8px" }}>{fieldErrors.installments}</div>}
                      {installments.length > 0 && !usesCreditCard && (
                        <div className="pnova-installments-table">
                          <div className="pnova-installments-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th className="pnova-inst-col-parcela">Parcela</th>
                                <th className="pnova-inst-col-venc">Vencimento</th>
                                <th className="pnova-inst-col-valor">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {installments.map((installment, index) => (
                                <tr key={installment.installment}>
                                  <td className="pnova-inst-ordinal">
                                    {installment.installment}ª
                                    {installments.length > 1 && (
                                      <span className="pnova-inst-of"> de {installments.length}</span>
                                    )}
                                  </td>
                                  <td>
                                    <input
                                      type="date"
                                      value={installment.dueDate}
                                      onChange={(event) => setInstallments((current) => current.map((inst, entryIndex) => entryIndex === index ? { ...inst, dueDate: event.target.value } : inst))}
                                    />
                                  </td>
                                  <td className="pnova-inst-col-valor">
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={installment.amount}
                                      onChange={(event) => setInstallments((current) => current.map((inst, entryIndex) => entryIndex === index ? { ...inst, amount: event.target.value } : inst))}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className={`pnova-inst-footer${Math.round(amountDifference * 100) !== 0 ? " has-diff" : ""}`}>
                                <td colSpan={2} className="pnova-inst-footer-label">
                                  Total das parcelas
                                </td>
                                <td className="pnova-inst-footer-total">
                                  {formatCurrency(installmentTotal)}
                                  {Math.round(amountDifference * 100) === 0
                                    ? <span className="pnova-inst-ok">✓</span>
                                    : <span className="pnova-inst-diff"> ⚠ dif. {formatCurrency(amountDifference)}</span>
                                  }
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                          </div>
                        </div>
                      )}
                    </div>}
                  </>
                )}
              </div>

            </div>

            {/* ─── BOTTOM SHEET — PRODUTO (mobile) ─── */}
            {productSheetOpen && (
              <>
                <div className="pnova-bs-backdrop" onClick={closeProductSheet} />
                <div className="pnova-bottom-sheet" role="dialog" aria-modal="true" aria-label="Buscar produto">
                  <div className="pnova-bs-handle" />
                  <div className="pnova-bs-header">
                    <span className="pnova-bs-title">
                      {entry.editingIndex !== null
                        ? `Trocar produto do item ${entry.editingIndex + 1}`
                        : "Adicionar produto"}
                    </span>
                    <button type="button" className="pnova-bs-close" onClick={closeProductSheet} aria-label="Fechar">✕</button>
                  </div>
                  {entry.editingIndex !== null && (
                    <div className="pnova-bs-editing-banner">
                      Trocando: <strong>{items[entry.editingIndex]?.productName}</strong>
                    </div>
                  )}
                  <div className="pnova-bs-search-wrap">
                    <input
                      ref={productSheetSearchRef}
                      type="search"
                      className="pnova-bs-search"
                      autoComplete="off"
                      placeholder="Código ou nome do produto…"
                      value={productSheetQuery}
                      onChange={(event) => {
                        setProductSheetQuery(event.target.value);
                        setEntryDropdownCursor(-1);
                      }}
                    />
                  </div>
                  <div className="pnova-bs-list">
                    {entryFilteredProducts.length === 0 ? (
                      <div className="pnova-bs-empty">
                        {productSheetQuery
                          ? `Nenhum produto encontrado para "${productSheetQuery}"`
                          : "Digite para buscar produtos"}
                      </div>
                    ) : (
                      entryFilteredProducts.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="pnova-bs-card"
                          onClick={() => handleSheetProductSelect(option.id)}
                        >
                          <span className="pnova-bs-card-primary">{option.name}</span>
                          <span className="pnova-bs-card-secondary">
                            {option.externalCode && <span className="pnova-bs-card-chip">{option.externalCode}</span>}
                            {option.unit && <span>{option.unit}</span>}
                            {option.category?.name && <span>{option.category.name}</span>}
                            {!option.isActive && <span style={{ color: "#c62828" }}>INATIVO</span>}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  {items.length > 0 && (
                    <div className="pnova-bs-footer">
                      <p className="pnova-bs-footer-count">{items.length} produto{items.length > 1 ? "s" : ""} adicionado{items.length > 1 ? "s" : ""} — toque para adicionar mais</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── BOTTOM SHEET — FORNECEDOR (mobile) ─── */}
            {supplierSheetOpen && (
              <>
                <div className="pnova-bs-backdrop" onClick={() => setSupplierSheetOpen(false)} />
                <div className="pnova-bottom-sheet" role="dialog" aria-modal="true" aria-label="Buscar fornecedor">
                  <div className="pnova-bs-handle" />
                  <div className="pnova-bs-header">
                    <span className="pnova-bs-title">Selecionar fornecedor</span>
                    <button type="button" className="pnova-bs-close" onClick={() => setSupplierSheetOpen(false)} aria-label="Fechar">✕</button>
                  </div>
                  <div className="pnova-bs-search-wrap">
                    <input
                      ref={supplierSheetSearchRef}
                      type="search"
                      className="pnova-bs-search"
                      autoComplete="off"
                      placeholder="Nome, código ou CNPJ/CPF…"
                      value={supplierSheetQuery}
                      onChange={(event) => setSupplierSheetQuery(event.target.value)}
                    />
                  </div>
                  <div className="pnova-bs-list">
                    {filteredSupplierOptions.length === 0 ? (
                      <div className="pnova-bs-empty">
                        {supplierSheetQuery
                          ? "Nenhum fornecedor encontrado. Verifique o nome, código ou CNPJ."
                          : "Digite para buscar fornecedores"}
                      </div>
                    ) : (
                      filteredSupplierOptions.map((supplier) => (
                        <button
                          key={supplier.id}
                          type="button"
                          className="pnova-bs-card"
                          onClick={() => handleSheetSupplierSelect(supplier.id)}
                        >
                          <span className="pnova-bs-card-primary">{supplier.name}</span>
                          <span className="pnova-bs-card-secondary">
                            {supplier.externalCode && <span className="pnova-bs-card-chip">{supplier.externalCode}</span>}
                            {supplier.document && <span>{supplier.document}</span>}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ─── BARRA STICKY INFERIOR ─── */}
            <div className={`pnova-sticky-bar${keyboardOpen ? " keyboard-open" : ""}`}>
              <div className="pnova-sticky-left">
                <span className="pnova-sticky-total">{formatCurrency(totalAmount)}</span>
                {!selectedSupplierIsCycle && Math.round(amountDifference * 100) !== 0 && (
                  <span className="pnova-sticky-diff">⚠ dif. {formatCurrency(amountDifference)}</span>
                )}
                <span className={`pnova-sticky-status${validationMessages.length === 0 ? " ok" : " pending"}`}>
                  {validationMessages.length === 0 ? "✓ Conferida" : `${validationMessages.length} pendência${validationMessages.length > 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="pnova-sticky-right">
                <button className="secondary-button" type="button" onClick={goBackToList}>Cancelar</button>
                <button className="primary-button pnova-sticky-save" type="button" disabled={!canSavePurchase} onClick={handleCreatePurchase}>
                  {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar compra"}
                </button>
              </div>
            </div>
          </section>
        )}
    </section>
  );
}

