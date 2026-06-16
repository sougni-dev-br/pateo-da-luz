import { AlertTriangle, Archive, ArrowDown, CalendarDays, CheckCircle2, ClipboardCheck, Download, FileText, FilterX, Layers, Loader2, MessageSquare, Play, RefreshCw, Search, Send, ShoppingCart, Save, SlidersHorizontal, Trash2, X } from "lucide-react";
import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  AppUser,
  approveOperationalInventory,
  BuyerSupportReport,
  cancelStockCountSession,
  cancelOperationalInventory,
  closeOperationalInventory,
  concludeStockCountSession,
  confirmInventoryAgendaItem,
  createPurchaseOrdersFromPrelist,
  createOperationalInventory,
  createStockCountSession,
  createInventoryMovement,
  createStockCount,
  deleteInventoryAgendaRule,
  getInventoryAgendaDetail,
  getInventoryAgenda,
  getInventoryMovements,
  getInventoryStocks,
  getOperationalInventories,
  getOperationalInventory,
  getOperationalInventoryPurchasingReport,
  getStockCountSession,
  getStockCountSessions,
  getBuyerSupportReport,
  downloadBuyerPrelistCsv,
  getProducts,
  getSectors,
  getStockCounts,
  InventoryAgenda,
  InventoryAgendaItem,
  InventoryMovement,
  InventorySector,
  InventoryStock,
  markOperationalInventoryItemsZero,
  OperationalInventory,
  OperationalInventoryDetail,
  OperationalInventoryPurchasingReport,
  OperationalInventoryType,
  Product,
  generateInventoryFromStockCountSession,
  consolidateMonthEndSessions,
  rejectOperationalInventory,
  reopenStockCountSession,
  reopenOperationalInventory,
  saveStockCountSessionItems,
  saveInventoryAgendaRule,
  saveOperationalInventoryItems,
  downloadOperationalInventoryPdf,
  startInventoryAgendaItem,
  StockCount,
  StockCountSession,
  StockCountSessionDetail,
  StockCountSessionType,
  submitOperationalInventory,
  submitInventoryAgendaItem,
  updateStockMinQuantity
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { PeriodFilter } from "../components/PeriodFilter";
import { SimpleBarChart } from "../components/SimpleBarChart";
import { EmptyState, StatusBadge, SummaryCard } from "../components/ui";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

type InventoryProps = {
  user: AppUser;
  initialView?: InventoryView;
  countSessionId?: string | null;
  onOpenProducts?: () => void;
  onOpenPurchaseOrders?: () => void;
  onOpenCountSessionRoute?: (id: string) => void;
  onCloseCountSessionRoute?: () => void;
};

type InventoryView = "overview" | "movements" | "counting" | "inventory" | "reports";
type InventoryDeskTab = "official" | "purchase" | "stock" | "reports";

const weekdays = [
  { value: "", label: "Sem dia fixo" },
  { value: "1", label: "Segunda" },
  { value: "2", label: "Terca" },
  { value: "3", label: "Quarta" },
  { value: "4", label: "Quinta" },
  { value: "5", label: "Sexta" },
  { value: "6", label: "Sabado" },
  { value: "0", label: "Domingo" }
];

const statusLabels: Record<string, string> = {
  PENDING: "pendente",
  IN_PROGRESS: "em andamento",
  DRAFT: "rascunho",
  SUBMITTED: "enviado para revisao",
  CONFIRMED: "confirmado",
  LATE: "atrasado",
  CANCELLED: "cancelada"
};

const operationalStatusLabels: Record<string, string> = {
  RASCUNHO: "rascunho",
  EM_REVISAO: "em revisao",
  APROVADO: "aprovado",
  REJEITADO: "rejeitado",
  FECHADO: "fechado",
  CANCELADO: "cancelado"
};

const operationalTypeLabels: Record<OperationalInventoryType, string> = {
  GERAL: "Geral",
  SETORIAL: "Setorial",
  FINAL_CMV: "Final CMV",
  CONFERENCIA: "Conferencia"
};

const editableOperationalInventoryStatuses = new Set(["RASCUNHO", "REJEITADO"]);

const countSessionStatusLabels: Record<string, string> = {
  ABERTA: "aberta",
  EM_ANDAMENTO: "em andamento",
  CONCLUIDA: "concluida",
  CANCELADA: "cancelada"
};

const countSessionTypeLabels: Record<StockCountSessionType, string> = {
  GERAL: "Geral",
  SETORIAL: "Setorial",
  CATEGORIA: "Categoria",
  SUBCATEGORIA: "Subcategoria",
  FINAL_MES: "Final do mes",
  ALEATORIA: "Aleatoria",
  TAREFA: "Tarefa"
};

const editableCountSessionStatuses = new Set(["ABERTA", "EM_ANDAMENTO"]);

const countSessionColumnOptions = [
  { key: "sector", label: "Setor", required: false },
  { key: "category", label: "Categoria", required: false },
  { key: "subcategory", label: "Subcategoria", required: false },
  { key: "unit", label: "Unidade", required: false },
  { key: "code", label: "Codigo", required: false },
  { key: "product", label: "Produto", required: true },
  { key: "quantity", label: "Quantidade", required: true },
  { key: "notes", label: "Observacao", required: false },
  { key: "status", label: "Status", required: true }
] as const;

type CountSessionColumn = typeof countSessionColumnOptions[number]["key"];

const defaultCountSessionColumns: Record<CountSessionColumn, boolean> = {
  sector: false,
  category: false,
  subcategory: false,
  unit: true,
  code: true,
  product: true,
  quantity: true,
  notes: true,
  status: true
};

function displayLabel(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const text = String(value).trim();
  if (!text || text === "[object Object]" || text === "undefined" || text === "null") return fallback;
  return text;
}

function loadCountSessionColumnPreferences() {
  try {
    const stored = window.localStorage.getItem("stockCountLaunchColumns");
    if (!stored) return defaultCountSessionColumns;
    const parsed = JSON.parse(stored) as Partial<Record<CountSessionColumn, boolean>>;
    return {
      ...defaultCountSessionColumns,
      ...parsed,
      product: true,
      quantity: true
    };
  } catch {
    return defaultCountSessionColumns;
  }
}

const movementTypes = [
  { value: "MANUAL_OUT", label: "Saida manual" },
  { value: "BREAKAGE", label: "Quebra" },
  { value: "LOSS", label: "Perda" },
  { value: "INTERNAL_CONSUMPTION", label: "Consumo interno" },
  { value: "EMPLOYEE_PURCHASE", label: "Compra por funcionario" },
  { value: "POSITIVE_ADJUSTMENT", label: "Ajuste positivo" },
  { value: "NEGATIVE_ADJUSTMENT", label: "Ajuste negativo" },
  { value: "RETURN", label: "Devolucao" },
  { value: "TRANSFER", label: "Transferencia futura" },
  { value: "PURCHASE_IN", label: "Entrada manual" }
];

const sensitiveMovementTypes = ["BREAKAGE", "LOSS", "EMPLOYEE_PURCHASE", "NEGATIVE_ADJUSTMENT"];

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year: String(year), month: String(month) };
}

function dateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function stockCountSortText(value: string | null | undefined, fallback = "") {
  return String(value ?? fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function inventoryClassificationSortText(value: string | null | undefined, fallback = "") {
  return String(value ?? fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function sameDay(a: string, b: Date) {
  return dateKey(a) === b.toISOString().slice(0, 10);
}

function operationalTone(status: string) {
  if (["APROVADO", "FECHADO"].includes(status)) return "success" as const;
  if (status === "EM_REVISAO") return "info" as const;
  if (["REJEITADO", "CANCELADO"].includes(status)) return "danger" as const;
  return "warning" as const;
}

function countSessionTone(status: string) {
  if (status === "CONCLUIDA") return "success" as const;
  if (status === "EM_ANDAMENTO") return "info" as const;
  if (status === "CANCELADA") return "danger" as const;
  return "warning" as const;
}

function buyerAlertTone(alert: string) {
  if (["ZERADO", "DIVERGENTE", "SEM_FORNECEDOR"].includes(alert)) return "danger" as const;
  if (["ABAIXO DO MINIMO", "CADASTRO INCOMPLETO", "SEM CONTAGEM", "SEM_ESTOQUE_MINIMO", "SEM_ESTOQUE_IDEAL"].includes(alert)) return "warning" as const;
  return "info" as const;
}

function buyerAlertLabel(alert: string) {
  return alert.replace(/_/g, " ").toLowerCase();
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item) || "Sem classificacao";
    totals.set(key, (totals.get(key) ?? 0) + 1);
  });
  return [...totals.entries()].map(([label, value]) => ({ label, value }));
}

function sumBy<T>(items: T[], getKey: (item: T) => string | null | undefined, getValue: (item: T) => number) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item) || "Sem classificacao";
    totals.set(key, (totals.get(key) ?? 0) + getValue(item));
  });
  return [...totals.entries()].map(([label, value]) => ({ label, value: Math.round(value) }));
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}

