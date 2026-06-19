import { ChevronDown, Eye, FileText, Pencil, Plus, RefreshCw, Shield, Trash2, X } from "lucide-react";
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
  updatePurchase
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
    paymentDifferenceReason: ""
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
    Promise.all([getSuppliers(), getProducts(), getPaymentMethods(), getUnits(), getCards(), getSmallExpenseTypes()]).then(
      ([supplierList, productList, methodList, unitList, cardList, smallExpenseTypeList]) => {
        setSuppliers(supplierList);
        setProducts(productList);
        setPaymentMethods(methodList.filter((method) => method.isActive));
        setUnits(unitList.filter((unit) => unit.isActive));
        setCreditCards(cardList.filter((card) => card.isActive));
        setSmallExpenseTypes(smallExpenseTypeList.filter((type) => type.isActive));
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
          paymentDifferenceReason: ""
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
  }, [isCreateRoute, isEditRoute, params.id]);

  const selectedSupplier = suppliers.find((supplier) => supplier.id === form.supplierId) ?? null;
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;
  const selectedPaymentMethodBaseName = basePaymentMethodName(selectedPaymentMethod?.name);
  const availablePaymentMethods = useMemo(() => {
    const baseMethods = paymentMethods.filter((method) => !isLegacyInstallmentMethod(method));
    return baseMethods.length > 0 ? baseMethods : paymentMethods;
  }, [paymentMethods]);
  const categories = useMemo(() => [...new Set(products.map((product) => product.category?.name).filter(Boolean))] as string[], [products]);
  const smallExpenseUsesCreditCard = form.isSmallExpense && selectedPaymentMethod ? normalize(selectedPaymentMethod.name).includes("cartao de credito") : false;
  const selectedPaymentMethodAllowsInstallments = allowsInstallments(selectedPaymentMethod);
  const totalAmount = useMemo(() => items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0), [items]);
  const installmentTotal = useMemo(() => installments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0), [installments]);
  const amountDifference = totalAmount - installmentTotal;
  const installmentLeadDays = selectedSupplier?.defaultPaymentTermDays ?? (selectedPaymentMethodAllowsInstallments ? 30 : 0);
  const currentSnapshot = buildFormSnapshot();
  const isDirty = isFormRoute && baselineSnapshot !== "" && currentSnapshot !== baselineSnapshot;
  useNavigationPrompt(isDirty, "Existem alterações não salvas. Deseja sair sem salvar?");

  const filteredSupplierOptions = useMemo(() => {
    const query = normalize(supplierFilterQuery);
    if (!query) return suppliers.slice(0, 8);
    return suppliers.filter((supplier) => {
      const haystack = [supplier.name, supplier.externalCode, supplier.document].map(normalize).join(" ");
      return haystack.includes(query);
    }).slice(0, 8);
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

  const canSavePurchase = useMemo(() => {
    const validItems = items.filter((item) => item.productId && Number(item.quantity) > 0);
    const requestedInstallments = Math.max(1, Number(form.installmentCount || 1));
    const hasDifference = Math.round(amountDifference * 100) !== 0;
    const baseChecks = Boolean(form.supplierId)
      && Boolean(form.purchaseDate)
      && Boolean(form.paymentMethodId)
      && validItems.length > 0
      && validItems.every((item) => item.unit.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) >= 0)
      && (!showNoInvoiceReason ? Boolean(form.invoiceNumber.trim()) || form.isSmallExpense : Boolean(form.noInvoiceReason.trim()) || form.isSmallExpense)
      && (!form.isSmallExpense || Boolean(form.smallExpenseTypeId))
      && (!smallExpenseUsesCreditCard || (Boolean(form.creditCardId) && Boolean(openCardStatement)));
    if (!baseChecks) return false;
    if (!smallExpenseUsesCreditCard) {
      if (installments.length !== requestedInstallments) return false;
      if (installments.some((installment) => !installment.dueDate)) return false;
      if (hasDifference) return false;
    }
    if (duplicateCheck?.hasActiveDuplicate) return false;
    return !saving;
  }, [
    amountDifference,
    duplicateCheck?.hasActiveDuplicate,
    form.creditCardId,
    form.installmentCount,
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
    openCardStatement,
    saving,
    showNoInvoiceReason,
    smallExpenseUsesCreditCard
  ]);

  useEffect(() => {
    let active = true;
    if (!smallExpenseUsesCreditCard || !form.creditCardId) {
      setOpenCardStatement(null);
      return () => { active = false; };
    }
    getCardStatements({ creditCardId: form.creditCardId, status: "OPEN" })
      .then((rows) => { if (active) setOpenCardStatement(rows[0] ?? null); })
      .catch(() => { if (active) setOpenCardStatement(null); });
    return () => { active = false; };
  }, [form.creditCardId, smallExpenseUsesCreditCard]);

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

    // Duplicate: focus existing row qty instead of adding again
    const dupIdx = items.findIndex((item) => item.productId === productId);
    if (dupIdx >= 0) {
      setEntry({ ...emptyEntry });
      setEntryDropdownOpen(false);
      setEntryDropdownCursor(-1);
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
    setItems((current) => [...current, newItem]);
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
    window.setTimeout(() => {
      entryProductRef.current?.focus();
      entryProductRef.current?.select();
    }, 0);
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
      paymentDifferenceReason: ""
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
        paymentDifferenceReason: ""
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

  function rebuildInstallments(methodId = form.paymentMethodId, total = totalAmount, explicitCount?: number) {
    if (smallExpenseUsesCreditCard) {
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
    if (!form.paymentMethodId) errors.paymentMethodId = "Forma de pagamento obrigatória.";
    const requestedInstallments = Math.max(1, Number(form.installmentCount || 1));
    if (selectedPaymentMethod && !smallExpenseUsesCreditCard) {
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
    if (!smallExpenseUsesCreditCard && installments.length !== requestedInstallments) errors.installments = "Revise a quantidade de parcelas informada.";
    if (installments.length > 0 && Math.round(amountDifference * 100) !== 0) {
      errors.installments = "Total das parcelas não confere com o total da compra.";
    }
    if (installments.some((installment) => !installment.dueDate)) errors.installments = "Informe todos os vencimentos.";
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
        rawSupplierCode: form.supplierCode || selectedSupplier?.externalCode || null,
        purchaseDate: form.purchaseDate,
        invoiceNumber: form.invoiceNumber || null,
        purchaseOrderNumber: form.purchaseOrderNumber || null,
        noInvoiceReason: showNoInvoiceReason ? form.noInvoiceReason || null : null,
        paymentMethodId: selectedPaymentMethod?.id ?? null,
        paymentMethod: basePaymentMethodName(selectedPaymentMethod?.name) || selectedPaymentMethod?.name || null,
        notes: form.notes || null,
        isSmallExpense: form.isSmallExpense,
        smallExpenseTypeId: form.isSmallExpense ? form.smallExpenseTypeId || null : null,
        smallExpenseResponsibleName: null,
        smallExpenseAuthorizedBy: null,
        smallExpenseMoneyOrigin: form.isSmallExpense ? selectedPaymentMethod?.name ?? null : null,
        smallExpenseNotes: form.isSmallExpense ? form.smallExpenseNotes || form.notes || null : null,
        creditCardId: form.isSmallExpense ? form.creditCardId || null : null,
        paymentDifferenceReason: form.paymentDifferenceReason || null,
        workflowStatus: "confirmed",
        totalAmount,
        installments: smallExpenseUsesCreditCard
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
    const confirmed = window.confirm("Cancelar esta compra vai estornar a entrada de estoque vinculada. Confirmar?");
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

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    const validItems = items.filter((item) => item.productId || item.quantity || item.unitPrice || item.totalPrice);
    if (!form.supplierId) messages.push("Selecione o fornecedor da compra.");
    if (!form.purchaseDate) messages.push("Preencha a data da compra.");
    if (!form.paymentMethodId) messages.push("Selecione a forma de pagamento.");
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
    if (!smallExpenseUsesCreditCard && installments.length === 0) messages.push("Confira o parcelamento antes de salvar.");
    if (installments.some((installment) => !installment.dueDate)) messages.push("Preencha o vencimento de todas as parcelas.");
    if (installments.some((installment) => Number(installment.amount) < 0)) messages.push("Os valores das parcelas não podem ser negativos.");
    if (Math.round(amountDifference * 100) !== 0) messages.push("O total das parcelas precisa fechar com o total da compra.");
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
    openCardStatement,
    showNoInvoiceReason,
    smallExpenseUsesCreditCard
  ]);

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
      <div className="section-heading">
        <div>
          <p>Últimas compras</p>
          <h2>Compras</h2>
        </div>
        <div className="actions-cell">
          <button className="primary-button" type="button" onClick={openNewPurchase}>
            <Plus size={16} /> Nova compra
          </button>
          <button className="secondary-button" type="button" onClick={handleSupplierPositionPdf}>
            <FileText size={16} /> PDF posição fornecedor
          </button>
          <button className="secondary-button" type="button" onClick={() => { setShowSmallExpenses((current) => !current); if (!showSmallExpenses) void loadSmallExpenses(); }}>
            <Shield size={16} /> Pequenos gastos
          </button>
          <button className="icon-button" type="button" onClick={loadPurchases} aria-label="Atualizar compras">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <section className="purchase-filters-panel">
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
                {filteredSupplierOptions.length === 0 && <div className="autocomplete-empty">Nenhum fornecedor encontrado.</div>}
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
      </section>

      {showSmallExpenses && (
        <section className="panel subsection">
          <div className="section-heading compact-heading">
            <div>
              <p>Relatório</p>
              <h3>Pequenos gastos</h3>
            </div>
            <div className="actions-cell">
              <button className="secondary-button" type="button" onClick={loadSmallExpenses}>Atualizar</button>
              <button className="secondary-button" type="button" onClick={handleSmallExpensesPdf}><FileText size={16} /> PDF pequenos gastos</button>
            </div>
          </div>
          <div className="filters-row">
            <label>Funcionário<input value={smallExpenseFilters.employee} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, employee: event.target.value })} /></label>
            <label>Autorizado por<input value={smallExpenseFilters.authorizedBy} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, authorizedBy: event.target.value })} /></label>
            <label>Origem<input value={smallExpenseFilters.origin} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, origin: event.target.value })} /></label>
            <label>Tipo<input value={smallExpenseFilters.type} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, type: event.target.value })} /></label>
            <label>Fornecedor<input value={smallExpenseFilters.supplier} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, supplier: event.target.value })} /></label>
            <label>Pagamento<input value={smallExpenseFilters.paymentMethod} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, paymentMethod: event.target.value })} /></label>
            <label>Categoria<input value={smallExpenseFilters.category} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, category: event.target.value })} /></label>
            <label>Produto<input value={smallExpenseFilters.product} onChange={(event) => setSmallExpenseFilters({ ...smallExpenseFilters, product: event.target.value })} /></label>
            <button className="primary-button" type="button" onClick={loadSmallExpenses}>Filtrar</button>
          </div>
          {smallExpenseReport && (
            <>
              <div className="summary-grid">
                <article><span>Total</span><strong>{formatCurrency(smallExpenseReport.summary.total)}</strong></article>
                <article><span>Impacta CMV</span><strong>{formatCurrency(smallExpenseReport.summary.impactCmvTotal)}</strong></article>
                <article><span>Administrativo</span><strong>{formatCurrency(smallExpenseReport.summary.administrativeTotal)}</strong></article>
                <article><span>Linhas</span><strong>{smallExpenseReport.rows.length}</strong></article>
              </div>
              <div className="table-wrap operational-table">
                <table className="purchase-items-table">
                  <thead><tr><th>Data</th><th>Pedido</th><th>Fornecedor/Local</th><th>Funcionário</th><th>Autorizado</th><th>Origem</th><th>Tipo</th><th>Item</th><th className="numeric-cell">Valor</th><th>CMV</th></tr></thead>
                  <tbody>{smallExpenseReport.rows.map((row) => <tr key={row.id}><td>{formatDate(row.purchaseDate)}</td><td>{row.purchaseNumber ?? "-"}</td><td>{row.supplierName}</td><td>{row.employee}</td><td>{row.authorizedBy}</td><td>{row.origin}</td><td>{row.smallExpenseType}</td><td>{row.item}</td><td className="numeric-cell nowrap-cell">{formatCurrency(row.totalAmount)}</td><td>{row.impactCmv ? "Sim" : "Não"}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

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
                      <strong>{purchase.installments[0]?.paymentMethodName ?? purchase.paymentMethod ?? "-"}</strong>
                      <small>{purchase.installments.length} parcela(s)</small>
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
                    <td colSpan={7} className="empty-table-state">Nenhuma compra cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="purchases-mobile-list">
            {displayedPurchases.map((purchase) => (
              <article className="cmv-mobile-card" key={`${purchase.id}-mobile`}>
                <div className="cmv-mobile-row">
                  <span>Compra</span>
                  <strong>{purchase.invoiceNumber ? `NF ${purchase.invoiceNumber}` : purchase.purchaseNumber ?? "Compra manual"}</strong>
                </div>
                <div className="cmv-mobile-row">
                  <span>Data</span>
                  <span>{formatDate(purchase.purchaseDate)} • {String(purchase.competenceMonth).padStart(2, "0")}/{purchase.competenceYear}</span>
                </div>
                <div className="cmv-mobile-row">
                  <span>Fornecedor</span>
                  <span>{purchase.supplier.name}</span>
                </div>
                <div className="cmv-mobile-row">
                  <span>Itens</span>
                  <span>{purchase.items.length} item(ns) • {purchase.items[0]?.rawProductName ?? "-"}</span>
                </div>
                <div className="cmv-mobile-row">
                  <span>Pagamento</span>
                  <span>{purchase.installments[0]?.paymentMethodName ?? purchase.paymentMethod ?? "-"} • {purchase.installments.length} parcela(s)</span>
                </div>
                <div className="cmv-mobile-row">
                  <span>Total</span>
                  <strong>{formatCurrency(purchase.totalAmount)}</strong>
                </div>
                <div className="cmv-mobile-row">
                  <span>Status</span>
                  <span className={`status-badge ${purchaseStatusTone(purchase.status)}`}>{purchaseStatusLabel(purchase.status)}</span>
                </div>
                <div className="cmv-mobile-actions">
                  <button className="secondary-button" type="button" onClick={() => openDetail(purchase)}><Eye size={14} /> Ver</button>
                  {canEditPurchase && purchase.status !== "CANCELLED" && <button className="secondary-button" type="button" onClick={() => openEdit(purchase)}><Pencil size={14} /> Editar</button>}
                  {isAdmin && (
                    purchase.status === "CANCELLED"
                      ? <button className="secondary-button" type="button" onClick={() => handleRestore(purchase)}>Restaurar</button>
                      : <button className="danger-button" type="button" onClick={() => handleCancel(purchase)}><Trash2 size={14} /> Cancelar</button>
                  )}
                </div>
              </article>
            ))}
            {displayedPurchases.length === 0 && <div className="alert warning">Nenhuma compra cadastrada.</div>}
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
                <strong>{detail.smallExpenseMoneyOrigin ?? detail.creditCardName ?? detail.paymentMethodName ?? detail.paymentMethod ?? "-"}</strong>
                <small>{detail.installments.length} parcela(s) · {detail.importBatchId ? "Importação" : "Manual"}</small>
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
              <h3>Parcelas</h3>
              <div className="table-wrap operational-table">
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
                        window.setTimeout(() => setSupplierFilterOpen(true), 0);
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
                            {filteredSupplierOptions.length === 0 && <div className="autocomplete-empty">Nenhum fornecedor encontrado.</div>}
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
                      {!form.supplierId && (form.supplierName || form.supplierCode) && (
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
                    <label className="pnova-chip-check">
                      <input type="checkbox" checked={form.isSmallExpense}
                        onChange={(event) => setForm({ ...form, isSmallExpense: event.target.checked })} />
                      <span>Pequeno gasto</span>
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
                    {selectedPaymentMethod && normalize(selectedPaymentMethod.name).includes("cartao de credito") ? (
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

                {form.creditCardId && openCardStatement && (
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
                {fieldErrors.items && <div className="alert error">{fieldErrors.items}</div>}

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
                      <input
                        ref={entryProductRef}
                        className="pnova-entry-product-input"
                        autoComplete="off"
                        placeholder={entry.editingIndex !== null ? "Digite o novo produto..." : "Código ou nome do produto — Enter para adicionar"}
                        value={entry.query}
                        onFocus={() => { setEntryDropdownCursor(-1); }}
                        onClick={() => { setEntryDropdownOpen(true); }}
                        onChange={(event) => {
                          const val = event.target.value;
                          setEntry((e) => ({ ...e, query: val, productId: "", productName: val, productCode: "" }));
                          setEntryDropdownOpen(true);
                          setEntryDropdownCursor(-1);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") { event.preventDefault(); setEntryDropdownOpen(false); setEntryDropdownCursor(-1); if (entry.editingIndex !== null) setEntry({ ...emptyEntry }); return; }
                          if (event.key === "ArrowDown") { event.preventDefault(); setEntryDropdownOpen(true); setEntryDropdownCursor((c) => Math.min(c + 1, entryFilteredProducts.length - 1)); return; }
                          if (event.key === "ArrowUp") { event.preventDefault(); setEntryDropdownCursor((c) => Math.max(c - 1, -1)); return; }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            // Cursor ativo: seleciona o item destacado
                            if (entryDropdownCursor >= 0 && entryFilteredProducts[entryDropdownCursor]) {
                              selectEntryProduct(entryFilteredProducts[entryDropdownCursor].id); return;
                            }
                            // Sem cursor: seleciona o primeiro resultado (fluxo em lote)
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
                    </div>
                  </div>
                </div>

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
                        className={`pnova-grid-row${entry.editingIndex === index ? " is-editing" : ""}${fieldErrors[`item-${index}`] ? " row-error" : ""}${(!item.unitPrice || Number(item.unitPrice) <= 0) && item.productId ? " row-warn" : ""}`}
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
                          className={`pnova-gr-input pnova-gr-qty-input${!item.quantity || Number(item.quantity) <= 0 ? " cell-warn" : ""}`}
                          value={item.quantity}
                          onChange={(ev) => updateGridItem(index, { quantity: ev.target.value })}
                          onBlur={(ev) => {
                            const raw = ev.target.value.trim();
                            if (raw && !isNaN(Number(raw))) {
                              const num = parseFloat(raw);
                              if (!isNaN(num)) updateGridItem(index, { quantity: Number.isInteger(num) ? String(num) : String(num) });
                            }
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.preventDefault();
                              const next = gridQtyRefs.current[index + 1];
                              if (next) { next.focus(); next.select(); }
                              else if (gridPriceRefs.current[0]) { gridPriceRefs.current[0].focus(); gridPriceRefs.current[0].select(); }
                            }
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
                          className={`pnova-gr-input pnova-gr-price-input${!item.unitPrice || Number(item.unitPrice) <= 0 ? " cell-warn" : ""}`}
                          value={item.unitPrice}
                          placeholder="0,00"
                          onChange={(ev) => updateGridItem(index, { unitPrice: ev.target.value })}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter") {
                              ev.preventDefault();
                              const next = gridPriceRefs.current[index + 1];
                              if (next) { next.focus(); next.select(); }
                              else entryProductRef.current?.focus();
                            }
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
                {Math.round(amountDifference * 100) !== 0 && (
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
                    {validationMessages.length === 0 ? "✓ Conferida" : `Pendências (${validationMessages.length})`}
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
              <div className="pnova-payment-block">
                {!form.supplierId || totalAmount <= 0 ? (
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
                      {installments.length > 0 && (
                        <span className="pnova-payment-header-info">
                          {installments.length}x · 1ª {new Date(`${addDaysToInputDate(form.purchaseDate, installmentLeadDays)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {formatCurrency(totalAmount)}
                        </span>
                      )}
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
                            setForm({ ...form, paymentMethodId: event.target.value, installmentCount: String(nextCount) });
                            rebuildInstallments(event.target.value, totalAmount, nextCount);
                          }}>
                            <option value="">Selecione</option>
                            {availablePaymentMethods.map((method) => <option key={method.id} value={method.id}>{basePaymentMethodName(method.name) || method.name}</option>)}
                          </select>
                        </label>
                        <label className={fieldErrors.installmentCount ? "field-error" : ""}>
                          Parcelas
                          <input type="number" min="1" step="1" value={form.installmentCount}
                            disabled={!selectedPaymentMethod || !selectedPaymentMethodAllowsInstallments || smallExpenseUsesCreditCard}
                            onChange={(event) => setForm((current) => ({ ...current, installmentCount: String(Math.max(1, Number(event.target.value || 1))) }))} />
                        </label>
                        <label>
                          1ª parcela
                          <input className="locked-field"
                            value={new Date(`${addDaysToInputDate(form.purchaseDate, installmentLeadDays)}T12:00:00`).toLocaleDateString("pt-BR")}
                            disabled />
                        </label>
                        {!showPaymentNotes ? (
                          <button className="secondary-button pnova-payment-obs-btn" type="button" onClick={() => setShowPaymentNotes(true)}>
                            + Obs financeira
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
                      {fieldErrors.installments && <div className="alert error" style={{ margin: "0 0 8px" }}>{fieldErrors.installments}</div>}
                      {installments.length > 0 && (
                        <div className="pnova-installments-table">
                          <table>
                            <thead><tr><th>#</th><th>Vencimento</th><th>Valor</th></tr></thead>
                            <tbody>
                              {installments.map((installment, index) => (
                                <tr key={installment.installment}>
                                  <td>{installment.installment}/{installments.length}</td>
                                  <td><input type="date" value={installment.dueDate} onChange={(event) => setInstallments((current) => current.map((inst, entryIndex) => entryIndex === index ? { ...inst, dueDate: event.target.value } : inst))} /></td>
                                  <td><input type="number" min="0" step="0.01" value={installment.amount} onChange={(event) => setInstallments((current) => current.map((inst, entryIndex) => entryIndex === index ? { ...inst, amount: event.target.value } : inst))} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>}
                  </>
                )}
              </div>

            </div>

            {/* ─── BARRA STICKY INFERIOR ─── */}
            <div className="pnova-sticky-bar">
              <div className="pnova-sticky-left">
                <span className="pnova-sticky-total">{formatCurrency(totalAmount)}</span>
                {Math.round(amountDifference * 100) !== 0 && (
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

