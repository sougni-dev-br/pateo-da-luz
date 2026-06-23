export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";
export const BACKEND_TARGET_URL = import.meta.env.VITE_BACKEND_TARGET_URL ?? "http://127.0.0.1:3334";
const FALLBACK_BACKEND_URL = BACKEND_TARGET_URL;
const REQUEST_TIMEOUT_MS = 10000;
const SESSION_TOKEN_KEY = "pateo_session_token";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function sessionToken() {
  const legacyToken = localStorage.getItem(SESSION_TOKEN_KEY);
  if (legacyToken) localStorage.removeItem(SESSION_TOKEN_KEY);
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function request<T>(path: string, options?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const token = sessionToken();
  const headers = new Headers(options?.headers);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const requestOptions = { ...options, headers };

  const candidates = [`${API_BASE_URL}${path}`];
  if (API_BASE_URL.startsWith("/")) {
    candidates.push(`${FALLBACK_BACKEND_URL}${path}`);
  }

  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    try {
      const response = await fetchWithTimeout(url, requestOptions, timeoutMs);
      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const errorBody = await response.json().catch(() => null) as Record<string, unknown> | null;

      // Sessão inválida ou encerrada: limpar token e recarregar para a tela de login
      if (response.status === 401 && !path.startsWith("/auth/")) {
        localStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        window.location.reload();
        throw new ApiError("Sessao encerrada. Faca login novamente.", 401, errorBody ?? undefined);
      }

      if (response.status === 404 && path === "/monthly/inventory/preview") {
        throw new Error("Rota de preview de inventario nao encontrada.");
      }

      const shouldFallback =
        index === 0 &&
        API_BASE_URL.startsWith("/") &&
        [404, 502, 503, 504].includes(response.status) &&
        candidates.length > 1;

      if (shouldFallback) {
        lastError = new ApiError(errorBody?.message as string ?? `Erro HTTP ${response.status}`, response.status, errorBody ?? undefined);
        continue;
      }

      throw new ApiError(errorBody?.message as string ?? `Erro HTTP ${response.status}`, response.status, errorBody ?? undefined);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error instanceof Error ? error : new Error("Backend nao encontrado.");
      const shouldFallback = index === 0 && API_BASE_URL.startsWith("/") && candidates.length > 1;
      if (shouldFallback) continue;
      break;
    }
  }

  throw lastError ?? new Error("Backend nao encontrado.");
}