export function Inventory({
  user,
  initialView = "overview",
  countSessionId = null,
  onOpenProducts,
  onOpenPurchaseOrders,
  onOpenCountSessionRoute,
  onCloseCountSessionRoute
}: InventoryProps) {
  const canViewCosts = user.role === "ADMIN" || user.role === "GESTAO_COMPLETA";
  const canConfigureAgenda = canViewCosts;
  const [activeView, setActiveView] = useState<InventoryView>(user.role === "ESTOQUISTA" ? "counting" : initialView);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [countSessions, setCountSessions] = useState<StockCountSession[]>([]);
  const [countSessionDetail, setCountSessionDetail] = useState<StockCountSessionDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [agenda, setAgenda] = useState<InventoryAgenda | null>(null);
  const [month, setMonth] = useState(monthValue());
  const [movementPeriod, setMovementPeriod] = useState(currentMonthPeriod());
  const [selectedAgendaId, setSelectedAgendaId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [movementForm, setMovementForm] = useState({ productId: "", type: "MANUAL_OUT", quantity: "", unit: "", notes: "" });
  const [movementSearch, setMovementSearch] = useState("");
  const [countForm, setCountForm] = useState({ productId: "", countedQuantity: "", unit: "", notes: "", generateAdjustment: true });
  const [ruleForm, setRuleForm] = useState({ id: "", dayOfWeek: "1", sectorId: "", sectorName: "", categoryName: "", frequency: "WEEKLY", notes: "" });
  const [countScreenOpen, setCountScreenOpen] = useState(false);
  const [countSearch, setCountSearch] = useState("");
  const [countLines, setCountLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  const [operationalInventories, setOperationalInventories] = useState<OperationalInventory[]>([]);
  const [operationalDetail, setOperationalDetail] = useState<OperationalInventoryDetail | null>(null);
  const [showCanceledStockData, setShowCanceledStockData] = useState(false);
  const [minQtyEdit, setMinQtyEdit] = useState<Record<string, string>>({});
  const [savingMinQty, setSavingMinQty] = useState<Record<string, boolean>>({});
  const [countSessionVisibleColumns, setCountSessionVisibleColumns] = useState<Record<CountSessionColumn, boolean>>(loadCountSessionColumnPreferences);
  const [editingCountSessionNoteId, setEditingCountSessionNoteId] = useState<string | null>(null);
  const [operationalForm, setOperationalForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: "GERAL" as OperationalInventoryType,
    sectorId: "",
    notes: ""
  });
  const [operationalSearch, setOperationalSearch] = useState("");
  const [operationalSectorFilter, setOperationalSectorFilter] = useState("");
  const [operationalLines, setOperationalLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  const [countSessionForm, setCountSessionForm] = useState({
    referenceDate: new Date().toISOString().slice(0, 10),
    type: "GERAL" as StockCountSessionType,
    sectorId: "",
    categoryId: "",
    subcategoryId: "",
    isMonthEnd: false,
    notes: ""
  });
  const [countSessionSearch, setCountSessionSearch] = useState("");
  const [countSessionSectorFilter, setCountSessionSectorFilter] = useState("");
  const [countSessionCategoryFilter, setCountSessionCategoryFilter] = useState("");
  const [countSessionSubcategoryFilter, setCountSessionSubcategoryFilter] = useState("");
  const [countSessionUnitFilter, setCountSessionUnitFilter] = useState("");
  const [countSessionStatusFilter, setCountSessionStatusFilter] = useState<"TODOS" | "PENDENTE" | "CONTADO">("TODOS");
  const [countSessionLines, setCountSessionLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  const [mobileCountFiltersOpen, setMobileCountFiltersOpen] = useState(false);
  const [mobileCountMoreActionsOpen, setMobileCountMoreActionsOpen] = useState(false);
  const [mobileQuickCountMode, setMobileQuickCountMode] = useState(false);
  const [activeCountSessionInputId, setActiveCountSessionInputId] = useState<string | null>(null);
  const [purchasingReport, setPurchasingReport] = useState<OperationalInventoryPurchasingReport | null>(null);
  const [buyerSupport, setBuyerSupport] = useState<BuyerSupportReport | null>(null);
  const [buyerFilters, setBuyerFilters] = useState({ search: "", supplier: "", sector: "", category: "", subcategory: "", status: "" });
  const [buyerTab, setBuyerTab] = useState<"summary" | "suppliers" | "alerts" | "registration" | "prelist">("summary");
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);
  const [selectedPrelistSuppliers, setSelectedPrelistSuppliers] = useState<Record<string, boolean>>({});
  const [inventoryDeskTab, setInventoryDeskTab] = useState<InventoryDeskTab>("official");
  const [stockFilters, setStockFilters] = useState({ sector: "", category: "", subcategory: "", supplier: "", alert: "" });
  const [consolidationSelected, setConsolidationSelected] = useState<Set<string>>(new Set());
  const { notice, setNotice } = useNotice();

  const selectedAgenda = useMemo(
    () => agenda?.items.find((item) => item.id === selectedAgendaId) ?? null,
    [agenda, selectedAgendaId]
  );
  const todayItems = useMemo(
    () => agenda?.items.filter((item) => sameDay(item.scheduledDate, new Date())) ?? [],
    [agenda]
  );
  const canManageOperationalInventory = user.role === "ADMIN" || user.role === "GESTAO_COMPLETA";
  const canEditStockMinimum = user.role === "ADMIN" || user.role === "GESTAO_COMPLETA" || user.role === "ESTOQUISTA";

  const saveMinQty = async (productId: string) => {
    const raw = minQtyEdit[productId];
    if (raw === undefined) return;
    const val = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (val !== null && isNaN(val)) return;
    setSavingMinQty((prev) => ({ ...prev, [productId]: true }));
    try {
      await updateStockMinQuantity(productId, val);
      setStocks((prev) => prev.map((s) => s.productId === productId ? { ...s, minQuantity: val === null ? null : String(val) } : s));
      setMinQtyEdit((prev) => { const next = { ...prev }; delete next[productId]; return next; });
    } catch {
      setNotice({ tone: "error", message: "Erro ao salvar estoque mínimo." });
    } finally {
      setSavingMinQty((prev) => { const next = { ...prev }; delete next[productId]; return next; });
    }
  };
  const canCancelCountSession = (session: StockCountSession | StockCountSessionDetail) => {
    if (session.status === "CANCELADA" || session.generatedInventoryId) return false;
    if (!["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"].includes(session.status)) return false;
    if (canManageOperationalInventory) return true;
    return user.role === "ESTOQUISTA" && session.responsibleUserId === user.id && ["ABERTA", "EM_ANDAMENTO"].includes(session.status);
  };
  const operationalSummary = useMemo(() => ({
    drafts: operationalInventories.filter((item) => item.status === "RASCUNHO").length,
    review: operationalInventories.filter((item) => item.status === "EM_REVISAO").length,
    closed: operationalInventories.filter((item) => item.status === "FECHADO").length,
    lastFinalCmv: operationalInventories.find((item) => item.type === "FINAL_CMV" && ["APROVADO", "FECHADO"].includes(item.status)),
    pending: operationalInventories
      .filter((item) => !["CANCELADO", "REJEITADO"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.pendingItems ?? 0), 0),
    divergent: operationalInventories
      .filter((item) => !["CANCELADO", "REJEITADO"].includes(item.status))
      .reduce((sum, item) => sum + Number(item.divergentItems ?? 0), 0)
  }), [operationalInventories]);
  const operationalCounts = useMemo(
    () => operationalInventories.filter((item) => ["RASCUNHO", "EM_REVISAO", "REJEITADO"].includes(item.status)),
    [operationalInventories]
  );
  const officialInventories = useMemo(
    () => operationalInventories.filter((item) => ["APROVADO", "FECHADO", "CANCELADO"].includes(item.status)),
    [operationalInventories]
  );
  const operationalSectors = useMemo(() => {
    const names = new Set<string>();
    operationalDetail?.items.forEach((item) => { if (item.sectorName) names.add(item.sectorName); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [operationalDetail]);
  const filteredOperationalItems = useMemo(() => {
    const normalized = operationalSearch.trim().toLowerCase();
    return [...(operationalDetail?.items ?? [])]
      .filter((item) => {
      const matchesSector = !operationalSectorFilter || item.sectorName === operationalSectorFilter;
      const matchesSearch = !normalized
        || String(item.productCode ?? "").toLowerCase().includes(normalized)
        || item.productName.toLowerCase().includes(normalized);
      return matchesSector && matchesSearch;
      })
      .sort((a, b) => {
        const valuesA = [
          inventoryClassificationSortText(a.sectorName, "zzzz_sem_setor"),
          inventoryClassificationSortText(a.categoryName, "zzzz_sem_categoria"),
          inventoryClassificationSortText(a.subcategoryName, "zzzz_sem_subcategoria"),
          inventoryClassificationSortText(a.productName),
          inventoryClassificationSortText(a.productCode, "zzzz_sem_codigo")
        ];
        const valuesB = [
          inventoryClassificationSortText(b.sectorName, "zzzz_sem_setor"),
          inventoryClassificationSortText(b.categoryName, "zzzz_sem_categoria"),
          inventoryClassificationSortText(b.subcategoryName, "zzzz_sem_subcategoria"),
          inventoryClassificationSortText(b.productName),
          inventoryClassificationSortText(b.productCode, "zzzz_sem_codigo")
        ];
        for (let index = 0; index < valuesA.length; index += 1) {
          const diff = valuesA[index].localeCompare(valuesB[index], "pt-BR");
          if (diff !== 0) return diff;
        }
        return 0;
      });
  }, [operationalDetail, operationalSearch, operationalSectorFilter]);
  const productCategories = useMemo(() => {
    const rows = new Map<string, { id: string; name: string }>();
    products.forEach((product) => {
      if (product.category?.id && product.category?.name) rows.set(product.category.id, { id: product.category.id, name: product.category.name });
    });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const productSubcategories = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; categoryId?: string | null }>();
    products.forEach((product) => {
      if (product.subcategory?.id && product.subcategory?.name) rows.set(product.subcategory.id, { id: product.subcategory.id, name: product.subcategory.name, categoryId: product.category?.id });
    });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const buyerSupportByProductId = useMemo(() => new Map((buyerSupport?.items ?? []).map((item) => [item.productId, item])), [buyerSupport]);
  const stockRows = useMemo(() => stocks.map((stock) => {
    const product = productById.get(stock.productId);
    const support = buyerSupportByProductId.get(stock.productId);
    const currentQuantity = Number(stock.currentQuantity ?? 0);
    const alerts = [...new Set([...(support?.alerts ?? []), ...(support?.registrationAlerts ?? [])])];
    if (currentQuantity <= 0 && !alerts.includes("ZERADO")) alerts.push("ZERADO");
    return {
      ...stock,
      currentQuantityNumber: currentQuantity,
      categoryName: support?.categoryName ?? product?.category?.name ?? null,
      subcategoryName: support?.subcategoryName ?? product?.subcategory?.name ?? null,
      supplierName: support?.supplierName ?? "Sem fornecedor definido",
      productDisplayName: stock.productName,
      codeLabel: stock.productCode ?? "Sem codigo",
      alerts
    };
  }).sort((a, b) => {
    const valuesA = [
      inventoryClassificationSortText(a.sectorName, "zzzz_sem_setor"),
      inventoryClassificationSortText(a.categoryName, "zzzz_sem_categoria"),
      inventoryClassificationSortText(a.subcategoryName, "zzzz_sem_subcategoria"),
      inventoryClassificationSortText(a.productDisplayName),
      inventoryClassificationSortText(a.productCode, "zzzz_sem_codigo")
    ];
    const valuesB = [
      inventoryClassificationSortText(b.sectorName, "zzzz_sem_setor"),
      inventoryClassificationSortText(b.categoryName, "zzzz_sem_categoria"),
      inventoryClassificationSortText(b.subcategoryName, "zzzz_sem_subcategoria"),
      inventoryClassificationSortText(b.productDisplayName),
      inventoryClassificationSortText(b.productCode, "zzzz_sem_codigo")
    ];
    for (let index = 0; index < valuesA.length; index += 1) {
      const diff = valuesA[index].localeCompare(valuesB[index], "pt-BR");
      if (diff !== 0) return diff;
    }
    return 0;
  }), [stocks, productById, buyerSupportByProductId]);
  const stockFilterOptions = useMemo(() => ({
    sectors: [...new Set(stockRows.map((item) => item.sectorName).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    categories: [...new Set(stockRows.map((item) => item.categoryName).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    subcategories: [...new Set(stockRows.map((item) => item.subcategoryName).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    suppliers: [...new Set(stockRows.map((item) => item.supplierName).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)),
    alerts: [...new Set(stockRows.flatMap((item) => item.alerts))].sort((a, b) => a.localeCompare(b))
  }), [stockRows]);
  const filteredStockRows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return stockRows.filter((item) => {
      const matchesSearch = !normalized || [item.productDisplayName, item.productCode, item.sectorName, item.categoryName, item.subcategoryName, item.supplierName]
        .some((value) => String(value ?? "").toLowerCase().includes(normalized));
      const matchesSector = !stockFilters.sector || item.sectorName === stockFilters.sector;
      const matchesCategory = !stockFilters.category || item.categoryName === stockFilters.category;
      const matchesSubcategory = !stockFilters.subcategory || item.subcategoryName === stockFilters.subcategory;
      const matchesSupplier = !stockFilters.supplier || item.supplierName === stockFilters.supplier;
      const matchesAlert = !stockFilters.alert || item.alerts.includes(stockFilters.alert);
      return matchesSearch && matchesSector && matchesCategory && matchesSubcategory && matchesSupplier && matchesAlert;
    });
  }, [stockRows, search, stockFilters]);
  const stockSummary = useMemo(() => ({
    total: stockRows.length,
    zeros: stockRows.filter((item) => item.alerts.includes("ZERADO")).length,
    belowMinimum: stockRows.filter((item) => item.alerts.includes("ABAIXO DO MINIMO")).length,
    divergent: stockRows.filter((item) => item.alerts.includes("DIVERGENTE")).length,
    withoutSupplier: stockRows.filter((item) => item.alerts.includes("SEM_FORNECEDOR")).length,
    incomplete: stockRows.filter((item) => item.alerts.includes("CADASTRO INCOMPLETO")).length
  }), [stockRows]);
  const activeCountSessions = useMemo(() => countSessions.filter((item) => editableCountSessionStatuses.has(item.status)), [countSessions]);
  const completedCountSessions = useMemo(() => countSessions.filter((item) => item.status === "CONCLUIDA"), [countSessions]);
  const countSessionSectors = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionCategories = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionSubcategories = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionUnits = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.unitLabel ?? displayLabel(item.unitSnapshot, "-")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const filteredCountSessionItems = useMemo(() => {
    const normalized = countSessionSearch.trim().toLowerCase();
    const sorted = [...(countSessionDetail?.items ?? [])].sort((a, b) => {
      const valuesA = [
        stockCountSortText(a.sectorSnapshot, "zzzz_sem_setor"),
        stockCountSortText(a.categorySnapshot, "zzzz_sem_categoria"),
        stockCountSortText(a.subcategorySnapshot, "zzzz_sem_subcategoria"),
        stockCountSortText(a.unitSnapshot, "zzzz_sem_unidade"),
        stockCountSortText(a.productNameSnapshot),
        stockCountSortText(a.productCodeSnapshot)
      ];
      const valuesB = [
        stockCountSortText(b.sectorSnapshot, "zzzz_sem_setor"),
        stockCountSortText(b.categorySnapshot, "zzzz_sem_categoria"),
        stockCountSortText(b.subcategorySnapshot, "zzzz_sem_subcategoria"),
        stockCountSortText(b.unitSnapshot, "zzzz_sem_unidade"),
        stockCountSortText(b.productNameSnapshot),
        stockCountSortText(b.productCodeSnapshot)
      ];
      return valuesA.join("|").localeCompare(valuesB.join("|"));
    });
    return sorted.filter((item) => {
      const line = countSessionLines[item.id];
      const currentStatus = line?.countedQuantity !== undefined && line.countedQuantity !== "" ? "CONTADO" : "PENDENTE";
      const keepFocusedPendingItem = countSessionStatusFilter === "PENDENTE" && item.id === activeCountSessionInputId;
      const matchesStatus = countSessionStatusFilter === "TODOS" || currentStatus === countSessionStatusFilter || keepFocusedPendingItem;
      const matchesSector = !countSessionSectorFilter || (item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor")) === countSessionSectorFilter;
      const matchesCategory = !countSessionCategoryFilter || (item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")) === countSessionCategoryFilter;
      const matchesSubcategory = !countSessionSubcategoryFilter || (item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria")) === countSessionSubcategoryFilter;
      const matchesUnit = !countSessionUnitFilter || (item.unitLabel ?? displayLabel(item.unitSnapshot, "-")) === countSessionUnitFilter;
      const matchesSearch = !normalized
        || String(item.productCodeSnapshot ?? "").toLowerCase().includes(normalized)
        || item.productNameSnapshot.toLowerCase().includes(normalized);
      return matchesStatus && matchesSector && matchesCategory && matchesSubcategory && matchesUnit && matchesSearch;
    }) ?? [];
  }, [countSessionDetail, countSessionLines, countSessionSearch, countSessionSectorFilter, countSessionCategoryFilter, countSessionSubcategoryFilter, countSessionUnitFilter, countSessionStatusFilter, activeCountSessionInputId]);
  const countSessionProgress = useMemo(() => {
    const total = countSessionDetail?.items.length ?? 0;
    const counted = countSessionDetail?.items.filter((item) => {
      const line = countSessionLines[item.id];
      return line?.countedQuantity !== undefined && line.countedQuantity !== "";
    }).length ?? 0;
    return { total, counted, pending: Math.max(total - counted, 0), percent: total ? Math.round((counted / total) * 100) : 0 };
  }, [countSessionDetail, countSessionLines]);
  const productsForCount = useMemo(() => {
    if (!selectedAgenda || selectedAgenda.sectorName === "INVENTARIO GERAL" || selectedAgenda.categoryName === "Todas as categorias") return products;
    return products.filter((product) => product.inventorySector?.name === selectedAgenda.sectorName);
  }, [products, selectedAgenda]);
  const filteredCountProducts = useMemo(() => {
    const normalized = countSearch.trim().toLowerCase();
    if (!normalized) return productsForCount;
    return productsForCount.filter((product) =>
      [product.externalCode, product.name, product.category?.name, product.subcategory?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [countSearch, productsForCount]);
  const countProgress = useMemo(() => {
    const counted = productsForCount.filter((product) => countLines[product.id]?.countedQuantity !== undefined && countLines[product.id]?.countedQuantity !== "").length;
    const divergent = productsForCount.filter((product) => {
      const value = countLines[product.id]?.countedQuantity;
      if (value === undefined || value === "") return false;
      const stock = stocks.find((item) => item.productName === product.name || item.productCode === product.externalCode);
      return Number(value) !== Number(stock?.currentQuantity ?? 0);
    }).length;
    return { total: productsForCount.length, counted, pending: Math.max(productsForCount.length - counted, 0), divergent };
  }, [countLines, productsForCount, stocks]);
  const activeProducts = useMemo(() => products.filter((product) => product.isActive !== false), [products]);
  const lowStockItems = useMemo(() => buyerSupport?.items.filter((item) => item.alerts.includes("ZERADO") || item.alerts.includes("ABAIXO_DO_MINIMO")) ?? [], [buyerSupport]);
  const latestCountSession = useMemo(() => [...countSessions].sort((a, b) => String(b.referenceDate).localeCompare(String(a.referenceDate)))[0] ?? null, [countSessions]);
  const latestClosedInventory = useMemo(
    () => [...operationalInventories].filter((item) => item.status === "FECHADO").sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] ?? null,
    [operationalInventories]
  );
  const productsByCategory = useMemo(() => countBy(products, (product) => product.category?.name), [products]);
  const productsBySector = useMemo(() => countBy(products, (product) => product.inventorySector?.name), [products]);
  const movementsByType = useMemo(() => countBy(movements, (movement) => movement.type), [movements]);
  const movementsByProduct = useMemo(() => sumBy(movements, (movement) => movement.productName, (movement) => Math.abs(Number(movement.quantity ?? 0))), [movements]);
  const movementsTimeline = useMemo(() => countBy(movements, (movement) => formatDate(movement.createdAt)), [movements]);
  const countsByStatus = useMemo(() => countBy(countSessions, (session) => countSessionStatusLabels[session.status] ?? session.status), [countSessions]);
  const divergencesBySector = useMemo(() => sumBy(operationalInventories, (inventory) => inventory.sectorName ?? operationalTypeLabels[inventory.type], (inventory) => Number(inventory.divergentItems ?? 0)), [operationalInventories]);
  const openCounts = activeCountSessions;
  const completedCounts = completedCountSessions;
  const activeCountProgress = openCounts.length
    ? Math.round(openCounts.reduce((sum, session) => {
        const total = Number(session.totalItems ?? 0);
        return sum + (total > 0 ? (Number(session.countedItems ?? 0) / total) * 100 : 0);
      }, 0) / openCounts.length)
    : 0;
  const viewItems = [
    { id: "overview" as const, label: "Visão Geral" },
    { id: "movements" as const, label: "Movimentações" },
    { id: "counting" as const, label: "Contagem de Estoque" },
    { id: "inventory" as const, label: "Inventário" },
    { id: "reports" as const, label: "Relatórios" }
  ].filter((item) => user.role !== "ESTOQUISTA" || item.id === "counting" || item.id === "overview");
  const panelClass = (views: InventoryView[]) => views.includes(activeView) ? "panel" : "panel inventory-section-hidden";

  async function load() {
    setLoading(true);
    try {
      const monthParts = parseMonth(month);
      const shouldLoadCountingOnly = user.role === "ESTOQUISTA";
      const [stockResult, movementResult, countResult, countSessionResult, agendaResult, operationalResult, sectorResult] = await Promise.allSettled([
        getInventoryStocks(search),
        shouldLoadCountingOnly ? Promise.resolve([] as InventoryMovement[]) : getInventoryMovements({ startDate: movementPeriod.startDate, endDate: movementPeriod.endDate }),
        getStockCounts(),
        getStockCountSessions(showCanceledStockData),
        getInventoryAgenda(monthParts),
        shouldLoadCountingOnly ? Promise.resolve([] as OperationalInventory[]) : getOperationalInventories(showCanceledStockData),
        getSectors(undefined, { forStockCounting: true })
      ]);
      const stockRows = settledValue(stockResult, [] as InventoryStock[]);
      const movementRows = settledValue(movementResult, [] as InventoryMovement[]);
      const countRows = settledValue(countResult, [] as StockCount[]);
      const countSessionRows = settledValue(countSessionResult, [] as StockCountSession[]);
      const agendaRows = settledValue(agendaResult, null as InventoryAgenda | null);
      const operationalRows = settledValue(operationalResult, [] as OperationalInventory[]);
      const sectorRows = settledValue(sectorResult, [] as InventorySector[]);
      setStocks(stockRows);
      setMovements(movementRows);
      setCounts(countRows);
      setCountSessions(countSessionRows);
      setAgenda(agendaRows);
      setOperationalInventories(operationalRows);
      setSectors(sectorRows);

      const firstAgenda = agendaRows?.items.find((item) => sameDay(item.scheduledDate, new Date())) ?? agendaRows?.items[0];
      setSelectedAgendaId((current) => current || firstAgenda?.id || "");
      await loadProducts(firstAgenda);
      if (shouldLoadCountingOnly) {
        setPurchasingReport(null);
        setBuyerSupport(null);
      } else {
        const [reportRows, buyerRows] = await Promise.all([
          getOperationalInventoryPurchasingReport(),
          getBuyerSupportReport(buyerFilters)
        ]);
        setPurchasingReport(reportRows);
        setBuyerSupport(buyerRows);
      }
      if (!sectorRows.length && countSessionForm.type === "SETORIAL") {
        setNotice({ tone: "warning", message: "Nenhum setor disponivel para contagem." });
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel carregar os dados do estoque." });
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts(agendaItem?: InventoryAgendaItem | null) {
    const isGeneral = agendaItem?.sectorName === "INVENTARIO GERAL" || agendaItem?.categoryName === "Todas as categorias";
    const productRows = await getProducts({
      ...(agendaItem?.sectorName && !isGeneral ? { sector: agendaItem.sectorName } : {}),
      controlsStock: "true",
      isActive: "true"
    });
    setProducts(productRows);
    if (productRows[0]) {
      setMovementForm((current) => current.productId ? current : { ...current, productId: productRows[0].id, unit: productRows[0].unit ?? "" });
      setCountForm((current) => current.productId ? current : { ...current, productId: productRows[0].id, unit: productRows[0].unit ?? "" });
    }
  }

  async function refreshOperational(id?: string) {
    const [rows, reportRows, buyerRows] = await Promise.all([getOperationalInventories(showCanceledStockData), getOperationalInventoryPurchasingReport(), getBuyerSupportReport(buyerFilters)]);
    setOperationalInventories(rows);
    setPurchasingReport(reportRows);
    setBuyerSupport(buyerRows);
    if (id) await openOperationalInventory(id, false);
  }

  async function loadBuyerSupport() {
    setBuyerSupport(await getBuyerSupportReport(buyerFilters));
  }

  async function exportBuyerPrelist() {
    try {
      await downloadBuyerPrelistCsv(buyerFilters);
      setNotice({ tone: "success", message: "Pre-lista de compra exportada." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao exportar pre-lista." });
    }
  }

  async function generatePurchaseOrdersFromPrelist() {
    if (!buyerSupport) return;
    const eligible = buyerSupport.prelist.filter((group) => group.supplierId);
    const selectedSupplierIds = eligible
      .filter((group) => selectedPrelistSuppliers[group.supplierId ?? ""] !== false)
      .map((group) => group.supplierId!)
      .filter(Boolean);
    const pendingWithoutSupplier = buyerSupport.prelist
      .filter((group) => !group.supplierId)
      .reduce((sum, group) => sum + group.items.length, 0);

    if (selectedSupplierIds.length === 0) {
      setNotice({ tone: "warning", message: "Nenhum fornecedor elegivel selecionado. Produtos sem fornecedor ficam como pendencia." });
      return;
    }
    if (!window.confirm(`Gerar pedido de compra em rascunho para ${selectedSupplierIds.length} fornecedor(es)?`)) return;

    try {
      const result = await createPurchaseOrdersFromPrelist({ supplierIds: selectedSupplierIds, filters: buyerFilters });
      setNotice({ tone: "success", message: `${result.orders.length} pedido(s) criado(s). Pendencias sem fornecedor: ${result.pendingWithoutSupplier || pendingWithoutSupplier}.` });
      onOpenPurchaseOrders?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar pedido de compra." });
    }
  }

  async function downloadInventoryPdf(inventory: OperationalInventory) {
    try {
      await downloadOperationalInventoryPdf(inventory.id, inventory.code);
      setNotice({ tone: "success", message: "Relatorio do inventario gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF." });
    }
  }

  async function refreshCountSessions(id?: string) {
    const rows = await getStockCountSessions(showCanceledStockData);
    setCountSessions(rows);
    if (id) await openCountSession(id, false);
  }

  async function createCountSession() {
    try {
      const sector = sectors.find((item) => item.id === countSessionForm.sectorId);
      const category = productCategories.find((item) => item.id === countSessionForm.categoryId);
      const subcategory = productSubcategories.find((item) => item.id === countSessionForm.subcategoryId);
      if (countSessionForm.type === "SETORIAL" && !sector) {
        setNotice({ tone: "warning", message: "Selecione um setor para iniciar a contagem por setor." });
        return;
      }
      if (countSessionForm.type === "CATEGORIA" && !category) {
        setNotice({ tone: "warning", message: "Selecione uma categoria para iniciar a contagem por categoria." });
        return;
      }
      if (countSessionForm.type === "SUBCATEGORIA" && !subcategory) {
        setNotice({ tone: "warning", message: "Selecione uma subcategoria para iniciar a contagem por subcategoria." });
        return;
      }
      const reference = new Date(`${countSessionForm.referenceDate}T00:00:00`);
      const created = await createStockCountSession({
        referenceDate: countSessionForm.referenceDate,
        type: countSessionForm.type,
        sectorId: countSessionForm.type === "SETORIAL" ? countSessionForm.sectorId || null : null,
        sectorName: countSessionForm.type === "SETORIAL" ? sector?.name ?? null : null,
        categoryId: countSessionForm.type === "CATEGORIA" ? countSessionForm.categoryId || null : null,
        categoryName: countSessionForm.type === "CATEGORIA" ? category?.name ?? null : null,
        subcategoryId: countSessionForm.type === "SUBCATEGORIA" ? countSessionForm.subcategoryId || null : null,
        subcategoryName: countSessionForm.type === "SUBCATEGORIA" ? subcategory?.name ?? null : null,
        isMonthEnd: countSessionForm.isMonthEnd || countSessionForm.type === "FINAL_MES",
        periodMonth: reference.getMonth() + 1,
        periodYear: reference.getFullYear(),
        notes: countSessionForm.notes || null
      });
      setNotice({ tone: "success", message: `${created.code} criada com ${created.totalItems} produto(s)${created.sectorName ? ` do setor ${created.sectorName}` : ""}.` });
      await refreshCountSessions(created.id);
      onOpenCountSessionRoute?.(created.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel iniciar a contagem." });
    }
  }

  async function openCountSession(id: string, showMessage = true, syncRoute = true) {
    const detail = await getStockCountSession(id);
    setCountSessionDetail(detail);
    setCountSessionSearch("");
    setCountSessionSectorFilter("");
    setCountSessionCategoryFilter("");
    setCountSessionSubcategoryFilter("");
    setCountSessionUnitFilter("");
    setCountSessionStatusFilter("TODOS");
    setCountSessionLines(Object.fromEntries(detail.items.map((item) => [
      item.id,
      { countedQuantity: item.countedQuantity == null ? "" : String(item.countedQuantity), notes: item.notes ?? "" }
    ])));
    if (syncRoute) onOpenCountSessionRoute?.(id);
    if (showMessage) setNotice({ tone: "success", message: `${detail.code} aberta para lancamento.` });
  }

  function countSessionPayload() {
    if (!countSessionDetail) return [];
    return countSessionDetail.items.map((item) => ({
      id: item.id,
      countedQuantity: countSessionLines[item.id]?.countedQuantity ?? "",
      notes: countSessionLines[item.id]?.notes ?? ""
    }));
  }

  async function saveCountSessionDraft() {
    if (!countSessionDetail) return;
    try {
      await saveStockCountSessionItems(countSessionDetail.id, countSessionPayload());
      setNotice({ tone: "success", message: "Contagem salva. Voce pode continuar depois." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel salvar a contagem." });
    }
  }

  async function concludeCountSession() {
    if (!countSessionDetail) return;
    const pendingItems = countSessionDetail.items.filter((item) => {
      const value = countSessionLines[item.id]?.countedQuantity;
      return value === undefined || value === "";
    }).length;
    if (pendingItems > 0) {
      setCountSessionStatusFilter("PENDENTE");
      setNotice({
        tone: "warning",
        message: `Existem ${pendingItems} produtos sem quantidade informada. Informe a quantidade contada ou digite 0 nos produtos sem estoque antes de concluir.`
      });
      return;
    }
    if (!window.confirm("Concluir contagem? Depois disso o estoquista nao podera editar diretamente sem reabertura autorizada.")) return;
    try {
      await concludeStockCountSession(countSessionDetail.id, countSessionPayload());
      setNotice({ tone: "success", message: "Contagem concluida. Todos os itens estavam informados." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel concluir a contagem." });
    }
  }

  async function reopenCountSessionAction() {
    if (!countSessionDetail) return;
    const reason = window.prompt("Motivo da reabertura");
    if (!reason) return;
    try {
      await reopenStockCountSession(countSessionDetail.id, reason);
      setNotice({ tone: "success", message: "Contagem reaberta." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel reabrir a contagem." });
    }
  }

  async function cancelCountSessionAction(session?: StockCountSession | StockCountSessionDetail) {
    const target = session ?? countSessionDetail;
    if (!target) return;
    if (!window.confirm("Tem certeza que deseja cancelar esta contagem? Esta acao nao apaga o historico, mas a contagem deixara de ser considerada para inventario, CMV, compras e fechamento.")) return;
    const reason = window.prompt("Motivo do cancelamento");
    if (!reason?.trim()) {
      setNotice({ tone: "warning", message: "Informe o motivo para cancelar a contagem." });
      return;
    }
    try {
      await cancelStockCountSession(target.id, reason.trim());
      setNotice({ tone: "success", message: `${target.code} cancelada. O historico foi preservado.` });
      await refreshCountSessions(countSessionDetail?.id === target.id ? target.id : undefined);
      if (countSessionDetail?.id === target.id) {
        const updated = await getStockCountSession(target.id);
        setCountSessionDetail(updated);
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel cancelar a contagem." });
    }
  }

  async function generateInventoryFromCountSession() {
    if (!countSessionDetail) return;
    if (!window.confirm("Gerar inventario oficial em rascunho a partir desta contagem concluida?")) return;
    try {
      const inventory = await generateInventoryFromStockCountSession(countSessionDetail.id);
      setNotice({ tone: "success", message: `${inventory.code} gerado a partir da contagem ${countSessionDetail.code}.` });
      await Promise.all([refreshCountSessions(countSessionDetail.id), refreshOperational(inventory.id)]);
      setActiveView("inventory");
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel gerar o inventario." });
    }
  }

  async function consolidateMonthEnd() {
    if (consolidationSelected.size === 0) return;
    const ids = [...consolidationSelected];
    if (!window.confirm(`Consolidar ${ids.length} contagem(ns) setorial(is) em um unico inventario Final CMV?`)) return;
    try {
      const inventory = await consolidateMonthEndSessions(ids);
      setNotice({ tone: "success", message: `${inventory.code} gerado — ${ids.length} setor(es) consolidados.` });
      setConsolidationSelected(new Set());
      await Promise.all([refreshCountSessions(), refreshOperational(inventory.id)]);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel consolidar as contagens." });
    }
  }

  function handleCountInputBlur(itemId: string) {
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.getAttribute("data-session-count-input") === "true") return;
      setActiveCountSessionInputId((current) => current === itemId ? null : current);
    }, 80);
  }

  function getVisibleCountSessionInputs() {
    return Array.from(document.querySelectorAll<HTMLInputElement>("[data-session-count-input='true']:not(:disabled)"))
      .filter((input) => input.getClientRects().length > 0);
  }

  function scrollCountInputToComfort(input: HTMLInputElement, behavior: ScrollBehavior = "auto") {
    const target = (input.closest(".mobile-count-card-block") as HTMLElement | null) ?? input;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const comfortableTop = Math.min(152, Math.max(112, viewportHeight * 0.26));
    const comfortableBottom = viewportHeight * 0.58;
    if (rect.top >= comfortableTop - 10 && rect.top <= comfortableBottom) return;
    window.scrollBy({ top: rect.top - comfortableTop, behavior });
  }

  function advanceCountSessionInput(currentInput: HTMLInputElement) {
    const inputs = getVisibleCountSessionInputs();
    const index = inputs.indexOf(currentInput);
    const nextInput = inputs[index + 1];
    if (!nextInput) {
      currentInput.blur();
      if (countSessionStatusFilter === "PENDENTE") {
        setNotice({ tone: "success", message: "Todos os itens deste filtro foram contados." });
      }
      return;
    }
    const nextItemId = nextInput.getAttribute("data-session-count-item-id");
    if (nextItemId) setActiveCountSessionInputId(nextItemId);
    scrollCountInputToComfort(nextInput);
    window.setTimeout(() => {
      nextInput.focus();
      nextInput.select();
      scrollCountInputToComfort(nextInput);
    }, 60);
  }

  function advanceCountSessionItem(itemId: string) {
    const input = getVisibleCountSessionInputs().find((candidate) => candidate.getAttribute("data-session-count-item-id") === itemId);
    if (input) advanceCountSessionInput(input);
  }

  function focusFirstVisibleCountSessionInput() {
    const firstInput = getVisibleCountSessionInputs()[0];
    if (!firstInput) {
      if (countSessionStatusFilter === "PENDENTE") {
        setNotice({ tone: "success", message: "Todos os itens deste filtro foram contados." });
      }
      return;
    }
    const itemId = firstInput.getAttribute("data-session-count-item-id");
    if (itemId) setActiveCountSessionInputId(itemId);
    scrollCountInputToComfort(firstInput);
    window.setTimeout(() => {
      firstInput.focus();
      firstInput.select();
      scrollCountInputToComfort(firstInput);
    }, 70);
  }

  function handleCountFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      advanceCountSessionInput(event.currentTarget);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    advanceCountSessionInput(event.currentTarget);
  }

  function markFilteredCountSessionItemsAsZero() {
    if (!filteredCountSessionItems.length) return;
    if (!window.confirm(`Marcar ${filteredCountSessionItems.length} item(ns) filtrado(s) como zero? Campos vazios serao preenchidos com 0.`)) return;
    const next = { ...countSessionLines };
    filteredCountSessionItems.forEach((item) => {
      next[item.id] = { countedQuantity: "0", notes: next[item.id]?.notes ?? "" };
    });
    setCountSessionLines(next);
  }

  async function createOperational() {
    try {
      const sector = sectors.find((item) => item.id === operationalForm.sectorId);
      const created = await createOperationalInventory({
        date: operationalForm.date,
        type: operationalForm.type,
        sectorId: operationalForm.type === "SETORIAL" ? operationalForm.sectorId || null : null,
        sectorName: operationalForm.type === "SETORIAL" ? sector?.name ?? null : null,
        notes: operationalForm.notes || null
      });
      setNotice({ tone: "success", message: `${created.code} criado com ${created.totalItems} item(ns).` });
      await refreshOperational(created.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel criar o inventario." });
    }
  }

  async function openOperationalInventory(id: string, showMessage = true) {
    const detail = await getOperationalInventory(id);
    setOperationalDetail(detail);
    setOperationalSectorFilter("");
    setOperationalLines(Object.fromEntries(detail.items.map((item) => [
      item.id,
      { countedQuantity: item.countedQuantity == null ? "" : String(item.countedQuantity), notes: item.notes ?? "" }
    ])));
    if (showMessage) setNotice({ tone: "success", message: `${detail.code} aberto para consulta.` });
  }

  async function saveOperationalDraft() {
    if (!operationalDetail) return;
    const items = operationalDetail.items.map((item) => ({
      id: item.id,
      countedQuantity: operationalLines[item.id]?.countedQuantity ?? "",
      notes: operationalLines[item.id]?.notes ?? ""
    }));
    try {
      await saveOperationalInventoryItems(operationalDetail.id, items);
      setNotice({ tone: "success", message: "Rascunho salvo." });
      await refreshOperational(operationalDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel salvar o inventario." });
    }
  }

  async function markOperationalFilteredZero() {
    if (!operationalDetail) return;
    const ids = filteredOperationalItems.map((item) => item.id);
    if (ids.length === 0) return;
    await markOperationalInventoryItemsZero(operationalDetail.id, ids);
    setNotice({ tone: "success", message: `${ids.length} item(ns) filtrado(s) marcados como zero.` });
    await refreshOperational(operationalDetail.id);
  }

  async function operationalAction(action: "submit" | "approve" | "reject" | "close" | "cancel" | "reopen") {
    if (!operationalDetail) return;
    try {
      if (action === "submit") await submitOperationalInventory(operationalDetail.id);
      if (action === "approve") await approveOperationalInventory(operationalDetail.id);
      if (action === "close") await closeOperationalInventory(operationalDetail.id);
      if (action === "reject") {
        const reason = window.prompt("Motivo da rejeicao");
        if (!reason) return;
        await rejectOperationalInventory(operationalDetail.id, reason);
      }
      if (action === "cancel") {
        const reason = window.prompt("Motivo do cancelamento");
        if (!reason) return;
        await cancelOperationalInventory(operationalDetail.id, reason);
      }
      if (action === "reopen") {
        const reason = window.prompt("Motivo da reabertura");
        if (!reason) return;
        await reopenOperationalInventory(operationalDetail.id, reason);
      }
      setNotice({ tone: "success", message: "Status do inventario atualizado." });
      await refreshOperational(operationalDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel atualizar o inventario." });
    }
  }

  async function chooseAgenda(item: InventoryAgendaItem) {
    setSelectedAgendaId(item.id);
    await loadProducts(item);
  }

  async function startAgenda() {
    if (!selectedAgenda) return;
    await startInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: "Contagem iniciada." });
    await load();
  }

  async function openCount(item: InventoryAgendaItem) {
    setSelectedAgendaId(item.id);
    setCountScreenOpen(true);
    await startInventoryAgendaItem(item.id);
    await loadProducts(item);
    await getInventoryAgendaDetail(item.id).catch(() => null);
    setNotice({ tone: "success", message: "Contagem aberta." });
  }

  function closeCountScreen() {
    setCountScreenOpen(false);
  }

  async function submitAgenda() {
    if (!selectedAgenda) return;
    await submitInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: "Contagem enviada para revisao." });
    await load();
  }

  async function confirmAgenda(item: InventoryAgendaItem) {
    await confirmInventoryAgendaItem(item.id);
    setNotice({ tone: "success", message: "Contagem confirmada." });
    await load();
  }

  async function submitMovement() {
    if (!movementForm.productId || !movementForm.quantity) return;
    if (sensitiveMovementTypes.includes(movementForm.type) && !movementForm.notes.trim()) {
      setNotice({ tone: "error", message: "Observacao obrigatoria para este tipo de movimentacao." });
      return;
    }
    try {
      await createInventoryMovement({ ...movementForm, quantity: Number(movementForm.quantity) });
      setNotice({ tone: "success", message: "Movimentacao criada com sucesso." });
      setMovementForm({ ...movementForm, quantity: "", notes: "" });
      await load();
    } catch {
      setNotice({ tone: "error", message: "Erro ao salvar movimentacao." });
    }
  }

  function selectMovementProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    setMovementForm({ ...movementForm, productId, unit: product?.unit ?? product?.stockUnit ?? movementForm.unit });
  }

  function findMovementProduct() {
    const query = movementSearch.trim().toLowerCase();
    const product = products.find((item) =>
      item.externalCode?.toLowerCase() === query ||
      item.name.toLowerCase().includes(query)
    );
    if (!product) {
      setNotice({ tone: "warning", message: "Produto nao encontrado para movimentacao." });
      return;
    }
    selectMovementProduct(product.id);
    setMovementSearch(product.externalCode ? `${product.externalCode} - ${product.name}` : product.name);
  }

  async function saveCountLine(product: Product, status: "DRAFT" | "SUBMITTED") {
    const line = countLines[product.id];
    if (!line?.countedQuantity) return;
    const result = await createStockCount({
      productId: product.id,
      countedQuantity: Number(line.countedQuantity),
      unit: product.stockUnit ?? product.unit ?? "",
      notes: line.notes,
      generateAdjustment: false,
      status,
      inventoryAgendaItemId: selectedAgenda?.id ?? null
    });
    setNotice({
      tone: result.divergenceQuantity === 0 ? "success" : "warning",
      message: status === "SUBMITTED" ? "Linha enviada para revisao." : "Rascunho salvo."
    });
  }

  async function submitCountScreen(status: "DRAFT" | "SUBMITTED") {
    const rows = productsForCount.filter((product) => countLines[product.id]?.countedQuantity);
    for (const product of rows) {
      await saveCountLine(product, status);
    }
    if (status === "SUBMITTED" && selectedAgenda) await submitInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: status === "SUBMITTED" ? "Contagem enviada para revisao." : "Rascunho da contagem salvo." });
    await load();
  }

  async function submitCount(status: "DRAFT" | "SUBMITTED") {
    if (!countForm.productId || !countForm.countedQuantity) return;
    try {
      const result = await createStockCount({
        ...countForm,
        status,
        inventoryAgendaItemId: selectedAgenda?.id ?? null,
        countedQuantity: Number(countForm.countedQuantity)
      });
      setNotice({
        tone: result.divergenceQuantity === 0 ? "success" : "warning",
        message: status === "SUBMITTED" ? "Contagem salva e enviada para revisao." : "Rascunho de contagem salvo."
      });
      setCountForm({ ...countForm, countedQuantity: "", notes: "" });
      await load();
    } catch {
      setNotice({ tone: "error", message: "Erro ao salvar contagem." });
    }
  }

  async function saveRule() {
    const sector = sectors.find((item) => item.id === ruleForm.sectorId);
    if (!sector && !ruleForm.categoryName.trim()) return;
    await saveInventoryAgendaRule({
      id: ruleForm.id || undefined,
      sectorId: sector?.id,
      sectorName: sector?.name ?? ruleForm.sectorName,
      categoryName: ruleForm.categoryName,
      dayOfWeek: ruleForm.dayOfWeek ? Number(ruleForm.dayOfWeek) : null,
      frequency: ruleForm.frequency,
      notes: ruleForm.notes,
      isActive: true
    });
    setNotice({ tone: "success", message: "Agenda de inventario atualizada." });
    setRuleForm({ id: "", dayOfWeek: "1", sectorId: "", sectorName: "", categoryName: "", frequency: "WEEKLY", notes: "" });
    await load();
  }

  async function editRule(rule: InventoryAgenda["rules"][number]) {
    setRuleForm({
      id: rule.id,
      dayOfWeek: rule.dayOfWeek == null ? "" : String(rule.dayOfWeek),
      sectorId: rule.sectorId ?? "",
      sectorName: rule.sectorName ?? "",
      categoryName: rule.categoryName,
      frequency: rule.frequency,
      notes: rule.notes ?? ""
    });
  }

  async function removeRule(ruleId: string) {
    const confirmed = window.confirm("Excluir esta agenda recorrente?");
    if (!confirmed) return;
    await deleteInventoryAgendaRule(ruleId);
    setNotice({ tone: "success", message: "Agenda excluida." });
    await load();
  }

  function focusNextCountInput(event: KeyboardEvent<HTMLInputElement>, productId: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const currentIndex = filteredCountProducts.findIndex((product) => product.id === productId);
    const nextProduct = filteredCountProducts[currentIndex + 1];
    if (!nextProduct) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-count-quantity="${nextProduct.id}"]`)?.focus();
    });
  }

  useEffect(() => {
    load();
  }, [month, showCanceledStockData]);

  useEffect(() => {
    window.localStorage.setItem("stockCountLaunchColumns", JSON.stringify(countSessionVisibleColumns));
  }, [countSessionVisibleColumns]);

  useEffect(() => {
    setActiveView(user.role === "ESTOQUISTA" ? "counting" : initialView);
  }, [initialView, user.role]);

  useEffect(() => {
    if (activeView !== "counting") return;
    if (!countSessionId) {
      setCountSessionDetail(null);
      return;
    }
    let active = true;
    openCountSession(countSessionId, false, false).catch((error) => {
      if (!active) return;
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel abrir a contagem." });
      onCloseCountSessionRoute?.();
    });
    return () => {
      active = false;
    };
  }, [activeView, countSessionId]);

  if (countSessionDetail && activeView === "counting") {
    const locked = !editableCountSessionStatuses.has(countSessionDetail.status) || user.role === "VISUALIZACAO";
    const mobileFilterSummary = [
      countSessionSectorFilter ? `Setor: ${countSessionSectorFilter}` : "",
      countSessionCategoryFilter ? `Categoria: ${countSessionCategoryFilter}` : "",
      countSessionSubcategoryFilter ? `Subcategoria: ${countSessionSubcategoryFilter}` : "",
      countSessionUnitFilter ? `Unidade: ${countSessionUnitFilter}` : "",
      countSessionStatusFilter !== "TODOS" ? (countSessionStatusFilter === "PENDENTE" ? "Pendentes" : "Contados") : ""
    ].filter(Boolean).join(" - ");
    const shouldRepeatSector = !countSessionDetail.sectorName && !countSessionSectorFilter && countSessionDetail.type !== "SETORIAL";
    const filteredSectorCounts = filteredCountSessionItems.reduce<Record<string, number>>((totals, item) => {
      const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
      totals[sector] = (totals[sector] ?? 0) + 1;
      return totals;
    }, {});
    const editingMobileNoteItem = editingCountSessionNoteId
      ? filteredCountSessionItems.find((item) => item.id === editingCountSessionNoteId) ?? countSessionDetail.items.find((item) => item.id === editingCountSessionNoteId)
      : null;
    const editingMobileNoteLine = editingMobileNoteItem ? countSessionLines[editingMobileNoteItem.id] ?? { countedQuantity: "", notes: "" } : null;
    const clearCountSessionFilters = () => {
      setCountSessionSearch("");
      setCountSessionSectorFilter("");
      setCountSessionCategoryFilter("");
      setCountSessionSubcategoryFilter("");
      setCountSessionUnitFilter("");
      setCountSessionStatusFilter("TODOS");
      setMobileQuickCountMode(false);
      setMobileCountFiltersOpen(false);
    };
    const toggleMobileQuickCountMode = () => {
      const next = !mobileQuickCountMode;
      setMobileQuickCountMode(next);
      setMobileCountFiltersOpen(false);
      if (next) {
        setCountSessionStatusFilter("PENDENTE");
        window.setTimeout(focusFirstVisibleCountSessionInput, 140);
      }
    };
    const toggleCountSessionColumn = (column: CountSessionColumn) => {
      if (column === "product" || column === "quantity" || column === "status") return;
      setCountSessionVisibleColumns((current) => ({ ...current, [column]: !current[column] }));
    };
    return (
      <div className={`stack stockkeeper-mode count-session-launch ${mobileQuickCountMode ? "quick-count-mode" : ""}`}>
        <Notice notice={notice} />
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>
                {countSessionDetail.code} - {formatDate(countSessionDetail.referenceDate)} - {countSessionTypeLabels[countSessionDetail.type]}
                {countSessionDetail.sectorName ? ` - ${countSessionDetail.sectorName}` : ""}
              </p>
              <h2>Lançamento de contagem</h2>
              <span className="muted">Digite as quantidades fisicas. Para produto sem estoque, informe 0. Campo vazio fica pendente.</span>
            </div>
            <div className="actions-cell">
              <button className="secondary-button" type="button" onClick={() => { setCountSessionDetail(null); onCloseCountSessionRoute?.(); }}><X size={16} />Voltar</button>
              <button className="secondary-button large-action" type="button" disabled={locked} onClick={saveCountSessionDraft}><Save size={17} />Salvar Contagem</button>
              <button className="primary-button large-action" type="button" disabled={locked} onClick={concludeCountSession}><CheckCircle2 size={17} />Concluir Contagem</button>
              {canManageOperationalInventory && countSessionDetail.status === "CONCLUIDA" && !countSessionDetail.generatedInventoryId && (
                <button className="primary-button large-action" type="button" onClick={generateInventoryFromCountSession}>Gerar inventario</button>
              )}
              {canManageOperationalInventory && countSessionDetail.status === "CONCLUIDA" && !countSessionDetail.generatedInventoryId && (
                <button className="secondary-button" type="button" onClick={reopenCountSessionAction}>Reabrir</button>
              )}
              {canCancelCountSession(countSessionDetail) && (
                <button className="danger-button" type="button" onClick={() => cancelCountSessionAction(countSessionDetail)}><Trash2 size={16} />Cancelar</button>
              )}
            </div>
          </div>

          <div className="summary-grid">
            <article><span>Total de produtos</span><strong>{countSessionProgress.total}</strong></article>
            <article><span>Contados</span><strong>{countSessionProgress.counted}</strong></article>
            <article><span>Pendentes</span><strong>{countSessionProgress.pending}</strong></article>
            <article><span>Status</span><strong>{countSessionStatusLabels[countSessionDetail.status] ?? countSessionDetail.status}</strong></article>
          </div>

          <div className="count-session-sticky-shell">
            <div className="count-progress-block compact-progress-block">
              <div className="progress-header">
                <span>{countSessionProgress.counted} de {countSessionProgress.total} produtos contados</span>
                <strong>{countSessionProgress.percent}%</strong>
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${countSessionProgress.percent}%` }} /></div>
            </div>

            <div className="mobile-count-sticky-bar">
              <div className="mobile-count-progress-line">
                <strong>{countSessionProgress.counted}/{countSessionProgress.total} contados</strong>
                <span>{countSessionProgress.pending} pendentes</span>
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${countSessionProgress.percent}%` }} /></div>
              <div className="mobile-quick-count-row">
                <button className={mobileQuickCountMode ? "primary-button" : "secondary-button"} type="button" onClick={toggleMobileQuickCountMode}>
                  {mobileQuickCountMode ? "Sair do modo rapido" : "Lancamento rapido"}
                </button>
                <span>{[countSessionSectorFilter || "Todos setores", "Pendentes"].join(" - ")}</span>
              </div>
              <div className="mobile-count-search-row">
                <label aria-label="Busca por codigo ou produto">
                  <Search size={16} />
                  <input value={countSessionSearch} onChange={(event) => setCountSessionSearch(event.target.value)} placeholder="Codigo ou produto" />
                </label>
                <button className={countSessionStatusFilter === "PENDENTE" ? "secondary-button active-filter" : "secondary-button"} type="button" onClick={() => setCountSessionStatusFilter(countSessionStatusFilter === "PENDENTE" ? "TODOS" : "PENDENTE")}>Pendentes</button>
                <button className="secondary-button icon-button" type="button" aria-expanded={mobileCountFiltersOpen} onClick={() => setMobileCountFiltersOpen((current) => !current)}><SlidersHorizontal size={17} />Filtros</button>
              </div>
              {(mobileFilterSummary || countSessionSearch) && (
                <div className="mobile-count-filter-summary">
                  <span>{[countSessionSearch ? `Busca: ${countSessionSearch}` : "", mobileFilterSummary].filter(Boolean).join(" - ")}</span>
                  <button type="button" onClick={clearCountSessionFilters}>Limpar</button>
                </div>
              )}
              {mobileCountFiltersOpen && (
                <div className="mobile-count-filter-panel">
                  <label>Setor<select value={countSessionSectorFilter} onChange={(event) => { setCountSessionSectorFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todos</option>
                    {countSessionSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
                  </select></label>
                  <label>Categoria<select value={countSessionCategoryFilter} onChange={(event) => { setCountSessionCategoryFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select></label>
                  <label>Subcategoria<select value={countSessionSubcategoryFilter} onChange={(event) => { setCountSessionSubcategoryFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
                  </select></label>
                  <label>Unidade<select value={countSessionUnitFilter} onChange={(event) => { setCountSessionUnitFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select></label>
                  <label>Status<select value={countSessionStatusFilter} onChange={(event) => { setCountSessionStatusFilter(event.target.value as "TODOS" | "PENDENTE" | "CONTADO"); setMobileCountFiltersOpen(false); }}>
                    <option value="TODOS">Todos</option>
                    <option value="PENDENTE">Pendentes</option>
                    <option value="CONTADO">Contados</option>
                  </select></label>
                  <button className="secondary-button" type="button" onClick={clearCountSessionFilters}>Limpar filtros</button>
                </div>
              )}
            </div>

            <div className="filters-row mobile-count-filters desktop-count-filters">
              <label>Busca<input autoFocus value={countSessionSearch} onChange={(event) => setCountSessionSearch(event.target.value)} placeholder="Codigo ou produto" /></label>
              <label>Setor<select value={countSessionSectorFilter} onChange={(event) => setCountSessionSectorFilter(event.target.value)}>
                <option value="">Todos</option>
                {countSessionSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
              </select></label>
              <label>Categoria<select value={countSessionCategoryFilter} onChange={(event) => setCountSessionCategoryFilter(event.target.value)}>
                <option value="">Todas</option>
                {countSessionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select></label>
              <label>Subcategoria<select value={countSessionSubcategoryFilter} onChange={(event) => setCountSessionSubcategoryFilter(event.target.value)}>
                <option value="">Todas</option>
                {countSessionSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
              </select></label>
              <label>Unidade<select value={countSessionUnitFilter} onChange={(event) => setCountSessionUnitFilter(event.target.value)}>
                <option value="">Todas</option>
                {countSessionUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select></label>
              <label>Status<select value={countSessionStatusFilter} onChange={(event) => setCountSessionStatusFilter(event.target.value as "TODOS" | "PENDENTE" | "CONTADO")}>
                <option value="TODOS">Todos</option>
                <option value="PENDENTE">Pendentes</option>
                <option value="CONTADO">Contados</option>
              </select></label>
              <button className={countSessionStatusFilter === "PENDENTE" ? "secondary-button active-filter pending-filter-button" : "secondary-button pending-filter-button"} type="button" onClick={() => setCountSessionStatusFilter(countSessionStatusFilter === "PENDENTE" ? "TODOS" : "PENDENTE")}>Somente pendentes</button>
              <button className="secondary-button" type="button" disabled={locked} onClick={markFilteredCountSessionItemsAsZero}>Marcar filtrados como zero</button>
              <details className="column-picker">
                <summary>Colunas</summary>
                <div className="column-picker-menu">
                  {countSessionColumnOptions.map((column) => (
                    <label key={column.key} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={countSessionVisibleColumns[column.key]}
                        disabled={column.required}
                        onChange={() => toggleCountSessionColumn(column.key)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>

          <div className="chart-grid count-session-charts">
            <SimpleBarChart title="Progresso" items={[
              { label: "Contados", value: countSessionProgress.counted },
              { label: "Pendentes", value: countSessionProgress.pending }
            ]} />
          </div>

          <div className="mobile-count-card-list">
            {filteredCountSessionItems.map((item, index) => {
              const line = countSessionLines[item.id] ?? { countedQuantity: "", notes: "" };
              const typed = line.countedQuantity !== "";
              const status = typed ? "CONTADO" : "PENDENTE";
              const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
              const previousSector = index > 0 ? (filteredCountSessionItems[index - 1].sectorLabel ?? displayLabel(filteredCountSessionItems[index - 1].sectorSnapshot, "Sem setor")) : null;
              const hasNotes = line.notes.trim().length > 0;
              const isActiveInput = activeCountSessionInputId === item.id;
              return (
                <div key={item.id} className="mobile-count-card-block">
                  {sector !== previousSector && (
                    <div className="mobile-sector-divider">
                      <strong>{sector}</strong>
                      <span>{filteredSectorCounts[sector]} itens</span>
                    </div>
                  )}
                  <article className={`mobile-count-card ${typed ? "is-counted" : "is-pending"} ${isActiveInput ? "is-active-input" : ""}`}>
                    <div className="mobile-count-card-title">
                      <strong title={displayLabel(item.productNameSnapshot, "Produto sem nome")}>{displayLabel(item.productNameSnapshot, "Produto sem nome")}</strong>
                      <StatusBadge tone={status === "PENDENTE" ? "warning" : "success"}>{status === "PENDENTE" ? "pendente" : "contado"}</StatusBadge>
                    </div>
                    <div className="mobile-count-card-meta">
                      <span>{item.productCodeSnapshot ?? "sem codigo"}</span>
                      <span>{item.unitLabel ?? displayLabel(item.unitSnapshot, "sem unidade")}</span>
                      <span className={sector === "Sem setor" ? "missing-classification" : ""}>{sector}</span>
                    </div>
                    <div className="mobile-count-card-classification">
                      <span>{item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")}</span>
                      <span>{item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria")}</span>
                    </div>
                    <div className="mobile-count-card-entry">
                      <label className="mobile-quantity-inline">
                        <span>Qtd.</span>
                        <input
                          className="count-input mobile-touch-count-input"
                          data-session-count-input="true"
                          data-session-count-item-id={item.id}
                          enterKeyHint={index >= filteredCountSessionItems.length - 1 ? "done" : "next"}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={locked}
                          value={line.countedQuantity}
                          onKeyDown={handleCountFieldKeyDown}
                          onFocus={() => setActiveCountSessionInputId(item.id)}
                          onBlur={() => handleCountInputBlur(item.id)}
                          onChange={(event) => setCountSessionLines({ ...countSessionLines, [item.id]: { ...line, countedQuantity: event.target.value } })}
                        />
                      </label>
                      <button
                        className={`note-flag mobile-note-button ${hasNotes ? "has-note" : ""}`}
                        type="button"
                        title={hasNotes ? line.notes : "Adicionar observacao"}
                        aria-label={hasNotes ? "Editar observacao do produto" : "Adicionar observacao ao produto"}
                        onClick={() => setEditingCountSessionNoteId(item.id)}
                      >
                        <MessageSquare size={16} />
                      </button>
                      {isActiveInput && !locked && (
                        <button className="secondary-button mobile-next-button" type="button" aria-label="Ir para proximo produto" onMouseDown={(event) => event.preventDefault()} onClick={() => advanceCountSessionItem(item.id)}>
                          <ArrowDown size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                </div>
              );
            })}
            {filteredCountSessionItems.length === 0 && mobileQuickCountMode && (
              <div className="mobile-quick-finished">
                <strong>Todos os itens deste filtro foram contados.</strong>
                <span>{countSessionProgress.pending === 0 ? "A contagem inteira esta pronta para conclusao." : "Salve o rascunho ou veja os itens ja contados neste filtro."}</span>
                <div>
                  <button className="secondary-button" type="button" disabled={locked} onClick={saveCountSessionDraft}>Salvar rascunho</button>
                  <button className="secondary-button" type="button" onClick={() => { setMobileQuickCountMode(false); setCountSessionStatusFilter("CONTADO"); }}>Ver contados</button>
                  {countSessionProgress.pending === 0 && <button className="primary-button" type="button" disabled={locked} onClick={concludeCountSession}>Concluir contagem</button>}
                </div>
              </div>
            )}
            {filteredCountSessionItems.length === 0 && !mobileQuickCountMode && (
              <EmptyState title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros da contagem." />
            )}
          </div>

          <div className="count-session-desktop-list subsection count-session-table-wrap">
            <div className="count-session-desktop-head">
              <span>Produto</span>
              <span>Quantidade</span>
              {countSessionVisibleColumns.status && <span>Status</span>}
            </div>
            <div className="count-session-desktop-body">
              {filteredCountSessionItems.map((item, index) => {
                const line = countSessionLines[item.id] ?? { countedQuantity: "", notes: "" };
                const typed = line.countedQuantity !== "";
                const status = typed ? "CONTADO" : "PENDENTE";
                const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
                const category = item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria");
                const subcategory = item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria");
                const unit = item.unitLabel ?? displayLabel(item.unitSnapshot, "Sem unidade");
                const productName = displayLabel(item.productNameSnapshot, "Produto sem nome");
                const hasNotes = line.notes.trim().length > 0;
                const editingNotes = editingCountSessionNoteId === item.id;
                const isActiveInput = activeCountSessionInputId === item.id;
                return (
                  <article key={item.id} className={`count-session-desktop-row ${typed ? "is-counted" : "is-pending"} ${isActiveInput ? "is-active-input" : ""}`}>
                    <div className="count-session-desktop-row-main">
                      <div className="count-session-product-stack">
                        <div className="count-session-product-line">
                          <strong className="count-session-product-name" title={productName}>{productName}</strong>
                          {countSessionVisibleColumns.notes && (
                            <button
                              className={`note-flag count-session-note-button ${hasNotes ? "has-note" : ""}`}
                              type="button"
                              tabIndex={-1}
                              title={hasNotes ? line.notes : "Adicionar observacao"}
                              aria-label={hasNotes ? "Editar observacao do produto" : "Adicionar observacao ao produto"}
                              onClick={() => setEditingCountSessionNoteId(editingNotes ? null : item.id)}
                            >
                              <MessageSquare size={14} />
                            </button>
                          )}
                        </div>
                        <div className="count-session-product-meta">
                          {countSessionVisibleColumns.code && <span title={item.productCodeSnapshot ?? "Sem codigo"}>{item.productCodeSnapshot ?? "Sem codigo"}</span>}
                          {item.locationSnapshot && <span title={item.locationSnapshot}>{item.locationSnapshot}</span>}
                        </div>
                        <div className="count-session-product-tags">
                          {countSessionVisibleColumns.unit && <span className="count-session-tag" title={unit}>{unit}</span>}
                          {countSessionVisibleColumns.category && <span className="count-session-tag" title={category}>{category}</span>}
                          {countSessionVisibleColumns.subcategory && <span className="count-session-tag" title={subcategory}>{subcategory}</span>}
                          {countSessionVisibleColumns.sector && shouldRepeatSector && (
                            <span className={`count-session-tag ${sector === "Sem setor" ? "is-problem" : ""}`} title={sector}>{sector}</span>
                          )}
                        </div>
                        {editingNotes && (
                          <div className="inline-note-editor count-session-inline-note">
                            <input
                              autoFocus
                              disabled={locked}
                              value={line.notes}
                              placeholder="Observacao do produto"
                              onChange={(event) => setCountSessionLines({ ...countSessionLines, [item.id]: { ...line, notes: event.target.value } })}
                            />
                            <button className="secondary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>OK</button>
                          </div>
                        )}
                      </div>
                      <div className="count-session-quantity-block">
                        <label className="count-session-quantity-label" htmlFor={`count-session-input-${item.id}`}>
                          <span>Qtd. contada</span>
                          <input
                            id={`count-session-input-${item.id}`}
                            className="count-input touch-count-input desktop-count-input"
                            data-session-count-input="true"
                            data-session-count-item-id={item.id}
                            enterKeyHint={index >= filteredCountSessionItems.length - 1 ? "done" : "next"}
                            inputMode="decimal"
                            placeholder="0"
                            disabled={locked}
                            value={line.countedQuantity}
                            onKeyDown={handleCountFieldKeyDown}
                            onFocus={() => setActiveCountSessionInputId(item.id)}
                            onBlur={() => handleCountInputBlur(item.id)}
                            onChange={(event) => setCountSessionLines({ ...countSessionLines, [item.id]: { ...line, countedQuantity: event.target.value } })}
                          />
                        </label>
                      </div>
                      {countSessionVisibleColumns.status && (
                        <div className="count-session-status-block">
                          <StatusBadge tone={status === "PENDENTE" ? "warning" : "success"}>{status === "PENDENTE" ? "pendente" : "contado"}</StatusBadge>
                          <small>{typed ? "valor confirmado" : "aguardando lancamento"}</small>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {filteredCountSessionItems.length === 0 && (
                <div className="count-session-empty-state">
                  <EmptyState title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros da contagem." />
                </div>
              )}
            </div>
          </div>
          <div className="mobile-count-bottom-actions">
            <button className="secondary-button" type="button" onClick={() => { setCountSessionDetail(null); onCloseCountSessionRoute?.(); }}><X size={16} />Voltar</button>
            <button className="secondary-button" type="button" disabled={locked} onClick={saveCountSessionDraft}><Save size={17} />Salvar</button>
            <button className="primary-button" type="button" disabled={locked} onClick={concludeCountSession}><CheckCircle2 size={17} />Concluir</button>
            <button className="secondary-button" type="button" aria-expanded={mobileCountMoreActionsOpen} onClick={() => setMobileCountMoreActionsOpen((current) => !current)}>Mais</button>
            {mobileCountMoreActionsOpen && (
              <div className="mobile-more-actions-panel">
                <button className="secondary-button" type="button" disabled={locked} onClick={() => {
                  markFilteredCountSessionItemsAsZero();
                  setMobileCountMoreActionsOpen(false);
                }}>Marcar filtrados como zero</button>
                {canManageOperationalInventory && countSessionDetail.status === "CONCLUIDA" && !countSessionDetail.generatedInventoryId && (
                  <button className="primary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); generateInventoryFromCountSession(); }}>Gerar inventario</button>
                )}
                {canManageOperationalInventory && countSessionDetail.status === "CONCLUIDA" && !countSessionDetail.generatedInventoryId && (
                  <button className="secondary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); reopenCountSessionAction(); }}>Reabrir contagem</button>
                )}
                {canCancelCountSession(countSessionDetail) && (
                  <button className="danger-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); cancelCountSessionAction(countSessionDetail); }}>Cancelar contagem</button>
                )}
                {locked && !(canManageOperationalInventory && countSessionDetail.status === "CONCLUIDA" && !countSessionDetail.generatedInventoryId) && !canCancelCountSession(countSessionDetail) && (
                  <span>Nenhuma acao adicional disponivel para este status.</span>
                )}
              </div>
            )}
          </div>
        </section>
        {editingMobileNoteItem && editingMobileNoteLine && (
          <div className="mobile-note-sheet" role="dialog" aria-modal="true" aria-label="Observacao do produto">
            <button className="mobile-note-backdrop" type="button" aria-label="Fechar observacao" onClick={() => setEditingCountSessionNoteId(null)} />
            <div className="mobile-note-panel">
              <div>
                <span>Observacao</span>
                <strong>{editingMobileNoteItem.productNameSnapshot}</strong>
              </div>
              <textarea
                autoFocus
                disabled={locked}
                value={editingMobileNoteLine.notes}
                placeholder="Anote uma divergencia, embalagem aberta ou detalhe importante."
                onChange={(event) => setCountSessionLines({
                  ...countSessionLines,
                  [editingMobileNoteItem.id]: { ...editingMobileNoteLine, notes: event.target.value }
                })}
              />
              <div className="actions-cell">
                <button className="secondary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>Cancelar</button>
                <button className="primary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>Salvar obs.</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (countScreenOpen && selectedAgenda) {
    return (
      <div className="stack stockkeeper-mode">
        <Notice notice={notice} />
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{formatDate(selectedAgenda.scheduledDate)} - {selectedAgenda.responsibleName ?? user.name}</p>
              <h2>{selectedAgenda.sectorName || selectedAgenda.categoryName}</h2>
            </div>
            <div className="actions-cell">
              <button className="secondary-button" type="button" onClick={closeCountScreen}><X size={16} />Voltar</button>
              <button className="secondary-button large-action" type="button" onClick={() => submitCountScreen("DRAFT")}><Save size={17} />Salvar rascunho</button>
              <button className="primary-button large-action" type="button" onClick={() => submitCountScreen("SUBMITTED")}><Send size={17} />Enviar para revisao</button>
            </div>
          </div>

          <div className="summary-grid">
            <article><span>Total de produtos</span><strong>{countProgress.total}</strong></article>
            <article><span>Contados</span><strong>{countProgress.counted}</strong></article>
            <article><span>Pendentes</span><strong>{countProgress.pending}</strong></article>
            <article><span>Divergentes</span><strong>{countProgress.divergent}</strong></article>
          </div>
          <div className="count-progress-block">
            <div className="progress-header">
              <span>{countProgress.counted} de {countProgress.total} produtos contados</span>
              <strong>{countProgress.total ? Math.round((countProgress.counted / countProgress.total) * 100) : 0}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${countProgress.total ? Math.round((countProgress.counted / countProgress.total) * 100) : 0}%` }} />
            </div>
          </div>

          <div className="filters-row">
            <label>Busca por codigo ou nome<input autoFocus value={countSearch} onChange={(event) => setCountSearch(event.target.value)} /></label>
            <button className="secondary-button" type="button" onClick={() => {
              const updates = { ...countLines };
              filteredCountProducts.forEach((product) => { updates[product.id] = { countedQuantity: "0", notes: updates[product.id]?.notes ?? "" }; });
              setCountLines(updates);
            }}>Marcar filtrados como zero</button>
          </div>

          <div className="chart-grid">
            <SimpleBarChart title="Contado x pendente" items={[
              { label: "Contados", value: countProgress.counted },
              { label: "Pendentes", value: countProgress.pending },
              { label: "Divergentes", value: countProgress.divergent }
            ]} />
          </div>

          <div className="table-wrap subsection">
            <table>
              <thead><tr><th>Codigo</th><th>Produto</th><th>Localizacao</th><th>Unidade</th><th>Quantidade contada</th><th>Observacao</th><th>Status</th></tr></thead>
              <tbody>{filteredCountProducts.map((product) => {
                const line = countLines[product.id] ?? { countedQuantity: "", notes: "" };
                const stock = stocks.find((item) => item.productName === product.name || item.productCode === product.externalCode);
                const hasValue = line.countedQuantity !== "";
                const divergent = hasValue && Number(line.countedQuantity) !== Number(stock?.currentQuantity ?? 0);
                return (
                  <tr key={product.id}>
                    <td>{product.externalCode ?? "-"}</td>
                    <td>{product.name}<small>{product.category?.name ?? "-"}</small></td>
                    <td>{[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "-"}</td>
                    <td>{product.stockUnit ?? product.unit ?? "-"}</td>
                    <td><input data-count-quantity={product.id} inputMode="decimal" value={line.countedQuantity} onKeyDown={(event) => focusNextCountInput(event, product.id)} onChange={(event) => setCountLines({ ...countLines, [product.id]: { ...line, countedQuantity: event.target.value } })} /></td>
                    <td><input value={line.notes} onChange={(event) => setCountLines({ ...countLines, [product.id]: { ...line, notes: event.target.value } })} /></td>
                    <td><span className={`status-badge ${divergent ? "overdue" : hasValue ? "confirmed" : "pending"}`}>{divergent ? "divergente" : hasValue ? "contado" : "pendente"}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`stack ${user.role === "ESTOQUISTA" ? "stockkeeper-mode" : ""}`}>
      <Notice notice={notice} />

      <div className="module-tabs stock-module-tabs">
        {viewItems.map((item) => (
          <button className={activeView === item.id ? "active" : ""} key={item.id} type="button" onClick={() => setActiveView(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <section className={panelClass(["overview"])}>
        <div className="section-heading">
          <div>
            <p>Estoque</p>
            <h2>Visão Geral</h2>
          </div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar estoque">
            {loading ? <Loader2 size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
        <div className="summary-grid dashboard-summary">
          <SummaryCard label="Produtos cadastrados" value={products.length} />
          <SummaryCard label="Produtos ativos" value={activeProducts.length} tone="success" />
          <SummaryCard label="Estoque baixo" value={lowStockItems.length} tone={lowStockItems.length ? "warning" : "success"} />
          <SummaryCard label="Última contagem" value={latestCountSession?.code ?? "-"} detail={latestCountSession ? formatDate(latestCountSession.referenceDate) : "Nenhuma contagem encontrada"} />
          <SummaryCard label="Último inventário fechado" value={latestClosedInventory?.code ?? "-"} detail={latestClosedInventory ? formatDate(latestClosedInventory.date) : "Nenhum fechamento"} />
          <SummaryCard label="Progresso em aberto" value={`${activeCountProgress}%`} detail={`${openCounts.length} contagem(ns) abertas`} tone={activeCountProgress >= 80 ? "success" : openCounts.length ? "warning" : "info"} />
        </div>
        <div className="quick-actions-row">
          <button className="primary-button large-action" type="button" onClick={() => setActiveView("counting")}>Iniciar Contagem</button>
          <button className="secondary-button large-action" type="button" onClick={() => setActiveView("inventory")}>Ver Inventário</button>
        </div>
        <div className="chart-grid">
          <SimpleBarChart title="Produtos por categoria" items={productsByCategory} />
          <SimpleBarChart title="Produtos por setor" items={productsBySector} />
          <SimpleBarChart title="Movimentações dos últimos 30 dias" items={movementsByType} />
          <SimpleBarChart title="Evolução de contagens" items={countsByStatus} />
          <SimpleBarChart title="Produtos com estoque baixo" items={countBy(lowStockItems, (item) => item.sectorName ?? item.categoryName)} />
        </div>
      </section>

      <section className={panelClass(["counting", "inventory", "reports"])}>
        <div className="section-heading">
          <div>
            <p>Estoque</p>
            <h2>{activeView === "counting" ? "Contagens de estoque" : "Inventario operacional"}</h2>
          </div>
          <div className="actions-cell">
            <label className="checkbox-label compact-check inventory-toggle-label">
              <input type="checkbox" checked={showCanceledStockData} onChange={(event) => setShowCanceledStockData(event.target.checked)} />
              Exibir cancelados/testes
            </label>
            <button className="icon-button" type="button" onClick={load} aria-label="Atualizar inventarios">
              {loading ? <Loader2 size={18} /> : <RefreshCw size={18} />}
            </button>
          </div>
        </div>

        {activeView !== "counting" && (
          <>
            <div className="inventory-workspace-tabs">
              <button className={inventoryDeskTab === "official" ? "active" : ""} type="button" onClick={() => setInventoryDeskTab("official")}>Inventarios oficiais</button>
              <button className={inventoryDeskTab === "purchase" ? "active" : ""} type="button" onClick={() => setInventoryDeskTab("purchase")}>Sugestao de compras</button>
              <button className={inventoryDeskTab === "stock" ? "active" : ""} type="button" onClick={() => setInventoryDeskTab("stock")}>Estoque atual</button>
              <button className={inventoryDeskTab === "reports" ? "active" : ""} type="button" onClick={() => setInventoryDeskTab("reports")}>Relatorios</button>
            </div>

            <div className="inventory-action-strip">
              <button className="primary-button" type="button" onClick={() => setInventoryDeskTab("official")}><ClipboardCheck size={16} />Criar inventario</button>
              <button className="secondary-button" type="button" disabled={!operationalDetail} onClick={() => operationalDetail && downloadInventoryPdf(operationalDetail)}><Download size={16} />Gerar PDF</button>
              <button className="secondary-button" type="button" onClick={() => { setInventoryDeskTab("purchase"); loadBuyerSupport(); }}><RefreshCw size={16} />Atualizar relatorio</button>
              <button className="secondary-button" type="button" disabled={!buyerSupport} onClick={exportBuyerPrelist}><FileText size={16} />Exportar CSV</button>
              <button className="primary-button" type="button" disabled={!buyerSupport} onClick={generatePurchaseOrdersFromPrelist}><ShoppingCart size={16} />Gerar pedido de compra</button>
            </div>
          </>
        )}

        {activeView === "counting" && (
          <>
            <div className="summary-grid dashboard-summary">
              <SummaryCard label="Abertas" value={activeCountSessions.filter((item) => item.status === "ABERTA").length} tone="warning" icon={<ClipboardCheck size={18} />} />
              <SummaryCard label="Em andamento" value={activeCountSessions.filter((item) => item.status === "EM_ANDAMENTO").length} tone="info" />
              <SummaryCard label="Concluidas" value={completedCountSessions.length} tone="success" icon={<CheckCircle2 size={18} />} />
              <SummaryCard label="Progresso medio" value={`${activeCountProgress}%`} tone={activeCountProgress >= 80 ? "success" : activeCountSessions.length ? "warning" : "info"} />
            </div>

            <div className="form-section">
              <div className="section-heading compact-heading">
                <div>
                  <p>Nova contagem</p>
                  <h3>Iniciar Contagem</h3>
                  <span className="muted">Esta etapa abre uma ficha de lancamento. Inventario oficial sera gerado depois, apenas com contagem concluida.</span>
                </div>
              </div>
              <div className="filters-row">
                <label>Data<input type="date" value={countSessionForm.referenceDate} onChange={(event) => setCountSessionForm({ ...countSessionForm, referenceDate: event.target.value })} /></label>
                <label>Tipo<select value={countSessionForm.type} onChange={(event) => setCountSessionForm({ ...countSessionForm, type: event.target.value as StockCountSessionType })}>
                  <option value="GERAL">Geral</option>
                  <option value="SETORIAL">Por setor</option>
                  <option value="CATEGORIA">Por categoria</option>
                  <option value="SUBCATEGORIA">Por subcategoria</option>
                  <option value="FINAL_MES">Final do mes</option>
                  <option value="ALEATORIA">Aleatoria</option>
                </select></label>
                {countSessionForm.type === "SETORIAL" && (
                  <label>Setor<select value={countSessionForm.sectorId} onChange={(event) => setCountSessionForm({ ...countSessionForm, sectorId: event.target.value })}>
                    <option value="">{sectors.length ? "Selecione" : "Nenhum setor disponível para contagem"}</option>
                    {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                  </select></label>
                )}
                {countSessionForm.type === "CATEGORIA" && (
                  <label>Categoria<select value={countSessionForm.categoryId} onChange={(event) => setCountSessionForm({ ...countSessionForm, categoryId: event.target.value })}>
                    <option value="">Selecione</option>
                    {productCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select></label>
                )}
                {countSessionForm.type === "SUBCATEGORIA" && (
                  <label>Subcategoria<select value={countSessionForm.subcategoryId} onChange={(event) => setCountSessionForm({ ...countSessionForm, subcategoryId: event.target.value })}>
                    <option value="">Selecione</option>
                    {productSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                  </select></label>
                )}
                <label className="checkbox-label"><input type="checkbox" checked={countSessionForm.isMonthEnd || countSessionForm.type === "FINAL_MES"} onChange={(event) => setCountSessionForm({ ...countSessionForm, isMonthEnd: event.target.checked })} />Contagem final do mes</label>
                <label>Observacoes<input value={countSessionForm.notes} onChange={(event) => setCountSessionForm({ ...countSessionForm, notes: event.target.value })} /></label>
                <button className="primary-button" type="button" onClick={createCountSession}><Play size={16} />Iniciar Contagem</button>
              </div>
            </div>
          </>
        )}

        {activeView === "counting" && (() => {
          const consolidatable = countSessions.filter((s) => s.isMonthEnd && s.status === "CONCLUIDA" && !s.generatedInventoryId);
          return consolidatable.length > 0 && canManageOperationalInventory ? (
            <div className="form-section" style={{ borderColor: "var(--gold)", background: "var(--surface)" }}>
              <div className="section-heading compact-heading">
                <div>
                  <p>Fechamento do mes</p>
                  <h3><Layers size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />Consolidar contagens setoriais em inventario Final CMV</h3>
                  <span className="muted">Selecione as contagens setoriais concluidas que deseja unificar. Os produtos duplicados entre setores terao a contagem mais recente prevalecida.</span>
                </div>
              </div>
              <div className="filters-row" style={{ flexWrap: "wrap", gap: 8 }}>
                {consolidatable.map((s) => (
                  <label key={s.id} className="checkbox-label" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "6px 10px", background: consolidationSelected.has(s.id) ? "var(--gold-soft)" : "#fff", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={consolidationSelected.has(s.id)}
                      onChange={(e) => {
                        const next = new Set(consolidationSelected);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        setConsolidationSelected(next);
                      }}
                    />
                    <span><strong>{s.code}</strong>{s.sectorName ? ` — ${s.sectorName}` : ""}<small style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>{s.totalItems} produtos contados</small></span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                <button
                  className="primary-button"
                  type="button"
                  disabled={consolidationSelected.size === 0}
                  onClick={consolidateMonthEnd}
                >
                  <Layers size={15} />Gerar inventario final unificado ({consolidationSelected.size} setor{consolidationSelected.size !== 1 ? "es" : ""})
                </button>
                {consolidationSelected.size > 0 && (
                  <button className="secondary-button" type="button" onClick={() => setConsolidationSelected(new Set())}>Limpar selecao</button>
                )}
              </div>
            </div>
          ) : null;
        })()}

        {activeView === "counting" && (
          <div className="table-wrap subsection">
            <h3>Contagens de estoque</h3>
            <p className="muted">Atividade operacional do estoquista. Concluir contagem nao fecha inventario.</p>
            <table>
              <thead><tr><th>Codigo</th><th>Data</th><th>Tipo</th><th>Setor/Categoria</th><th>Status</th><th>Responsavel</th><th>Total</th><th>Contados</th><th>Pendentes</th><th>Divergentes</th><th>Acoes</th></tr></thead>
              <tbody>
                {countSessions.map((session) => (
                  <tr key={session.id}>
                    <td title={session.notes ?? session.code}><strong>{session.code}</strong><small>{session.generatedInventoryCode ? `Inventario: ${session.generatedInventoryCode}` : session.isMonthEnd ? "Final do mes" : "Contagem operacional"}</small></td>
                    <td>{formatDate(session.referenceDate)}</td>
                    <td>
                      {countSessionTypeLabels[session.type]}
                      {session.type === "SETORIAL" && session.sectorName && <small>SETOR: {session.sectorName}</small>}
                    </td>
                    <td title={[session.sectorName, session.categoryName, session.subcategoryName].filter(Boolean).join(" - ") || "-"}>
                      {[session.sectorName, session.categoryName, session.subcategoryName].filter(Boolean).join(" - ") || "-"}
                      <small>{formatNumber(session.countedItems)}/{formatNumber(session.totalItems)} contados</small>
                    </td>
                    <td><StatusBadge tone={countSessionTone(session.status)}>{countSessionStatusLabels[session.status] ?? session.status}</StatusBadge></td>
                    <td title={session.responsibleName ?? "-"}>{session.responsibleName ?? "-"}</td>
                    <td>{formatNumber(session.totalItems)}</td>
                    <td>{formatNumber(session.countedItems)}</td>
                    <td>{formatNumber(session.pendingItems)}</td>
                    <td>{formatNumber(session.divergentItems)}</td>
                    <td className="actions-cell">
                      <button className="secondary-button" type="button" onClick={() => openCountSession(session.id)}>{editableCountSessionStatuses.has(session.status) ? "Continuar" : "Visualizar"}</button>
                      {canManageOperationalInventory && session.status === "CONCLUIDA" && !session.generatedInventoryId && (
                        <button className="primary-button" type="button" onClick={async () => { await openCountSession(session.id, false); await generateInventoryFromStockCountSession(session.id); await refreshCountSessions(session.id); await refreshOperational(); setNotice({ tone: "success", message: "Inventario gerado a partir da contagem." }); }}>Gerar inventario</button>
                      )}
                      {canCancelCountSession(session) && (
                        <button className="danger-button" type="button" onClick={() => cancelCountSessionAction(session)}>Cancelar</button>
                      )}
                    </td>
                  </tr>
                ))}
                {countSessions.length === 0 && (
                  <tr><td colSpan={11}><EmptyState title="Nenhuma contagem encontrada" description="Clique em Iniciar Contagem para abrir uma ficha de lancamento com produtos controlados." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeView !== "counting" && inventoryDeskTab === "official" && <>
          <div className="summary-grid inventory-compact-summary">
            <SummaryCard label="Inventarios em rascunho" value={operationalSummary.drafts} tone={operationalSummary.drafts ? "warning" : "info"} icon={<Archive size={18} />} />
            <SummaryCard label="Em revisao" value={operationalSummary.review} tone={operationalSummary.review ? "warning" : "info"} />
            <SummaryCard label="Ultimo final CMV" value={operationalSummary.lastFinalCmv?.code ?? "-"} detail={operationalSummary.lastFinalCmv ? formatDate(operationalSummary.lastFinalCmv.date) : "Nenhum final aprovado"} />
            <SummaryCard label="Pendentes" value={operationalSummary.pending} tone={operationalSummary.pending ? "warning" : "success"} />
            <SummaryCard label="Divergentes" value={operationalSummary.divergent} tone={operationalSummary.divergent ? "danger" : "success"} />
          </div>

          <div className="form-section inventory-create-panel">
            <div className="section-heading compact-heading">
              <div>
                <p>Novo inventario</p>
                <h3>Criar inventario manual</h3>
              </div>
              <span className="muted">Use para inventario oficial, conferencia ou fechamento de CMV com estrutura pronta para lancamento.</span>
            </div>
            <div className="filters-row">
              <label>Data<input type="date" value={operationalForm.date} onChange={(event) => setOperationalForm({ ...operationalForm, date: event.target.value })} /></label>
              <label>Tipo<select value={operationalForm.type} onChange={(event) => setOperationalForm({ ...operationalForm, type: event.target.value as OperationalInventoryType })}>
                <option value="GERAL">Geral</option>
                <option value="SETORIAL">Setorial</option>
                <option value="FINAL_CMV">Final CMV</option>
                <option value="CONFERENCIA">Conferencia</option>
              </select></label>
              {operationalForm.type === "SETORIAL" && (
                <label>Setor<select value={operationalForm.sectorId} onChange={(event) => setOperationalForm({ ...operationalForm, sectorId: event.target.value })}>
                  <option value="">Selecione</option>
                  {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                </select></label>
              )}
              <label className="span-2">Observacoes<input value={operationalForm.notes} onChange={(event) => setOperationalForm({ ...operationalForm, notes: event.target.value })} /></label>
              <button className="primary-button" type="button" onClick={createOperational}><ClipboardCheck size={16} />Criar inventario</button>
            </div>
          </div>

          <div className="table-wrap subsection inventory-official-list">
            <div className="inventory-block-heading">
              <div>
                <h3>Inventarios oficiais</h3>
                <p className="muted">Documentos aprovados, fechados ou cancelados. Apenas aprovados/fechados geram snapshot valido para CMV Real.</p>
              </div>
            </div>
            <table className="inventory-official-table">
            <thead><tr><th>Codigo</th><th>Data</th><th>Tipo</th><th>Setor</th><th>Status</th><th>Responsavel</th><th>Total</th><th>Contados</th><th>Pendentes</th><th>Divergentes</th><th>Acoes</th></tr></thead>
            <tbody>
              {officialInventories.map((inventory) => (
                <tr key={inventory.id}>
                  <td title={inventory.name}><strong>{inventory.code}</strong><small>{inventory.name}</small><div className="badge-row inventory-inline-badges">{inventory.status === "FECHADO" && <StatusBadge tone="success">fechado</StatusBadge>}{inventory.inventorySnapshotId && <StatusBadge tone="info">snapshot CMV</StatusBadge>}{inventory.type === "FINAL_CMV" && <StatusBadge tone="warning">final CMV</StatusBadge>}</div></td>
                  <td>{formatDate(inventory.date)}</td>
                  <td>{operationalTypeLabels[inventory.type]}</td>
                  <td title={inventory.sectorName ?? "-"}>{inventory.sectorName ?? "-"}</td>
                  <td><StatusBadge tone={operationalTone(inventory.status)}>{operationalStatusLabels[inventory.status] ?? inventory.status}</StatusBadge></td>
                  <td title={inventory.responsibleName ?? "-"}>{inventory.responsibleName ?? "-"}</td>
                  <td>{formatNumber(inventory.totalItems)}</td>
                  <td>{formatNumber(inventory.countedItems)}</td>
                  <td>{formatNumber(inventory.pendingItems)}</td>
                  <td>{formatNumber(inventory.divergentItems)}</td>
                  <td className="actions-cell">
                    <button className="secondary-button" type="button" onClick={() => openOperationalInventory(inventory.id)}>Abrir</button>
                    <button className="secondary-button" type="button" onClick={() => downloadInventoryPdf(inventory)}>Gerar PDF</button>
                  </td>
                </tr>
              ))}
              {officialInventories.length === 0 && (
                <tr><td colSpan={11}><EmptyState title="Nenhum inventario oficial" description="Aprove ou feche uma contagem para gerar o documento oficial." /></td></tr>
              )}
            </tbody>
            </table>
          </div>
        </>}

        {activeView !== "counting" && inventoryDeskTab === "official" && operationalDetail && (
          <div className="subsection operational-count-panel">
            <div className="section-heading">
              <div>
                <p>{operationalDetail.code} • {formatDate(operationalDetail.date)} • {operationalTypeLabels[operationalDetail.type]}</p>
                <h3 title={operationalDetail.name}>{operationalDetail.name}</h3>
              </div>
              <StatusBadge tone={operationalTone(operationalDetail.status)}>{operationalStatusLabels[operationalDetail.status] ?? operationalDetail.status}</StatusBadge>
            </div>

            <div className="summary-grid">
              <article><span>Total</span><strong>{formatNumber(operationalDetail.totalItems)}</strong></article>
              <article><span>Contados</span><strong>{formatNumber(operationalDetail.countedItems)}</strong></article>
              <article><span>Pendentes</span><strong>{formatNumber(operationalDetail.pendingItems)}</strong></article>
              <article><span>Divergentes</span><strong>{formatNumber(operationalDetail.divergentItems)}</strong></article>
            </div>

            <div className="filters-row">
              <label>Setor<select value={operationalSectorFilter} onChange={(event) => setOperationalSectorFilter(event.target.value)}>
                <option value="">Todos</option>
                {operationalSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
              </select></label>
              <label>Busca<input value={operationalSearch} onChange={(event) => setOperationalSearch(event.target.value)} placeholder="Codigo ou produto" /></label>
              <button className="secondary-button" type="button" disabled={!editableOperationalInventoryStatuses.has(operationalDetail.status)} onClick={markOperationalFilteredZero}>Marcar filtrados como zero</button>
              <button className="secondary-button" type="button" disabled={!editableOperationalInventoryStatuses.has(operationalDetail.status)} onClick={saveOperationalDraft}><Save size={16} />Salvar rascunho</button>
              <button className="primary-button" type="button" disabled={!editableOperationalInventoryStatuses.has(operationalDetail.status)} onClick={() => operationalAction("submit")}><Send size={16} />Enviar para revisao</button>
              {canManageOperationalInventory && <button className="secondary-button" type="button" disabled={operationalDetail.status !== "EM_REVISAO"} onClick={() => operationalAction("approve")}>Aprovar</button>}
              {canManageOperationalInventory && <button className="secondary-button" type="button" disabled={operationalDetail.status !== "EM_REVISAO"} onClick={() => operationalAction("reject")}>Rejeitar</button>}
              {canManageOperationalInventory && <button className="primary-button" type="button" disabled={operationalDetail.status !== "APROVADO"} onClick={() => operationalAction("close")}>Fechar</button>}
              {canManageOperationalInventory && <button className="danger-button" type="button" disabled={["FECHADO", "CANCELADO"].includes(operationalDetail.status)} onClick={() => operationalAction("cancel")}>Cancelar</button>}
            </div>

            <div className="table-wrap operational-count-table">
              <table>
                <thead><tr><th>Codigo</th><th>Produto</th><th>Setor</th><th>Localizacao</th><th>Unidade</th><th>Esperado</th><th>Quantidade contada</th><th>Observacao</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredOperationalItems.map((item) => {
                    const line = operationalLines[item.id] ?? { countedQuantity: "", notes: "" };
                    const locked = !editableOperationalInventoryStatuses.has(operationalDetail.status);
                    return (
                      <tr key={item.id}>
                        <td>{item.productCode ?? "-"}</td>
                        <td title={item.productName}>{item.productName}<small>{[item.categoryName, item.subcategoryName].filter(Boolean).join(" • ") || "-"}</small></td>
                        <td title={item.sectorName ?? "-"}>{item.sectorName ?? "-"}</td>
                        <td title={item.location ?? "-"}>{item.location ?? "-"}</td>
                        <td>{item.unit ?? "-"}</td>
                        <td>{formatNumber(item.expectedQuantity)}</td>
                        <td><input className="count-input" inputMode="decimal" disabled={locked} value={line.countedQuantity} onChange={(event) => setOperationalLines({ ...operationalLines, [item.id]: { ...line, countedQuantity: event.target.value } })} /></td>
                        <td><input disabled={locked} value={line.notes} onChange={(event) => setOperationalLines({ ...operationalLines, [item.id]: { ...line, notes: event.target.value } })} /></td>
                        <td><StatusBadge tone={operationalTone(item.status)}>{item.status.toLowerCase()}</StatusBadge></td>
                      </tr>
                    );
                  })}
                  {filteredOperationalItems.length === 0 && (
                    <tr><td colSpan={9}><EmptyState title="Nenhum produto nesta contagem" description="Revise o setor selecionado ou crie uma contagem geral/final CMV para carregar todos os produtos controlados." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeView !== "counting" && inventoryDeskTab === "purchase" && purchasingReport && (
          <div className="subsection">
            <div className="section-heading compact-heading">
              <div>
                <p>Compras</p>
                <h3>Atencoes do ultimo inventario</h3>
              </div>
            </div>
            <div className="summary-grid">
              <article><span>Zerados</span><strong>{purchasingReport.summary.zeros}</strong></article>
              <article><span>Pendentes</span><strong>{purchasingReport.summary.pending}</strong></article>
              <article><span>Divergentes</span><strong>{purchasingReport.summary.divergent}</strong></article>
              <article><span>Sem contagem</span><strong>{purchasingReport.summary.withoutCount}</strong></article>
            </div>
          </div>
        )}

        {inventoryDeskTab === "purchase" && buyerSupport && (
          <div className="subsection">
            <div className="section-heading">
              <div>
                <p>Apoio ao comprador</p>
                <h3>Sugestao de compras</h3>
              </div>
              <div className="actions-cell">
                <button className="secondary-button" type="button" onClick={loadBuyerSupport}>Atualizar relatorio</button>
                <button className="primary-button" type="button" onClick={exportBuyerPrelist}>Exportar CSV</button>
                <button className="primary-button" type="button" onClick={generatePurchaseOrdersFromPrelist}>Gerar pedido de compra</button>
              </div>
            </div>
            <div className="alert info">Esta sugestao considera a ultima contagem aprovada/fechada e os parametros de estoque minimo/ideal cadastrados no produto.</div>

            <div className="inventory-guidance-strip">
              <article><strong>1.</strong><span>Corrigir cadastros incompletos</span></article>
              <article><strong>2.</strong><span>Definir fornecedor principal</span></article>
              <article><strong>3.</strong><span>Ajustar estoque minimo e ideal</span></article>
              <article><strong>4.</strong><span>Revisar pre-lista de compra</span></article>
              <article><strong>5.</strong><span>Gerar pedido de compra</span></article>
            </div>

            <div className="summary-grid inventory-compact-summary purchase-summary-grid">
              <SummaryCard label="Itens controlados" value={buyerSupport.summary.controlledTotal} tone="info" icon={<Archive size={18} />} />
              <SummaryCard label="Itens com sugestao" value={buyerSupport.summary.itemsWithSuggestion} tone={buyerSupport.summary.itemsWithSuggestion ? "warning" : "success"} />
              <SummaryCard label="Fornecedores sugeridos" value={buyerSupport.summary.suggestedSuppliers} />
              <SummaryCard label="Sem fornecedor" value={buyerSupport.summary.productsWithoutSupplier} tone={buyerSupport.summary.productsWithoutSupplier ? "danger" : "success"} icon={<AlertTriangle size={18} />} />
              <SummaryCard label="Zerados" value={buyerSupport.summary.zeros} tone={buyerSupport.summary.zeros ? "danger" : "success"} />
              <SummaryCard label="Abaixo do minimo" value={buyerSupport.summary.belowMinimum} tone={buyerSupport.summary.belowMinimum ? "warning" : "success"} />
              <SummaryCard label="Sem ideal" value={buyerSupport.summary.withoutIdeal} tone={buyerSupport.summary.withoutIdeal ? "warning" : "success"} />
              <SummaryCard label="Sem minimo" value={buyerSupport.summary.withoutMinimum} tone={buyerSupport.summary.withoutMinimum ? "warning" : "success"} />
              <SummaryCard label="Ultimo final CMV" value={buyerSupport.summary.latestFinalCmv?.code ?? "-"} detail={buyerSupport.summary.latestFinalCmv ? formatDate(buyerSupport.summary.latestFinalCmv.date) : "Sem final aprovado"} />
            </div>

            <div className="filters-row inventory-filter-row">
              <label>Busca<input value={buyerFilters.search} onChange={(event) => setBuyerFilters({ ...buyerFilters, search: event.target.value })} placeholder="Codigo ou produto" /></label>
              <label>Fornecedor<select value={buyerFilters.supplier} onChange={(event) => setBuyerFilters({ ...buyerFilters, supplier: event.target.value })}>
                <option value="">Todos</option>
                <option value="__NONE__">Sem fornecedor definido</option>
                {buyerSupport.supplierGroups.filter((group) => group.supplierId).map((group) => <option key={group.supplierId ?? "none"} value={group.supplierId ?? ""}>{group.supplierName}</option>)}
              </select></label>
              <label>Setor<select value={buyerFilters.sector} onChange={(event) => setBuyerFilters({ ...buyerFilters, sector: event.target.value })}>
                <option value="">Todos</option>
                {[...new Set(buyerSupport.items.map((item) => item.sectorName).filter(Boolean))].map((sector) => <option key={sector} value={sector ?? ""}>{sector}</option>)}
              </select></label>
              <label>Categoria<select value={buyerFilters.category} onChange={(event) => setBuyerFilters({ ...buyerFilters, category: event.target.value })}>
                <option value="">Todas</option>
                {[...new Set(buyerSupport.items.map((item) => item.categoryName).filter(Boolean))].map((category) => <option key={category} value={category ?? ""}>{category}</option>)}
              </select></label>
              <label>Subcategoria<select value={buyerFilters.subcategory} onChange={(event) => setBuyerFilters({ ...buyerFilters, subcategory: event.target.value })}>
                <option value="">Todas</option>
                {[...new Set(buyerSupport.items.map((item) => item.subcategoryName).filter(Boolean))].map((subcategory) => <option key={subcategory} value={subcategory ?? ""}>{subcategory}</option>)}
              </select></label>
              <label>Alerta<select value={buyerFilters.status} onChange={(event) => setBuyerFilters({ ...buyerFilters, status: event.target.value })}>
                <option value="">Todos</option>
                <option value="ZERADO">Zerado</option>
                <option value="ABAIXO DO MINIMO">Abaixo do minimo</option>
                <option value="SEM CONTAGEM">Sem contagem</option>
                <option value="DIVERGENTE">Divergente</option>
                <option value="CADASTRO INCOMPLETO">Cadastro incompleto</option>
                <option value="SEM_FORNECEDOR">Sem fornecedor</option>
                <option value="SEM_ESTOQUE_MINIMO">Sem estoque minimo</option>
                <option value="SEM_ESTOQUE_IDEAL">Sem estoque ideal</option>
              </select></label>
              <button className="primary-button" type="button" onClick={loadBuyerSupport}>Filtrar</button>
              <button className="secondary-button" type="button" onClick={() => { setBuyerFilters({ search: "", supplier: "", sector: "", category: "", subcategory: "", status: "" }); setTimeout(() => loadBuyerSupport(), 0); }}><FilterX size={16} />Limpar</button>
            </div>

            <div className="tabs-row">
              <button className={buyerTab === "summary" ? "active" : ""} type="button" onClick={() => setBuyerTab("summary")}>Resumo</button>
              <button className={buyerTab === "suppliers" ? "active" : ""} type="button" onClick={() => setBuyerTab("suppliers")}>Sugestao por fornecedor</button>
              <button className={buyerTab === "alerts" ? "active" : ""} type="button" onClick={() => setBuyerTab("alerts")}>Produtos em alerta</button>
              <button className={buyerTab === "registration" ? "active" : ""} type="button" onClick={() => setBuyerTab("registration")}>Cadastro incompleto</button>
              <button className={buyerTab === "prelist" ? "active" : ""} type="button" onClick={() => setBuyerTab("prelist")}>Pre-lista de compra</button>
            </div>

            {buyerTab === "summary" && (
              <div className="summary-columns">
                <div>
                  <h3>Prioridades da operacao</h3>
                  <p>Sem fornecedor: <strong>{buyerSupport.summary.productsWithoutSupplier}</strong></p>
                  <p>Zerados: <strong>{buyerSupport.summary.zeros}</strong></p>
                  <p>Abaixo do minimo: <strong>{buyerSupport.summary.belowMinimum}</strong></p>
                  <p>Cadastro incompleto: <strong>{buyerSupport.summary.incompleteRegistration}</strong></p>
                </div>
                <div>
                  <h3>Como agir</h3>
                  <p>Corrija primeiro os produtos sem fornecedor ou sem parametros minimos/ideais.</p>
                  <p>Depois revise a pre-lista e gere o pedido apenas para os fornecedores selecionados.</p>
                </div>
              </div>
            )}

            {buyerTab === "suppliers" && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fornecedor</th><th>Itens sugeridos</th><th>Zerados</th><th>Abaixo minimo</th><th>Parametros incompletos</th><th>Total sugerido</th><th>Acoes</th></tr></thead>
                  <tbody>
                    {buyerSupport.supplierGroups.map((group) => (
                      <tr key={group.supplierId ?? "__NONE__"}>
                        <td title={group.supplierName}>{group.supplierName}</td>
                        <td>{group.suggestedItems}</td>
                        <td>{group.zeroItems}</td>
                        <td>{group.belowMinimumItems}</td>
                        <td>{group.incompleteItems}</td>
                        <td>{formatNumber(group.totalSuggestedQuantity)}</td>
                        <td><button className="secondary-button" type="button" onClick={() => setOpenSupplierId(openSupplierId === (group.supplierId ?? "__NONE__") ? null : (group.supplierId ?? "__NONE__"))}>Ver detalhes</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {buyerSupport.supplierGroups.map((group) => openSupplierId === (group.supplierId ?? "__NONE__") && (
                  <div className="subsection table-wrap" key={`detail-${group.supplierId ?? "__NONE__"}`}>
                    <h3>{group.supplierName}</h3>
                    <table>
                      <thead><tr><th>Codigo</th><th>Produto</th><th>Un.</th><th>Ultima qtd.</th><th>Min.</th><th>Ideal</th><th>Sugestao</th><th>Tipo</th><th>Alerta</th></tr></thead>
                      <tbody>{group.items.map((item) => <tr key={item.productId}><td>{item.productCode ?? "-"}</td><td title={item.productName}>{item.productName}</td><td>{item.unit ?? "-"}</td><td>{item.lastQuantity == null ? "-" : formatNumber(item.lastQuantity)}</td><td>{item.estoqueMinimo ?? "-"}</td><td>{item.estoqueIdeal ?? "-"}</td><td>{item.suggestedQuantity == null ? "-" : formatNumber(item.suggestedQuantity)}</td><td>{item.suggestionType}</td><td>{item.alerts.slice(0, 3).join(", ") || "OK"}</td></tr>)}</tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {(buyerTab === "alerts" || buyerTab === "registration" || buyerTab === "prelist") && (
              <div className="table-wrap operational-count-table">
                {buyerTab === "prelist" && (
                  <div className="subsection">
                    <h3>Fornecedores selecionados</h3>
                    <p className="muted">Produtos sem fornecedor definido ficam como pendencia e nao geram pedido automatico.</p>
                    <div className="checkbox-grid">
                      {buyerSupport.prelist.filter((group) => group.supplierId).map((group) => (
                        <label key={group.supplierId}>
                          <input
                            type="checkbox"
                            checked={selectedPrelistSuppliers[group.supplierId ?? ""] !== false}
                            onChange={(event) => setSelectedPrelistSuppliers({ ...selectedPrelistSuppliers, [group.supplierId ?? ""]: event.target.checked })}
                          />
                          {group.supplierName} ({group.items.length} itens)
                        </label>
                      ))}
                      {buyerSupport.prelist.filter((group) => group.supplierId).length === 0 && <p>Nenhum fornecedor elegivel na pre-lista atual.</p>}
                    </div>
                  </div>
                )}
                <table>
                  <thead><tr><th>Codigo</th><th>Produto</th><th>Fornecedor</th><th>Setor</th><th>Categoria</th><th>Subcategoria</th><th>Un.</th><th>Ultima qtd.</th><th>Min.</th><th>Ideal</th><th>Sugestao</th><th>Consumo/dia</th><th>Cobertura</th><th>Alerta</th><th>Acoes</th></tr></thead>
                  <tbody>
                    {(buyerTab === "prelist" ? buyerSupport.prelist.flatMap((group) => group.items) : buyerSupport.items)
                      .filter((item) => buyerTab !== "registration" || item.registrationAlerts.length > 0)
                      .filter((item) => buyerTab !== "alerts" || item.alerts.length > 0)
                      .map((item) => (
                      <tr key={item.productId}>
                        <td>{item.productCode ?? "-"}</td>
                        <td title={item.productName}>{item.productName}<small>{item.logisticsNotes ?? item.notes ?? ""}</small></td>
                        <td title={item.supplierName}>{item.supplierName}</td>
                        <td title={item.sectorName ?? "-"}>{item.sectorName ?? "-"}</td>
                        <td title={item.categoryName ?? "-"}>{item.categoryName ?? "-"}</td>
                        <td title={item.subcategoryName ?? "-"}>{item.subcategoryName ?? "-"}</td>
                        <td>{item.unit ?? "-"}</td>
                        <td>{item.lastQuantity == null ? "-" : formatNumber(item.lastQuantity)}</td>
                        <td>{item.estoqueMinimo == null ? "-" : formatNumber(item.estoqueMinimo)}</td>
                        <td>{item.estoqueIdeal == null ? "-" : formatNumber(item.estoqueIdeal)}</td>
                        <td>{item.suggestedQuantity == null ? "-" : formatNumber(item.suggestedQuantity)}<small>{item.suggestionType}</small></td>
                        <td>{item.averageDailyConsumption == null ? "Sem dados" : formatNumber(item.averageDailyConsumption)}</td>
                        <td>{item.coverageDays == null ? "Sem dados" : `${formatNumber(item.coverageDays)} dias`}</td>
                        <td><div className="badge-row">{(buyerTab === "registration" ? item.registrationAlerts : item.alerts).map((alert) => <StatusBadge key={alert} tone={alert === "ZERADO" || alert === "DIVERGENTE" ? "danger" : "warning"}>{alert}</StatusBadge>)}</div></td>
                        <td><button className="secondary-button" type="button" onClick={() => { setNotice({ tone: "info", message: `Busque o codigo ${item.productCode ?? ""} na tela de Produtos para editar o cadastro.` }); onOpenProducts?.(); }}>Editar produto</button></td>
                      </tr>
                    ))}
                    {buyerSupport.items.length === 0 && <tr><td colSpan={15}><EmptyState title="Nenhum produto em atencao" description="Os filtros atuais nao encontraram sugestoes de compra." /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className={panelClass(["reports"])}>
        <div className="section-heading">
          <div>
            <p>Rotina do estoque</p>
            <h2>Agenda de inventario</h2>
          </div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar">
            {loading ? <Loader2 size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>

        <div className="filters-row">
          <label>
            Mes
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button className="secondary-button" type="button" onClick={() => setMonth(monthValue())}>
            Mes atual
          </button>
        </div>

        {todayItems.length > 0 && (
          <div className="today-count-card">
            <div>
              <span>Contagem de hoje</span>
              <strong>{todayItems.map((item) => item.sectorName || item.categoryName).join(", ")}</strong>
            </div>
            <button className="primary-button large-action" type="button" onClick={() => openCount(todayItems[0])}>
              <CalendarDays size={18} />
              Abrir contagem
            </button>
          </div>
        )}

        <div className="agenda-calendar">
          {agenda?.items.map((item) => (
            <button
              className={selectedAgendaId === item.id ? "agenda-day active" : `agenda-day ${item.status.toLowerCase()}`}
              key={item.id}
              type="button"
              onClick={() => openCount(item)}
            >
              <strong>{new Date(item.scheduledDate).getDate()}</strong>
              <span>{item.sectorName || item.categoryName}</span>
              <small>{statusLabels[item.status] ?? item.status}</small>
              <small>Abrir contagem</small>
            </button>
          ))}
        </div>

        {canConfigureAgenda && (
          <div className="subsection">
            <h3>Configurar agenda</h3>
            <div className="form-grid">
              <label>Dia<select value={ruleForm.dayOfWeek} onChange={(event) => setRuleForm({ ...ruleForm, dayOfWeek: event.target.value })}>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
              <label>Frequencia<select value={ruleForm.frequency} onChange={(event) => setRuleForm({ ...ruleForm, frequency: event.target.value })}><option value="DAILY">Diaria</option><option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option><option value="LAST_DAY">Ultimo dia do mes</option></select></label>
              <label>Setor<select value={ruleForm.sectorId} onChange={(event) => {
                const sector = sectors.find((item) => item.id === event.target.value);
                setRuleForm({ ...ruleForm, sectorId: event.target.value, sectorName: sector?.name ?? "" });
              }}><option value="">Selecione</option>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
              <label>Categoria/grupo<input value={ruleForm.categoryName} onChange={(event) => setRuleForm({ ...ruleForm, categoryName: event.target.value })} /></label>
              <label>Observacoes<input value={ruleForm.notes} onChange={(event) => setRuleForm({ ...ruleForm, notes: event.target.value })} /></label>
              <button className="primary-button" type="button" onClick={saveRule}>{ruleForm.id ? "Atualizar agenda" : "Salvar agenda"}</button>
            </div>
            <div className="table-wrap subsection">
              <table>
                <thead><tr><th>Setor</th><th>Frequencia</th><th>Dia</th><th>Obs.</th><th>Acoes</th></tr></thead>
                <tbody>{agenda?.rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.sectorName || rule.categoryName}</td>
                    <td>{rule.frequency}</td>
                    <td>{rule.dayOfWeek == null ? "-" : weekdays.find((day) => day.value === String(rule.dayOfWeek))?.label ?? rule.dayOfWeek}</td>
                    <td>{rule.notes ?? "-"}</td>
                    <td><div className="actions-cell"><button type="button" onClick={() => editRule(rule)}>Editar</button><button type="button" onClick={() => removeRule(rule.id)}><Trash2 size={15} />Excluir</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className={panelClass(["reports"])}>
        <div className="section-heading">
          <div>
            <p>{selectedAgenda ? selectedAgenda.sectorName || selectedAgenda.categoryName : "Contagem rapida"}</p>
            <h2>Contagem do estoquista</h2>
          </div>
          <div className="actions-cell">
            <button className="secondary-button large-action" type="button" onClick={startAgenda} disabled={!selectedAgenda || selectedAgenda.status === "CONFIRMED"}>
              <Play size={17} />
              Iniciar
            </button>
            <button className="primary-button large-action" type="button" onClick={submitAgenda} disabled={!selectedAgenda || selectedAgenda.status === "CONFIRMED"}>
              <Send size={17} />
              Enviar revisao
            </button>
          </div>
        </div>

        <div className="form-grid quick-count-grid">
          <label>Produto<select value={countForm.productId} onChange={(event) => {
            const product = products.find((item) => item.id === event.target.value);
            setCountForm({ ...countForm, productId: event.target.value, unit: product?.unit ?? countForm.unit });
          }}>{productsForCount.map((product) => <option key={product.id} value={product.id}>{product.externalCode ? `${product.externalCode} - ` : ""}{product.name}</option>)}</select></label>
          <label>Quantidade<input inputMode="decimal" value={countForm.countedQuantity} onChange={(event) => setCountForm({ ...countForm, countedQuantity: event.target.value })} /></label>
          <label>Unidade<input value={countForm.unit} onChange={(event) => setCountForm({ ...countForm, unit: event.target.value })} /></label>
          <label>Observacao<input value={countForm.notes} onChange={(event) => setCountForm({ ...countForm, notes: event.target.value })} /></label>
          <button className="secondary-button large-action" type="button" onClick={() => submitCount("DRAFT")}><Save size={17} />Salvar rascunho</button>
          <button className="primary-button large-action" type="button" onClick={() => submitCount("SUBMITTED")}><Send size={17} />Salvar e enviar</button>
        </div>

        <div className="subsection table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Setor</th><th>Localizacao</th><th>Categoria</th><th>Unidade</th></tr></thead>
            <tbody>{productsForCount.slice(0, 80).map((product) => <tr key={product.id}><td>{product.name}<small>{product.externalCode ?? "Sem codigo"}</small></td><td>{product.inventorySector?.name ?? "-"}</td><td>{[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "-"}</td><td>{product.category?.name ?? "-"}</td><td>{product.stockUnit ?? product.unit ?? "-"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={panelClass(["inventory", "reports"])}>
        <div className="section-heading">
          <div>
            <p>{inventoryDeskTab === "reports" ? "Relatorios" : "Estoque atual"}</p>
            <h2>{inventoryDeskTab === "reports" ? "Leitura gerencial" : "Estoque atual"}</h2>
          </div>
        </div>
        {inventoryDeskTab === "stock" && (
          <>
        <div className="summary-grid inventory-compact-summary stock-summary-grid">
          <SummaryCard label="Itens em estoque" value={stockSummary.total} tone="info" icon={<Archive size={18} />} />
          <SummaryCard label="Zerados" value={stockSummary.zeros} tone={stockSummary.zeros ? "danger" : "success"} />
          <SummaryCard label="Abaixo do minimo" value={stockSummary.belowMinimum} tone={stockSummary.belowMinimum ? "warning" : "success"} />
          <SummaryCard label="Divergentes" value={stockSummary.divergent} tone={stockSummary.divergent ? "danger" : "success"} />
          <SummaryCard label="Sem fornecedor" value={stockSummary.withoutSupplier} tone={stockSummary.withoutSupplier ? "danger" : "success"} />
          <SummaryCard label="Cadastro incompleto" value={stockSummary.incomplete} tone={stockSummary.incomplete ? "warning" : "success"} />
        </div>
        <div className="filters-row inventory-filter-row">
          <label>Busca<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Codigo, produto, setor ou fornecedor" /></label>
          <label>Setor<select value={stockFilters.sector} onChange={(event) => setStockFilters((current) => ({ ...current, sector: event.target.value }))}><option value="">Todos</option>{stockFilterOptions.sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}</select></label>
          <label>Categoria<select value={stockFilters.category} onChange={(event) => setStockFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Todas</option>{stockFilterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label>Subcategoria<select value={stockFilters.subcategory} onChange={(event) => setStockFilters((current) => ({ ...current, subcategory: event.target.value }))}><option value="">Todas</option>{stockFilterOptions.subcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}</select></label>
          <label>Fornecedor<select value={stockFilters.supplier} onChange={(event) => setStockFilters((current) => ({ ...current, supplier: event.target.value }))}><option value="">Todos</option>{stockFilterOptions.suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}</select></label>
          <label>Status/alerta<select value={stockFilters.alert} onChange={(event) => setStockFilters((current) => ({ ...current, alert: event.target.value }))}><option value="">Todos</option>{stockFilterOptions.alerts.map((alert) => <option key={alert} value={alert}>{buyerAlertLabel(alert)}</option>)}</select></label>
          <button className="primary-button" type="button" onClick={load}>Filtrar</button>
          <button className="secondary-button" type="button" onClick={() => {
            setSearch("");
            setStockFilters({ sector: "", category: "", subcategory: "", supplier: "", alert: "" });
          }}>
            <FilterX size={16} />
            Limpar
          </button>
        </div>
        <div className="chart-grid">
          <SimpleBarChart title="Divergências por setor/tipo" items={divergencesBySector} />
          <SimpleBarChart title="Status dos inventários" items={countsByStatus} />
          <SimpleBarChart title="Estoque contado x pendente" items={[
            { label: "Contados", value: operationalInventories.reduce((sum, item) => sum + Number(item.countedItems ?? 0), 0) },
            { label: "Pendentes", value: operationalInventories.reduce((sum, item) => sum + Number(item.pendingItems ?? 0), 0) }
          ]} />
        </div>
        <div className="subsection inventory-stock-table-wrap">
          <table className="inventory-stock-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Setor</th>
                <th>Fornecedor</th>
                <th className="numeric-cell">Quantidade</th>
                <th className="numeric-cell" title="Quantidade mínima em estoque — edite clicando no campo">Mínimo</th>
                <th title="UN = unidade, CX = caixa, KG = quilograma">Unidade</th>
                {canViewCosts && <><th className="numeric-cell">Custo medio</th><th className="numeric-cell" title="Custo por quilograma">KG</th><th className="numeric-cell" title="Custo por caixa">CX</th><th className="numeric-cell" title="Custo por unidade">UN</th></>}
                <th title="Data da ultima movimentacao">Ultima movimentacao</th>
                <th>Alertas</th>
              </tr>
            </thead>
            <tbody>
              {filteredStockRows.length ? filteredStockRows.map((stock) => {
                const rowClass = [
                  stock.alerts.includes("ZERADO") ? "is-zero" : "",
                  stock.alerts.includes("ABAIXO DO MINIMO") ? "is-warning" : "",
                  stock.alerts.includes("DIVERGENTE") ? "is-divergent" : "",
                  stock.alerts.includes("SEM_FORNECEDOR") ? "is-problem" : "",
                  stock.alerts.includes("CADASTRO INCOMPLETO") ? "is-incomplete" : ""
                ].filter(Boolean).join(" ");
                return (
                  <tr key={stock.id} className={rowClass}>
                    <td title={stock.productDisplayName}>
                      <strong>{stock.productDisplayName}</strong>
                      <small>{stock.codeLabel}</small>
                      <small>{[stock.categoryName, stock.subcategoryName].filter(Boolean).join(" / ") || "Sem classificacao"}</small>
                    </td>
                    <td><span className="table-muted-badge">{displayLabel(stock.sectorName, "Sem setor")}</span></td>
                    <td title={stock.supplierName}>{stock.supplierName}</td>
                    <td className="numeric-cell">{formatNumber(stock.currentQuantityNumber)}</td>
                    <td className="numeric-cell" style={{ padding: "2px 4px" }}>
                      {canEditStockMinimum ? (
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="inline-qty-input"
                          style={{ width: 72, textAlign: "right" }}
                          value={minQtyEdit[stock.productId] ?? (stock.minQuantity == null ? "" : String(Number(stock.minQuantity)))}
                          placeholder="—"
                          disabled={savingMinQty[stock.productId]}
                          onChange={(e) => setMinQtyEdit((prev) => ({ ...prev, [stock.productId]: e.target.value }))}
                          onBlur={() => { void saveMinQty(stock.productId); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
                        />
                      ) : (
                        stock.minQuantity == null ? "—" : formatNumber(Number(stock.minQuantity))
                      )}
                    </td>
                    <td>{displayLabel(stock.unitCode, "-")}</td>
                    {canViewCosts && <><td className="numeric-cell">{formatCurrency(Number(stock.averageCost ?? 0))}</td><td className="numeric-cell">{stock.costPerKg ? formatCurrency(Number(stock.costPerKg)) : "-"}</td><td className="numeric-cell">{stock.costPerBox ? formatCurrency(Number(stock.costPerBox)) : "-"}</td><td className="numeric-cell">{stock.costPerUnit ? formatCurrency(Number(stock.costPerUnit)) : "-"}</td></>}
                    <td>{formatDate(stock.lastMovementAt)}</td>
                    <td>
                      <div className="badge-row">
                        {stock.alerts.length ? stock.alerts.map((alert) => <StatusBadge key={`${stock.id}-${alert}`} tone={buyerAlertTone(alert)}>{buyerAlertLabel(alert)}</StatusBadge>) : <StatusBadge tone="success">ok</StatusBadge>}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={canViewCosts ? 12 : 8} className="empty-table-state">Nenhum item encontrado com os filtros atuais.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </>
        )}
        {inventoryDeskTab === "reports" && (
          <>
            <div className="summary-grid inventory-compact-summary">
              <SummaryCard label="Movimentacoes" value={movements.length} tone="info" />
              <SummaryCard label="Contagens" value={counts.length} tone="info" />
              <SummaryCard label="Inventarios oficiais" value={officialInventories.length} tone="success" />
              <SummaryCard label="Divergencias" value={counts.filter((count) => Number(count.divergenceQuantity) !== 0).length} tone="warning" />
            </div>
            <div className="chart-grid">
              <SimpleBarChart title="Divergencias por setor/tipo" items={divergencesBySector} />
              <SimpleBarChart title="Status dos inventarios" items={countsByStatus} />
              <SimpleBarChart title="Estoque contado x pendente" items={[
                { label: "Contados", value: operationalInventories.reduce((sum, item) => sum + Number(item.countedItems ?? 0), 0) },
                { label: "Pendentes", value: operationalInventories.reduce((sum, item) => sum + Number(item.pendingItems ?? 0), 0) }
              ]} />
            </div>
          </>
        )}
      </section>

      <section className={panelClass(["movements"])}>
        <div className="section-heading"><div><p>Movimentacao autorizada</p><h2>Registrar movimentacao</h2></div></div>
        <div className="form-grid">
          <label>Buscar produto<input list="movement-products" value={movementSearch} onBlur={findMovementProduct} onChange={(event) => setMovementSearch(event.target.value)} placeholder="Codigo ou nome" /><datalist id="movement-products">{products.map((product) => <option key={product.id} value={product.externalCode ? `${product.externalCode} - ${product.name}` : product.name} />)}</datalist></label>
          <button className="secondary-button" type="button" onClick={findMovementProduct}><Search size={16} />Buscar</button>
          <label>Produto<select value={movementForm.productId} onChange={(event) => selectMovementProduct(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.externalCode ? `${product.externalCode} - ` : ""}{product.name}</option>)}</select></label>
          <label>Tipo<select value={movementForm.type} onChange={(event) => setMovementForm({ ...movementForm, type: event.target.value })}>{movementTypes.filter((type) => canViewCosts || type.value !== "PURCHASE_IN").map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label>Quantidade<input inputMode="decimal" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} /></label>
          <label>Unidade<input value={movementForm.unit} onChange={(event) => setMovementForm({ ...movementForm, unit: event.target.value })} /></label>
          <label className={sensitiveMovementTypes.includes(movementForm.type) && !movementForm.notes.trim() ? "field-error" : ""}>Motivo/observacao<input value={movementForm.notes} onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })} /></label>
          <button className="primary-button large-action" type="button" onClick={submitMovement}>Salvar movimentacao</button>
        </div>
        {movementForm.productId && (
          <div className="alert success">
            {(() => {
              const product = products.find((item) => item.id === movementForm.productId);
              return product ? `Selecionado: ${product.externalCode ?? "-"} - ${product.name} | Setor ${product.inventorySector?.name ?? "-"} | ${[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "sem localizacao"}` : "";
            })()}
          </div>
        )}
      </section>

      <section className={panelClass(["movements", "reports"])}>
        <div className="section-heading"><div><p>Historico</p><h2>{user.role === "ESTOQUISTA" ? "Minhas contagens e movimentacoes" : "Movimentacoes recentes"}</h2></div></div>
        <div className="filters-row">
          <PeriodFilter value={movementPeriod} onChange={setMovementPeriod} />
          <button className="primary-button" type="button" onClick={load}>Filtrar</button>
        </div>
        <div className="chart-grid">
          <SimpleBarChart title="Entradas x saídas por tipo" items={movementsByType} />
          <SimpleBarChart title="Produtos mais movimentados" items={movementsByProduct} />
          <SimpleBarChart title="Linha temporal de movimentações" items={movementsTimeline} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Produto</th><th>Tipo/status</th><th>Quantidade</th><th>Unidade</th>{canViewCosts && <th>Custo total</th>}<th>Obs.</th></tr></thead>
            <tbody>{movements.map((movement) => <tr key={movement.id}><td>{formatDate(movement.createdAt)}</td><td>{movement.productName}</td><td>{movement.type}</td><td>{formatNumber(Number(movement.quantity))}</td><td>{movement.unit ?? "-"}</td>{canViewCosts && <td>{movement.totalCost ? formatCurrency(Number(movement.totalCost)) : "-"}</td>}<td>{movement.notes ?? "-"}</td></tr>)}</tbody>
          </table>
        </div>
        {canConfigureAgenda && (
          <div className="subsection table-wrap">
            <table>
              <thead><tr><th>Dia</th><th>Categoria</th><th>Status</th><th>Responsavel</th><th>Acoes</th></tr></thead>
              <tbody>{agenda?.items.map((item) => <tr key={item.id}><td>{formatDate(item.scheduledDate)}</td><td>{item.sectorName || item.categoryName}</td><td><span className={`status-badge ${item.status.toLowerCase()}`}>{statusLabels[item.status] ?? item.status}</span></td><td>{item.responsibleName ?? "-"}</td><td>{item.status === "SUBMITTED" ? <button className="secondary-button" type="button" onClick={() => confirmAgenda(item)}><CheckCircle2 size={16} />Confirmar</button> : "-"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