async function download(path: string, filename: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const token = sessionToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const candidates = [`${API_BASE_URL}${path}`];
  if (API_BASE_URL.startsWith("/")) {
    candidates.push(`${FALLBACK_BACKEND_URL}${path}`);
  }

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    try {
      response = await fetchWithTimeout(url, { headers }, timeoutMs);
      if (response.ok) break;

      if (response.status === 401) {
        localStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        window.location.reload();
        throw new Error("Sessao encerrada. Faca login novamente.");
      }

      const errorBody = await response.json().catch(() => null);
      const shouldFallback =
        index === 0 &&
        API_BASE_URL.startsWith("/") &&
        [404, 502, 503, 504].includes(response.status) &&
        candidates.length > 1;
      if (shouldFallback) {
        lastError = new Error(errorBody?.message ?? `Erro HTTP ${response.status}`);
        continue;
      }
      throw new Error(errorBody?.message ?? `Erro HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Backend nao encontrado.");
      const shouldFallback = index === 0 && API_BASE_URL.startsWith("/") && candidates.length > 1;
      if (shouldFallback) continue;
      break;
    }
  }

  if (!response || !response.ok) {
    throw lastError ?? new Error("Backend nao encontrado.");
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function checkBackendHealth() {
  try {
    const response = await request<{ status: string }>("/health");
    return response.status === "ok";
  } catch {
    return false;
  }
}

export type ImportPreviewRow = {
  purchaseDate: string | null;
  supplierCode: string | null;
  invoiceNumber: string | null;
  purchaseOrderNumber: string | null;
  supplierName: string;
  productCode: string | null;
  productDescription: string;
  categoryName: string | null;
  subcategoryName: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  totalPrice: number;
  paymentMethod: string | null;
  dueDates: string | null;
  sourceRowNumber?: number | null;
};

export type ImportPreview = {
  sheetName: string | null;
  totalRows: number;
  importFileId: string;
  originalFileName: string | null;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  missingRequiredFields: string[];
  missingFields: string[];
  validation: {
    spreadsheetTotal: number;
    groupedPurchases?: number;
    itemRows?: number;
    uniqueInvoices?: number;
    groupedInvoiceTotals?: Array<{
      invoiceNumber: string | null;
      supplierName: string;
      total: number;
      items: number;
      paymentMethod?: string | null;
      dueDates?: string[];
      expectedInstallments?: number;
    }>;
    rowsWithDueDates?: number;
    dueDatesDetected?: number;
    expectedInstallments?: number;
    smallExpenses?: number;
    purchasesWithoutInvoice?: number;
    purchasesWithoutDueDate?: number;
    emptyRowsIgnored?: number;
    uniqueSuppliers: number;
    uniqueProducts: number;
    supplierCodes: string[];
    productCodes: string[];
    duplicateProducts: Array<{ name: string; count: number }>;
    categories: string[];
    subcategories: string[];
    paymentMethods: string[];
  };
  conflicts: ImportConflict[];
  conflictSummary: ImportConflictSummary;
  warnings: Array<{ rowNumber: number; message: string }>;
  debugRows?: Array<{
    rowNumber: number;
    rawRow: Record<string, unknown>;
    detectedColumns: Record<string, string | undefined>;
    productDetected: { code: string | null; description: string; hasProduct: boolean };
    unitDetected: string | null;
    invoiceDetected: string | null;
    dueDatesDetected: Array<{ raw: string; parsed: string | null }>;
    operationalContent: boolean;
    alerts: string[];
  }>;
  previewRows: ImportPreviewRow[];
};

export type ConflictAction = "KEEP_CURRENT" | "UPDATE_CURRENT" | "CREATE_ALIAS" | "CREATE_NEW" | "IGNORE";

export type ImportConflictDecision = {
  id: string;
  conflictKey: string;
  entityType: "product" | "supplier";
  conflictType: string;
  action: ConflictAction;
  targetId: string | null;
  code: string | null;
  normalizedName: string | null;
  incomingName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportConflict = {
  key: string;
  entityType: "product" | "supplier";
  type: string;
  label: string;
  severity?: "critical" | "alias_suggestion";
  recommendedAction?: ConflictAction;
  code: string | null;
  normalizedName: string | null;
  currentId: string | null;
  currentName: string | null;
  incomingName: string;
  incomingCodes: string[];
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  supplierName: string | null;
  occurrences: number;
  exampleRows: number[];
  savedDecision: ImportConflictDecision | null;
};

export type ImportConflictSummary = {
  conflictsFound: number;
  conflictsResolved: number;
  conflictsPending: number;
  decisionsAppliedAutomatically: number;
};

export type PurchaseImportOptions = {
  historicalMode?: boolean;
  ignoreRowsWithoutProduct?: boolean;
};

export type ImportReport = {
  importBatchId: string | null;
  importedRows: number;
  ignoredRows: number;
  suppliersCreated: number;
  suppliersReused: number;
  categoriesCreated: number;
  categoriesReused: number;
  subcategoriesCreated: number;
  subcategoriesReused: number;
  productsCreated: number;
  productsReused: number;
  unitsCreated: number;
  unitsReused: number;
  expenseTypesCreated: number;
  expenseTypesReused: number;
  purchasesCreated: number;
  installmentsCreated: number;
  spreadsheetTotal: number;
  importedTotal: number;
  differenceTotal: number;
  duplicateProducts: Array<{ name: string; count: number }>;
  categories: string[];
  subcategories: string[];
  paymentMethods: string[];
  conflictsFound: number;
  conflictsResolved: number;
  conflictsPending: number;
  decisionsAppliedAutomatically: number;
  productsLinkedByFallback: number;
  ignoredWithoutProduct: number;
  emptyRowsIgnored?: number;
  duplicatePurchasesBlocked: number;
  duplicatePurchasesAuthorized: number;
  purchaseNumbers: string[];
  elapsedMs: number;
  errors: Array<{ rowNumber: number; message: string }>;
  warnings: Array<{ rowNumber: number; message: string }>;
};

export type DeleteImportResult = {
  importBatchId: string;
  purchasesDeleted: number;
  masterDataKept: boolean;
};

export type ImportHistoryEntry = {
  id: string;
  type: string;
  entity: string | null;
  entityId: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  importId: string | null;
  fileName: string;
  totalRows: number | string;
  importedRows: number | string;
  status: string;
  undoAvailable: boolean;
};

export type CatalogImportKind = "suppliers" | "products";

export type CatalogPreview = {
  kind: CatalogImportKind;
  sheetNames: string[];
  sheetName: string | null;
  totalRows: number;
  importFileId: string;
  originalFileName: string | null;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  missingRequiredFields: string[];
  validation: {
    spreadsheetRows: number;
    emptyRowsIgnored: number;
    recognizedRows: number;
    validRows: number;
    ignoredRows: number;
    rowsWithCode: number;
    rowsWithoutCode: number;
    existingByCode: number;
    existingByName: number;
    newRows: number;
    withoutSector: number;
    withoutControlsStock: number;
    notCountableRows: number;
  };
  warnings: Array<{ rowNumber: number; message: string }>;
  errors: Array<{ rowNumber: number; message: string }>;
  ignoredRowDetails: Array<{
    rowNumber: number;
    code: string | null;
    label: string | null;
    reason: string;
  }>;
  previewRows: Array<Record<string, string | number | boolean | null>>;
};

export type CatalogImportReport = {
  importBatchId: string | null;
  totalRows: number;
  recognizedRows: number;
  validRows: number;
  processedRows: number;
  importedRows: number;
  createdRows: number;
  updatedRows: number;
  reusedRows: number;
  ignoredRows: number;
  withoutSector: number;
  withoutControlsStock: number;
  notCountableRows: number;
  ignoredReasons: Array<{ reason: string; count: number }>;
  errors: Array<{ rowNumber: number; message: string }>;
  warnings: Array<{ rowNumber: number; message: string }>;
  ignoredRowDetails: Array<{
    rowNumber: number;
    code: string | null;
    label: string | null;
    reason: string;
  }>;
};

export type InventorySnapshotType = "INVENTARIO_INICIAL" | "INVENTARIO_FINAL" | "CONTAGEM_PARCIAL" | "AJUSTE";

export type MonthlyInventoryPreview = {
  sheetName: string | null;
  importFileId: string;
  originalFileName: string | null;
  totalRows: number;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  validation: {
    matchedItems: number;
    pendingItems: number;
    totalQuantity: number;
    totalValue: number;
  };
  warnings: Array<{ rowNumber: number; message: string }>;
  previewRows: Array<{
    rowNumber: number;
    productCode: string | null;
    productName: string;
    sectorName: string | null;
    categoryName: string | null;
    subcategoryName: string | null;
    unit: string | null;
    quantity: number;
    unitCost: number | null;
    totalCost: number | null;
    productId: string | null;
    resolutionStatus: string;
  }>;
};

export type InventorySnapshot = {
  id: string;
  competenceYear: number;
  competenceMonth: number;
  type: InventorySnapshotType;
  countDate: string;
  status: string;
  totalItems: number;
  totalValue: string | number;
  originalFileName: string | null;
  notes: string | null;
  createdAt: string;
  items?: MonthlyInventoryPreview["previewRows"];
};

export type RevenueEntry = {
  id: string;
  date: string;
  competenceYear: number;
  competenceMonth: number;
  channel: string;
  sourcePlatform?: string | null;
  description: string | null;
  grossAmount: string | number;
  discounts: string | number;
  platformFees: string | number;
  netAmount: string | number;
  serviceAmount?: string | number;
  tickets?: number;
  ticketAverage?: string | number | null;
  repiqueAmount?: string | number;
  salesFirstShift?: string | number;
  ticketsFirstShift?: number;
  salesSecondShift?: string | number;
  ticketsSecondShift?: number;
  salesTables?: string | number;
  ticketsTables?: number;
  accumulatedAmount?: string | number | null;
  weekdayName?: string | null;
  paymentMethod: string | null;
  cashAmount?: string | number;
  pixAmount?: string | number;
  debitAmount?: string | number;
  creditAmount?: string | number;
  voucherAmount?: string | number;
  notes: string | null;
  status: string;
  importBatchId?: string | null;
};

export type RevenueSummary = {
  entries: RevenueEntry[];
  summary: {
    grossAmount: number;
    serviceAmount: number;
    repiqueAmount: number;
    discounts: number;
    platformFees: number;
    netAmount: number;
    tickets: number;
    salesFirstShift: number;
    salesSecondShift: number;
    salesTables: number;
    ticketsFirstShift: number;
    ticketsSecondShift: number;
    ticketsTables: number;
    ticketAverageGeneral: number;
    byChannel: Array<Record<string, string | number | null>>;
    byPlatform: Array<Record<string, string | number | null>>;
    byDay: Array<Record<string, string | number | null>>;
  };
};

export type MonthlyCmv = {
  competenceYear: number;
  competenceMonth: number;
  initialInventoryValue: number;
  purchasesValue: number;
  finalInventoryValue: number;
  realCmvValue: number;
  revenueGrossValue: number;
  revenueNetValue: number;
  cmvPercent: number | null;
  estimatedGrossMargin: number | null;
  status: string;
};

export type RevenueImportPreview = {
  importKind: "SALON" | "DELIVERY";
  sheetName: string | null;
  importFileId: string;
  originalFileName: string | null;
  totalRows: number;
  detectedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  validation: {
    dailyRows: number;
    ignoredRows: number;
    totalGross: number;
    totalService: number;
    totalTickets: number;
    totalFirstShift: number;
    totalSecondShift: number;
    totalTables: number;
    totalRepique: number;
    total99Food: number;
    totalIfood: number;
    totalKeeta: number;
    firstDate: string | null;
    lastDate: string | null;
    ticketAverageGeneral: number;
    existingRows: number;
  };
  warnings: Array<{ rowNumber: number; message: string }>;
  previewRows: Array<{
    rowNumber: number;
    date: string;
    dayOfWeek: string | null;
    channel: string;
    sourcePlatform?: string | null;
    grossAmount: number;
    serviceAmount: number;
    tickets: number;
    ticketAverage: number;
    repiqueAmount: number;
    salesFirstShift: number;
    ticketsFirstShift: number;
    salesSecondShift: number;
    ticketsSecondShift: number;
    salesTables: number;
    ticketsTables: number;
    accumulatedAmount: number;
    delivery?: {
      orders99Food: number;
      earnings99Food: number;
      ordersIfood: number;
      earningsIfood: number;
      ordersKeeta: number;
      earningsKeeta: number;
    };
    status: "NEW" | "EXISTS";
    existingRevenueEntryId: string | null;
  }>;
};

export type RevenueImportReport = {
  importBatchId: string;
  importedRows: number;
  createdRows: number;
  updatedRows: number;
  ignoredRows: number;
  spreadsheetTotal: number;
  importedTotal: number;
  totalGross: number;
  totalService: number;
  totalTickets: number;
  ticketAverageGeneral: number;
  existingRows: number;
  overwrittenRows: number;
  warnings: Array<{ rowNumber: number; message: string }>;
  errors: Array<{ rowNumber: number; message: string }>;
};

export type CmvPeriod = {
  id: string;
  code: string | null;
  name: string;
  dataInicial: string;
  dataFinal: string;
  estoqueInicialSnapshotId: string | null;
  estoqueFinalSnapshotId: string | null;
  estoqueInicialSnapshotData: string | null;
  estoqueFinalSnapshotData: string | null;
  comprasTotal: number;
  faturamentoTotal: number;
  estoqueInicialTotal: number;
  estoqueFinalTotal: number;
  cmvReal: number;
  cmvPercentual: number | null;
  margemBruta: number | null;
  status: "OPEN" | "CLOSED";
  fechadoPor: string | null;
  fechadoPorNome: string | null;
  fechadoEm: string | null;
  reabertoPor: string | null;
  reabertoPorNome: string | null;
  reabertoEm: string | null;
  motivoReabertura: string | null;
  observacoes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CmvPeriodDetail = CmvPeriod & {
  purchasesGrossTotal: number;
  purchasesCount: number;
  revenueGrossTotal: number;
  revenueServiceTotal: number;
  revenueNetTotal: number;
  revenueDaysCount: number;
  purchaseByCategory: Array<{ categoryName: string; totalAmount: number; itemsCount: number }>;
  purchaseBySupplier: Array<{ supplierId: string; supplierName: string; supplierDocument: string | null; totalAmount: number; purchasesCount: number }>;
  revenueByChannel: Array<{ channel: string; grossAmount: number; netAmount: number; count: number }>;
};

export type CmvRealSuggestions = {
  suggestedStartDate: string;
  suggestedInitialSnapshotId: string | null;
  continuityLocked: boolean;
  latestPeriod: { id: string; dataInicial: string; dataFinal: string; status: "OPEN" | "CLOSED"; estoqueFinalSnapshotId: string | null } | null;
};

export type Supplier = {
  id: string;
  externalCode: string | null;
  document: string | null;
  name: string;
  normalizedName?: string | null;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  mainCategory?: string | null;
  defaultPaymentTermDays?: number | null;
  defaultPaymentMethodId?: string | null;
  defaultInstallmentCount?: number | null;
  defaultInstallmentDays?: number[] | null;
  defaultFinancialNotes?: string | null;
  registrationDate: string | null;
  isActive: boolean;
  notes: string | null;
  billingMode?: string;
  cycleFrequency?: string | null;
  cycleFirstDueDays?: number | null;
  cycleSecondDueDays?: number | null;
};

export type SupplierHistory = {
  monthTotal: number;
  yearTotal: number;
  lastPurchase: Purchase | null;
  recentInvoices: Array<{ id: string; purchaseNumber: string | null; invoiceNumber: string | null; purchaseDate: string; totalAmount: string; status: string }>;
  topProducts: Array<{ name: string; quantity: string; total: string }>;
  paymentMethods: Array<{ name: string; count: number }>;
  averagePaymentTermDays: number | null;
};

export type Product = {
  id: string;
  externalCode: string | null;
  name: string;
  normalizedName: string;
  unit: string | null;
  unitMeasureId?: string | null;
  inventorySectorId?: string | null;
  accountType?: string | null;
  controlsStock?: boolean;
  estoqueMinimo?: string | null;
  estoqueIdeal?: string | null;
  leadTimeCompraDias?: number | string | null;
  fornecedorPrincipalId?: string | null;
  stockUnit?: string | null;
  purchaseUnit?: string | null;
  baseUnit?: string | null;
  conversionFactor?: string | null;
  packageWeight?: string | null;
  conversionNotes?: string | null;
  logisticsNotes?: string | null;
  storageLocation?: string | null;
  storageCorridor?: string | null;
  storageShelf?: string | null;
  storagePosition?: string | null;
  storageNotes?: string | null;
  dreCategoryId?: string | null;
  dreCategory?: DRECategory | null;
  isActive: boolean;
  notes: string | null;
  category?: Category | null;
  subcategory?: Subcategory | null;
  inventorySector?: InventorySector | null;
  aliases?: Array<{ alias: string }>;
  unitConversions?: Array<{
    id?: string;
    fromUnit: string;
    toUnit: string;
    factor: string;
    averagePackageWeight: string | null;
    notes: string | null;
    isActive: boolean;
  }>;
};

export type InventorySector = {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  countOrder: number;
  isActive: boolean;
  notes: string | null;
};

export type Category = {
  id: string;
  name: string;
  mainGroup: string | null;
  isActive: boolean;
  notes: string | null;
};

export type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
  category?: Category;
  isActive: boolean;
  notes: string | null;
};

export type UnitMeasure = {
  id: string;
  code: string;
  name: string;
  type: string | null;
  isActive: boolean;
  notes: string | null;
};

export type ExpenseTypeMaster = {
  id: string;
  name: string;
  normalizedName: string;
  group: string | null;
  isActive: boolean;
  notes: string | null;
};

export type PaymentMethod = {
  id: string;
  name: string;
  normalizedName: string;
  type: string;
  group: string | null;
  isActive: boolean;
  notes: string | null;
};

export type NaturezaGerencial =
  | "CMV_COMPRA_SEM_NF"
  | "DESPESA_OPERACIONAL"
  | "IMPOSTO_TAXA"
  | "FINANCEIRO_TARIFA"
  | "INVESTIMENTO_PLANEJAMENTO"
  | "NAO_ENTRA_DRE";

export const NATUREZA_GERENCIAL_LABELS: Record<NaturezaGerencial, string> = {
  CMV_COMPRA_SEM_NF:         "CMV / Compra sem NF",
  DESPESA_OPERACIONAL:       "Despesa operacional",
  IMPOSTO_TAXA:              "Imposto / taxa",
  FINANCEIRO_TARIFA:         "Financeiro / tarifa",
  INVESTIMENTO_PLANEJAMENTO: "Investimento / planejamento",
  NAO_ENTRA_DRE:             "Não entra no DRE",
};

export type SmallExpenseType = {
  id: string;
  name: string;
  normalizedName: string;
  group: string | null;
  isActive: boolean;
  notes: string | null;
  suggestedDreCategoryId: string | null;
  suggestedDreCategory: DRECategory | null;
  naturezaGerencial: NaturezaGerencial | null;
};

export type CreditCard = {
  id: string;
  name: string;
  bankName: string;
  last4Digits: string;
  closingDay: number;
  dueDay: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    statements: number;
    purchases: number;
  };
};

export type CreditCardStatement = {
  id: string;
  creditCardId: string;
  name: string | null;
  competenceYear: number;
  competenceMonth: number;
  closingDate: string;
  dueDate: string;
  totalAmount: string;
  status: "OPEN" | "CHECKED" | "CLOSED" | "PAID" | "CANCELLED" | string;
  notes: string | null;
  generatedPurchaseId: string | null;
  createdAt: string;
  updatedAt: string;
  creditCard?: CreditCard;
  _count?: { items: number };
};

export type CreditCardStatementItem = {
  id: string;
  statementId: string;
  purchaseId: string | null;
  purchaseItemId: string | null;
  itemDate: string | null;
  description: string;
  supplierName: string | null;
  value: string;
  installment: number | null;
  totalInstallments: number | null;
  categoryName: string | null;
  smallExpenseTypeId: string | null;
  responsibleName: string | null;
  checked: boolean;
  hasDivergence: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  purchase?: { supplier?: Supplier };
  purchaseItem?: { product?: Product };
  smallExpenseType?: SmallExpenseType | null;
};

export type Purchase = {
  id: string;
  supplierId: string;
  purchaseNumber?: string | null;
  purchaseOrderNumber?: string | null;
  workflowStatus?: string | null;
  cycleStatus?: string | null;
  purchaseDate: string;
  competenceMonth: number;
  competenceYear: number;
  invoiceNumber: string | null;
  noInvoiceReason?: string | null;
  rawSupplierCode: string | null;
  paymentMethod: string | null;
  paymentMethodId: string | null;
  creditCardId?: string | null;
  smallExpenseTypeId?: string | null;
  isSmallExpense?: boolean;
  smallExpenseResponsibleName?: string | null;
  smallExpenseAuthorizedBy?: string | null;
  smallExpenseMoneyOrigin?: string | null;
  smallExpenseNotes?: string | null;
  totalAmount: string;
  status?: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  supplier: Supplier;
  items: Array<{
    id: string;
    rawProductCode: string | null;
    rawProductName: string;
    unit: string | null;
    unitMeasureId?: string | null;
    quantity: string;
    unitPrice: string;
    totalPrice: string;
    convertedUnit?: string | null;
    convertedQuantity?: string | null;
    convertedUnitPrice?: string | null;
    conversionFactorUsed?: string | null;
    conversionMissing?: boolean;
    product: Product;
  }>;
  installments: Array<{
    id: string;
    dueDate: string | null;
    paidDate: string | null;
    amount: string | null;
    paidAmount?: string | null;
    installment: number | null;
    totalInstallments?: number | null;
    paymentMethodId?: string | null;
    paymentMethodName?: string | null;
    paidPaymentMethodId?: string | null;
    paidPaymentMethodName?: string | null;
    paymentNotes?: string | null;
    status?: string;
    rawValue: string | null;
  }>;
};

export type PurchaseDetail = Omit<Purchase, "items"> & {
  supplierName: string;
  supplierDocument: string | null;
  paymentMethodName: string | null;
  creditCardName?: string | null;
  creditCardBankName?: string | null;
  creditCardLast4Digits?: string | null;
  sourceFile?: string | null;
  importBatchId?: string | null;
  rawRow?: unknown;
  cardStatementItems?: Array<{
    id: string;
    value: string;
    installment: number | null;
    totalInstallments: number | null;
    itemDate: string | null;
    description: string | null;
    statementId: string;
    statementName: string | null;
    competenceMonth: number;
    competenceYear: number;
    statementDueDate: string | null;
    statementStatus: string;
    creditCardName: string | null;
    creditCardLast4Digits: string | null;
  }>;
  items: Array<{
    id: string;
    productId: string;
    productCode: string | null;
    productName: string;
    rawProductCode: string | null;
    rawProductName: string;
    categoryName: string | null;
    subcategoryName: string | null;
    unit: string | null;
    unitMeasureId?: string | null;
    quantity: string;
    unitPrice: string;
    totalPrice: string;
    rawCategory: string | null;
    rawSubcategory: string | null;
  }>;
  audits: Array<{
    id: string;
    action: string;
    userName: string | null;
    previousValue: unknown;
    newValue: unknown;
    createdAt: string;
  }>;
};

export type PurchaseDuplicateCheck = {
  normalizedInvoiceNumber: string | null;
  normalizedPurchaseOrderNumber: string | null;
  hasActiveDuplicate: boolean;
  hasCancelledDuplicate: boolean;
  existingPurchase: null | {
    id: string;
    supplierName: string;
    purchaseDate: string;
    totalAmount: string;
    invoiceNumber: string | null;
    purchaseOrderNumber: string | null;
    purchaseNumber: string | null;
    matchType: "INVOICE" | "ORDER";
    referenceLabel: string;
  };
  cancelledPurchase: null | {
    id: string;
    supplierName: string;
    purchaseDate: string;
    totalAmount: string;
    invoiceNumber: string | null;
    purchaseOrderNumber: string | null;
    purchaseNumber: string | null;
    matchType: "INVOICE" | "ORDER";
    referenceLabel: string;
  };
};

export type ManualPurchasePayload = {
  supplierId: string;
  purchaseDate: string;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  noInvoiceReason?: string | null;
  rawSupplierCode?: string | null;
  paymentMethod?: string | null;
  paymentMethodId?: string | null;
  isSmallExpense?: boolean;
  smallExpenseTypeId?: string | null;
  smallExpenseResponsibleName?: string | null;
  smallExpenseAuthorizedBy?: string | null;
  smallExpenseMoneyOrigin?: string | null;
  smallExpenseNotes?: string | null;
  creditCardId?: string | null;
  dueDates?: string | null;
  installments?: Array<{
    installment: number;
    dueDate: string | null;
    amount: number;
    paymentMethodId?: string | null;
    paymentMethodName?: string | null;
    status?: string;
  }>;
  notes?: string | null;
  totalAmount?: number;
  paymentDifferenceReason?: string | null;
  workflowStatus?: string;
  items: Array<{
    productId: string;
    rawProductCode?: string | null;
    rawProductName?: string;
    unit?: string | null;
    unitMeasureId?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    rawCategory?: string | null;
    rawSubcategory?: string | null;
    notes?: string | null;
  }>;
};

export type Payable = {
  id: string;
  purchaseId: string | null;
  dueDate: string | null;
  paidDate: string | null;
  amount: string | null;
  paidAmount: string | null;
  installment: number | null;
  totalInstallments?: number | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paidPaymentMethodId?: string | null;
  paidPaymentMethodName?: string | null;
  paymentNotes?: string | null;
  sourceType?: "DIRECT" | "CARD_STATEMENT" | "LEGACY_CREDIT_CARD" | "SUPPLIER_CYCLE" | "TAX_PAYMENT" | string | null;
  status: "OPEN" | "PAID" | "PAID_LATE" | "OVERDUE" | "CANCELLED" | string;
  rawValue: string | null;
  supplierId: string | null;
  supplierName: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  notes: string | null;
  // Campos exclusivos de TaxPayment (presentes quando sourceType === "TAX_PAYMENT")
  taxDocumentType?: string | null;
  taxDescription?: string | null;
  taxCompanyName?: string | null;
  taxCnpj?: string | null;
  taxCompetenceDate?: string | null;
  taxDreCategoryName?: string | null;
};

export type SmallExpenseReportRow = {
  id: string;
  purchaseNumber: string | null;
  purchaseDate: string;
  supplierName: string;
  supplierDocument: string | null;
  invoiceNumber: string | null;
  employee: string;
  authorizedBy: string;
  origin: string;
  smallExpenseType: string;
  item: string;
  category: string;
  product: string;
  paymentMethod: string;
  notes: string;
  totalAmount: number;
  impactCmv: boolean;
  controlsStock: boolean;
};

export type SmallExpenseReport = {
  rows: SmallExpenseReportRow[];
  summary: {
    total: number;
    byOrigin: Array<{ label: string; amount: number }>;
    byEmployee: Array<{ label: string; amount: number }>;
    byType: Array<{ label: string; amount: number }>;
    impactCmvTotal: number;
    administrativeTotal: number;
  };
};

export type CreditCardStatementDetail = Omit<CreditCardStatement, "_count"> & {
  creditCard: CreditCard;
  items: CreditCardStatementItem[];
};

export type PurchaseFilters = {
  year?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  showCancelled?: string;
  supplierId?: string;
  category?: string;
  productId?: string;
  paymentMethod?: string;
  search?: string;
};

export type UserRole = "ADMIN" | "GESTAO_COMPLETA" | "ESTOQUISTA" | "VISUALIZACAO";
export type MenuAccessLevel = "NONE" | "VIEW" | "FULL";
export type PermissionAction = "view" | "create" | "edit" | "delete" | "approve" | "admin";
export type MenuPermissionMap = Record<string, MenuAccessLevel>;
export type ModulePermission = Record<PermissionAction, boolean>;
export type ModulePermissionMap = Record<string, ModulePermission>;
export type MenuDefinition = { id: string; label: string; group: string };

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive?: boolean;
  mustChangePassword?: boolean;
  passwordChangedAt?: string | null;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  lastLoginAt?: string | null;
  menuPermissions?: MenuPermissionMap;
  modulePermissions?: ModulePermissionMap;
  menuPermissionOverrides?: Partial<MenuPermissionMap>;
  modulePermissionOverrides?: Partial<ModulePermissionMap>;
};

export type InventoryStock = {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  unitCode: string | null;
  sectorName?: string | null;
  currentQuantity: string;
  minQuantity: string | null;
  averageCost?: string;
  costPerKg?: string | null;
  costPerBox?: string | null;
  costPerUnit?: string | null;
  lastMovementAt: string | null;
};

export function updateStockMinQuantity(productId: string, minQuantity: number | null) {
  return request<{ ok: boolean }>(`/inventory/stocks/${productId}/min-quantity`, {
    method: "PATCH",
    body: JSON.stringify({ minQuantity }),
  });
}

export type InventoryRequisitionItem = {
  id: string;
  requisitionId: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  unit: string | null;
  quantity: string;
  movementId: string | null;
  stockBefore: string | null;
  stockAfter: string | null;
  currentStock?: string | null;
  createdAt: string;
};

export type InventoryRequisition = {
  id: string;
  code: string;
  date: string;
  shift: string;
  reason: string;
  reasonNotes: string | null;
  sectorId: string | null;
  sectorName: string | null;
  requestedByUserId: string;
  requestedByName: string | null;
  status: string;
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  itemCount?: number;
  items?: InventoryRequisitionItem[];
  createdAt: string;
};

export type CreateRequisitionPayload = {
  date: string;
  shift: string;
  reason: string;
  reasonNotes?: string | null;
  sectorId?: string | null;
  notes?: string | null;
  items: Array<{ productId: string; quantity: number; unit: string }>;
};

export function getRequisitions(filters?: { startDate?: string; endDate?: string; sectorId?: string; shift?: string }) {
  return request<InventoryRequisition[]>(`/inventory/requisitions${toQueryString(filters)}`);
}

export function getRequisition(id: string) {
  return request<InventoryRequisition>(`/inventory/requisitions/${id}`);
}

export function createRequisition(payload: CreateRequisitionPayload) {
  return request<InventoryRequisition>("/inventory/requisitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export type InventoryMovement = {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  sectorName?: string | null;
  type: string;
  quantity: string;
  unit: string | null;
  unitCost?: string | null;
  totalCost?: string | null;
  responsibleUserId?: string | null;
  notes: string | null;
  createdAt: string;
};

export type StockCount = {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  countedQuantity: string;
  expectedQuantity: string;
  divergenceQuantity: string;
  unit: string | null;
  status?: string;
  inventoryAgendaItemId?: string | null;
  responsibleUserId?: string | null;
  notes: string | null;
  adjustmentGenerated: boolean;
  countedAt: string;
};

export type StockCountSessionType = "GERAL" | "SETORIAL" | "CATEGORIA" | "SUBCATEGORIA" | "FINAL_MES" | "ALEATORIA" | "TAREFA";
export type StockCountSessionStatus = "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
export type StockCountSessionItemStatus = "PENDENTE" | "CONTADO" | "ZERO" | "DIVERGENTE";

export type StockCountSessionItem = {
  id: string;
  stockCountSessionId: string;
  productId: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string;
  sectorSnapshot: string | null;
  categorySnapshot: string | null;
  subcategorySnapshot: string | null;
  locationSnapshot: string | null;
  unitSnapshot: string | null;
  sectorLabel?: string;
  categoryLabel?: string;
  subcategoryLabel?: string;
  unitLabel?: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  differenceQuantity: number | null;
  status: StockCountSessionItemStatus;
  notes: string | null;
  countedByUserId: string | null;
  countedAt: string | null;
};

export type StockCountSession = {
  id: string;
  code: string;
  type: StockCountSessionType;
  status: StockCountSessionStatus;
  referenceDate: string;
  periodMonth: number | null;
  periodYear: number | null;
  isMonthEnd: boolean;
  sectorId: string | null;
  sectorName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  inventoryAgendaItemId: string | null;
  responsibleUserId: string | null;
  responsibleName?: string | null;
  notes: string | null;
  concludedAt: string | null;
  reopenedAt: string | null;
  canceledAt: string | null;
  canceledByUserId: string | null;
  cancelReason: string | null;
  generatedInventoryId: string | null;
  generatedInventoryCode?: string | null;
  totalItems: number;
  countedItems: number;
  pendingItems: number;
  divergentItems: number;
  zeroItems: number;
};

export type StockCountSessionDetail = StockCountSession & {
  items: StockCountSessionItem[];
};

function coerceDisplayLabel(value: unknown, fallback = "-") {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "[object Object]" || text === "undefined" || text === "null") return fallback;
    return text;
  }
  if (value && typeof value === "object" && "name" in value) {
    return coerceDisplayLabel((value as { name?: unknown }).name, fallback);
  }
  return fallback;
}

function normalizeStockCountSessionDetail(detail: StockCountSessionDetail): StockCountSessionDetail {
  return {
    ...detail,
    items: detail.items.map((item) => ({
      ...item,
      productNameSnapshot: coerceDisplayLabel(item.productNameSnapshot, "Produto sem nome"),
      sectorSnapshot: coerceDisplayLabel(item.sectorSnapshot, "Sem setor"),
      categorySnapshot: coerceDisplayLabel(item.categorySnapshot, "Sem categoria"),
      subcategorySnapshot: coerceDisplayLabel(item.subcategorySnapshot, "Sem subcategoria"),
      unitSnapshot: coerceDisplayLabel(item.unitSnapshot, "-"),
      sectorLabel: coerceDisplayLabel(item.sectorSnapshot, "Sem setor"),
      categoryLabel: coerceDisplayLabel(item.categorySnapshot, "Sem categoria"),
      subcategoryLabel: coerceDisplayLabel(item.subcategorySnapshot, "Sem subcategoria"),
      unitLabel: coerceDisplayLabel(item.unitSnapshot, "-")
    }))
  };
}

export type InventoryAgendaStatus = "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "CONFIRMED" | "LATE";

export type InventoryAgendaRule = {
  id: string;
  dayOfWeek: number | null;
  categoryId: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  categoryName: string;
  frequency: string;
  defaultResponsibleUserId: string | null;
  responsibleName?: string | null;
  notes: string | null;
  isActive: boolean;
};

export type InventoryAgendaItem = {
  id: string;
  scheduledDate: string;
  categoryId: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  categoryName: string;
  status: InventoryAgendaStatus;
  responsibleUserId: string | null;
  responsibleName?: string | null;
  notes: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
};

export type InventoryAgenda = {
  year: number;
  month: number;
  items: InventoryAgendaItem[];
  rules: InventoryAgendaRule[];
};

export type InventoryAgendaDetail = {
  item: InventoryAgendaItem;
  products: Array<Product & {
    sectorName?: string | null;
    categoryName?: string | null;
    subcategoryName?: string | null;
    expectedQuantity?: string | null;
  }>;
  counts: StockCount[];
};

export type OperationalInventoryType = "GERAL" | "SETORIAL" | "FINAL_CMV" | "CONFERENCIA";
export type OperationalInventoryStatus = "RASCUNHO" | "EM_REVISAO" | "APROVADO" | "REJEITADO" | "FECHADO" | "CANCELADO";
export type OperationalInventoryItemStatus = "PENDENTE" | "CONTADO" | "ZERO" | "DIVERGENTE" | "IGNORADO";

export type OperationalInventoryItem = {
  id: string;
  inventoryId: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  location: string | null;
  unit: string | null;
  expectedQuantity: number;
  countedQuantity: number | null;
  differenceQuantity: number | null;
  status: OperationalInventoryItemStatus;
  notes: string | null;
  countedByUserId: string | null;
  countedAt: string | null;
};

export type OperationalInventory = {
  id: string;
  code: string;
  date: string;
  name: string;
  type: OperationalInventoryType;
  status: OperationalInventoryStatus;
  sectorId: string | null;
  sectorName: string | null;
  responsibleUserId: string | null;
  responsibleName?: string | null;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  closedByUserId: string | null;
  canceledByUserId: string | null;
  sentToReviewAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  canceledAt: string | null;
  notes: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  inventorySnapshotId: string | null;
  sourceStockCountSessionId?: string | null;
  totalItems: number;
  countedItems: number;
  pendingItems: number;
  divergentItems: number;
  zeroItems: number;
};

export type OperationalInventoryDetail = OperationalInventory & {
  items: OperationalInventoryItem[];
};

export type OperationalInventoryPurchasingReport = {
  zeros: OperationalInventoryItem[];
  pending: OperationalInventoryItem[];
  divergent: OperationalInventoryItem[];
  withoutCount: OperationalInventoryItem[];
  summary: {
    zeros: number;
    pending: number;
    divergent: number;
    withoutCount: number;
  };
};

export type BuyerSupportItem = {
  productId: string;
  productCode: string | null;
  productName: string;
  supplierId: string | null;
  supplierName: string;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  logisticsNotes: string | null;
  estoqueMinimo: number | null;
  estoqueIdeal: number | null;
  leadTimeCompraDias: number | null;
  lastInventoryCode: string | null;
  lastCountDate: string | null;
  lastQuantity: number | null;
  status: string;
  notes: string | null;
  alerts: string[];
  registrationAlerts: string[];
  suggestedQuantity: number | null;
  suggestionType: "SIMPLES" | "POR_CONSUMO";
  consumptionEstimated: number | null;
  averageDailyConsumption: number | null;
  coverageDays: number | null;
  consumptionPeriodStart: string | null;
  consumptionPeriodEnd: string | null;
};

export type BuyerSupportSupplierGroup = {
  supplierId: string | null;
  supplierName: string;
  items: BuyerSupportItem[];
  suggestedItems: number;
  zeroItems: number;
  belowMinimumItems: number;
  incompleteItems: number;
  totalSuggestedQuantity: number;
};

export type BuyerSupportReport = {
  summary: {
    itemsWithSuggestion: number;
    suggestedSuppliers: number;
    productsWithoutSupplier: number;
    zeros: number;
    belowMinimum: number;
    withoutCount: number;
    divergent: number;
    incompleteRegistration: number;
    withoutIdeal: number;
    withoutMinimum: number;
    controlledTotal: number;
    latestFinalCmv: { code: string; date: string; inventorySnapshotId: string | null } | null;
  };
  supplierGroups: BuyerSupportSupplierGroup[];
  prelist: BuyerSupportSupplierGroup[];
  items: BuyerSupportItem[];
};

export type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productCodeSnapshot: string | null;
  productNameSnapshot: string;
  unitSnapshot: string | null;
  suggestedQuantity: string | number | null;
  requestedQuantity: string | number;
  approvedQuantity: string | number | null;
  receivedQuantity: string | number | null;
  lastCountedQuantity: string | number | null;
  estoqueMinimoSnapshot: string | number | null;
  estoqueIdealSnapshot: string | number | null;
  alertSnapshot: string | null;
  suggestionTypeSnapshot: string | null;
  unitPriceEstimated: string | number | null;
  totalEstimated: string | number | null;
  notes: string | null;
};

export type PurchaseOrder = {
  id: string;
  code: string;
  supplierId: string;
  supplierNameSnapshot: string;
  status: "RASCUNHO" | "EM_REVISAO" | "APROVADO" | "ENVIADO" | "RECEBIDO_PARCIAL" | "RECEBIDO" | "CANCELADO";
  source: "MANUAL" | "PRE_LISTA_COMPRADOR";
  createdByUserId: string | null;
  createdByUserName?: string | null;
  approvedByUserName?: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  cancelReason: string | null;
  sentToReviewAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalItems?: number;
  estimatedTotal?: string | number;
  items?: PurchaseOrderItem[];
  audits?: AuditLog[];
};

export type PurchaseOrderList = {
  summary: Record<string, number>;
  orders: PurchaseOrder[];
};

export type ProductHistory = {
  product: Product;
  counts: Array<{
    date: string;
    inventoryCode: string;
    inventoryType: string;
    inventoryStatus: string;
    countedQuantity: number | null;
    notes: string | null;
    itemStatus: string;
  }>;
  purchases: Array<{
    date: string;
    supplierName: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    totalPrice: number;
    purchaseNumber: string | null;
    invoiceNumber: string | null;
  }>;
  cmvUsage: Array<{
    periodCode: string | null;
    startDate: string;
    endDate: string;
    initialInventory: string | null;
    finalInventory: string | null;
    initialQuantity: number | null;
    finalQuantity: number | null;
    purchaseQuantity: number | null;
    consumptionEstimated: number | null;
    averageDailyConsumption: number | null;
    coverageDays: number | null;
    variation: number | null;
  }>;
};

export type AuditLog = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: string;
};

export type DashboardData = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  totalAmount: number;
  previousMonth: number;
  previousYear: number;
  previousTotalAmount: number;
  comparisonAmount: number;
  comparisonPercent: number | null;
  revenue?: {
    grossAmount: number;
    serviceAmount: number;
    netAmount: number;
    tickets: number;
    ticketAverageGeneral: number;
    count: number;
    byChannel: Array<{ channel: string; grossAmount: number; netAmount: number; tickets: number; count: number }>;
  };
  bySupplier: Array<{ name: string; total: number }>;
  byCategory: Array<{ name: string; total: number }>;
  byProduct: Array<{ name: string; total: number; quantity: number }>;
  recentPurchases: Purchase[];
};

export async function previewImport(file: File, options: PurchaseImportOptions = {}) {
  const formData = new FormData();
  formData.append("file", file);
  if (options.historicalMode) formData.append("historicalMode", "true");
  if (options.ignoreRowsWithoutProduct) formData.append("ignoreRowsWithoutProduct", "true");

  return request<ImportPreview>("/imports/purchases/preview", {
    method: "POST",
    body: formData
  });
}

export async function confirmImport(
  importFileId: string,
  originalFileName?: string | null,
  options: PurchaseImportOptions = {}
) {
  return request<ImportReport>("/imports/purchases/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ importFileId, originalFileName, ...options })
  });
}

export function deleteImport(importBatchId: string) {
  return request<DeleteImportResult>(`/imports/purchases/${importBatchId}`, {
    method: "DELETE"
  });
}

export function saveImportConflictDecision(payload: {
  conflictKey: string;
  entityType: "product" | "supplier";
  conflictType: string;
  action: ConflictAction;
  targetId?: string | null;
  code?: string | null;
  normalizedName?: string | null;
  incomingName?: string | null;
  notes?: string | null;
}) {
  return request<ImportConflictDecision>("/import-conflicts/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function previewCatalogImport(kind: CatalogImportKind, file: File, sheetName?: string | null) {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetName) formData.append("sheetName", sheetName);

  return request<CatalogPreview>(`/imports/${kind}/preview`, {
    method: "POST",
    body: formData
  });
}

export function confirmCatalogImport(
  kind: CatalogImportKind,
  payload: {
    importFileId: string;
    originalFileName?: string | null;
    sheetName?: string | null;
    updateExisting: boolean;
  }
) {
  return request<CatalogImportReport>(`/imports/${kind}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function deleteCatalogImport(importBatchId: string) {
  return request<{ importBatchId: string; undoneChanges: number; deletedBatch: boolean; errors: string[] }>(
    `/imports/catalog/${importBatchId}`,
    { method: "DELETE" }
  );
}

function toQueryString(filters?: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== false && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getPurchases(filters?: PurchaseFilters) {
  return request<Purchase[]>(`/purchases${toQueryString(filters)}`);
}

export function getPurchase(id: string) {
  return request<PurchaseDetail>(`/purchases/${id}`);
}

export function checkPurchaseDuplicate(filters: {
  supplierId: string;
  invoiceNumber?: string;
  purchaseOrderNumber?: string;
  excludePurchaseId?: string;
}) {
  return request<PurchaseDuplicateCheck>(`/purchases/duplicate-check${toQueryString(filters)}`);
}

export function updatePurchase(id: string, payload: ManualPurchasePayload & { supplierChangeReason?: string | null }) {
  return request<PurchaseDetail>(`/purchases/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getPayables(filters?: {
  filter?: string;
  supplierId?: string;
  paymentMethodId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  noDueDate?: boolean;
  origin?: "all" | "purchases" | "taxes";
}) {
  return request<Payable[]>(`/purchases/payables${toQueryString(filters)}`);
}

export function payTaxPayment(id: string, payload: { paymentDate: string; paidAmount: number; comments?: string | null }) {
  return request<{ id: string; status: string }>(`/tax-payments/${id}/pay`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function reverseTaxPayment(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/tax-payments/${id}/reverse`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function getTaxPaymentHistory(id: string) {
  return request<AuditLog[]>(`/tax-payments/${id}/history`);
}

export function downloadSupplierPositionPdf(filters?: { supplierId?: string; startDate?: string; endDate?: string }) {
  return download(`/purchases/reports/supplier-position.pdf${toQueryString(filters)}`, "posicao-fornecedor.pdf");
}

export function downloadPayablesFinancialPdf(filters?: {
  supplierId?: string;
  paymentMethodId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  return download(`/purchases/payables/report.pdf${toQueryString(filters)}`, "financeiro-contas-a-pagar.pdf");
}

export function payInstallment(id: string, payload: {
  paidDate: string;
  paidAmount: number;
  paidPaymentMethodId?: string | null;
  paidPaymentMethodName?: string | null;
  paymentNotes?: string | null;
  differenceReason?: string | null;
  payingCompanyId?: string | null;
  companyBankAccountId?: string | null;
}) {
  return request<{ id: string; status: string }>(`/purchases/payables/${id}/pay`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function reverseInstallment(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/purchases/payables/${id}/reverse`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function getPayableHistory(id: string) {
  return request<AuditLog[]>(`/purchases/payables/${id}/history`);
}

export function getSuppliers(params?: { search?: string; activeOnly?: boolean }) {
  return request<Supplier[]>(`/suppliers${toQueryString(params)}`);
}

export function saveSupplier(payload: Partial<Supplier> & { name: string }) {
  const path = payload.id ? `/suppliers/${payload.id}` : "/suppliers";
  return request<Supplier>(path, {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setSupplierStatus(id: string, isActive: boolean) {
  return request<Supplier>(`/suppliers/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getSupplierHistory(id: string, filters?: { year?: string; month?: string }) {
  return request<SupplierHistory>(`/suppliers/${id}/history${toQueryString(filters)}`);
}

export function getProducts(filters?: { search?: string; category?: string; sector?: string; controlsStock?: string; isActive?: string; semDreCategoria?: string }) {
  return request<Product[]>(`/products${toQueryString(filters)}`);
}

export function getProductHistory(id: string) {
  return request<ProductHistory>(`/products/${id}/history`);
}

export function getNextProductCode() {
  return request<{ code: string }>("/products/next-code");
}

export function saveProduct(
  payload: Partial<Product> & {
    name: string;
    categoryName?: string;
    subcategoryName?: string;
  }
) {
  const path = payload.id ? `/products/${payload.id}` : "/products";
  return request<Product>(path, {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function bulkPatchProductDreCategory(ids: string[], dreCategoryId: string | null) {
  return request<{ ok: boolean; updated: number }>("/products/bulk-dre", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, dreCategoryId })
  });
}

export function setProductStatus(id: string, isActive: boolean) {
  return request<Product>(`/products/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function addProductAlias(id: string, alias: string) {
  return request(`/products/${id}/aliases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias })
  });
}

export function getPaymentMethods(search?: string) {
  return request<PaymentMethod[]>(`/payment-methods${toQueryString({ search })}`);
}

export function savePaymentMethod(payload: Partial<PaymentMethod> & { name: string }) {
  const path = payload.id ? `/payment-methods/${payload.id}` : "/payment-methods";
  return request<PaymentMethod>(path, {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setPaymentMethodStatus(id: string, isActive: boolean) {
  return request<PaymentMethod>(`/payment-methods/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getCards(search?: string) {
  return request<CreditCard[]>(`/cards${toQueryString({ search })}`);
}

export function saveCard(payload: Partial<CreditCard> & { name: string; bankName: string; last4Digits: string; closingDay: number; dueDay: number }) {
  return request<CreditCard>("/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setCardStatus(id: string, isActive: boolean) {
  return request<CreditCard>(`/cards/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getCardStatements(filters?: { creditCardId?: string; status?: string; startDate?: string; endDate?: string }) {
  return request<CreditCardStatement[]>(`/cards/statements${toQueryString(filters)}`);
}

export function getCardStatement(id: string) {
  return request<CreditCardStatementDetail>(`/cards/statements/${id}`);
}

export function saveCardStatement(
  payload: Partial<CreditCardStatement> & {
    creditCardId: string;
    competenceYear: number;
    competenceMonth: number;
  }
) {
  return request<CreditCardStatement>("/cards/statements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setCardStatementStatus(id: string, status: string) {
  return request<CreditCardStatement>(`/cards/statements/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export function addCardStatementItem(
  statementId: string,
  payload: {
    purchaseId?: string | null;
    purchaseItemId?: string | null;
    itemDate?: string | null;
    description: string;
    supplierName?: string | null;
    value: number;
    installment?: number | null;
    totalInstallments?: number | null;
    categoryName?: string | null;
    smallExpenseTypeId?: string | null;
    responsibleName?: string | null;
    checked?: boolean;
    hasDivergence?: boolean;
    notes?: string | null;
  }
) {
  return request<CreditCardStatementItem>(`/cards/statements/${statementId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateCardStatementItem(statementId: string, itemId: string, payload: Partial<CreditCardStatementItem>) {
  return request<CreditCardStatementItem>(`/cards/statements/${statementId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function checkCardStatementItem(statementId: string, itemId: string, payload: { checked: boolean; hasDivergence?: boolean; notes?: string | null }) {
  return request<CreditCardStatementItem>(`/cards/statements/${statementId}/items/${itemId}/check`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function closeCardStatement(id: string) {
  return request<CreditCardStatementDetail>(`/cards/statements/${id}/close`, {
    method: "POST"
  });
}

export function payCardStatement(id: string, payload?: { paidDate?: string; paidAmount?: number; paymentMethodName?: string }) {
  return request<{ id: string; status: string }>(`/cards/statements/${id}/pay`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });
}

export function downloadCardStatementPdf(id: string) {
  return download(`/cards/statements/${id}/pdf`, "fatura-cartao.pdf");
}

export function getSmallExpenseReport(filters?: {
  startDate?: string;
  endDate?: string;
  employee?: string;
  authorizedBy?: string;
  origin?: string;
  type?: string;
  supplier?: string;
  paymentMethod?: string;
  category?: string;
  product?: string;
}) {
  return request<SmallExpenseReport>(`/cards/small-expenses${toQueryString(filters)}`);
}

export function downloadSmallExpensesPdf(filters?: {
  startDate?: string;
  endDate?: string;
  employee?: string;
  authorizedBy?: string;
  origin?: string;
  type?: string;
  supplier?: string;
  paymentMethod?: string;
  category?: string;
  product?: string;
}) {
  return download(`/cards/small-expenses.pdf${toQueryString(filters)}`, "pequenos-gastos.pdf");
}

export function getDashboard(filters: { year?: string; month?: string; startDate?: string; endDate?: string }) {
  return request<DashboardData>(`/dashboard/purchases${toQueryString(filters)}`);
}

export type DashboardAlert = {
  type: "danger" | "warning" | "info" | "success";
  code: string;
  title: string;
  description: string;
  count?: number;
  amount?: number;
  actionLabel?: string;
  actionPath?: string;
};

export type DashboardAlertsData = {
  competence: string;
  alerts: DashboardAlert[];
  summary: {
    overduePayablesCount: number;
    overduePayablesAmount: number;
    dueSoonPayablesCount: number;
    dueSoonPayablesAmount: number;
    unpaidPurchasesCount: number;
    unpaidPurchasesAmount: number;
    missingRevenueDays: number;
    cmvStatus: "closed" | "pending" | "missing" | "unknown";
  };
};

export function getDashboardAlerts(competence: string) {
  return request<DashboardAlertsData>(`/dashboard/alerts${toQueryString({ competence })}`);
}

// ── Dashboard Summary (KPIs financeiros) ──

export type DashboardSummaryKpi = {
  total?: number;
  grossAmount?: number;
  netAmount?: number;
  serviceAmount?: number;
  tickets?: number;
  count?: number;
  ticketAverage?: number;
  prev: { total?: number; netAmount?: number; grossAmount?: number };
  deltaPercent: number | null;
};

export type DashboardSummaryData = {
  year: number;
  month: number;
  revenue: Omit<DashboardSummaryKpi, "total"> & {
    grossAmount: number;
    netAmount: number;
    serviceAmount: number;
    tickets: number;
    count: number;
    ticketAverage: number;
    prev: { grossAmount: number; netAmount: number };
    deltaPercent: number | null;
  };
  purchases: {
    total: number;
    count: number;
    prev: { total: number };
    deltaPercent: number | null;
  };
  smallExpenses: {
    total: number;
    count: number;
    prev: { total: number };
    deltaPercent: number | null;
  };
  cmvReal: {
    status: "closed" | "pending" | "missing";
    value: number | null;
    percent: number | null;
  };
  estimatedResult: {
    value: number;
    marginPercent: number | null;
  };
};

export function getDashboardSummary(year: number, month: number) {
  return request<DashboardSummaryData>(`/dashboard/summary${toQueryString({ year: String(year), month: String(month) })}`);
}

export async function login(email: string, password: string, options?: { force?: boolean }) {
  const result = await request<{ token: string; user: AppUser }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, force: options?.force ?? false })
  });
  localStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.setItem(SESSION_TOKEN_KEY, result.token);
  return result;
}

export async function logout() {
  const token = sessionToken();
  if (token) {
    const urls = [
      `${API_BASE_URL}/auth/logout`,
      ...(API_BASE_URL.startsWith("/") ? [`${BACKEND_TARGET_URL}/auth/logout`] : [])
    ];
    for (const url of urls) {
      try {
        const resp = await fetchWithTimeout(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resp.ok) break;
      } catch {
        // fallback to next URL or ignore on failure
      }
    }
  }
  localStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function killUserSession(userId: string) {
  return request<{ ok: boolean }>(`/auth/sessions/${userId}`, { method: "DELETE" });
}

export type UserSessionInfo = {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string | null;
};

export function getActiveSessions() {
  return request<UserSessionInfo[]>("/auth/sessions");
}

export function getMe() {
  return request<AppUser>("/auth/me");
}

export function getUsers() {
  return request<AppUser[]>("/users");
}

export function getMenuPermissions() {
  return request<{
    menus: MenuDefinition[];
    accessLevels: MenuAccessLevel[];
    actions: PermissionAction[];
    rolePermissions: Record<UserRole, MenuPermissionMap>;
    roleModulePermissions: Record<UserRole, ModulePermissionMap>;
  }>("/users/menu-permissions");
}

export function saveUser(payload: { name: string; email: string; password: string; role: UserRole }) {
  return request<AppUser>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setUserStatus(id: string, isActive: boolean) {
  return request<AppUser>(`/users/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function updateUserPermissions(id: string, payload: {
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
}) {
  return request<AppUser>(`/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateUserMenuPermissions(id: string, permissions: Partial<ModulePermissionMap>) {
  return request<AppUser>(`/users/${id}/menu-permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions })
  });
}

export function updateRoleMenuPermissions(role: UserRole, permissions: ModulePermissionMap) {
  return request<{ role: UserRole; menuPermissions: MenuPermissionMap; modulePermissions: ModulePermissionMap }>(`/users/roles/${role}/menu-permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions })
  });
}

export function resetUserPassword(id: string, payload: { password: string; mustChangePassword: boolean }) {
  return request<AppUser>(`/users/${id}/password`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function changeOwnPassword(payload: { currentPassword: string; newPassword: string }) {
  return request<{ ok: boolean }>("/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function cancelPurchase(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/purchases/${id}/cancel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function restorePurchase(id: string) {
  return request<{ id: string; status: string }>(`/purchases/${id}/restore`, {
    method: "PATCH"
  });
}

export function createPurchase(payload: ManualPurchasePayload) {
  return request<{ id: string; purchaseNumber: string }>("/purchases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export type AuditLogsResponse = {
  data: AuditLog[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export function getAuditLogs(filters?: { userId?: string; entity?: string; startDate?: string; endDate?: string; page?: number; limit?: number }) {
  const { page, limit, ...rest } = filters ?? {};
  const qs = toQueryString({ ...rest, ...(page !== undefined ? { page: String(page) } : {}), ...(limit !== undefined ? { limit: String(limit) } : {}) });
  return request<AuditLogsResponse>(`/audit${qs}`);
}

export function getImportHistory() {
  return request<ImportHistoryEntry[]>("/imports/history");
}

export function getInventoryStocks(search?: string) {
  return request<InventoryStock[]>(`/inventory/stocks${toQueryString({ search })}`);
}

export function getInventoryMovements(filters?: { productId?: string; search?: string; startDate?: string; endDate?: string }) {
  return request<InventoryMovement[]>(`/inventory/movements${toQueryString(filters)}`);
}

export function createInventoryMovement(payload: {
  productId: string;
  type: string;
  quantity: number;
  unit?: string | null;
  unitCost?: number | null;
  totalCost?: number | null;
  notes?: string | null;
}) {
  return request<{ id: string }>("/inventory/movements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getStockCounts() {
  return request<StockCount[]>("/inventory/counts");
}

export function createStockCount(payload: {
  productId: string;
  countedQuantity: number;
  unit?: string | null;
  notes?: string | null;
  generateAdjustment?: boolean;
  status?: "DRAFT" | "SUBMITTED";
  inventoryAgendaItemId?: string | null;
}) {
  return request<{ id: string; expectedQuantity: number; divergenceQuantity: number; adjustmentMovementId: string | null }>(
    "/inventory/counts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}

export function getStockCountSessions(includeCanceled = false) {
  return request<StockCountSession[]>(`/inventory/count-sessions${toQueryString({ includeCanceled: includeCanceled ? "true" : undefined })}`);
}

export function createStockCountSession(payload: {
  referenceDate: string;
  type: StockCountSessionType;
  sectorId?: string | null;
  sectorName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  periodMonth?: number | null;
  periodYear?: number | null;
  isMonthEnd?: boolean;
  inventoryAgendaItemId?: string | null;
  notes?: string | null;
}) {
  return request<StockCountSession>("/inventory/count-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getStockCountSession(id: string) {
  return request<StockCountSessionDetail>(`/inventory/count-sessions/${id}`).then(normalizeStockCountSessionDetail);
}

export function saveStockCountSessionItems(id: string, items: Array<{ id: string; countedQuantity?: number | string | null; notes?: string | null }>) {
  return request<StockCountSession>(`/inventory/count-sessions/${id}/items`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
}

export function concludeStockCountSession(id: string, items: Array<{ id: string; countedQuantity?: number | string | null; notes?: string | null }>) {
  return request<StockCountSession>(`/inventory/count-sessions/${id}/conclude`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
}

export function reopenStockCountSession(id: string, reason: string) {
  return request<StockCountSession>(`/inventory/count-sessions/${id}/reopen`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function cancelStockCountSession(id: string, reason: string) {
  return request<StockCountSession>(`/inventory/count-sessions/${id}/cancel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function generateInventoryFromStockCountSession(id: string, notes?: string | null) {
  return request<OperationalInventory>(`/inventory/count-sessions/${id}/generate-inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes })
  });
}

export function consolidateMonthEndSessions(sessionIds: string[], notes?: string | null) {
  return request<OperationalInventory>("/inventory/count-sessions/consolidate-month-end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionIds, notes })
  });
}

export function getMonthEndStockCountSession(filters: { year: number; month: number }) {
  return request<StockCountSession | null>(`/inventory/count-sessions/month-end${toQueryString({ year: String(filters.year), month: String(filters.month) })}`);
}

export function getOpeningBasisStockCountSession(filters: { year: number; month: number }) {
  return request<StockCountSession | null>(`/inventory/count-sessions/opening-basis${toQueryString({ year: String(filters.year), month: String(filters.month) })}`);
}

export function getInventoryAgenda(filters: { year: string; month: string }) {
  return request<InventoryAgenda>(`/inventory/agenda${toQueryString(filters)}`);
}

export function saveInventoryAgendaRule(payload: Partial<InventoryAgendaRule> & { categoryName: string }) {
  const path = payload.id ? `/inventory/agenda/rules/${payload.id}` : "/inventory/agenda/rules";
  return request<{ id: string }>(path, {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function deleteInventoryAgendaRule(id: string) {
  return request<{ id: string; isActive: boolean }>(`/inventory/agenda/rules/${id}`, { method: "DELETE" });
}

export function getInventoryAgendaDetail(id: string) {
  return request<InventoryAgendaDetail>(`/inventory/agenda/${id}/detail`);
}

export function getOperationalInventories(includeCanceled = false) {
  return request<OperationalInventory[]>(`/inventory/operational${toQueryString({ includeCanceled: includeCanceled ? "true" : undefined })}`);
}

export function createOperationalInventory(payload: {
  date: string;
  type: OperationalInventoryType;
  sectorId?: string | null;
  sectorName?: string | null;
  notes?: string | null;
}) {
  return request<OperationalInventory>("/inventory/operational", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getOperationalInventory(id: string) {
  return request<OperationalInventoryDetail>(`/inventory/operational/${id}`);
}

export function saveOperationalInventoryItems(id: string, items: Array<{ id: string; countedQuantity?: number | string | null; notes?: string | null }>) {
  return request<OperationalInventory>(`/inventory/operational/${id}/items`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
}

export function markOperationalInventoryItemsZero(id: string, itemIds: string[]) {
  return request<OperationalInventory>(`/inventory/operational/${id}/mark-zero`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemIds })
  });
}

export function submitOperationalInventory(id: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/submit`, { method: "PATCH" });
}

export function approveOperationalInventory(id: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/approve`, { method: "PATCH" });
}

export function rejectOperationalInventory(id: string, reason: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/reject`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function closeOperationalInventory(id: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/close`, { method: "PATCH" });
}

export function cancelOperationalInventory(id: string, reason: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/cancel`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function reopenOperationalInventory(id: string, reason: string) {
  return request<OperationalInventory>(`/inventory/operational/${id}/reopen`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function getOperationalInventoryPurchasingReport() {
  return request<OperationalInventoryPurchasingReport>("/inventory/operational/purchasing-report");
}

export function getBuyerSupportReport(filters?: { search?: string; supplier?: string; sector?: string; category?: string; subcategory?: string; status?: string }) {
  return request<BuyerSupportReport>(`/inventory/operational/buyer-support${toQueryString(filters)}`);
}

export function downloadOperationalInventoryPdf(id: string, code?: string) {
  return download(`/inventory/operational/${id}/pdf`, `${code ?? "inventario"}.pdf`);
}

export function downloadBuyerPrelistCsv(filters?: { search?: string; supplier?: string; sector?: string; category?: string; subcategory?: string; status?: string }) {
  return download(`/inventory/operational/buyer-support/prelist.csv${toQueryString(filters)}`, "pre-lista-compras.csv");
}

export function getPurchaseOrders(filters?: { status?: string; search?: string }) {
  return request<PurchaseOrderList>(`/purchase-orders${toQueryString(filters)}`);
}

export function getPurchaseOrder(id: string) {
  return request<PurchaseOrder>(`/purchase-orders/${id}`);
}

export function createPurchaseOrdersFromPrelist(payload: {
  supplierIds?: string[];
  productIds?: string[];
  filters?: { search?: string; supplier?: string; sector?: string; category?: string; subcategory?: string; status?: string };
  expectedDeliveryDate?: string | null;
  notes?: string | null;
}) {
  return request<{ orders: Array<{ id: string; code: string; supplierName: string; items: number }>; pendingWithoutSupplier: number }>("/purchase-orders/from-prelist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updatePurchaseOrder(id: string, payload: { expectedDeliveryDate?: string | null; notes?: string | null; items?: Array<{ id: string; requestedQuantity: number | string; notes?: string | null }> }) {
  return request<PurchaseOrder>(`/purchase-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function changePurchaseOrderStatus(id: string, action: "SEND_REVIEW" | "APPROVE" | "MARK_SENT") {
  return request<PurchaseOrder>(`/purchase-orders/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });
}

export function receivePurchaseOrder(id: string, items: Array<{ id: string; receivedQuantity: number | string }>) {
  return request<PurchaseOrder>(`/purchase-orders/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
}

export function cancelPurchaseOrder(id: string, reason: string) {
  return request<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function downloadPurchaseOrderCsv(id: string, code?: string) {
  return download(`/purchase-orders/${id}/export.csv`, `${code ?? "pedido-compra"}.csv`);
}

export function previewMonthlyInventory(file: File, sheetName?: string | null) {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetName) formData.append("sheetName", sheetName);
  return request<MonthlyInventoryPreview>("/monthly/inventory/preview", {
    method: "POST",
    body: formData
  });
}

export function confirmMonthlyInventory(payload: {
  importFileId: string;
  originalFileName?: string | null;
  sheetName?: string | null;
  competenceYear: number;
  competenceMonth: number;
  type: InventorySnapshotType;
  countDate: string;
  notes?: string | null;
  allowOverwrite?: boolean;
  overwriteReason?: string | null;
}) {
  return request<{ id: string; importedRows: number; pendingItems: number; totalValue: number; replacedSnapshotId: string | null; warnings: Array<{ rowNumber: number; message: string }> }>("/monthly/inventory/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getMonthlyInventories(filters: { year?: string; month?: string }) {
  return request<InventorySnapshot[]>(`/monthly/inventory${toQueryString(filters)}`);
}

export function getMonthlyInventory(id: string) {
  return request<InventorySnapshot>(`/monthly/inventory/${id}`);
}

export function undoMonthlyInventory(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/monthly/inventory/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function getRevenue(
  filters: { year: string; month: string; startDate?: string; endDate?: string; channel?: string },
  signal?: AbortSignal
) {
  return request<RevenueSummary>(`/monthly/revenue${toQueryString(filters)}`, { signal });
}

export function getRevenueEntry(id: string) {
  return request<RevenueEntry>(`/monthly/revenue/${id}`);
}

export function previewRevenueImport(file: File, payload: { competenceYear: number; competenceMonth: number; defaultChannel: string; sheetName?: string | null; notes?: string | null }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("competenceYear", String(payload.competenceYear));
  formData.append("competenceMonth", String(payload.competenceMonth));
  formData.append("defaultChannel", payload.defaultChannel);
  if (payload.sheetName) formData.append("sheetName", payload.sheetName);
  if (payload.notes) formData.append("notes", payload.notes);
  return request<RevenueImportPreview>("/monthly/revenue/import/preview", {
    method: "POST",
    body: formData
  });
}

export function confirmRevenueImport(payload: {
  importFileId: string;
  originalFileName?: string | null;
  sheetName?: string | null;
  competenceYear: number;
  competenceMonth: number;
  defaultChannel: string;
  notes?: string | null;
  allowOverwrite?: boolean;
  overwriteReason?: string | null;
}) {
  return request<RevenueImportReport>("/monthly/revenue/import/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function undoRevenueImport(importBatchId: string) {
  return request<{ importBatchId: string; status: string }>(`/monthly/revenue/import/${importBatchId}`, {
    method: "DELETE"
  });
}

export function saveRevenueEntry(payload: Partial<RevenueEntry> & {
  date: string;
  competenceYear: number;
  competenceMonth: number;
  channel: string;
  sourcePlatform?: string | null;
  grossAmount: number;
  discounts?: number;
  platformFees?: number;
  netAmount?: number;
  serviceAmount?: number;
  tickets?: number;
  ticketAverage?: number | null;
  salesFirstShift?: number;
  ticketsFirstShift?: number;
  salesSecondShift?: number;
  ticketsSecondShift?: number;
  salesTables?: number;
  ticketsTables?: number;
  accumulatedAmount?: number | null;
  weekdayName?: string | null;
  cashAmount?: number;
  pixAmount?: number;
  debitAmount?: number;
  creditAmount?: number;
  voucherAmount?: number;
}) {
  return request<{ id: string }>(payload.id ? `/monthly/revenue/${payload.id}` : "/monthly/revenue", {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function closeDailyRevenue(date: string) {
  return request<{ date: string; hasSalon: boolean; hasDelivery: boolean; status: string }>("/monthly/revenue/daily-close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date })
  });
}

export function cancelRevenueEntry(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/monthly/revenue/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function getMonthlyCmv(filters: { year: string; month: string }) {
  return request<MonthlyCmv>(`/monthly/cmv${toQueryString(filters)}`);
}

export function calculateMonthlyCmv(year: number, month: number) {
  return request<MonthlyCmv>("/monthly/cmv/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month })
  });
}

export function closeMonthlyCmv(year: number, month: number) {
  return request<MonthlyCmv>("/monthly/cmv/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month })
  });
}

export function reopenMonthlyCmv(year: number, month: number, reason: string) {
  return request<MonthlyCmv>("/monthly/cmv/reopen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month, reason })
  });
}

export function getCmvRealSuggestions() {
  return request<CmvRealSuggestions>("/monthly/cmv-real/suggestions");
}

export function getCmvPeriods() {
  return request<CmvPeriod[]>("/monthly/cmv-real");
}

export function getCmvPeriod(id: string) {
  return request<CmvPeriodDetail>(`/monthly/cmv-real/${id}`);
}

export function saveCmvPeriod(payload: {
  id?: string;
  name?: string;
  dataInicial: string;
  dataFinal: string;
  estoqueInicialSnapshotId: string;
  estoqueFinalSnapshotId: string;
  observacoes?: string | null;
  continuityOverrideReason?: string | null;
}) {
  const path = payload.id ? `/monthly/cmv-real/${payload.id}` : "/monthly/cmv-real";
  return request<CmvPeriodDetail>(path, {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function calculateCmvPeriod(id: string) {
  return request<CmvPeriodDetail>(`/monthly/cmv-real/${id}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export function closeCmvPeriod(id: string) {
  return request<CmvPeriodDetail>(`/monthly/cmv-real/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export function reopenCmvPeriod(id: string, reason: string) {
  return request<CmvPeriodDetail>(`/monthly/cmv-real/${id}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function deleteCmvPeriod(id: string, reason?: string | null) {
  return request<{ id: string; status: string; linkedNextPeriods: number }>(`/monthly/cmv-real/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null })
  });
}

export function downloadCmvPeriodPdf(id: string) {
  return download(`/monthly/cmv-real/${id}/pdf`, "cmv-real.pdf");
}

export function startInventoryAgendaItem(id: string) {
  return request<{ id: string; status: string }>(`/inventory/agenda/${id}/start`, { method: "PATCH" });
}

export function submitInventoryAgendaItem(id: string) {
  return request<{ id: string; status: string }>(`/inventory/agenda/${id}/submit`, { method: "PATCH" });
}

export function confirmInventoryAgendaItem(id: string) {
  return request<{ id: string; status: string }>(`/inventory/agenda/${id}/confirm`, { method: "PATCH" });
}

export function getCategories(search?: string) {
  return request<Category[]>(`/master-data/categories${toQueryString({ search })}`);
}

export function getSectors(search?: string, filters?: { forStockCounting?: boolean }) {
  return request<InventorySector[]>(`/master-data/sectors${toQueryString({ search, forStockCounting: filters?.forStockCounting ? "true" : undefined })}`);
}

export function saveSector(payload: Partial<InventorySector> & { name: string }) {
  return request<InventorySector>(payload.id ? `/master-data/sectors/${payload.id}` : "/master-data/sectors", {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setSectorStatus(id: string, isActive: boolean) {
  return request<InventorySector>(`/master-data/sectors/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function saveCategory(payload: Partial<Category> & { name: string }) {
  return request<Category>(payload.id ? `/master-data/categories/${payload.id}` : "/master-data/categories", {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setCategoryStatus(id: string, isActive: boolean) {
  return request<Category>(`/master-data/categories/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getSubcategories(search?: string) {
  return request<Subcategory[]>(`/master-data/subcategories${toQueryString({ search })}`);
}

export function saveSubcategory(payload: Partial<Subcategory> & { name: string; categoryId: string }) {
  return request<Subcategory>(
    payload.id ? `/master-data/subcategories/${payload.id}` : "/master-data/subcategories",
    {
      method: payload.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}

export function setSubcategoryStatus(id: string, isActive: boolean) {
  return request<Subcategory>(`/master-data/subcategories/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getUnits(search?: string) {
  return request<UnitMeasure[]>(`/master-data/units${toQueryString({ search })}`);
}

export function saveUnit(payload: Partial<UnitMeasure> & { code: string; name: string }) {
  return request<UnitMeasure>(payload.id ? `/master-data/units/${payload.id}` : "/master-data/units", {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setUnitStatus(id: string, isActive: boolean) {
  return request<UnitMeasure>(`/master-data/units/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getExpenseTypes(search?: string) {
  return request<ExpenseTypeMaster[]>(`/master-data/expense-types${toQueryString({ search })}`);
}

export function saveExpenseType(payload: Partial<ExpenseTypeMaster> & { name: string }) {
  return request<ExpenseTypeMaster>(
    payload.id ? `/master-data/expense-types/${payload.id}` : "/master-data/expense-types",
    {
      method: payload.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}

export function setExpenseTypeStatus(id: string, isActive: boolean) {
  return request<ExpenseTypeMaster>(`/master-data/expense-types/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getSmallExpenseTypes(search?: string) {
  return request<SmallExpenseType[]>(`/master-data/small-expense-types${toQueryString({ search })}`);
}

export function saveSmallExpenseType(payload: Partial<SmallExpenseType> & { name: string }) {
  return request<SmallExpenseType>(
    payload.id ? `/master-data/small-expense-types/${payload.id}` : "/master-data/small-expense-types",
    {
      method: payload.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
}

export function setSmallExpenseTypeStatus(id: string, isActive: boolean) {
  return request<SmallExpenseType>(`/master-data/small-expense-types/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function bulkPatchSmallExpenseTypes(payload: {
  ids: string[];
  naturezaGerencial?: NaturezaGerencial | null;
  suggestedDreCategoryId?: string | null;
}) {
  return request<{ ok: boolean; updated: number }>("/master-data/small-expense-types/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ──────────────────────────────────────────────
// Dishes / Fichas Técnicas
// ──────────────────────────────────────────────

export type DishCategory = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
};

export type DishIngredient = {
  id: string;
  productId: string;
  productCode: string | null;
  productName: string;
  productUnit: string | null;
  quantity: number;
  unit: string;
  wasteFactor: number;
  unitCost: number;
  itemCost: number;
  notes: string | null;
  sortOrder: number;
};

export type DishListItem = {
  id: string;
  code: string | null;
  name: string;
  category: { id: string; name: string } | null;
  salePriceDefault: number | null;
  yieldQty: number;
  yieldUnit: string;
  isActive: boolean;
  itemsCount: number;
  calculatedCost: number;
  margemBruta: number | null;
  cmvPercentual: number | null;
};

export type DishDetail = DishListItem & {
  notes: string | null;
  items: DishIngredient[];
};

export function getDishCategories() {
  return request<DishCategory[]>("/dishes/categories");
}

export function saveDishCategory(payload: Partial<DishCategory> & { name: string }) {
  return request<DishCategory>(
    payload.id ? `/dishes/categories/${payload.id}` : "/dishes/categories",
    { method: payload.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function getDishes(params: { search?: string; categoryId?: string; showInactive?: boolean } = {}) {
  return request<DishListItem[]>(`/dishes${toQueryString({
    search: params.search,
    categoryId: params.categoryId,
    showInactive: params.showInactive ? "true" : undefined
  })}`);
}

export function getDishDetail(id: string) {
  return request<DishDetail>(`/dishes/${id}`);
}

export function saveDish(payload: Record<string, unknown>) {
  return request<{ id: string }>(
    payload.id ? `/dishes/${payload.id}` : "/dishes",
    { method: payload.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function deactivateDish(id: string) {
  return request<{ ok: boolean }>(`/dishes/${id}`, { method: "DELETE" });
}

export type DishProductSearchResult = {
  id: string;
  externalCode: string | null;
  name: string;
  unit: string | null;
  averageCost: number;
};

export function searchDishProducts(search: string) {
  return request<DishProductSearchResult[]>(`/dishes/products/search${toQueryString({ search })}`);
}

// ──────────────────────────────────────────────
// DRE Gerencial
// ──────────────────────────────────────────────

export type DRECategory = {
  id: string;
  name: string;
  dreGroup: string;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
};

export type DREExpenseLine = {
  dreCategoryId: string | null;
  dreCategoryName: string;
  dreGroup: string;
  sortOrder: number;
  total: number;
  count: number;
};

export type DREExpenseGroup = {
  key: string;
  label: string;
  sortOrder: number;
  total: number;
  lines: DREExpenseLine[];
};

const DRE_TIMEOUT_MS = 30_000;

export function getDRESummary(
  params: { year: number; month: number; comparatives?: boolean } | { from: string; to: string; comparatives?: boolean }
) {
  let qs: Record<string, string>;
  if ("year" in params) {
    qs = { year: String(params.year), month: String(params.month) };
    if (params.comparatives === false) qs.comparatives = "false";
  } else {
    qs = { from: params.from, to: params.to };
    if (params.comparatives === false) qs.comparatives = "false";
  }
  return request<{ current: DRESummary; prevMonth: DRESummary | null; prevYear: DRESummary | null }>(
    `/dre/summary${toQueryString(qs)}`,
    undefined,
    DRE_TIMEOUT_MS
  );
}

export function seedDRECategories() {
  return request<{ ok: boolean; created: number; skipped: number }>("/dre/categories/seed", { method: "POST" });
}

export function getDRECategories(all = false) {
  return request<DRECategory[]>(all ? "/dre/categories/all" : "/dre/categories");
}

export function saveDRECategory(payload: Partial<DRECategory> & { name: string }) {
  return request<DRECategory>(
    payload.id ? `/dre/categories/${payload.id}` : "/dre/categories",
    { method: payload.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function getDREDrill(params: { year: number; month: number; dreCategoryId?: string | null }) {
  const qs: Record<string, string> = { year: String(params.year), month: String(params.month) };
  if (params.dreCategoryId) qs.dreCategoryId = params.dreCategoryId;
  return request<Array<{
    installmentId: string; purchaseId: string; purchaseDate: string;
    supplierName: string; invoiceNumber: string | null; purchaseNumber: string | null;
    expenseType: string; installment: number | null;
    dueDate: string | null; paidDate: string | null;
    amount: number; paidAmount: number | null; effectiveAmount: number;
    status: string; dreCategoryId: string | null; dreCategoryName: string;
  }>>(`/dre/expense-drill${toQueryString(qs)}`);
}

export function assignDRECategory(installmentId: string, dreCategoryId: string | null) {
  return request<{ ok: boolean }>(`/dre/installment/${installmentId}/category`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dreCategoryId })
  });
}

export type DREPendingRow = {
  installmentId: string;
  purchaseId: string;
  purchaseDate: string;
  supplierName: string;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  purchaseNumber: string | null;
  dueDate: string | null;
  paidDate: string | null;
  amount: number;
  effectiveAmount: number;
  status: string;
  expenseType: string;
  includedInCmv: boolean;
  origin: "cmv_purchase" | "operational";
  classificationRisk: string | null;
  suggestedCategoryName: string | null;
};

export type DREPendingResult = {
  total: number;
  totalAmount: number;
  page: number;
  perPage: number;
  rows: DREPendingRow[];
};

export function getDREPending(
  params: ({ year: number; month: number } | { from: string; to: string }) & {
    search?: string;
    sort?: "amount_desc" | "amount_asc" | "date_desc" | "date_asc";
    type?: "operational" | "cmv" | "all";
    page?: number;
    perPage?: number;
  }
) {
  const qs: Record<string, string> = {};
  if ("year" in params) {
    qs.year = String(params.year);
    qs.month = String(params.month);
  } else {
    qs.from = params.from;
    qs.to = params.to;
  }
  if (params.search) qs.search = params.search;
  if (params.sort) qs.sort = params.sort;
  if (params.type) qs.type = params.type;
  if (params.page) qs.page = String(params.page);
  if (params.perPage) qs.perPage = String(params.perPage);
  return request<DREPendingResult>(`/dre/pending${toQueryString(qs)}`, undefined, DRE_TIMEOUT_MS);
}

export function bulkAssignDRECategory(installmentIds: string[], dreCategoryId: string | null, allowCmvItems = false) {
  return request<{ ok: boolean; updated: number }>("/dre/installments/bulk-category", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installmentIds, dreCategoryId, allowCmvItems }),
  });
}

export function downloadDrePdf(
  params: { year: number; month: number } | { from: string; to: string }
) {
  let qs: Record<string, string>;
  let filename: string;
  if ("year" in params) {
    qs = { year: String(params.year), month: String(params.month) };
    filename = `dre-gerencial-${params.year}-${String(params.month).padStart(2, "0")}.pdf`;
  } else {
    qs = { from: params.from, to: params.to };
    filename = `dre-gerencial-${params.from}-${params.to}.pdf`;
  }
  return download(`/dre/export/pdf${toQueryString(qs)}`, filename, DRE_TIMEOUT_MS);
}

export function getMenuFavorites() {
  return request<string[]>("/auth/menu-favorites");
}

export function addMenuFavorite(menuKey: string) {
  return request<{ ok: boolean }>(`/auth/menu-favorites/${encodeURIComponent(menuKey)}`, { method: "POST" });
}

export function removeMenuFavorite(menuKey: string) {
  return request<{ ok: boolean }>(`/auth/menu-favorites/${encodeURIComponent(menuKey)}`, {
    method: "DELETE"
  });
}

export function updateMenuFavoritesOrder(menuKeys: string[]) {
  return request<{ ok: boolean }>("/auth/menu-favorites/order", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menuKeys })
  });
}

// ─── Companies ───────────────────────────────────────────────────────────────

export type Company = {
  id: string;
  code: string;
  tradeName: string;
  legalName: string;
  cnpj: string;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  financialEmail: string | null;
  phone: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  isActive: boolean;
  activeBankAccountCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type CompanyBankAccount = {
  id: string;
  companyId: string;
  companyTradeName?: string;
  companyCode?: string;
  bankName: string | null;
  agency: string | null;
  account: string | null;
  accountDigit: string | null;
  accountType: "CONTA_CORRENTE" | "POUPANCA" | "CAIXA" | "CARTEIRA" | "CARTAO" | "OUTROS";
  pixKey: string | null;
  name: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export function getCompanies(params: { search?: string; includeInactive?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.includeInactive) qs.set("includeInactive", "true");
  return request<Company[]>(`/companies${qs.toString() ? `?${qs}` : ""}`);
}

export function getCompany(id: string) {
  return request<Company>(`/companies/${id}`);
}

export function saveCompany(payload: Partial<Company> & { tradeName: string; legalName: string; cnpj: string }) {
  if (payload.id) {
    return request<Company>(`/companies/${payload.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  return request<Company>("/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setCompanyStatus(id: string, isActive: boolean) {
  return request<Company>(`/companies/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function getCompanyBankAccounts(companyId: string, includeInactive = false) {
  return request<CompanyBankAccount[]>(`/companies/${companyId}/bank-accounts${includeInactive ? "?includeInactive=true" : ""}`);
}

export function getAllBankAccounts(companyId?: string) {
  const qs = companyId ? `?companyId=${companyId}` : "";
  return request<CompanyBankAccount[]>(`/companies/bank-accounts/all${qs}`);
}

export function saveCompanyBankAccount(companyId: string, payload: Partial<CompanyBankAccount> & { name: string }) {
  if (payload.id) {
    return request<CompanyBankAccount>(`/companies/${companyId}/bank-accounts/${payload.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  return request<CompanyBankAccount>(`/companies/${companyId}/bank-accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setCompanyBankAccountStatus(companyId: string, accountId: string, isActive: boolean) {
  return request<CompanyBankAccount>(`/companies/${companyId}/bank-accounts/${accountId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export type DRESummary = {
  period: { from: string; to: string };
  revenue: {
    byChannel: Record<string, number>;
    grossAmount: number;
    discounts: number;
    platformFees: number;
    deductions: number;
    netAmount: number;
    serviceAmount: number;
    tickets: number;
  };
  cmv: {
    estoqueInicial: number;
    compras: number;
    estoqueFinal: number;
    cmvReal: number;
    cmvPercent: number | null;
    hasInventoryData: boolean;
    warning: string | null;
  };
  lucroBruto: number;
  margemBruta: number | null;
  expenses: DREExpenseLine[];
  expenseGroups: DREExpenseGroup[];
  totalExpenses: number;
  ebitda: number;
  ebitdaPercent: number | null;
};

// ── Supplier Billing Cycles ───────────────────────────────────────────────────

export type SupplierCycle = {
  id: string;
  supplierId: string;
  supplierName: string;
  periodStart: string;
  periodEnd: string | null;
  status: "OPEN" | "CHECKED" | "CLOSED" | "PAID" | "CANCELLED";
  totalAmount: string;
  generatedPurchaseId: string | null;
  itemCount: number;
  checkedCount: number;
  hasDivergence: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SupplierCycleItem = {
  id: string;
  purchaseId: string;
  amount: string;
  purchaseDate: string;
  invoiceNumber: string | null;
  checked: boolean;
  hasDivergence: boolean;
  divergenceAmount: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseNumber: string | null;
  purchaseStatus: string;
  purchaseTotalAmount: string;
};

export type SupplierCycleInstallment = {
  id: string;
  installment: number;
  amount: string;
  dueDate: string;
  status: string;
  sourceType: string;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paidDate: string | null;
  paidAmount: string | null;
};

export type SupplierCycleDetail = SupplierCycle & {
  notes: string | null;
  createdByUserId: string | null;
  checkedByUserId: string | null;
  closedByUserId: string | null;
  checkedAt: string | null;
  closedAt: string | null;
  items: SupplierCycleItem[];
  installments: SupplierCycleInstallment[];
};

export function getSupplierCycles(params?: { supplierId?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.supplierId) qs.set("supplierId", params.supplierId);
  if (params?.status) qs.set("status", params.status);
  const q = qs.toString();
  return request<SupplierCycle[]>(`/supplier-cycles${q ? `?${q}` : ""}`);
}

export function getSupplierCycle(id: string) {
  return request<SupplierCycleDetail>(`/supplier-cycles/${id}`);
}

export function checkSupplierCycleItem(cycleId: string, payload: {
  itemId: string;
  checked: boolean;
  hasDivergence?: boolean;
  divergenceAmount?: number | null;
  notes?: string | null;
}) {
  return request<{ cycleStatus: string; allChecked: boolean; itemCount: number; checkedCount: number }>(
    `/supplier-cycles/${cycleId}/check-item`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function closeSupplierCycle(cycleId: string, payload: {
  paymentMethodId: string;
  installmentCount: 1 | 2;
  firstDueDate: string;
  secondDueDate?: string;
  notes?: string;
}) {
  return request<{ cycleId: string; status: string; generatedPurchaseId: string; purchaseNumber: string; totalAmount: number; installmentCount: number }>(
    `/supplier-cycles/${cycleId}/close`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

// ─── Tax Payments ─────────────────────────────────────────────────────────────

export type TaxPaymentStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT";
export type TaxPaymentSource = "MANUAL" | "IMPORT_XLSX";

export type TaxPayment = {
  id: string;
  companyId: string | null;
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  documentType: string;
  description: string | null;
  competenceDate: string | null;
  dueDate: string;
  amount: string;
  paymentDate: string | null;
  paidAmount: string | null;
  status: TaxPaymentStatus;
  comments: string | null;
  source: TaxPaymentSource;
  importBatchId: string | null;
  dreCategoryId: string | null;
  dreCategoryName: string | null;
  createdById: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaxPaymentDetail = TaxPayment & {
  company: { id: string; tradeName: string; legalName: string; cnpj: string } | null;
  dreCategory: { id: string; name: string; dreGroup: string } | null;
};

export type TaxPaymentSummary = {
  total: string;
  paid: string;
  pending: string;
  overdue: string;
  withoutReceipt: string;
};

export type TaxPaymentListResponse = {
  data: TaxPayment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: TaxPaymentSummary;
};

export type TaxPaymentFilters = {
  companyId?: string;
  cnpj?: string;
  documentType?: string;
  status?: string;
  competenceStart?: string;
  competenceEnd?: string;
  dueStart?: string;
  dueEnd?: string;
  paymentStart?: string;
  paymentEnd?: string;
  search?: string;
  dreCategoryId?: string;
  page?: number;
  pageSize?: number;
};

export type TaxImportPreviewRow = {
  cnpj: string | null;
  legalName: string | null;
  tradeName: string | null;
  documentType: string | null;
  description: string | null;
  competenceDate: string | null;
  dueDate: string | null;
  amount: number | null;
  paymentDate: string | null;
  comments: string | null;
  rowIndex: number;
  valid: boolean;
  errors: string[];
  isDuplicate: boolean;
  dedupKey: string | null;
};

export type TaxImportPreview = {
  importFileId: string;
  filePath: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  pendingRows: number;
  paidRows: number;
  rows: TaxImportPreviewRow[];
  byCompany: Record<string, { legalName: string | null; tradeName: string | null; count: number; total: number }>;
  byDocumentType: Record<string, { count: number; total: number }>;
};

export function getTaxPayments(filters: TaxPaymentFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== "") params.set(k, String(v));
  }
  return request<TaxPaymentListResponse>(`/tax-payments?${params}`);
}

export function getTaxPayment(id: string) {
  return request<TaxPaymentDetail>(`/tax-payments/${id}`);
}

export function createTaxPayment(payload: Omit<Partial<TaxPayment>, "id" | "createdAt" | "updatedAt" | "dreCategoryName" | "attachmentCount">) {
  return request<TaxPayment>("/tax-payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateTaxPayment(id: string, payload: Partial<TaxPayment>) {
  return request<TaxPayment>(`/tax-payments/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteTaxPayment(id: string) {
  return request<{ ok: boolean }>(`/tax-payments/${id}`, { method: "DELETE" });
}

export async function previewTaxImportXlsx(file: File): Promise<TaxImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  const token = sessionStorage.getItem("pateo_session_token");
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const candidates = [`${API_BASE_URL}/tax-payments/import-xlsx/preview`];
  if (API_BASE_URL.startsWith("/")) candidates.push(`${BACKEND_TARGET_URL}/tax-payments/import-xlsx/preview`);
  for (const url of candidates) {
    const resp = await fetch(url, { method: "POST", headers, body: formData });
    if (resp.ok) return resp.json() as Promise<TaxImportPreview>;
    const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
    throw new ApiError(body?.message as string ?? `Erro ${resp.status}`, resp.status, body ?? undefined);
  }
  throw new Error("Backend não encontrado.");
}

export function confirmTaxImport(filePath: string, skipDuplicates = true) {
  return request<{ importBatchId: string; imported: number; skipped: number; total: number }>(
    "/tax-payments/import-xlsx/confirm",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath, skipDuplicates }) }
  );
}

