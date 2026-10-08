export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";
export const BACKEND_TARGET_URL = import.meta.env.VITE_BACKEND_TARGET_URL ?? "http://127.0.0.1:3334";
const FALLBACK_BACKEND_URL = BACKEND_TARGET_URL;
const REQUEST_TIMEOUT_MS = 60000;
const IMPORT_REQUEST_TIMEOUT_MS = 120000;
const SESSION_TOKEN_KEY = "pateo_session_token";
const NETWORK_ERROR_MESSAGE = "Não foi possível conectar ao servidor. Tente novamente em instantes.";
const NETWORK_IMPORT_ERROR_MESSAGE = "Nao foi possivel gerar o preview porque o backend nao respondeu. Verifique a conexao com a API e tente novamente.";
const TIMEOUT_ERROR_MESSAGE = "A requisicao demorou demais para responder. Tente novamente.";
const TIMEOUT_IMPORT_ERROR_MESSAGE = "A geracao do preview demorou demais para responder. Tente novamente.";

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

function isNetworkFailureMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "failed to fetch"
    || normalized.includes("networkerror")
    || normalized.includes("load failed")
    || normalized.includes("fetch failed")
    || normalized.includes("backend nao encontrado");
}

function isTimeoutError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function normalizeRequestError(error: unknown, path: string) {
  if (isTimeoutError(error)) {
    return new Error(path.startsWith("/imports/")
      ? TIMEOUT_IMPORT_ERROR_MESSAGE
      : TIMEOUT_ERROR_MESSAGE);
  }

  if (error instanceof Error && isNetworkFailureMessage(error.message)) {
    return new Error(path.startsWith("/imports/")
      ? NETWORK_IMPORT_ERROR_MESSAGE
      : NETWORK_ERROR_MESSAGE);
  }

  return error instanceof Error ? error : new Error(NETWORK_ERROR_MESSAGE);
}

function shouldKeepPreviousError(previous: Error | null, next: Error) {
  if (!previous) return false;
  if (isTimeoutError(next)) return !isTimeoutError(previous);
  if (!isNetworkFailureMessage(next.message)) return false;
  return !isNetworkFailureMessage(previous.message);
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

// aoResponder: só para quem precisa ler cabeçalho da resposta bem-sucedida (ex.: X-Payables-Truncado).
async function request<T>(path: string, options?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS, aoResponder?: (response: Response) => void): Promise<T> {
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
        aoResponder?.(response);
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
      const normalizedError = normalizeRequestError(error, path);
      if (!shouldKeepPreviousError(lastError, normalizedError)) {
        lastError = normalizedError;
      }
      const shouldFallback = index === 0 && API_BASE_URL.startsWith("/") && candidates.length > 1;
      if (shouldFallback) continue;
      break;
    }
  }

  throw lastError ?? new Error(NETWORK_ERROR_MESSAGE);
}

async function fetchBlob(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Blob> {
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

  return response.blob();
}

async function download(path: string, filename: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const blob = await fetchBlob(path, timeoutMs);
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
  companyId?: string | null;
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
  summary?: {
    inseridos: number;
    atualizados: number;
    erros: Array<{ linha: number; motivo: string }>;
  };
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
  source: string | null;
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
  peopleServed?: number | null;
  repiqueAmount?: string | number;
  salesFirstShift?: string | number;
  ticketsFirstShift?: number;
  peopleFirstShift?: number | null;
  salesSecondShift?: string | number;
  ticketsSecondShift?: number;
  peopleSecondShift?: number | null;
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
  shift1Cash?: string | number;
  shift1Pix?: string | number;
  shift1Card?: string | number;
  shift1Ticket?: string | number;
  shift1Service?: string | number;
  shift1Tcs?: string | number;
  shift2Cash?: string | number;
  shift2Pix?: string | number;
  shift2Card?: string | number;
  shift2Ticket?: string | number;
  shift2Service?: string | number;
  shift2Tcs?: string | number;
  tcsAmount?: string | number;
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
  views: {
    accounting: {
      key: "accounting";
      label: string;
      purchasesValue: number;
      realCmvValue: number;
      cmvPercent: number | null;
      estimatedGrossMargin: number | null;
    };
    managerial: {
      key: "managerial";
      label: string;
      purchasesValue: number;
      realCmvValue: number;
      cmvPercent: number | null;
      estimatedGrossMargin: number | null;
    };
  };
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

export type CmvSessionOption = {
  sessionId: string;
  code: string;
  type: string;
  source: string;
  referenceDate: string;
  periodMonth: number | null;
  periodYear: number | null;
  isMonthEnd: boolean;
  totalItems: number;
  linkedSnapshotId: string | null;
  snapshotTotalValue: number | null;
  notes: string | null;
};

export type StockBase = {
  id: string;
  sourceType: "SESSION" | "SNAPSHOT";
  code: string;
  label: string;
  inventoryType: string;
  totalItems: number;
  origin: "MANUAL" | "SISTEMA" | "PLANILHA";
  date: string;
  snapshotId: string | null;
  status: string;
  competenceYear: number | null;
  competenceMonth: number | null;
  displayLabel: string;
  isMonthEnd: boolean;
  snapshotTotal: number | null;
  originalFileName: string | null;
};

export type CoverageMissingProduct = {
  id: string;
  code: string | null;
  name: string;
  sector: string | null;
  category: string | null;
  unit: string | null;
};

export type StockCoverageAudit = {
  expectedTotal: number;
  coveredTotal: number;
  missingTotal: number;
  duplicateTotal: number;
  sectorMismatchTotal: number;
  coveragePercent: number;
  isComplete: boolean;
  missingSectors: string[];
  missingProducts: CoverageMissingProduct[];
  duplicateProducts: Array<{ productId: string; name: string; sessions: string[] }>;
  sectorMismatches: Array<{ productId: string; name: string; catalogSector: string | null; countedSector: string | null; sessionCode: string }>;
};

export type CmvPeriod = {
  id: string;
  code: string | null;
  name: string;
  dataInicial: string;
  dataFinal: string;
  estoqueInicialSnapshotId: string | null;
  estoqueFinalSnapshotId: string | null;
  estoqueInicialSessionId: string | null;
  estoqueFinalSessionId: string | null;
  estoqueInicialSnapshotData: string | null;
  estoqueFinalSnapshotData: string | null;
  estoqueInicialSessionCode: string | null;
  estoqueFinalSessionCode: string | null;
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
  views: {
    accounting: {
      key: "accounting";
      label: string;
      comprasTotal: number;
      purchasesCount: number;
      faturamentoTotal: number;
      estoqueInicialTotal: number;
      estoqueFinalTotal: number;
      cmvReal: number;
      cmvPercentual: number | null;
      margemBruta: number | null;
    };
    managerial: {
      key: "managerial";
      label: string;
      comprasTotal: number;
      purchasesCount: number;
      faturamentoTotal: number;
      estoqueInicialTotal: number;
      estoqueFinalTotal: number;
      cmvReal: number;
      cmvPercentual: number | null;
      margemBruta: number | null;
    };
  };
};

export type CmvWarningCode =
  | "PERIOD_CROSSES_MONTHS"
  | "SNAPSHOT_DATE_MISMATCH"
  | "IFOOD_ZERO_WITH_ACTIVE_CREDENTIAL"
  | "NOVENTA_NOVE_ZERO_WITH_ACTIVE_CREDENTIAL"
  | "CLOSED_TOTALS_DIVERGED"
  | "CLOSED_DETAIL_UNAVAILABLE";

export type CmvWarning = {
  code: CmvWarningCode;
  severity: "info" | "warning";
  message: string;
  detail?: Record<string, unknown>;
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
  viewDetails: {
    accounting: {
      purchasesGrossTotal: number;
      purchasesCount: number;
      purchaseByCategory: Array<{ categoryName: string; totalAmount: number; itemsCount: number }>;
      purchaseBySupplier: Array<{ supplierId: string; supplierName: string; supplierDocument: string | null; totalAmount: number; purchasesCount: number }>;
    };
    managerial: {
      purchasesGrossTotal: number;
      purchasesCount: number;
      purchaseByCategory: Array<{ categoryName: string; totalAmount: number; itemsCount: number }>;
      purchaseBySupplier: Array<{ supplierId: string; supplierName: string; supplierDocument: string | null; totalAmount: number; purchasesCount: number }>;
    };
  };
  warnings: CmvWarning[];
};

export type CmvRealSuggestions = {
  suggestedStartDate: string;
  suggestedInitialSnapshotId: string | null;
  suggestedInitialSessionId: string | null;
  continuityLocked: boolean;
  latestPeriod: {
    id: string;
    dataInicial: string;
    dataFinal: string;
    status: "OPEN" | "CLOSED";
    estoqueFinalSnapshotId: string | null;
    estoqueFinalSessionId: string | null;
  } | null;
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
  requiredInMonthlyClosing?: boolean;
  expectedClosingFrequency?: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  closingChecklistGroup?: string | null;
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
  receivedAt?: string | null;
  competenceMonth: number;
  competenceYear: number;
  invoiceNumber: string | null;
  noInvoiceReason?: string | null;
  rawSupplierCode: string | null;
  paymentMethod: string | null;
  paymentMethodId: string | null;
  creditCardId?: string | null;
  /** Funcionario que pagou do proprio bolso; a compra vai para o reembolso dele. */
  reimbursementPayeeId?: string | null;
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
  receivedAt?: string | null;
  invoiceNumber?: string | null;
  purchaseOrderNumber?: string | null;
  noInvoiceReason?: string | null;
  rawSupplierCode?: string | null;
  /** Rótulo de origem do lançamento (ex.: "doc-intake:nota.pdf"). Só descritivo. */
  sourceFile?: string | null;
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
  companyId?: string | null;
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
  sourceType?: "DIRECT" | "CARD_STATEMENT" | "LEGACY_CREDIT_CARD" | "SUPPLIER_CYCLE" | "TAX_PAYMENT" | "PAYROLL" | "EXTRA" | string | null;
  status: "OPEN" | "PAID" | "PAID_LATE" | "OVERDUE" | "CANCELLED" | string;
  rawValue: string | null;
  supplierId: string | null;
  supplierName: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  purchaseDate: string | null;
  /** Empresa em que o título foi lançado (compra: empresa faturada; folha: empresa do funcionário). */
  companyId?: string | null;
  notes: string | null;
  // Campos exclusivos de TaxPayment (presentes quando sourceType === "TAX_PAYMENT")
  taxDocumentType?: string | null;
  taxDescription?: string | null;
  taxCompanyName?: string | null;
  taxCnpj?: string | null;
  taxCompetenceDate?: string | null;
  taxDreCategoryName?: string | null;
  /** Folha: salário de quem tem salário combinado (só para quem pode ver salários). */
  salarioComposicao?: SalarioComposicao | null;
  /** Título do lote de pagamento da folha (sourceType FOLHA_LOTE): CNPJ, SEM_REGISTRO ou A_PARTE. */
  folhaLoteGrupo?: string | null;
  /** Título do lote: as pessoas dentro dele (o valor do título é a soma). */
  loteMembros?: MembroFolhaLote[] | null;
};

export type MembroFolhaLote = {
  id: string;
  employeeId: string;
  nome: string;
  valor: string | number;
  /** Na folha à parte: o título da empresa de onde a pessoa saiu. */
  origem: string | null;
  pago: boolean;
  /** Rótulo do tipo, como na folha solta: "Salário" (CLT) ou "Salário (acerto)" (sem registro). */
  tipo?: string | null;
};

export type SalarioComposicao = {
  tipo: "SALARIO_COMBINADO" | "PENDENTE_GORJETA";
  liquidoExtrato: number;
  complemento: number;
  total: number;
  combinado: number | null;
  adiantamento: number | null;
  gorjetaIntegral: number | null;
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
  clientRequestId?: string;
  date: string;
  shift: string;
  reason: string;
  reasonNotes?: string | null;
  sectorId?: string | null;
  notes?: string | null;
  items: Array<{ productId: string; quantity: number; unit: string }>;
};

export function getRequisitions(filters?: { startDate?: string; endDate?: string; sectorId?: string; shift?: string; clientRequestId?: string }) {
  return request<InventoryRequisition[]>(`/inventory/requisitions${toQueryString(filters)}`, undefined, 30_000);
}

export function getRequisition(id: string) {
  return request<InventoryRequisition>(`/inventory/requisitions/${id}`);
}

export function createRequisition(payload: CreateRequisitionPayload) {
  return request<InventoryRequisition>("/inventory/requisitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, 45_000);
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

export type StockCountSessionType = "GERAL" | "SETORIAL" | "CATEGORIA" | "SUBCATEGORIA" | "FINAL_MES" | "ALEATORIA" | "TAREFA" | "IMPORTACAO_PLANILHA" | "COMPLEMENTAR_CMV" | "RECONTAGEM";
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
  generatedInventoryStatus?: string | null;
  source: string | null;
  linkedSnapshotId: string | null;
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
  // Rotina do estoquista: setor ativo que o dia representa (null = nao abre
  // sessao) e a sessao de contagem que cumpre o dia. O status vem dela.
  activeSectorId?: string | null;
  activeSectorName?: string | null;
  sessionId?: string | null;
  sessionCode?: string | null;
  sessionStatus?: StockCountSessionStatus | null;
  routineStatus?: InventoryRoutineStatus;
};

export type InventoryRoutineStatus = "FEITA" | "EM_ANDAMENTO" | "ATRASADA" | "HOJE" | "PREVISTA";

export type InventoryAgendaWeek = {
  from: string;
  to: string;
  items: InventoryAgendaItem[];
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
  effectiveCountDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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
  /** Valor da base oficial (CMV) gerada por este inventario, quando viva. */
  snapshotTotalValue?: number | null;
};

export type OperationalInventoryDetail = OperationalInventory & {
  items: OperationalInventoryItem[];
};

/** Da mais grave para a menos grave. Regras em backend/src/modules/inventory/conferencia.ts. */
export type ClasseConferencia =
  | "IMPOSSIVEL"
  | "ZERADO_SUSPEITO"
  | "FORA_DO_HISTORICO"
  | "SEM_REFERENCIA"
  | "PENDENTE"
  | "COERENTE";

export type ItemDaConferencia = {
  itemId: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  unit: string | null;
  contado: number | null;
  contadoPor: string | null;
  contadoEm: string | null;
  anterior: number | null;
  anteriorData: string | null;
  anteriorCodigo: string | null;
  compras: number;
  disponivel: number | null;
  consumo: number | null;
  custoUnitario: number | null;
  /** De onde veio o custo (o mesmo que vai para o CMV). `null` = sistema nao achou nenhum. */
  custoFonte: FonteDoCusto | null;
  /** "compra de 14/08/2026", "base de 08/2026", "informado por ..." */
  custoDetalhe: string | null;
  impacto: number | null;
  classe: ClasseConferencia;
  motivo: string;
  /** Contou em unidades um produto de embalagem: o valor provavel, em embalagens. */
  sugestao?: { quantidade: number; embalagem: number };
  /** Marcado por quem revisa. `null` = ainda nao conferido. */
  conferido: { motivo: MotivoDeConferencia; observacao: string | null; em: string | null; por: string | null } | null;
  /** Contagem de recontagem que inclui este item. */
  recontagemId: string | null;
};

export type MotivoDeConferencia = "CORRETO" | "COMPRA_NAO_LANCADA" | "ERRO_DE_UNIDADE" | "CORRIGIDO" | "OUTRO" | "RECONTAR";

export type RecontagemDaConferencia = {
  id: string;
  code: string;
  status: string;
  aplicada: boolean;
  itens: number;
  contados: number;
  createdAt: string;
};

export type NotaDoItemDaConferencia = {
  purchaseId: string;
  numero: string | null;
  notaFiscal: string | null;
  fornecedor: string | null;
  data: string;
  quantidade: number;
  unidade: string | null;
  quantidadeConvertida: number | null;
  unidadeConvertida: string | null;
  valor: number | null;
};

export type ConferenciaDoInventario = {
  inventoryId: string;
  code: string;
  resumo: Record<ClasseConferencia, { itens: number; impacto: number }>;
  itens: ItemDaConferencia[];
  /** A partir deste valor (R$) o alerta precisa ser conferido para aprovar. */
  limiteDeConferencia: number;
  pendentesParaAprovar: number;
  recontagens: RecontagemDaConferencia[];
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

export type BuyerSupportPriceOption = {
  supplierId: string;
  supplierName: string;
  bestUnitPrice: number;
  bestPriceDate: string;
  lastUnitPrice: number;
  lastPurchaseDate: string;
  purchaseCount: number;
  unit: string | null;
  conversionMissing: boolean;
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
  purchaseUnit: string | null;
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
  // Etapa 1 — inteligencia de preco por fornecedor (24 meses)
  supplierPriceOptions: BuyerSupportPriceOption[];
  bestPriceSupplierId: string | null;
  bestPriceSupplierName: string | null;
  bestUnitPrice: number | null;
  bestPriceDate: string | null;
  lastPurchaseSupplierId: string | null;
  lastPurchaseSupplierName: string | null;
  lastUnitPrice: number | null;
  lastPurchaseDate: string | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  hasCheaperAlternative: boolean;
  priceComparisonNote: string | null;
  conversionMissing: boolean;
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
    // Etapa 2 — origem efetivamente usada neste relatorio (inventario/contagem especifico ou default)
    source: {
      sourceType: string;
      sourceId: string | null;
      code: string | null;
      status: string | null;
      type: string | null;
      date: string | null;
      totalItems: number;
      partial: boolean;
      scopeLabel: string | null;
      note: string | null;
      purpose: string;
      canUseForBuyer: boolean;
    };
  };
  supplierGroups: BuyerSupportSupplierGroup[];
  prelist: BuyerSupportSupplierGroup[];
  items: BuyerSupportItem[];
};

export type BuyerSupportFilters = {
  search?: string;
  supplier?: string;
  sector?: string;
  category?: string;
  subcategory?: string;
  status?: string;
  sourceType?: string;
  sourceId?: string;
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
  source: "MANUAL" | "PRE_LISTA_COMPRADOR" | "PLANEJAMENTO_COMPRA";
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
  // Totais do periodo inteiro, para o percentual de cada linha nao ser calculado
  // sobre o top 10 exibido. `unitemizedTotal` e o quanto as notas cobram alem do
  // que os itens explicam — aparece como a linha "Sem itemização" em byCategory.
  bySupplierTotal?: number;
  byCategoryTotal?: number;
  byProductTotal?: number;
  unitemizedTotal?: number;
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
  }, IMPORT_REQUEST_TIMEOUT_MS);
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
  }, IMPORT_REQUEST_TIMEOUT_MS);
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
  }, IMPORT_REQUEST_TIMEOUT_MS);
}

export function confirmCatalogImport(
  kind: CatalogImportKind,
  payload: {
    importFileId: string;
    originalFileName?: string | null;
    sheetName?: string | null;
  }
) {
  return request<CatalogImportReport>(`/imports/${kind}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, IMPORT_REQUEST_TIMEOUT_MS);
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

/** Igual a getPayables, mas diz se o backend cortou a lista no limite de segurança (cabeçalho X-Payables-Truncado). */
export async function getPayablesComLimite(filters?: Parameters<typeof getPayables>[0]): Promise<{ titulos: Payable[]; truncado: boolean }> {
  let truncado = false;
  const titulos = await request<Payable[]>(`/purchases/payables${toQueryString(filters)}`, undefined, REQUEST_TIMEOUT_MS, (response) => {
    const valor = response.headers.get("X-Payables-Truncado");
    truncado = valor !== null && valor !== "0" && valor.toLowerCase() !== "false";
  });
  return { titulos, truncado };
}

export function payTaxPayment(id: string, payload: { paymentDate: string; paidAmount: number; comments?: string | null }) {
  return request<{ id: string; status: string }>(`/tax-payments/${id}/pay`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function restoreTaxPayment(id: string) {
  return request<{ id: string; status: string }>(`/tax-payments/${id}/restore`, { method: "PATCH" });
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

export function downloadPurchaseOrderPdf(id: string, code: string) {
  return download(`/purchase-orders/${id}/pdf`, `pedido-${code}.pdf`);
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

export type SupplierEmployeeOption = {
  employeeId: string;
  name: string;
  position: string | null;
  isActive: boolean;
  draft: {
    name: string;
    document: string;
    phone: string;
    email: string;
    mainCategory: string;
    defaultFinancialNotes: string;
    notes: string;
  };
  existingSupplier: { id: string; name: string; isActive: boolean } | null;
};

export function getSupplierEmployeeOptions() {
  return request<SupplierEmployeeOption[]>("/suppliers/employee-options");
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

export type ProductListFilters = {
  search?: string;
  category?: string;
  subcategory?: string;
  sector?: string;
  controlsStock?: string;
  isActive?: string;
  semDreCategoria?: string;
  /** "sem-setor" | "sem-categoria" | "sem-subcategoria" | "sem-dre" */
  pendencia?: string;
  /** Sem page/pageSize a resposta vem completa — telas que montam autocomplete dependem disso. */
  page?: number;
  pageSize?: number;
};

export type ProductPage = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number | null;
  totalPages: number;
};

/**
 * Aceita tambem a resposta em array da versao anterior da API.
 *
 * Backend e frontend sobem separados, com minutos de diferenca: sem essa
 * tolerancia, a ordem do deploy quebraria as telas de Produtos, Estoque,
 * Compras e Requisicoes durante a janela — em qualquer das duas ordens.
 */
export async function getProducts(filters?: ProductListFilters): Promise<ProductPage> {
  const { page, pageSize, ...rest } = filters ?? {};
  const resposta = await request<ProductPage | Product[]>(`/products${toQueryString({
    ...rest,
    page: page == null ? undefined : String(page),
    pageSize: pageSize == null ? undefined : String(pageSize)
  })}`);

  if (Array.isArray(resposta)) {
    return { items: resposta, total: resposta.length, page: 1, pageSize: null, totalPages: 1 };
  }
  return resposta;
}

export type ProductSummary = {
  total: number;
  ativos: number;
  inativos: number;
  controlamEstoque: number;
  semDre: number;
  porCategoria: Array<{ label: string; value: number }>;
  porSetor: Array<{ label: string; value: number }>;
};

/** Totais calculados no banco: com pagina, somar o que esta na tela daria o total da pagina. */
export function getProductsSummary(filters?: Omit<ProductListFilters, "page" | "pageSize">) {
  return request<ProductSummary>(`/products/summary${toQueryString(filters)}`);
}

export function getProductHistory(id: string) {
  return request<ProductHistory>(`/products/${id}/history`);
}

export function getNextProductCode() {
  return request<{ code: string }>("/products/next-code");
}

export type ProductFormOptions = {
  categories: Category[];
  subcategories: Subcategory[];
  sectors: InventorySector[];
  units: UnitMeasure[];
  suppliers: Supplier[];
  dreCategories: DRECategory[];
  nextCode: string;
};

/**
 * Dados de apoio do formulario de produto numa chamada so, sob a permissao de
 * products. Montar isso com chamadas a master-data, suppliers e dre exigia
 * permissao nos quatro modulos para abrir uma tela de produto.
 */
export function getProductFormOptions() {
  return request<ProductFormOptions>("/products/form-options");
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

// Só linha avulsa (sem compra) em fatura aberta; linha de compra acompanha a compra.
export function deleteCardStatementItem(statementId: string, itemId: string) {
  return request<{ ok: boolean }>(`/cards/statements/${statementId}/items/${itemId}`, { method: "DELETE" });
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

export function reopenCardStatement(id: string) {
  return request<CreditCardStatementDetail>(`/cards/statements/${id}/reopen`, {
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

export function reallocateCardStatementItem(itemId: string, payload: { targetStatementId: string; reason: string }) {
  return request<{ item: CreditCardStatementItem; reason: string }>(`/cards/statements/items/${itemId}/reallocate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
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
    peopleServed: number;
    count: number;
    ticketAverage: number;
    ticketAveragePerTable: number;
    ticketAveragePerPerson: number;
    prev: {
      grossAmount: number;
      netAmount: number;
      serviceAmount: number;
      tickets: number;
      peopleServed: number;
      ticketAveragePerTable: number;
      ticketAveragePerPerson: number;
    };
    deltaPercent: number | null;
    deltaGrossPercent: number | null;
    deltaServicePercent: number | null;
    deltaTicketAvgPerTablePercent: number | null;
    deltaTicketAvgPerPersonPercent: number | null;
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
    views: {
      accounting: MonthlyCmv["views"]["accounting"];
      managerial: MonthlyCmv["views"]["managerial"];
    };
  };
  // Faturamento por dia do mês (competência), nos dois meses. Opcional porque um
  // backend anterior a este campo não o manda.
  revenueDaily?: {
    current: Array<{ day: number; grossAmount: number; netAmount: number; serviceAmount: number }>;
    previous: Array<{ day: number; grossAmount: number; netAmount: number; serviceAmount: number }>;
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
  // warning vem preenchido quando sobrou titulo ja pago na compra cancelada:
  // o dinheiro saiu e a despesa deixou o DRE, entao quem cancelou precisa ver.
  return request<{ id: string; status: string; installmentsPaidKept?: number; paidAmountKept?: number; warning?: string }>(`/purchases/${id}/cancel`, {
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
  categoryId?: string | null;
  subcategoryId?: string | null;
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

export type StockCountPlausibility = {
  itemId: string;
  median: number | null;
  maxCount: number | null;
  weakBaseline: boolean;
  erraticHistory: boolean;
  observations: number;
  purchasedEver: number | null;
};

export function getStockCountSessionPlausibility(id: string) {
  return request<StockCountPlausibility[]>(`/inventory/count-sessions/${id}/plausibility`);
}

/** Ultima contagem aprovada + compras desde entao, e o custo de cada item da contagem. */
export type ReferenciaDaContagem = {
  itemId: string;
  anterior: number | null;
  anteriorData: string | null;
  anteriorCodigo: string | null;
  compras: number;
  custoUnitario: number | null;
};

export function getReferenciaDaContagem(id: string) {
  return request<ReferenciaDaContagem[]>(`/inventory/count-sessions/${id}/referencia`);
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

export function reshapeStockCountSessionScope(payload: {
  id: string;
  type: "GERAL" | "SETORIAL" | "CATEGORIA" | "SUBCATEGORIA";
  sectorId?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  reason?: string | null;
}) {
  return request<StockCountSession>(`/inventory/count-sessions/${payload.id}/reshape-scope`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type,
      sectorId: payload.sectorId ?? null,
      categoryId: payload.categoryId ?? null,
      subcategoryId: payload.subcategoryId ?? null,
      reason: payload.reason ?? null
    })
  });
}

export function generateInventoryFromStockCountSession(id: string, notes?: string | null) {
  return request<OperationalInventory>(`/inventory/count-sessions/${id}/generate-inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes })
  });
}

export function consolidateMonthEndSessions(sessionIds: string[], notes?: string | null, allowIncomplete?: boolean) {
  return request<OperationalInventory>("/inventory/count-sessions/consolidate-month-end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionIds, notes, allowIncomplete: allowIncomplete === true })
  }, 120_000);
}

export function previewConsolidationCoverage(sessionIds: string[]) {
  return request<StockCoverageAudit>("/inventory/count-sessions/coverage-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionIds })
  });
}

export function getFinalCmvCoverage(inventoryId: string) {
  return request<StockCoverageAudit & { inventoryId: string; inventoryCode: string }>(`/inventory/final-cmv/${inventoryId}/coverage`);
}

export function createMissingCount(inventoryId: string) {
  return request<StockCountSession>(`/inventory/final-cmv/${inventoryId}/create-missing-count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
}

export function appendMissingCount(inventoryId: string, countSessionId: string) {
  return request<StockCoverageAudit & { inventoryId: string; inventoryCode: string; appendedItems: number }>(`/inventory/final-cmv/${inventoryId}/append-missing-count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countSessionId })
  });
}

export function getMonthEndStockCountSession(filters: { year: number; month: number }) {
  return request<StockCountSession | null>(`/inventory/count-sessions/month-end${toQueryString({ year: String(filters.year), month: String(filters.month) })}`);
}

export function getOpeningBasisStockCountSession(filters: { year: number; month: number }) {
  return request<StockCountSession | null>(`/inventory/count-sessions/opening-basis${toQueryString({ year: String(filters.year), month: String(filters.month) })}`);
}

export function getInventoryAgenda(filters: { year: string; month: string; hoje?: string }) {
  return request<InventoryAgenda>(`/inventory/agenda${toQueryString(filters)}`);
}

// `hoje` vem do navegador: o servidor roda em UTC e a noite ja estaria no dia seguinte.
export function getInventoryAgendaWeek(hoje: string) {
  return request<InventoryAgendaWeek>(`/inventory/agenda/week${toQueryString({ hoje })}`);
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
  effectiveCountDate?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
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

export type ItemDaPosicao = {
  productId: string;
  productCode: string | null;
  productName: string;
  unit: string | null;
  sectorName: string | null;
  categoryName: string | null;
  /** Ultima contagem aprovada. `null` = produto nunca contado num inventario aprovado. */
  quantidade: number | null;
  contadoEm: string | null;
  inventarioCodigo: string | null;
  /** Custo da base oficial daquele inventario. `null` = a base nao tem custo. */
  custoUnitario: number | null;
  valor: number | null;
  comprasDesde: number;
  valorComprasDesde: number;
};

export function getPosicaoDoEstoque() {
  return request<{ itens: ItemDaPosicao[] }>("/inventory/posicao");
}

export type FonteDoCusto = "COMPRAS_DO_PERIODO" | "ULTIMA_COMPRA" | "BASE_ANTERIOR" | "INFORMADO";

/** Custo informado a mao (so quando o sistema nao acha nenhum). `null` limpa. */
export function informarCustoDoItem(inventoryId: string, itemId: string, custo: string | null) {
  return request<{ ok: true }>(`/inventory/operational/${inventoryId}/items/${itemId}/custo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custo })
  });
}

export function marcarItemConferido(inventoryId: string, itemId: string, motivo: MotivoDeConferencia | null, observacao?: string) {
  return request<{ ok: true }>(`/inventory/operational/${inventoryId}/items/${itemId}/conferido`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo, observacao: observacao ?? "" })
  });
}

export function pedirRecontagem(inventoryId: string) {
  return request<StockCountSession>(`/inventory/operational/${inventoryId}/recontagem`, { method: "POST" });
}

export function aplicarRecontagem(inventoryId: string, sessionId: string) {
  return request<{ aplicados: number; alterados: number }>(`/inventory/operational/${inventoryId}/recontagem/${sessionId}/aplicar`, { method: "POST" });
}

export function getComprasDoItemDaConferencia(inventoryId: string, itemId: string) {
  return request<NotaDoItemDaConferencia[]>(`/inventory/operational/${inventoryId}/conferencia/${itemId}/compras`);
}

export function getConferenciaDoInventario(id: string) {
  return request<ConferenciaDoInventario>(`/inventory/operational/${id}/conferencia`);
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

// A aprovacao agora tambem reconcilia o estoque com o que foi contado, e devolve
// quantos itens foram ajustados para a tela poder dizer o que aconteceu.
export type StockReconciliation = {
  adjustedItems: number;
  totalDelta: number;
  // Saldo abaixo de zero apos o ajuste: sairam mais itens do que o contado
  // entre a contagem e a aprovacao. Nao e limitado a zero para nao mascarar.
  negativeBalances?: Array<{ produto: string; saldo: number }>;
} | null;

export function approveOperationalInventory(id: string) {
  return request<OperationalInventory & { reconciliacao?: StockReconciliation }>(
    `/inventory/operational/${id}/approve`,
    { method: "PATCH" }
  );
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

export function getBuyerSupportReport(filters?: BuyerSupportFilters) {
  return request<BuyerSupportReport>(`/inventory/operational/buyer-support${toQueryString(filters)}`);
}

export function downloadOperationalInventoryPdf(id: string, code?: string) {
  return download(`/inventory/operational/${id}/pdf`, `${code ?? "inventario"}.pdf`);
}

export function getStockCountSessionPdfBlob(id: string) {
  return fetchBlob(`/inventory/count-sessions/${id}/pdf`);
}

export function downloadStockCountSessionPdf(id: string, code?: string) {
  return download(`/inventory/count-sessions/${id}/pdf`, `${code ?? "contagem"}.pdf`);
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

export type PurchaseOrderFromPlanningItem = {
  productId: string;
  supplierId: string;
  requestedQuantity: number;
  purchaseModel?: string | null;
  unitSnapshot?: string | null;
  unitPriceEstimated?: number | null;
  notes?: string | null;
};

export type PurchaseOrderFromPlanningResult = {
  createdOrders: Array<{
    id: string;
    code: string;
    supplierId: string;
    supplierName: string;
    totalItems: number;
    totalEstimated: number;
    status: string;
  }>;
  skippedItems: Array<{ productId: string | null; reason: string }>;
};

export function createPurchaseOrdersFromPlanning(payload: {
  sourceType?: string;
  sourceId?: string | null;
  expectedDeliveryDate?: string | null;
  items: PurchaseOrderFromPlanningItem[];
}) {
  return request<PurchaseOrderFromPlanningResult>("/purchase-orders/from-planning", {
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


export type AchadoDoFechamento = {
  codigo: 'CADEIA_QUEBRADA' | 'ITEM_SEM_CUSTO' | 'CUSTO_FORA_DA_SERIE' | 'ITEM_CONCENTRADO' | 'TOTAL_FORA_DA_SERIE';
  severidade: 'BLOQUEIO' | 'ALERTA';
  titulo: string;
  detalhe: string;
  exemplos: Array<{ produto: string; numero: string }>;
};

export type VerificacaoDoFechamento = {
  competenceYear: number;
  competenceMonth: number;
  temInventarioFinal: boolean;
  podeAprovar: boolean;
  achados: AchadoDoFechamento[];
};

export function getVerificacaoDoFechamento(year: number, month: number) {
  return request<VerificacaoDoFechamento>(`/monthly/cmv/verificacao?year=${year}&month=${month}`);
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

export function getCmvRealSessions() {
  return request<CmvSessionOption[]>("/monthly/cmv-real/sessions");
}

export function getCmvRealBases() {
  return request<StockBase[]>("/monthly/cmv-real/bases");
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
  estoqueInicialSnapshotId?: string;
  estoqueFinalSnapshotId?: string;
  estoqueInicialSessionId?: string | null;
  estoqueFinalSessionId?: string | null;
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

// ============================================================================
// Painel de Fechamento Mensal (CMV v2 — 2026-07-15)
// ============================================================================

export type MonthlyClosureJustification = {
  blockKey: string;
  reason: string;
  justifiedByUserId: string;
  justifiedAt: string;
};

export type MonthlyClosureRequiredSupplier = {
  id: string;
  name: string;
  group: string;
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  appliesThisMonth: boolean;
  present: boolean;
  total: number;
  purchaseCount: number;
};

export type MonthlyClosureTax = {
  id: string;
  documentType: string;
  description: string | null;
  amount: number;
  dueDate: string;
  paymentDate: string | null;
  status: string;
};

export type MonthlyClosureFinalInventory =
  | { hasSnapshot: false }
  | { hasSnapshot: true; snapshotId: string; countDate: string; totalValue: number; totalItems: number };

export type MonthlyClosureCmvContribution = {
  cmvPeriodId: string;
  code: string | null;
  cycleStart: string;
  cycleEnd: string;
  cmvReal: number;
  daysInMonth: number;
  totalDays: number;
  contribution: number;
};

export type MonthlyClosureState = {
  competenceYear: number;
  competenceMonth: number;
  monthStart: string;
  monthEnd: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  closedByUserId: string | null;
  reopenReason: string | null;
  revenue: {
    salon: { grossAmount: number; netAmount: number; daysCount: number; entryCount: number };
    ifood: { grossAmount: number; count: number };
    noventaNove: { grossAmount: number; count: number };
    outrosDelivery: { grossAmount: number; count: number; plataformas: string[] };
    /** Total do mes, lido do razao. Nunca some as parcelas acima — elas saem dele. */
    total: { grossAmount: number; netAmount: number };
  };
  purchases: {
    total: number;
    count: number;
    byCategory: Array<{ categoryName: string; total: number; count: number }>;
  };
  requiredSuppliers: MonthlyClosureRequiredSupplier[];
  taxes: MonthlyClosureTax[];
  finalInventory: MonthlyClosureFinalInventory;
  cmvAttribution: { total: number; breakdown: MonthlyClosureCmvContribution[] };
  justifications: MonthlyClosureJustification[];
  summary: {
    pendingCount: number;
    pending: Array<{ key: string; label: string }>;
    canLock: boolean;
  };
};

export function getMonthlyClosure(year: number, month: number) {
  return request<MonthlyClosureState>(`/monthly-closure/${year}/${month}`);
}

export function justifyMonthlyClosureBlock(year: number, month: number, blockKey: string, reason: string) {
  return request<MonthlyClosureState>(`/monthly-closure/${year}/${month}/justify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockKey, reason }),
  });
}

export function removeMonthlyClosureJustification(year: number, month: number, blockKey: string) {
  return request<MonthlyClosureState>(`/monthly-closure/${year}/${month}/justify/${encodeURIComponent(blockKey)}`, {
    method: "DELETE",
  });
}

export function lockMonthlyClosure(year: number, month: number) {
  return request<MonthlyClosureState>(`/monthly-closure/${year}/${month}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function unlockMonthlyClosure(year: number, month: number, reason: string) {
  return request<MonthlyClosureState>(`/monthly-closure/${year}/${month}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
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

export function getCategories(search?: string, filters?: { sectorId?: string }) {
  return request<Category[]>(`/master-data/categories${toQueryString({ search, sectorId: filters?.sectorId })}`);
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
  /** Pratos ativos na categoria. */
  dishesCount?: number;
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
  /** null quando o produto nao tem custo medio no estoque. */
  unitCost: number | null;
  /** Quantos "productUnit" cabem em 1 unidade do item. */
  unitFactor: number | null;
  /** null quando falta conversao ou custo — o motivo vem em `issue`. */
  itemCost: number | null;
  issue: string | null;
  conversions: DishUnitConversion[];
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
  /** Quantas listagens ativas o prato tem nos canais (hoje, o cardapio da 99). */
  listingsCount: number;
  listingPriceMin: number | null;
  listingPriceMax: number | null;
  /** Custo do rendimento inteiro. */
  calculatedCost: number;
  /** Custo de uma porcao — e este que se compara com o preco de venda. */
  custoPorcao: number;
  margemBruta: number | null;
  cmvPercentual: number | null;
  /** true quando algum ingrediente ficou de fora por falta de conversao ou custo. */
  custoIncompleto: boolean;
};

export type DishListing = {
  id: string;
  channel: string;
  /** Apelido da loja na plataforma; null quando a listagem nao esta ligada a uma loja. */
  storeName: string | null;
  externalName: string;
  price: number;
  isActive: boolean;
  lastSeenAt: string;
};

export type DishDetail = Omit<DishListItem, "listingsCount" | "listingPriceMin" | "listingPriceMax"> & {
  notes: string | null;
  items: DishIngredient[];
  listings: DishListing[];
  createdAt: string;
  updatedAt: string;
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

export function reactivateDish(id: string) {
  return request<{ ok: boolean }>(`/dishes/${id}/reactivate`, { method: "POST" });
}

export type DishUnitConversion = {
  fromUnit: string;
  toUnit: string;
  factor: number;
};

export type DishProductSearchResult = {
  id: string;
  externalCode: string | null;
  name: string;
  /** Unidade em que o custo medio esta expresso. */
  unit: string | null;
  averageCost: number;
  conversions: DishUnitConversion[];
};

export function searchDishProducts(search: string) {
  return request<DishProductSearchResult[]>(`/dishes/products/search${toQueryString({ search })}`);
}

// ──────────────────────────────────────────────
// Plaquinhas do buffet
// ──────────────────────────────────────────────

export type PlateFormat = "std" | "tent" | "sauce";
export type PlateTheme = "wine" | "gold" | "white";
export type PlateListKind = "BUFFET" | "COFFEE_BREAK" | "EVENTO";

export type BuffetPlateItem = { id: string; namePt: string; nameEn: string; category: string; isActive: boolean };
export type BuffetPlateItemInput = { namePt: string; nameEn: string; category: string; isActive?: boolean };
/** format: formato só deste prato (ex.: molho numa lista de plaquinhas); sem valor, vale o da lista. */
export type BuffetPlateListEntry = { itemId: string; qty: number; format?: PlateFormat | null };
export type BuffetPlateListSummary = {
  id: string;
  name: string;
  kind: PlateListKind;
  eventDate: string | null;
  format: PlateFormat;
  theme: PlateTheme;
  itemCount: number;
  plateCount: number;
  updatedAt: string;
};
export type BuffetPlateList = BuffetPlateListSummary & { items: BuffetPlateListEntry[] };
export type BuffetPlateListInput = Pick<BuffetPlateList, "name" | "kind" | "eventDate" | "format" | "theme" | "items">;

const JSON_HEADERS = { "Content-Type": "application/json" };

export function getBuffetPlateItems(includeInactive = false) {
  return request<BuffetPlateItem[]>(`/buffet-plates/items${toQueryString({ includeInactive: includeInactive ? "true" : undefined })}`);
}

export function saveBuffetPlateItem(payload: BuffetPlateItemInput, id?: string) {
  return request<BuffetPlateItem>(id ? `/buffet-plates/items/${id}` : "/buffet-plates/items", {
    method: id ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
}

export function deactivateBuffetPlateItem(id: string) {
  return request<BuffetPlateItem>(`/buffet-plates/items/${id}`, { method: "DELETE" });
}

export function getBuffetPlateLists() {
  return request<BuffetPlateListSummary[]>("/buffet-plates/lists");
}

export function getBuffetPlateList(id: string) {
  return request<BuffetPlateList>(`/buffet-plates/lists/${id}`);
}

export function saveBuffetPlateList(payload: BuffetPlateListInput, id?: string) {
  return request<BuffetPlateListSummary>(id ? `/buffet-plates/lists/${id}` : "/buffet-plates/lists", {
    method: id ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
}

export function deleteBuffetPlateList(id: string) {
  return request<{ ok: boolean }>(`/buffet-plates/lists/${id}`, { method: "DELETE" });
}

// Cardápio do evento (display de acrílico, frente e verso)
export type MenuFace = "front" | "back";
/** qty: quantas vezes o prato sai na folha no "um display por prato" (1 se ausente). */
export type BuffetMenuItem = { namePt: string; nameEn: string; qty?: number };
export type BuffetMenuSection = { face: MenuFace; titlePt: string; titleEn: string; items: BuffetMenuItem[] };
export type BuffetMenuSummary = {
  id: string;
  name: string;
  eventDate: string | null;
  theme: PlateTheme;
  faceWidthMm: number;
  faceHeightMm: number;
  copies: number;
  /** "same": o mesmo cardápio em todos os displays. "perSection": cada seção é um display. "perItem": cada prato é um display. */
  layout: "same" | "perSection" | "perItem";
  sectionCount: number;
  itemCount: number;
  updatedAt: string;
};
export type BuffetMenu = BuffetMenuSummary & { sections: BuffetMenuSection[] };
export type BuffetMenuInput = Pick<BuffetMenu, "name" | "eventDate" | "theme" | "faceWidthMm" | "faceHeightMm" | "copies" | "layout" | "sections">;

export function getBuffetMenus() {
  return request<BuffetMenuSummary[]>("/buffet-plates/menus");
}

export function getBuffetMenu(id: string) {
  return request<BuffetMenu>(`/buffet-plates/menus/${id}`);
}

export function saveBuffetMenu(payload: BuffetMenuInput, id?: string) {
  return request<BuffetMenuSummary>(id ? `/buffet-plates/menus/${id}` : "/buffet-plates/menus", {
    method: id ? "PUT" : "POST", headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
}

export function deleteBuffetMenu(id: string) {
  return request<{ ok: boolean }>(`/buffet-plates/menus/${id}`, { method: "DELETE" });
}

// Impressões de plaquinhas: cada uma anota os pratos do dia para o acompanhamento.
export type BuffetPlatePrintInput = { servedOn: string; kind: PlateListKind; listId: string | null; listName: string | null; itemIds: string[] };
export type BuffetPlatePrint = { id: string; servedOn: string; kind: PlateListKind; listName: string | null; itemCount: number; createdAt: string };
export type BuffetUsageRow = { itemId: string; days: number; share: number; lastDay: string };
export type BuffetForgottenRow = { itemId: string; daysInHistory: number; lastDay: string; daysSince: number };
export type BuffetUsageReport = {
  period: { start: string; end: string; windowDays: number; servedDays: number };
  ranking: BuffetUsageRow[];
  staples: string[];
  repeating: string[];
  forgotten: BuffetForgottenRow[];
};

export function registerBuffetPlatePrint(payload: BuffetPlatePrintInput) {
  return request<{ id: string; servedOn: string; itemCount: number }>("/buffet-plates/prints", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
}

export function getBuffetPlatePrints(kind: PlateListKind) {
  return request<BuffetPlatePrint[]>(`/buffet-plates/prints${toQueryString({ kind })}`);
}

export function deleteBuffetPlatePrint(id: string) {
  return request<{ ok: boolean }>(`/buffet-plates/prints/${id}`, { method: "DELETE" });
}

export function getBuffetUsage(kind: PlateListKind, days: 7 | 30 | 90) {
  return request<BuffetUsageReport>(`/buffet-plates/usage${toQueryString({ kind, days: String(days) })}`);
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
    platformCommission: number;
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
    views: {
      accounting: {
        key: "accounting";
        label: string;
        compras: number;
        cmvReal: number;
        cmvPercent: number | null;
        lucroBruto: number;
        margemBruta: number | null;
        ebitda: number;
        ebitdaPercent: number | null;
      };
      managerial: {
        key: "managerial";
        label: string;
        compras: number;
        cmvReal: number;
        cmvPercent: number | null;
        lucroBruto: number;
        margemBruta: number | null;
        ebitda: number;
        ebitdaPercent: number | null;
      };
    };
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
  /** Só na criação: notas que o ciclo novo trouxe de outro ciclo aberto. */
  notasTrazidas?: Array<{ invoiceNumber: string | null; amount: number }>;
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
  cycleFirstDueDays: number | null;
  cycleSecondDueDays: number | null;
  createdByUserId: string | null;
  checkedByUserId: string | null;
  closedByUserId: string | null;
  checkedAt: string | null;
  closedAt: string | null;
  items: SupplierCycleItem[];
  installments: SupplierCycleInstallment[];
};

export type AvailablePurchaseForCycle = {
  id: string;
  purchaseNumber: string | null;
  purchaseDate: string;
  invoiceNumber: string | null;
  totalAmount: string;
  status: string;
  currentCycleId: string | null;
  currentCycleStatus: string | null;
  isOutsidePeriod: boolean;
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

export function createSupplierCycle(payload: {
  supplierId: string;
  startDate: string;
  endDate?: string;
  notes?: string;
}) {
  return request<SupplierCycle>(
    `/supplier-cycles`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function updateSupplierCycle(id: string, payload: {
  startDate?: string;
  endDate?: string;
  notes?: string;
}) {
  return request<{ id: string; periodStart: string; periodEnd: string | null; notes: string | null }>(
    `/supplier-cycles/${id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
}

export function getAvailablePurchasesForCycle(cycleId: string) {
  return request<AvailablePurchaseForCycle[]>(`/supplier-cycles/${cycleId}/available-purchases`);
}

export function addPurchaseToSupplierCycle(cycleId: string, purchaseId: string) {
  return request<{ success: boolean; purchaseId: string; cycleId: string }>(
    `/supplier-cycles/${cycleId}/purchases`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId }) }
  );
}

export function removePurchaseFromSupplierCycle(cycleId: string, purchaseId: string) {
  return request<{ success: boolean; purchaseId: string; cycleId: string }>(
    `/supplier-cycles/${cycleId}/purchases/${purchaseId}`,
    { method: "DELETE" }
  );
}

export function movePurchaseToSupplierCycle(sourceCycleId: string, purchaseId: string, targetCycleId: string) {
  return request<{ success: boolean; purchaseId: string; sourceCycleId: string; targetCycleId: string }>(
    `/supplier-cycles/${sourceCycleId}/purchases/${purchaseId}/move`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetCycleId }) }
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

export type AgileSyncStatus = {
  ultimaSyncEm: string | null;
  ultimoBatchId: string | null;
  ultimoPeriodoFim: string | null;
  diasImportadosUltimoBatch: number;
  totalRegistrosSalaoAgile: number;
};

export function getAgileSyncStatus(signal?: AbortSignal) {
  return request<AgileSyncStatus>("/integrations/agile/status", { signal });
}

// ============================================================================
// Delivery iFood (Fase 1: dados mockados no backend enquanto credencial não sai)
// ============================================================================

export type IfoodStoreView = {
  id: string;
  externalId: string;
  nickname: string;
  active: boolean;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IfoodCredentialStatusView = {
  configured: boolean;
  environment: "PRODUCTION" | "SANDBOX" | null;
  clientIdMasked: string | null;
  lastTokenAt: string | null;
};

export type IfoodDailySalesRow = {
  date: string;
  orders: number;
  grossAmount: number;
  ifoodFeeAmount: number;
  promotionAmount: number;
  deliveryFeeAmount: number;
  netAmount: number;
};

export type IfoodFeeBreakdownRow = {
  feeType: string;
  description: string | null;
  amount: number;
};

export type IfoodSettlementRow = {
  id: string;
  externalId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  paidAt: string | null;
  status: string;
};

export type IfoodPeriodSummary = {
  period: { year: number; month: number };
  storeId: string | null;
  storeLabel: string;
  totals: {
    orders: number;
    grossAmount: number;
    ifoodFeeAmount: number;
    promotionAmount: number;
    deliveryFeeAmount: number;
    netAmount: number;
    otherFees: number;
  };
  daily: IfoodDailySalesRow[];
  fees: IfoodFeeBreakdownRow[];
  settlements: IfoodSettlementRow[];
  isMock: boolean;
};

export type IfoodStatusView = {
  credential: IfoodCredentialStatusView;
  stores: IfoodStoreView[];
  lastSync: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemsProcessed: number;
    errorMessage: string | null;
  } | null;
  mockMode: boolean;
};

export function getIfoodStatus() {
  return request<IfoodStatusView>("/integrations/delivery/ifood/status");
}

export function getIfoodStores() {
  return request<IfoodStoreView[]>("/integrations/delivery/ifood/stores");
}

export function updateIfoodStore(id: string, payload: { externalId: string; nickname: string; active: boolean; companyId: string | null }) {
  return request<IfoodStoreView>(`/integrations/delivery/ifood/stores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function saveIfoodCredential(payload: { clientId: string; clientSecret: string; environment: "PRODUCTION" | "SANDBOX" }) {
  return request<IfoodCredentialStatusView>("/integrations/delivery/ifood/credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getIfoodSummary(params: { year: number; month: number; storeId?: string }) {
  const query = new URLSearchParams({
    year: String(params.year),
    month: String(params.month)
  });
  if (params.storeId) query.set("storeId", params.storeId);
  return request<IfoodPeriodSummary>(`/integrations/delivery/ifood/summary?${query.toString()}`);
}

export type IfoodSmartSyncResult = {
  mode: "REAL" | "MOCK";
  real?: {
    ranAt: string;
    hasCredential: boolean;
    totalPersisted: number;
    perStore: Array<{
      storeId: string;
      storeLabel: string;
      externalId: string;
      status: "SUCCESS" | "SKIPPED" | "ERROR";
      itemsPersisted: { sales: number; settlements: number; fees: number };
      message: string;
    }>;
  };
  log: IfoodStatusView["lastSync"];
};

export function runIfoodMockSync(params?: { year?: number; month?: number }) {
  return request<IfoodSmartSyncResult>("/integrations/delivery/ifood/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {})
  }, 60_000);
}

export type PainelDonoInsights = {
  period: { year: number; month: number; todayDay: number; daysInMonth: number };
  current: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
  };
  previousMonth: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
    deltaGrossPercent: number;
    deltaNetPercent: number;
  };
  lastYear: {
    orders: number;
    grossAmount: number;
    netAmount: number;
    ticketAverage: number;
    deltaGrossPercent: number;
    deltaNetPercent: number;
  };
  projection: {
    grossAmount: number;
    netAmount: number;
    daysElapsed: number;
    daysRemaining: number;
    note: string;
  };
  ranking: Array<{
    storeId: string;
    storeLabel: string;
    netAmount: number;
    grossAmount: number;
    sharePercent: number;
    deltaVsPreviousMonthPercent: number;
  }>;
  breakdown: {
    ifoodFeePercent: number;
    promotionPercent: number;
    deliveryFeePercent: number;
    otherFeesPercent: number;
    netPercent: number;
  };
  weekday: Array<{
    dow: number;
    label: string;
    avgNet: number;
    avgOrders: number;
  }>;
  ticketByStore: Array<{
    storeId: string;
    storeLabel: string;
    ticket: number;
    deltaPercent: number;
  }>;
  alerts: Array<{
    severity: "info" | "warn" | "danger";
    title: string;
    message: string;
    storeId: string | null;
  }>;
  isMock: boolean;
};

export function getIfoodInsights(params: { year: number; month: number }) {
  const query = new URLSearchParams({ year: String(params.year), month: String(params.month) });
  return request<PainelDonoInsights>(`/integrations/delivery/ifood/insights?${query.toString()}`);
}

export type IfoodConnectionTest = {
  ok: boolean;
  message: string;
  tokenPreview: string | null;
  expiresInSeconds: number | null;
  errorDetail: string | null;
  environment: "PRODUCTION" | "SANDBOX" | null;
};

export function testIfoodConnection() {
  return request<IfoodConnectionTest>("/integrations/delivery/ifood/test-connection", { method: "POST" });
}

// ============================================================================
// 99 Food — espelha os endpoints iFood. Enquanto o app do Pateo estiver em
// análise em developer-food.99app.com, o backend responde com mock e sinaliza
// awaitingApproval=true. A UI usa isso pra mostrar aviso apropriado.
// ============================================================================

export type NoventaNoveStoreView = {
  id: string;
  externalId: string;
  nickname: string;
  active: boolean;
  companyId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoventaNoveCredentialStatusView = {
  configured: boolean;
  environment: "PRODUCTION" | "SANDBOX" | null;
  clientIdMasked: string | null;
  lastTokenAt: string | null;
  commissionPercent: number;
};

export type NoventaNoveDailySalesRow = {
  date: string;
  orders: number;
  grossAmount: number;
  noventaNoveFeeAmount: number;
  promotionAmount: number;
  deliveryFeeAmount: number;
  netAmount: number;
};

export type NoventaNoveFeeBreakdownRow = {
  feeType: string;
  description: string | null;
  amount: number;
};

export type NoventaNoveSettlementRow = {
  id: string;
  externalId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  paidAt: string | null;
  status: string;
};

export type NoventaNovePeriodSummary = {
  period: { year: number; month: number };
  storeId: string | null;
  storeLabel: string;
  totals: {
    orders: number;
    grossAmount: number;
    noventaNoveFeeAmount: number;
    promotionAmount: number;
    deliveryFeeAmount: number;
    netAmount: number;
    otherFees: number;
  };
  daily: NoventaNoveDailySalesRow[];
  fees: NoventaNoveFeeBreakdownRow[];
  settlements: NoventaNoveSettlementRow[];
  isMock: boolean;
};

export type NoventaNoveStatusView = {
  credential: NoventaNoveCredentialStatusView;
  stores: NoventaNoveStoreView[];
  lastSync: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    itemsProcessed: number;
    errorMessage: string | null;
  } | null;
  mockMode: boolean;
  awaitingApproval: boolean;
};

export function getNoventaNoveStatus() {
  return request<NoventaNoveStatusView>("/integrations/delivery/noventa-nove/status");
}

export function getNoventaNoveStores() {
  return request<NoventaNoveStoreView[]>("/integrations/delivery/noventa-nove/stores");
}

export function updateNoventaNoveStore(id: string, payload: { externalId: string; nickname: string; active: boolean; companyId: string | null }) {
  return request<NoventaNoveStoreView>(`/integrations/delivery/noventa-nove/stores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function saveNoventaNoveCredential(payload: { clientId: string; clientSecret: string; environment: "PRODUCTION" | "SANDBOX"; commissionPercent: number }) {
  return request<NoventaNoveCredentialStatusView>("/integrations/delivery/noventa-nove/credential", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export type Variacao = { percentual: number; comparavel: boolean };

export type PainelDonoNoventaNove = {
  period: { year: number; month: number; diaDeHoje: number; diasNoMes: number; mesEmCurso: boolean };
  current: { orders: number; grossAmount: number; netAmount: number; ticketAverage: number };
  previousMonth: {
    orders: number; grossAmount: number; netAmount: number; ticketAverage: number;
    deltaGross: Variacao; deltaNet: Variacao;
  };
  lastYear: {
    orders: number; grossAmount: number; netAmount: number; ticketAverage: number;
    deltaGross: Variacao; deltaNet: Variacao;
  };
  projection: {
    grossAmount: number; netAmount: number;
    diasDecorridos: number; diasRestantes: number; ehProjecao: boolean; nota: string;
  };
  ranking: Array<{
    storeId: string; storeLabel: string;
    grossAmount: number; netAmount: number; orders: number;
    sharePercent: number; deltaVsPreviousMonth: Variacao;
  }>;
  breakdown: {
    deducaoPercent: number; liquidoPercent: number; deducaoValor: number;
    informadoPelaPlataforma: {
      taxa: number; promocao: number; entrega: number; outrasTaxas: number; disponivel: boolean;
    };
  };
  /** O delivery é vendido com desconto — esta é a conta sobre o preço ANUNCIADO. */
  precoDeTabela: {
    /** `false` em abr–jun/2026: vieram do relatório do portal, que não traz o preço de tabela. */
    disponivel: boolean;
    tabela: number;
    bruto: number;
    liquido: number;
    descontoTotal: number;
    descontoPercent: number;
    bancadoPelaLoja: number;
    bancadoPelaPlataforma: number;
    brutoSobreTabelaPercent: number;
    liquidoSobreTabelaPercent: number;
    cobertura: { comTabela: number; total: number };
  };
  weekday: Array<{ dow: number; label: string; avgNet: number; avgOrders: number; dias: number }>;
  ticketByStore: Array<{ storeId: string; storeLabel: string; ticket: number; delta: Variacao }>;
  alerts: Array<{ severity: "info" | "warn" | "danger"; title: string; message: string; storeId: string | null }>;
  semDados: boolean;
};

export function getNoventaNovePainelDono(params: { year: number; month: number }) {
  const query = new URLSearchParams({ year: String(params.year), month: String(params.month) });
  return request<PainelDonoNoventaNove>(`/integrations/delivery/noventa-nove/painel-dono?${query.toString()}`);
}

/**
 * Resumo da Keeta.
 *
 * Diferente de iFood e 99: a Keeta não tem integração, então não há lojas, nem
 * repasses, nem a quebra da dedução em taxa/promoção/entrega. O faturamento é
 * importado do portal e lido de `RevenueEntry` — por isso o tipo é bem menor
 * que o `NoventaNovePeriodSummary`.
 */
export type KeetaTotais = {
  orders: number;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  ticketAverage: number;
  deductionPercent: number;
  netPercent: number;
};

export type KeetaPeriodSummary = {
  period: { year: number; month: number };
  totals: KeetaTotais;
  daily: Array<{ date: string; orders: number; grossAmount: number; netAmount: number }>;
  previousMonth: {
    year: number;
    month: number;
    totals: KeetaTotais;
    deltaGross: Variacao;
    deltaNet: Variacao;
    deltaOrders: Variacao;
  };
  semDados: boolean;
};

export function getKeetaSummary(params: { year: number; month: number }) {
  const query = new URLSearchParams({ year: String(params.year), month: String(params.month) });
  return request<KeetaPeriodSummary>(`/integrations/delivery/keeta/summary?${query.toString()}`);
}

export function getNoventaNoveSummary(params: { year: number; month: number; storeId?: string }) {
  const query = new URLSearchParams({
    year: String(params.year),
    month: String(params.month)
  });
  if (params.storeId) query.set("storeId", params.storeId);
  return request<NoventaNovePeriodSummary>(`/integrations/delivery/noventa-nove/summary?${query.toString()}`);
}

export type NoventaNoveSmartSyncResult = {
  mode: "REAL" | "MOCK";
  real?: {
    ranAt: string;
    hasCredential: boolean;
    totalPersisted: number;
    perStore: Array<{
      storeId: string;
      storeLabel: string;
      externalId: string;
      status: "SUCCESS" | "PARTIAL" | "SKIPPED" | "ERROR";
      itemsPersisted: { sales: number; settlements: number; fees: number };
      message: string;
    }>;
  };
  log: NoventaNoveStatusView["lastSync"];
};

export function runNoventaNoveMockSync(params?: { year?: number; month?: number }) {
  return request<NoventaNoveSmartSyncResult>("/integrations/delivery/noventa-nove/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {})
  }, 60_000);
}

export type NoventaNoveConnectionTest = {
  ok: boolean;
  message: string;
  tokenPreview: string | null;
  expiresInSeconds: number | null;
  errorDetail: string | null;
  environment: "PRODUCTION" | "SANDBOX" | null;
};

export function testNoventaNoveConnection() {
  return request<NoventaNoveConnectionTest>("/integrations/delivery/noventa-nove/test-connection", { method: "POST" });
}

export type NoventaNoveStoreSyncRow = {
  appShopId: string;
  nickname: string;
  shopIdRemote: string | null;
  outcome: "NOVA" | "VINCULO_ATUALIZADO" | "JA_SINCRONIZADA" | "NAO_VINCULADA";
  detail: string;
};

export type NoventaNoveStoreSyncResult = {
  ranAt: string;
  totalNaPlataforma: number;
  rows: NoventaNoveStoreSyncRow[];
};

export function getNoventaNoveAuthorizationUrl(storeId: string) {
  return request<{ url: string; appShopId: string }>(
    `/integrations/delivery/noventa-nove/stores/${storeId}/authorization-url`,
    { method: "POST" },
    60_000
  );
}

export function syncNoventaNoveStores() {
  return request<NoventaNoveStoreSyncResult>("/integrations/delivery/noventa-nove/stores/sync", { method: "POST" }, 60_000);
}

// ============================================================================
// Contas a receber (Receivable) — cobre iFood, futuros 99/Keeta, eventos, etc.
// ============================================================================

export type ReceivableSourceType = "IFOOD_SETTLEMENT" | "NOVENTA_NOVE_SETTLEMENT" | "KEETA_SETTLEMENT" | "EVENT" | "DIRECT" | "OTHER";
export type ReceivableStatus = "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "LATE" | "CANCELLED";

export type ReceivableView = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  sourceType: ReceivableSourceType;
  sourceRef: string | null;
  ifoodSettlementId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  description: string;
  competenceYear: number;
  competenceMonth: number;
  expectedDate: string;
  receivedDate: string | null;
  grossAmount: number;
  fees: number;
  netAmount: number;
  paidAmount: number | null;
  paymentMethod: string | null;
  bankAccountId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  parentReceivableId: string | null;
  status: ReceivableStatus;
  notes: string | null;
  daysUntilExpected: number;
  isLate: boolean;
  createdAt: string;
};

export function getReceivables(filters: {
  status?: ReceivableStatus;
  sourceType?: ReceivableSourceType;
  companyId?: string;
  startDate?: string;
  endDate?: string;
} = {}) {
  return request<ReceivableView[]>(`/receivables${toQueryString(filters)}`);
}

export function createReceivable(payload: {
  companyId?: string | null;
  sourceType: ReceivableSourceType;
  sourceRef?: string | null;
  customerName?: string | null;
  customerDocument?: string | null;
  description: string;
  expectedDate: string;
  grossAmount: number;
  fees?: number;
  netAmount: number;
  paymentMethod?: string | null;
  bankAccountId?: string | null;
  installmentNumber?: number | null;
  totalInstallments?: number | null;
  parentReceivableId?: string | null;
  notes?: string | null;
}) {
  return request<ReceivableView>("/receivables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function markReceivableReceived(id: string, payload: {
  receivedDate: string;
  paidAmount: number;
  paymentMethod?: string | null;
  bankAccountId?: string | null;
  notes?: string | null;
}) {
  return request<ReceivableView>(`/receivables/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function cancelReceivable(id: string, reason?: string) {
  return request<ReceivableView>(`/receivables/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

// ============================================================================
// Despesas iFood mensais — vão pra Contas a Pagar (Fase D)
// ============================================================================

export type IfoodMonthlyExpenseStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export type IfoodMonthlyExpenseView = {
  id: string;
  deliveryStoreId: string;
  storeNickname: string;
  companyId: string | null;
  companyName: string | null;
  competenceYear: number;
  competenceMonth: number;
  dueDate: string;
  commissionAmount: number;
  deliveryFeeAmount: number;
  marketingAmount: number;
  maintenanceAmount: number;
  anticipationAmount: number;
  otherAmount: number;
  totalAmount: number;
  paidAmount: number | null;
  status: IfoodMonthlyExpenseStatus;
  paidAt: string | null;
  paymentMethod: string | null;
  notes: string | null;
  autoGenerated: boolean;
  daysUntilDue: number;
  isLate: boolean;
  createdAt: string;
};

export function getIfoodExpenses(filters: {
  status?: IfoodMonthlyExpenseStatus;
  companyId?: string;
  competenceYear?: number;
  competenceMonth?: number;
} = {}) {
  const params: Record<string, string | boolean | undefined> = {};
  if (filters.status) params.status = filters.status;
  if (filters.companyId) params.companyId = filters.companyId;
  if (filters.competenceYear) params.competenceYear = String(filters.competenceYear);
  if (filters.competenceMonth) params.competenceMonth = String(filters.competenceMonth);
  return request<IfoodMonthlyExpenseView[]>(`/ifood-expenses${toQueryString(params)}`);
}

export function payIfoodExpense(id: string, payload: {
  paidAt: string;
  paidAmount: number;
  paymentMethod?: string | null;
  notes?: string | null;
}) {
  return request<IfoodMonthlyExpenseView>(`/ifood-expenses/${id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function cancelIfoodExpense(id: string, reason?: string) {
  return request<IfoodMonthlyExpenseView>(`/ifood-expenses/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}


// ─── Notificações WhatsApp ────────────────────────────────────────────────
// CRUD de destinatários + status/QR/restart/test-send da conexão Baileys.
// Backend: /notifications/whatsapp/*  (rota admin, autenticada por sessão).

export type WhatsAppRecipient = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppStatus = {
  status: "starting" | "waiting_qr" | "connecting" | "open" | "closed" | "logged_out";
  sessionName: string;
  hasQr: boolean;
  lastError: string | null;
  startedAt: string | null;
};

export type WhatsAppTestSendResult =
  | { ok: true; name: string; messageId: string | null }
  | { ok: false; name: string; error: string };

export async function getWhatsAppRecipients() {
  const res = await request<{ recipients: WhatsAppRecipient[] } | undefined>(
    "/notifications/whatsapp/recipients"
  );
  // Defensivo: mock user mode ou 204 podem retornar undefined; tratar como lista vazia.
  return res?.recipients ?? [];
}

export async function createWhatsAppRecipient(input: {
  name: string;
  phone: string;
  notes?: string | null;
  isActive?: boolean;
}) {
  const res = await request<{ recipient: WhatsAppRecipient }>("/notifications/whatsapp/recipients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return res.recipient;
}

export async function updateWhatsAppRecipient(id: string, input: {
  name?: string;
  phone?: string;
  notes?: string | null;
  isActive?: boolean;
}) {
  const res = await request<{ recipient: WhatsAppRecipient }>(`/notifications/whatsapp/recipients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return res.recipient;
}

export async function deleteWhatsAppRecipient(id: string) {
  await request<void>(`/notifications/whatsapp/recipients/${id}`, { method: "DELETE" });
}

export function getWhatsAppStatus() {
  return request<WhatsAppStatus>("/notifications/whatsapp/status");
}

export function testWhatsAppSend(recipientId: string) {
  return request<WhatsAppTestSendResult>("/notifications/whatsapp/test-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientId })
  });
}

// Retorna dataUrl PNG do QR se houver, null se sessão já pareada.
// Backend retorna 404 quando não há QR ativo — convertemos em null.
export async function getWhatsAppQr(): Promise<{ dataUrl: string; status: WhatsAppStatus } | null> {
  try {
    return await request<{ dataUrl: string; status: WhatsAppStatus }>("/notifications/whatsapp/qr");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

// Desconecta a sessão WhatsApp atual e força novo QR.
// AÇÃO DESTRUTIVA: até o próximo scan, o resumo diário falha.
export function logoutWhatsApp() {
  return request<{ ok: boolean; status: WhatsAppStatus }>("/notifications/whatsapp/logout", {
    method: "POST"
  });
}

// ─── Folha de Pagamento — Funcionários ─────────────────────────────────────────
export type EmployeeGender = "FEMININO" | "MASCULINO" | "NAO_INFORMADO";
export type EmployeeModality = "CLT" | "NAO_CLT";
export type WorkScheduleRegime = "SEIS_POR_UM" | "CINCO_POR_DOIS";
export type VtType = "NENHUM" | "TRANSPORTE_PUBLICO" | "BILHETE_MENSAL" | "AUXILIO_COMBUSTIVEL";
export type VtPeriodicity = "QUINZENAL" | "MENSAL";
export type VtDirection = "IDA" | "VOLTA";
export type VtFareBasis = "VIAGEM" | "MENSAL";

export type VtFare = {
  id: string;
  name: string;
  amount: string;
  basis: VtFareBasis;
  /** Valor nos dias de tarifa zero (domingos + 01/01, 25/01, 25/12). */
  sundayAmount: string | null;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  /** Quantos funcionários ativos dependem desta tarifa. */
  inUseBy?: number;
};

export type VtFarePayload = {
  name: string;
  amount: string | number;
  basis?: VtFareBasis;
  sundayAmount?: string | number | null;
  isActive?: boolean;
  sortOrder?: number;
  notes?: string | null;
};

/** Uma perna do trajeto: "na ida, o 2º embarque é metrô". */
export type EmployeeVtLeg = {
  id: string;
  direction: VtDirection;
  sortOrder: number;
  fareId: string;
  fare: VtFare;
};

export function getVtFares(includeInactive = false) {
  return request<VtFare[]>(`/payroll/vt-fares${includeInactive ? "?includeInactive=true" : ""}`);
}

export function createVtFare(payload: VtFarePayload) {
  return request<VtFare>("/payroll/vt-fares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateVtFare(id: string, payload: Partial<VtFarePayload>) {
  return request<VtFare>(`/payroll/vt-fares/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function deleteVtFare(id: string) {
  return request<{ ok: boolean }>(`/payroll/vt-fares/${id}`, { method: "DELETE" });
}
export type EmployeeBankAccountType = "CONTA_CORRENTE" | "POUPANCA" | "CAIXA" | "CARTEIRA" | "CARTAO" | "OUTROS";

export type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  cpf: string;
  rg: string | null;
  pis: string | null;
  birthDate: string | null;
  gender: EmployeeGender;
  phone: string | null;
  email: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  bankName: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  bankAccountDigit: string | null;
  bankAccountType: EmployeeBankAccountType;
  pixKeyType: string | null;
  pixKey: string | null;
  sector: string | null;
  subgroup: string | null;
  position: string | null;
  baseSalary: string | null;
  salarioCombinado?: string | null;
  salarioCombinadoMotivo?: string | null;
  /** Teto do IR para a gorjeta informada à contabilidade (CLT): o envio leva teto − salário registrado. */
  tetoIrGorjeta?: string | null;
  /** Recebe adiantamento salarial no dia do adiantamento (sem registro: desconta da lista). */
  recebeAdiantamento?: boolean;
  /** Sem registro: recebe por quinzena (metade do salário base no dia 15; a lista do dia 30 desconta). */
  pagamentoQuinzenal?: boolean;
  shiftStart: string | null;
  shiftEnd: string | null;
  modality: EmployeeModality;
  scheduleRegime: WorkScheduleRegime;
  includeInSchedule: boolean;
  admissionDate: string | null;
  admissaoCarteira?: string | null;
  /** Entra na gorjeta em. Vazio = em teste (ou fora da gorjeta). */
  inicioGorjeta?: string | null;
  vtType: VtType;
  vtPeriodicity: VtPeriodicity;
  vtFixedAmount: string | null;
  vtMonthlyFareId: string | null;
  vtMonthlyFare?: VtFare | null;
  /** Sempre presente: o backend inclui a relacao no list e no get. */
  vtLegs: EmployeeVtLeg[];
  terminationDate: string | null;
  terminationReason: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
} & Partial<EmployeeFichaCampos>;

export type EmployeeBirthday = {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  /** Nome como está na carteira (pode faltar em quem não tem ficha importada). */
  nomeCompleto?: string | null;
  birthDate: string;
  sector: string | null;
  position: string | null;
};

export type EmployeePayload = {
  id?: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  cpf: string;
  rg?: string;
  pis?: string;
  birthDate?: string;
  gender?: EmployeeGender;
  phone?: string;
  email?: string;
  zipCode?: string;
  address?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  bankName?: string;
  bankAgency?: string;
  bankAccount?: string;
  bankAccountDigit?: string;
  bankAccountType?: EmployeeBankAccountType;
  pixKeyType?: string;
  pixKey?: string;
  sector?: string;
  subgroup?: string;
  position?: string;
  baseSalary?: string | number;
  /** Ausente = não mexe; null = tira. */
  salarioCombinado?: string | number | null;
  salarioCombinadoMotivo?: string | null;
  /** Ausente = não mexe; null = tira. Só CLT (sem registro: 400). */
  tetoIrGorjeta?: string | number | null;
  /** Ausente = não mexe. */
  recebeAdiantamento?: boolean;
  /** Ausente = não mexe. Junto com recebeAdiantamento=true, o backend recusa (400). */
  pagamentoQuinzenal?: boolean;
  shiftStart?: string;
  shiftEnd?: string;
  modality?: EmployeeModality;
  scheduleRegime?: WorkScheduleRegime;
  includeInSchedule?: boolean;
  admissionDate?: string;
  /** Registro em carteira (do extrato); null limpa, ausente preserva. */
  admissaoCarteira?: string | null;
  /** Entra na gorjeta em (AAAA-MM-DD); null = em teste/fora; ausente preserva. */
  inicioGorjeta?: string | null;
  vtType?: VtType;
  vtPeriodicity?: VtPeriodicity;
  /** null limpa o valor; ausente preserva o que esta gravado. */
  vtFixedAmount?: string | number | null;
  vtMonthlyFareId?: string | null;
  vtLegs?: Array<{ direction: VtDirection; fareId: string }>;
  notes?: string;
  /** Salário, vínculo, cargo etc. mudaram: a partir de quando vale (AAAA-MM-DD; padrão hoje). */
  vigenteDesde?: string;
  /** Motivo da alteração, para o histórico do cadastro. */
  motivoAlteracao?: string;
} & Partial<EmployeeFichaCampos>;

export type CampoHistoricoCadastro = "baseSalary" | "salarioCombinado" | "tetoIrGorjeta" | "modality" | "companyId" | "position" | "recebeAdiantamento" | "pagamentoQuinzenal" | "inicioGorjeta";

/** Uma alteração do cadastro. Sem permissão de ver Funcionários, salário vem com oculto=true e sem valores. */
export type EmployeeHistoricoLinha = {
  id: string;
  campo: CampoHistoricoCadastro;
  rotulo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  oculto: boolean;
  vigenteDesde: string;
  motivo: string | null;
  origem: string;
  criadoPorNome: string | null;
  createdAt: string;
};

export function getEmployeeHistorico(id: string) {
  return request<EmployeeHistoricoLinha[]>(`/employees/${id}/historico`);
}

/** Documentos e contrato da ficha de registro da contabilidade. Datas em "AAAA-MM-DD". Só consulta. */
export type EmployeeFichaCampos = {
  /** Nome como está na carteira; Nome + Sobrenome podem ser mais curtos. */
  nomeCompleto: string | null;
  registroNumero: string | null; matriculaEsocial: string | null;
  nomeMae: string | null; nomePai: string | null;
  estadoCivil: string | null; nacionalidade: string | null; naturalidade: string | null;
  racaCor: string | null; escolaridade: string | null; possuiDeficiencia: boolean | null;
  rgDataEmissao: string | null; rgOrgaoEmissor: string | null;
  tituloEleitor: string | null; tituloZona: string | null; tituloSecao: string | null;
  ctpsNumero: string | null; ctpsSerie: string | null; ctpsUf: string | null; ctpsDataEmissao: string | null;
  cbo: string | null;
  jornadaInicio: string | null; jornadaFim: string | null; intervaloInicio: string | null; intervaloFim: string | null;
  fgtsDataOpcao: string | null;
};

export type StatusFerias = "EM_AQUISICAO" | "QUITADO" | "A_GOZAR" | "PRAZO_VENCIDO" | "CONTRATO_ENCERRADO";
export type EmployeeFichaFerias = {
  aquisitivoInicio: string; aquisitivoFim: string; concessivoFim: string;
  diasGozados: number; diasAbono: number; status: StatusFerias;
  gozos: { inicio: string; fim: string; abonoInicio: string | null; abonoFim: string | null }[];
};
/** Sem permissão de ver Funcionários, salarioOculto=true e o salário da carteira vem null. */
export type EmployeeFicha = {
  dependentes: { id: string; nome: string; parentesco: string | null; dataNascimento: string | null }[];
  ferias: EmployeeFichaFerias[];
  salarioOculto: boolean;
  carteira: {
    id: string; tipo: "ADMISSAO" | "SALARIO" | "CARGO"; data: string;
    salario: number | null; retroativoCompetencia: string | null;
    cargoAnterior: string | null; cboAnterior: string | null; cargo: string | null; cbo: string | null;
  }[];
};

export function getEmployeeFicha(id: string) {
  return request<EmployeeFicha>(`/employees/${id}/ficha`);
}

export function getEmployees(params: { search?: string; sector?: string; includeInactive?: boolean } = {}) {
  return request<Employee[]>(`/employees${toQueryString(params)}`);
}

export function getEmployee(id: string) {
  return request<Employee>(`/employees/${id}`);
}

export function getEmployeeBirthdays(month?: number) {
  return request<EmployeeBirthday[]>(`/employees/birthdays${month ? `?month=${month}` : ""}`);
}

export function getEmployeeOptions() {
  return request<{ sectors: string[]; positions: string[] }>("/employees/options");
}

// ─── Escala mensal ──────────────────────────────────────────────────────────────
export type ScheduleDayType = "FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS" | "TURNO" | "EVENTO" | "FERIAS" | "FALTA" | "ATESTADO" | "AFASTAMENTO";
export type ScheduleDayMeta = { day: number; dow: number; isSunday: boolean; isHoliday: boolean; holidayName: string | null };
export type ScheduleEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  sector: string | null;
  subgroup: string | null;
  position: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  scheduleRegime: WorkScheduleRegime;
  admissionDate: string | null;
  terminationDate: string | null;
  /** false = desligado; ainda aparece na escala dos meses ate o desligamento. */
  isActive: boolean;
  gender: EmployeeGender;
  holidayCompBalance: number;
  /** A parte do saldo lancada a mao (o resto vem da escala). */
  holidayCompManual?: number;
  /** "Entra na escala" desligado: sem turno, só falta/atestado/férias/folga. */
  somenteOcorrencias?: boolean;
};
export type ScheduleEntry = { employeeId: string; day: number; type: ScheduleDayType };
export type ScheduleVacationDay = { employeeId: string; day: number };
export type EventSize = "PEQUENO" | "MEDIO" | "GRANDE";
export type ScheduleDateEvent = { day: number; size: EventSize };
/** Marcações dos 10 dias antes e depois do mês — para validar a virada. */
export type ScheduleBorderDay = { employeeId: string; date: string; type: ScheduleDayType };
export type ScheduleData = {
  year: number;
  month: number;
  daysInMonth: number;
  days: ScheduleDayMeta[];
  employees: ScheduleEmployee[];
  entries: ScheduleEntry[];
  vacationDays: ScheduleVacationDay[];
  dateEvents: ScheduleDateEvent[];
  borderDays: ScheduleBorderDay[];
  /** Domingos das 10 semanas anteriores, com o status ja resolvido. */
  sundayHistory: Array<{ employeeId: string; date: string; status: "FOLGA" | "TRABALHOU" | "SEM_ESCALA" }>;
  regraDomingo: { mulher: number; geral: number };
};

export function getSchedule(year: number, month: number) {
  return request<ScheduleData>(`/schedule?year=${year}&month=${month}`);
}

export function saveScheduleBulk(year: number, month: number, entries: ScheduleEntry[], dateEvents: ScheduleDateEvent[]) {
  return request<{ ok: boolean; year: number; month: number; count: number; events: number }>("/schedule/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month, entries, dateEvents })
  });
}

// ─── Folha de Pagamento ─────────────────────────────────────────────────────────
export type PayrollItemType = "ADIANTAMENTO" | "SALARIO" | "VALE_TRANSPORTE" | "RESCISAO" | "FERIAS";
export type PayrollItemStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELED";

export type PayrollSettings = {
  id: string;
  /** Dia em que a 2a quinzena comeca (16 => 1a e 01-15). */
  vtSecondPeriodStartDay: number;
  /** Folga em domingo ao menos 1 a cada N semanas (definido pela CCT). */
  dsrDomingoMulherSemanas: number;
  dsrDomingoGeralSemanas: number;
  advancePercent: string;
  advanceDueDay: number;
  salaryDueDay: number;
};

export type PayrollComputedItem = {
  employeeId: string;
  employeeName: string;
  employeeDisplayName: string | null;
  sector: string | null;
  type: PayrollItemType;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amount: number;
  workedDays: number | null;
  freeDays: number | null;
  /** 1 ou 2 no VT; null em salario/adiantamento. */
  quinzena: 1 | 2 | null;
  /** Faltas ja pagas que este vale abate (data + valor). */
  faltaDeductions?: Array<{ date: string; amount: number; tipo: "FALTA" | "ATESTADO" }>;
  dreCategoryName: string | null;
  details: Record<string, unknown> | null;
  exists: boolean;
  /** 1ª quinzena já lançada, sem baixa, com valor diferente do calculado: gerar de novo atualiza. */
  desatualizado?: boolean;
};

export type PayrollPreview = {
  year: number;
  month: number;
  settings: PayrollSettings;
  items: PayrollComputedItem[];
  warnings?: string[];
};

export type PayrollListItem = {
  id: string;
  employeeName: string;
  employeeDisplayName: string | null;
  sector: string | null;
  type: PayrollItemType;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amount: string;
  workedDays: number | null;
  freeDays: number | null;
  paymentDate: string | null;
  paidAmount: string | null;
  status: PayrollItemStatus;
  dreCategoryId: string | null;
  /** Detalhes do título (sem permissão de ver Funcionários, só as marcas: semRegistro, primeiraQuinzena…). */
  details?: Record<string, unknown> | null;
};

export type PayrollList = {
  year: number;
  month: number;
  items: PayrollListItem[];
  summary: {
    total: number; vt: number; advance: number; salary: number; ferias: number;
    paid: number; pending: number; overdue: number; count: number;
  };
};

export function getPayrollSettings() {
  return request<PayrollSettings>("/payroll/settings");
}

export function savePayrollSettings(payload: Partial<PayrollSettings>) {
  return request<PayrollSettings>("/payroll/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// ─── Folha da Gorjeta (Comissão) — Fase A ────────────────────────────────────
export type TipParticipantKind = "FIXO" | "PONTOS";
export type TipValeType = "REFEICAO" | "VALE_CONSUMO" | "RETIRADA_CAIXA" | "ADIANTAMENTO" | "OUTRO" | "CREDITO";

export type TipComputedVale = { id: string; type: TipValeType; amount: number; date: string | null; notes: string | null };
export type TipOrigem = "ESCALA" | "MANUAL";
export type TipTipoCalculo = "MES" | "RESCISAO" | "RESCISAO_QUITADA" | "FORA_DO_PERIODO";

export type TipRegrasPessoa = {
  descontaFalta: boolean | null;
  descontaAtestado: boolean | null;
  descontaFerias: boolean | null;
  descontaOutros: boolean | null;
  proporcionalEntrada: boolean | null;
  /** Afastamento não remunerado desconta na gorjeta. Ausente/null = regra do período. */
  descontaAfastamento?: boolean | null;
};

export type TipComputedParticipant = {
  participantId: string | null;
  employeeId: string;
  /** Nome completo (o principal nas telas). */
  employeeName: string;
  /** Apelido, mostrado embaixo do nome (null se não houver). */
  apelido: string | null;
  companyId: string | null;
  companyName: string | null;
  functionName: string | null;
  isActive: boolean;
  semRegistro: boolean;
  /** Sem registro que não participa da gorjeta: está só pelo salário (gorjeta e pontos zero). Ausente = participa. */
  foraDaGorjeta?: boolean;
  admissionDate: string | null;
  terminationDate: string | null;
  kind: TipParticipantKind;
  basePoints: number;
  pointsAdjustment: number;
  fixedAmount: number | null;
  /** O que está na Escala agora, mesmo quando o valor foi digitado. */
  escala?: { faltas: number; atestados: number; ferias: number; afastamento?: number };
  /** Folgas da Escala no período — só informação, fora do cálculo. null = retrato antigo. */
  folgasEscala?: { total: number; folga: number; feriado: number; bancoHoras: number } | null;
  faltas: number; faltasOrigem: TipOrigem;
  atestados: number; atestadosOrigem: TipOrigem;
  ferias: number; feriasOrigem: TipOrigem;
  /** Afastamento não remunerado: dias da Escala no ciclo (não se digita). Ausente = backend antigo. */
  afastamento?: number; afastamentoOrigem?: "ESCALA";
  outrosDias: number;
  diasPrevistosOverride: number | null;
  diasElegiveis: number;
  diasReferencia: number;
  /** Decisão de quem fecha para esta pessoa; null = regra do período. */
  regras: TipRegrasPessoa;
  regrasEfetivas: { descontaFalta: boolean; descontaAtestado: boolean; descontaFerias: boolean; descontaOutros: boolean; proporcionalEntrada: boolean; descontaAfastamento?: boolean };
  diasPrevistos: number;
  diasComputados: number;
  fatorPresenca: number;
  pontosApurados: number;
  points: number;
  pontosDireito: number;
  pontosDevolvidos: number;
  extraRescisao: number;
  justificativaExtra: string | null;
  tipoCalculo: TipTipoCalculo;
  valorPonto: number;
  rescisaoServicoBruto: number | null;
  rescisaoServicoOrigem: "FATURAMENTO" | "MANUAL" | null;
  rescisaoValorFixo: number | null;
  /** Gorjeta quitada na rescisão: já paga pela contabilidade, fora da lista a pagar. */
  pagoNaRescisao: boolean;
  rescisaoRecibo: TipReciboRescisao | null;
  /** Rescisão lançada em Contas a Pagar (valor só com permissão de Funcionários). */
  rescisaoContasPagar: { valor: number | null; vencimento: string; status: "PENDING" | "PAID" | "OVERDUE"; parcelas: number; gorjetaDefinida: boolean } | null;
  /** O que o sistema calculou; difere de rateioAmount quando há gorjeta real. */
  gorjetaCalculada: number;
  /** Gorjeta real digitada no lugar da calculada (null = vale a calculada). */
  gorjetaReal: { valor: number; motivo: string | null; por: string | null; em: string | null } | null;
  rescisaoPendente: boolean;
  rateioAmount: number;
  descontos: number;
  creditos: number;
  valesTotal: number;
  netCommission: number;
  /**
   * Gorjeta enviada à contabilidade. Com teto do IR (CLT): teto − salário registrado do mês;
   * sem teto: = netCommission. Com teto e sem permissão de ver Funcionários vem null (o valor
   * revelaria o salário). Ausente = backend antigo (vale netCommission).
   */
  gorjetaInformada?: number | null;
  gorjetaInformadaPeloTeto?: boolean;
  /** Teto do IR vigente no mês: só com permissão de ver Funcionários. */
  tetoIrGorjeta?: number | null;
  diasSalarioOverride: number | null;
  diasSalario: number;
  salarioProporcional: number;
  /** Sem registro: adiantamento salarial já pago no mês (0 = não recebeu). null sem permissão de ver Funcionários. */
  adiantamentoSalarial?: number | null;
  /** Sem registro por quinzena: 1ª quinzena já paga no dia 15 (0 = não recebeu). null sem permissão de ver Funcionários. */
  primeiraQuinzena?: number | null;
  /** Sem registro que recebe por quinzena no mês (o acerto vence no fim do mês). */
  pagamentoQuinzenal?: boolean;
  /** Sem registro: hora extra (+50%) e adicional noturno, já no total a pagar. CLT = 0. null sem permissão de ver Funcionários. */
  valorHoraExtra?: number | null;
  valorAdicionalNoturno?: number | null;
  /** Sem registro: DSR sobre a hora extra e o noturno (a partir de 09/2026), já no total. null sem permissão. */
  valorDsr?: number | null;
  totalAPagar: number;
  /** null quando o usuário não tem permissão de ver Funcionários. */
  baseSalary: number | null;
  pixKeyType: string | null;
  pixKey: string | null;
  horaExtra: string | null;
  adicionalNoturno: string | null;
  justificada: boolean;
  vales: TipComputedVale[];
};

export type TipComputation = {
  year: number;
  month: number;
  label: string;
  periodId: string | null;
  /** Código da apuração: GOR-AAAA-NNNN. */
  code: string | null;
  /** Registro vigente do fechamento (null enquanto aberto). */
  fechamento: { id: string; code: string; version: number; closedAt: string; closedByName: string } | null;
  status: "OPEN" | "CLOSED" | null;
  periodStart: string;
  periodEnd: string;
  grossPool: number;
  servicoFaturamento: number;
  ajusteServico: number;
  ajusteServicoMotivo: string | null;
  deductionPercent: number;
  netPool: number;
  fixedTotal: number;
  rescisoes: { valor: number; pontos: number };
  pontosDisponiveis: number;
  pointsPool: number;
  pointsBudget: number;
  totalPoints: number;
  pointsRemaining: number;
  pointValue: number;
  diasPadrao: number;
  descontaFalta: boolean;
  descontaAtestado: boolean;
  descontaFerias: boolean;
  descontaOutros: boolean;
  /** Afastamento não remunerado desconta na gorjeta (regra do período). Ausente = backend antigo (desconta). */
  descontaAfastamento?: boolean;
  proporcionalEntrada: boolean;
  /** Parte de quem saiu depois da saída: true = vai para o livre; false = sobe o ponto de quem fica. */
  sobraRescisaoParaSaldo: boolean;
  distribuido: number;
  saldo: number;
  reservaTotal: number;
  reservaPontos: number;
  fundoReservaSaldo: number;
  composicao: {
    mes: { valor: number; pontos: number; pessoas: number };
    rescisoes: { valor: number; pontos: number; pessoas: number; pendentes: number };
    reserva: { valor: number; pontos: number };
    fixos: { valor: number; pessoas: number };
  };
  participants: TipComputedParticipant[];
  /** Regra do adiantamento salarial (Folha → configurações): % do salário base, pago no dia. */
  adiantamento?: { percent: number; dia: number };
  /** adiantamentos, primeirasQuinzenas e horasExtrasSemRegistro (hora extra + noturno da lista): null sem permissão de ver Funcionários. */
  totals: {
    rateio: number; vales: number; netCommission: number; salarios: number; adiantamentos?: number | null;
    primeirasQuinzenas?: number | null;
    horasExtrasSemRegistro?: number | null; dsrSemRegistro?: number | null; totalAPagar: number; pagoNaRescisao: number;
  };
  check: { expectedNetPool: number; sumRateios: number; ok: boolean; diff: number };
  pendencias: string[];
  warnings: string[];
};

export type TipPeriod = {
  id: string;
  competenceYear: number;
  competenceMonth: number;
  periodStart: string;
  periodEnd: string;
  label: string;
  grossPool: string | number;
  poolSource: string;
  deductionPercent: string | number;
  netPool: string | number;
  pointsTotal: number;
  pointValue: string | number;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
};

export type TipParticipantInput = {
  employeeId: string;
  kind: TipParticipantKind;
  fixedAmount?: number | null;
  pointsAdjustment?: number;
  /** null = usar a Escala / o cálculo. */
  faltas?: number | null;
  atestados?: number | null;
  ferias?: number | null;
  outrosDias?: number | null;
  diasPrevistosOverride?: number | null;
  diasSalarioOverride?: number | null;
  descontaFalta?: boolean | null;
  descontaAtestado?: boolean | null;
  descontaFerias?: boolean | null;
  descontaOutros?: boolean | null;
  proporcionalEntrada?: boolean | null;
  descontaAfastamento?: boolean | null;
  rescisaoServicoBruto?: number | null;
  rescisaoValorFixo?: number | null;
  horaExtra?: string | null;
  adicionalNoturno?: string | null;
  justificada?: boolean;
};

export type TipPeriodPayload = {
  grossPool?: number; deductionPercent?: number; pointsTotal?: number; periodStart?: string; periodEnd?: string;
  diasPadrao?: number; descontaFalta?: boolean; descontaAtestado?: boolean; descontaFerias?: boolean; descontaOutros?: boolean;
  descontaAfastamento?: boolean;
  proporcionalEntrada?: boolean;
  sobraRescisaoParaSaldo?: boolean;
  reservaPontos?: number;
  ajusteServico?: number;
  ajusteServicoMotivo?: string | null;
};

export function refreshTipService(periodId: string) {
  return request<{ servicoFaturamento: number; grossPool: number }>(`/payroll/tip/periods/${periodId}/refresh-service`, { method: "POST" });
}

export type TipFunction = {
  id?: string;
  name: string;
  points: number;
  minPoints: number | null;
  maxPoints: number | null;
  group: string | null;
  notes: string | null;
  sortOrder?: number;
  isActive: boolean;
};

export type TipTeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  isActive: boolean;
  sector: string | null;
  position: string | null;
  modality: EmployeeModality;
  admissionDate: string | null;
  terminationDate: string | null;
  companyId: string | null;
  participaGorjeta: boolean;
  /** Entra na gorjeta em (do cadastro). Vazio ou futura = em teste, fora do rateio. */
  inicioGorjeta?: string | null;
  tipoGorjeta: TipParticipantKind;
  cotaFixaGorjeta: number | null;
  /** Ponto extra (±) somado aos pontos da função. */
  pontosExtra: number | null;
  pontosExtraMotivo: string | null;
  tipFunctionId: string | null;
};

export type TipTeamPayload = Pick<TipTeamMember,
  "participaGorjeta" | "tipoGorjeta" | "cotaFixaGorjeta" | "pontosExtra" | "pontosExtraMotivo" | "tipFunctionId" | "companyId"> & {
  /** Data a partir da qual a mudança de função/pontos vale (AAAA-MM-DD). */
  validFrom?: string;
  reason?: string;
};

export type TipMudancaTipo = "INICIAL" | "PROMOCAO" | "REDUCAO" | "TROCA_DE_FUNCAO" | "ENTRADA" | "SAIDA" | "OUTRA";
export type TipMudanca = {
  id: string; employeeId: string; employeeName: string; validFrom: string; tipo: TipMudancaTipo;
  funcaoAntes: string | null; funcaoDepois: string | null; baseAntes: number | null; baseDepois: number | null;
  diferenca: number | null; participa: boolean; motivo: string | null; registradoEm: string;
  apelido?: string | null;
};
export type TipEvolucao = {
  competencias: Array<{ ano: number; mes: number; status: "OPEN" | "CLOSED"; pointValue: number }>;
  linhas: Array<{
    employeeId: string; employeeName: string; apelido?: string | null;
    meses: Record<string, { funcao: string | null; base: number | null; pontos: number | null; gorjeta: number | null } | undefined>;
  }>;
};
export type TipReservaMovimento = {
  id: string; date: string; type: "FECHAMENTO_RESERVA" | "FECHAMENTO_SALDO" | "DISTRIBUICAO" | "AJUSTE";
  amount: number; saldo: number; competencia: string | null; employeeName: string | null; notes: string | null; removivel: boolean;
  employeeId?: string | null; apelido?: string | null;
};
export type TipFuncaoHistorico = {
  id: string; tipFunctionId: string; name: string; pointsBefore: number | null; pointsAfter: number;
  minPoints: number | null; maxPoints: number | null; createdAt: string;
};

export function getTipMemberHistory(employeeId: string) {
  return request<TipMudanca[]>(`/payroll/tip/team/${employeeId}/history`);
}

export function getTipChanges(de?: string, ate?: string) {
  return request<TipMudanca[]>(`/payroll/tip/reports/changes${toQueryString({ de, ate })}`);
}

export function getTipEvolution(de: string, ate: string) {
  return request<TipEvolucao>(`/payroll/tip/reports/evolution${toQueryString({ de, ate })}`);
}

export function getTipFunctionHistory() {
  return request<TipFuncaoHistorico[]>("/payroll/tip/functions/history");
}

export function getTipReserve() {
  return request<{ saldo: number; movimentos: TipReservaMovimento[] }>("/payroll/tip/reserve");
}

export function addTipReserveAdjustment(payload: { amount: number; notes: string; date?: string }) {
  return request<{ ok: boolean }>("/payroll/tip/reserve/adjustments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function deleteTipReserveAdjustment(id: string) {
  return request<{ ok: boolean }>(`/payroll/tip/reserve/adjustments/${id}`, { method: "DELETE" });
}

export function distributeTipReserve(periodId: string, items: Array<{ employeeId: string; amount: number; notes?: string }>) {
  return request<{ total: number; saldoDepois: number }>("/payroll/tip/reserve/distribute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodId, items })
  });
}

export function getTipFunctions() {
  return request<TipFunction[]>("/payroll/tip/functions");
}

/** Tabela para edição, com a versão aberta (o servidor recusa gravar por cima de quem salvou antes). */
export function getTipFunctionsTable() {
  return request<{ versao: string; funcoes: TipFunction[] }>("/payroll/tip/functions/table");
}

export function saveTipFunctions(functions: TipFunction[], vigencia: { validFrom?: string; reason?: string; baseVersion?: string } = {}) {
  return request<{ ok: boolean }>("/payroll/tip/functions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ functions, ...vigencia })
  });
}

export function getTipTeam() {
  return request<TipTeamMember[]>("/payroll/tip/team");
}

export function saveTipTeamMember(employeeId: string, payload: TipTeamPayload) {
  return request<{ ok: boolean }>(`/payroll/tip/team/${employeeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function getTipCompanies() {
  return request<Array<{ id: string; tradeName: string }>>("/payroll/tip/companies");
}

export function getTipCommission(year: number, month: number) {
  return request<TipComputation>(`/payroll/tip?year=${year}&month=${month}`);
}

// Elenco enxuto para a tela da gorjeta. Nao usar getEmployees aqui: aquele traz
// CPF, conta bancaria e salario, e exige permissao de Funcionarios.
export type TipRosterEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  isActive: boolean;
};

export function getTipRoster() {
  return request<TipRosterEmployee[]>("/payroll/tip/roster");
}

export function getTipPool(year: number, month: number) {
  return request<{ year: number; month: number; label: string; periodStart: string; periodEnd: string; grossPool: number }>(
    `/payroll/tip/pool?year=${year}&month=${month}`
  );
}

export function openTipPeriod(year: number, month: number) {
  return request<TipPeriod>("/payroll/tip/periods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month })
  });
}

export function updateTipPeriod(id: string, payload: TipPeriodPayload) {
  return request<TipPeriod>(`/payroll/tip/periods/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function saveTipParticipants(periodId: string, participants: TipParticipantInput[]) {
  return request<TipComputation>(`/payroll/tip/periods/${periodId}/participants`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participants })
  });
}

/** Gorjeta real no lugar da calculada; valor null tira o ajuste. */
export function setTipGorjetaReal(participantId: string, valor: number | null, motivo: string) {
  return request<TipComputation>(`/payroll/tip/participants/${participantId}/gorjeta-real`, json("PUT", { valor, motivo }));
}

export function removeTipParticipant(id: string) {
  return request<{ ok: boolean }>(`/payroll/tip/participants/${id}`, { method: "DELETE" });
}

export function addTipVale(participantId: string, payload: { type: TipValeType; amount: number; date?: string; notes?: string }) {
  return request<{ id: string; codigo: string | null }>(`/payroll/tip/participants/${participantId}/vales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

/** Vale lançado: fica no banco mesmo cancelado (só deixa de descontar). */
export type TipValeLancado = {
  id: string; participantId: string; employeeId: string; nome: string; apelido?: string | null;
  type: TipValeType; amount: number; date: string | null; notes: string | null;
  lancadoEm: string; lancadoPor: string | null; alteradoEm: string | null;
  canceladoEm: string | null; canceladoPor: string | null; motivoCancelamento: string | null;
  doFundo: boolean;
  /** Número impresso no recibo (VALE-AAAA-NNNNN). */
  codigo: string | null;
  reciboImpressoEm: string | null;
  reciboImpressoes: number;
};
export type TipValesPeriodo = {
  code: string; status: string;
  vales: TipValeLancado[];
  pessoas: Array<{ participantId: string | null; employeeId: string; nome: string; apelido?: string | null; semRegistro: boolean;
    /** Não participa da gorjeta: o vale desconta do salário na lista de pagamento. */
    foraDaGorjeta?: boolean;
    funcao: string | null; empresaId: string | null; empresa: string | null;
    gorjeta: number; descontos: number; creditos: number; liquida: number; pagoNaRescisao: boolean }>;
};
export type TipValeRelatorio = TipValeLancado & { periodo: string; competencia: string };

export function getTipVales(year: number, month: number) {
  return request<TipValesPeriodo>(`/payroll/tip/periods/${year}/${month}/vales`);
}
export function editarTipVale(id: string, payload: { type: TipValeType; amount: number; date?: string | null; notes?: string | null }) {
  return request<{ ok: boolean }>(`/payroll/tip/vales/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}
export function cancelarTipVale(id: string, motivo: string) {
  return request<{ ok: boolean }>(`/payroll/tip/vales/${id}/cancelar`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }),
  });
}
export type TipValeDescricao = { id: string; texto: string; tipo: TipValeType | null; ativo: boolean };
export function getTipValeDescricoes() {
  return request<TipValeDescricao[]>("/payroll/tip/vale-descricoes");
}
export function criarTipValeDescricao(texto: string, tipo: TipValeType | null) {
  return request<{ ok: boolean }>("/payroll/tip/vale-descricoes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto, tipo }),
  });
}
export function ativarTipValeDescricao(id: string, ativo: boolean) {
  return request<{ ok: boolean }>(`/payroll/tip/vale-descricoes/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo }),
  });
}
export type TipReciboVale = {
  codigo: string | null; vez: number;
  empresa: { razaoSocial: string; fantasia: string; cnpj: string; endereco: string; cidade: string | null };
  funcionario: { nome: string; cpf: string | null; funcao: string | null };
  vale: { tipo: TipValeType; valor: number; data: string | null; descricao: string | null };
  apuracao: { codigo: string; periodo: string };
  emitidoEm: string; emitidoPor: string;
};
/** Registra a emissão e devolve o que vai impresso. */
export function emitirReciboVale(id: string, empresaId: string | null) {
  return request<TipReciboVale>(`/payroll/tip/vales/${id}/recibo`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId }),
  });
}
/** Linha do recibo, como no holerite: código fixo do item, descrição em maiúsculas, referência (dias,
 *  horas, %, data do vale) e valor com sinal (positivo = vencimento, negativo = desconto). vale: vale ou crédito da gorjeta. */
export type ReciboLinha = { codigo: number; descricao: string; referencia: string | null; valor: number };
/** Cabeçalho do recibo: dados do cadastro. aniversario = "DD/MM" (sem o ano); codigo vazio quando o cadastro não tem. */
export type ReciboPessoa = {
  employeeId: string; nome: string; cpf: string | null; codigo: string | null; funcao: string | null;
  admissao: string | null; aniversario: string | null; valorMensal: number | null;
};
/** Recibo do pagamento do mês (lista de pagamento) de quem não tem registro. */
export type ReciboPagamentoMes = ReciboPessoa & {
  tipo: "PAGAMENTO_MES";
  /** Recebe por quinzena: o acerto sai no fim do próprio mês (os outros, no mês seguinte). */
  pagamentoQuinzenal: boolean;
  competencia: string; referencia: string;
  linhas: ReciboLinha[];
  /** A pagar da lista; total difere quando o acerto no Contas a Pagar tem outro valor (vira linha de ajuste). */
  totalLista: number;
  acerto: { valor: number; pago: boolean } | null;
  total: number;
  dataPagamento: string | null;
};
/** Recibo da 1ª quinzena (dia 15) ou do adiantamento (dia 20) de quem não tem registro. */
export type ReciboPagoAntes = ReciboPessoa & {
  tipo: "QUINZENA" | "ADIANTAMENTO";
  id: string;
  competencia: string; referencia: string;
  linhas: ReciboLinha[];
  total: number;
  dataPagamento: string | null;
};
/** Recibos do pagamento do mês (todos os sem registro com a receber, ou só um). Exige ver Funcionários. */
export function getRecibosPagamento(year: number, month: number, employeeId?: string) {
  const pessoa = employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : "";
  return request<{ competencia: string; recibos: ReciboPagamentoMes[] }>(`/payroll/tip/recibos-pagamento?year=${year}&month=${month}${pessoa}`);
}
/** Recibos da 1ª quinzena e do adiantamento dos sem registro (todos do mês, ou um lançamento). Exige ver Funcionários. */
export function getRecibosPagoAntes(year: number, month: number, id?: string) {
  const um = id ? `&id=${encodeURIComponent(id)}` : "";
  return request<{ competencia: string; recibos: ReciboPagoAntes[] }>(`/payroll/recibos-adiantamento?year=${year}&month=${month}${um}`);
}
export function getTipRelatorioVales(de: string, ate: string) {
  return request<TipValeRelatorio[]>(`/payroll/tip/reports/vales?de=${de}&ate=${ate}`);
}

/** Atualização dos salários combinados feita logo depois do fechamento (falha ou falta de permissão vira aviso). */
export type SincronizacaoAposFechar = {
  atualizados: number; detalhes: SincronizacaoSalariosCombinados | null; erro: string | null; aviso?: string | null;
};
/** Acertos da lista de pagamento (sem registro) lançados no Contas a Pagar como SALARIO.
 *  detalhes: nomes e valores, só para quem vê Funcionários (senão null). */
export type ResultadoAcertosLista = {
  competencia: string;
  criados: Array<{ employeeId: string; nome: string; valor: number; vencimento: string }>;
  atualizados: Array<{ employeeId: string; nome: string; antes: number; depois: number }>;
  semMudanca: number;
  avisos: string[];
  avisosSemValor: string[];
};
export type AcertosListaLancados = {
  criados: number; atualizados: number; semMudanca: number; avisos: string[]; detalhes: ResultadoAcertosLista | null;
};
/** Os mesmos, lançados logo depois do fechamento (falha ou falta de permissão vira aviso). */
export type AcertosAposFechar = {
  criados: number; atualizados: number; detalhes: ResultadoAcertosLista | null; erro: string | null; avisos: string[]; aviso?: string | null;
};
export function closeTipPeriodApi(year: number, month: number) {
  return request<TipComputation & { salariosCombinados?: SincronizacaoAposFechar | null; acertosLista?: AcertosAposFechar | null }>(
    `/payroll/tip/periods/${year}/${month}/close`, { method: "POST" });
}
/** Lança (ou atualiza o que não foi pago) o acerto de cada sem registro da lista no Contas a Pagar. */
export function lancarAcertosLista(year: number, month: number) {
  return request<AcertosListaLancados>(`/payroll/tip/periods/${year}/${month}/acertos-lista`, { method: "POST" });
}

export function reopenTipPeriodApi(year: number, month: number, motivo: string) {
  return request<TipComputation>(`/payroll/tip/periods/${year}/${month}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo })
  });
}

export type TipFechamentoResumo = {
  id: string; code: string; version: number; competenceYear: number; competenceMonth: number;
  periodStart: string; periodEnd: string; closedAt: string; closedByName: string;
  reopenedAt: string | null; reopenedByName: string | null; reopenReason: string | null;
  pessoas: number; liquido: number; distribuido: number; saldo: number; valorPonto: number; integro: boolean;
};

export type TipFechamentoDetalhe = Omit<TipFechamentoResumo, "pessoas" | "liquido" | "distribuido" | "saldo" | "valorPonto"> & {
  params: Record<string, unknown>;
  totals: Record<string, unknown>;
  participants: Array<Record<string, unknown>>;
  reserve: Record<string, unknown>;
  payloadHash: string;
  closedById: string;
};

export function getTipClosings(ano?: number) {
  return request<TipFechamentoResumo[]>(`/payroll/tip/closings${ano ? `?ano=${ano}` : ""}`);
}

export function getTipClosing(id: string) {
  return request<TipFechamentoDetalhe>(`/payroll/tip/closings/${id}`);
}

// elegiveis = quantos funcionarios tem participaGorjeta no cadastro. Serve para a
// tela distinguir "ja estao todos" de "nao ha ninguem marcado".
export function syncTipParticipants(periodId: string) {
  return request<{ added: number; elegiveis: number; atualizados: number; removidos?: number; computation: TipComputation }>(`/payroll/tip/periods/${periodId}/sync`, { method: "POST" });
}

export type ExtratoPreviewItem = {
  nome: string; cpf: string; liquido: number; gorjeta: number | null;
  matched: boolean; employeeId: string | null; employeeName: string | null; isActive: boolean | null;
};
/** Folha do mês ou adiantamento do dia 20: o mesmo "Extrato Mensal" da contabilidade. */
export type CalculoExtrato = "MENSAL" | "ADIANTAMENTO";
export type PrevisaoImportacaoRh = {
  novos: number; atualizar: number; zerados: number; desligados: number; excluidosAMao: number; jaPagos: number; comOutroRotulo: number;
};
export type ExtratoPreview = {
  calculo: CalculoExtrato;
  empresa: string; cnpj: string | null;
  competenceYear: number; competenceMonth: number;
  totalLiquido: number; matchedCount: number;
  items: ExtratoPreviewItem[];
  /** Pessoas lidas por inteiro (holerite) e quantas tiveram as somas conferidas. */
  pessoasLidas: number; pessoasConferidas: number;
  /** Quantas pessoas do extrato já têm o lançamento dele no Contas a Pagar (reimportar atualiza, não duplica). */
  lancamentosExistentes: number;
  /** O que a importação vai fazer com cada pessoa (backend novo; opcional). */
  previsao?: PrevisaoImportacaoRh;
  /** Rescisão não lançada, cadastro divergente, leitura que não fechou. Não bloqueiam. */
  avisos: string[];
};
export type TipReciboRescisao = {
  fonte: "TRCT"; arquivo: string; hash: string; gorjeta: number; liquido: number | null;
  admissao: string | null; afastamento: string | null; pagamento: string | null; importadoEm: string; importadoPor: string;
};
export type TipReciboPrevia = {
  employeeId: string; nome: string; arquivo: string; hash: string; gorjeta: number | null; liquido: number | null;
  admissao: string | null; afastamento: string | null; pagamento: string | null; divergencias: string[];
};
/** Lê o termo de rescisão (PDF) da contabilidade; com aplicar=true grava a gorjeta paga como valor quitado. */
export function lerReciboRescisao(year: number, month: number, fileBase64: string, fileName: string, aplicar: boolean) {
  return request<{ previa: TipReciboPrevia; aplicado: boolean; computation?: TipComputation }>(`/payroll/tip/periods/${year}/${month}/rescisao-recibo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64, fileName, aplicar }),
  });
}

export function previewExtratoRh(fileBase64: string) {
  return request<ExtratoPreview>("/payroll/tip/extrato/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64 }),
  });
}

export type ImportExtratoResult = {
  calculo: CalculoExtrato;
  empresa: string; companyId: string;
  competenceYear: number; competenceMonth: number;
  totalLiquido: number; funcionariosCadastrados: number; titulosGerados: number; rhExtractId: string;
  /** Dos títulos gravados: quantos já existiam (atualizados) e quantos são novos. */
  titulosAtualizados: number; titulosNovos: number;
  /** O mesmo arquivo já estava guardado: o registro foi completado, não duplicado. */
  extratoAtualizado: boolean;
  pessoasLidas: number; pessoasConferidas: number;
  /** Não gravados, somando todos os motivos abaixo. */
  titulosPulados?: number;
  /** Cada motivo com a sua contagem (backend novo; opcionais). Só "excluídos à mão" é exclusão de verdade. */
  excluidosAMao?: number; zerados?: number; desligados?: number; jaPagos?: number; comOutroRotulo?: number;
  /** Folha do mês: adiantamentos criados a partir do desconto da folha (sem o extrato do dia 20). */
  adiantamentosDaFolha?: number;
  avisos: string[];
};
export function importExtratoRh(fileBase64: string, fileName: string) {
  return request<ImportExtratoResult>("/payroll/tip/extrato/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64, fileName }),
  });
}

// ─── Extratos do RH guardados (PDF + holerite por pessoa) ─────────────────────
export type RhExtratoResumo = {
  id: string; competenceYear: number; competenceMonth: number; calculo: CalculoExtrato;
  empresa: string; cnpj: string | null; emissao: string | null; fileName: string; headcount: number;
  totalLiquido: number | null; totalProventos: number | null; totalDescontos: number | null;
  pessoas: number; naoConferidas: number;
  /** Falso = registro anterior ao armazenamento completo (sem pessoas guardadas). */
  detalhado: boolean;
  todasConferidas: boolean; temArquivo: boolean;
  importadoEm: string; atualizadoEm: string | null;
};
export type RhExtratoRubrica = { codigo: string; descricao: string; tipo: "P" | "D"; referencia: number | null; valor: number };
export type RhExtratoPessoa = {
  id: string; employeeId: string | null; employeeName: string | null;
  matricula: string; nome: string; situacao: string | null; vinculo: string | null; horasMes: number | null;
  cargoCodigo: string | null; cargo: string | null; cbo: string | null; salarioBase: number | null;
  admissao: string | null; demissao: string | null; demissaoMotivo: string | null;
  proventos: number; descontos: number; liquido: number;
  baseInss: number | null; baseFgts: number | null; baseIrrf: number | null; valorFgts: number | null;
  liquidoRescisao: number | null; conferido: boolean;
  rubricas: RhExtratoRubrica[];
};
export type RhExtratoDetalhe = {
  id: string; competenceYear: number; competenceMonth: number; calculo: CalculoExtrato;
  empresa: string; cnpj: string | null; emissao: string | null; fileName: string;
  totalLiquido: number | null; totalProventos: number | null; totalDescontos: number | null;
  pessoas: RhExtratoPessoa[];
};
export function listarRhExtratos(ano?: number) {
  return request<RhExtratoResumo[]>(`/payroll/tip/extratos${ano ? `?ano=${ano}` : ""}`);
}
export function getRhExtrato(id: string) {
  return request<RhExtratoDetalhe>(`/payroll/tip/extratos/${encodeURIComponent(id)}`);
}
/** O PDF original guardado no banco. */
export function getRhExtratoPdf(id: string) {
  return fetchBlob(`/payroll/tip/extratos/${encodeURIComponent(id)}/arquivo`);
}

export function getPayroll(year: number, month: number) {
  return request<PayrollList>(`/payroll?year=${year}&month=${month}`);
}

export function previewPayroll(year: number, month: number) {
  return request<PayrollPreview>("/payroll/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month })
  });
}

// VT e folha (adiantamento + salário) fecham em momentos diferentes — dá para
// gerar cada um isoladamente.
/** ADIANTAMENTO_SR: só o adiantamento do dia 20 de quem é sem registro e recebe adiantamento.
 *  QUINZENA_SR: só a 1ª quinzena (dia 15) de quem é sem registro e recebe por quinzena. */
export type PayrollKind = "ALL" | "VT" | "VT_Q1" | "VT_Q2" | "FOLHA" | "ADIANTAMENTO_SR" | "QUINZENA_SR";

// Valor ajustado à mão na prévia, quando o cálculo não bate com a realidade.
export type PayrollOverride = { employeeId: string; type: PayrollItemType; periodLabel: string; amount: number };

export function generatePayroll(year: number, month: number, kind: PayrollKind = "ALL", overrides: PayrollOverride[] = []) {
  return request<{ year: number; month: number; kind: PayrollKind; created: number; atualizados?: number; skipped: number; ajustados: number; avisos?: string[] }>("/payroll/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month, kind, overrides })
  });
}

export function payPayrollItem(id: string, payload: {
  paymentDate: string;
  paidAmount: number;
  paidPaymentMethodId?: string | null;
  paidPaymentMethodName?: string | null;
  paymentNotes?: string | null;
  differenceReason?: string | null;
  payingCompanyId?: string | null;
  companyBankAccountId?: string | null;
  /** Baixa mesmo já havendo o mesmo pagamento pago (409 BAIXA_DUPLICADA confirmado). */
  confirmaDuplicidade?: boolean;
}) {
  return request<{ id: string; status: string }>(`/payroll/${id}/pay`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// Lançamento manual na Folha. 409 DUPLICIDADE (já existe) ou APOS_SAIDA (depois do
// desligamento) voltam como ApiError com o corpo; reenviar com complemento/confirmaAposSaida.
export type LancamentoManualFolha = {
  employeeId: string;
  type: "SALARIO" | "ADIANTAMENTO" | "VALE_TRANSPORTE";
  competenceYear: number;
  competenceMonth: number;
  /** Só VT: 1, 2 ou null (mês inteiro). */
  quinzena?: 1 | 2 | null;
  amount: number;
  dueDate?: string;
  notes?: string;
  complemento?: boolean;
  motivoComplemento?: string;
  confirmaAposSaida?: boolean;
  motivoAposSaida?: string;
};
export function createPayrollItemManual(payload: LancamentoManualFolha) {
  return request<{ id: string; periodLabel: string; amount: number }>("/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// Confere o lote antes de baixar: o que já tem o mesmo pagamento pago e os repetidos no próprio lote.
export function checkPayrollPayBatch(ids: string[]) {
  return request<{ suspeitos: import("../lib/folha-duplicidade").SuspeitoLote[] }>("/payroll/pay-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
}

export function reversePayrollItem(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/payroll/${id}/reverse`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function deletePayrollItem(id: string, reason: string) {
  return request<{ ok: boolean }>(`/payroll/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function editPayrollItem(id: string, payload: { amount: number; dueDate: string; startDate?: string; endDate?: string; notes?: string }) {
  return request<{ id: string; status: string }>(`/payroll/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function restorePayrollItem(id: string) {
  return request<{ id: string; status: string }>(`/payroll/${id}/restore`, { method: "PATCH" });
}

export type TerminationInfo = {
  employee: { id: string; name: string; terminationDate: string | null; terminationReason: string | null };
  vtItems: Array<{ id: string; periodLabel: string; competenceYear: number; competenceMonth: number; amount: string; status: string; dueDate: string }>;
  alreadyReleased: boolean;
  rescisaoId: string | null;
  /** O que o sistema apura sozinho (null sem data de desligamento). */
  apuracao: ApuracaoRescisao | null;
  /** A rescisão já lançada (null se ainda não foi). */
  lancada: RescisaoLancada | null;
};

export type ValoresRescisaoLancada = { bruto: number; salario: number | null; gorjeta: number | null; vales: number; vtDesconto: number; outroDesconto: number; liquido: number; verbasOpcionaisTotal?: number | null };
export type RescisaoLancada = ValoresRescisaoLancada & {
  outroDescontoRotulo: string | null;
  valesRotulo: string | null;
  parcelas: Array<{ id: string; rotulo: string; valor: number; vencimento: string; paga: boolean }>;
  algumaPaga: boolean;
  /** Quitada sem valor (líquido zero ou saldo devedor perdoado): nada a pagar nem a estornar. */
  quitadaSemValor?: { saldoDevedorPerdoado: number } | null;
  notes: string | null;
  ajusteManual: { divergencias: Array<{ rotulo: string; apurado: number; lancado: number; diferenca: number }>; justificativa: string; porNome: string | null; em: string } | null;
  historicoAjustes: Array<{ em: string; porNome: string | null; justificativa: string; antes: ValoresRescisaoLancada; depois: ValoresRescisaoLancada }>;
  /** Verbas opcionais marcadas (sem registro) e quem marcou. valor/total null = oculto (sem ver Funcionários). */
  verbasOpcionais?: VerbasOpcionaisLancadas | null;
};

export type TipoVerbaOpcional = "FERIAS" | "DECIMO_TERCEIRO" | "AVISO" | "LIVRE";
export type VerbaOpcionalLancada = {
  tipo: TipoVerbaOpcional; rotulo: string; valor: number | null; memoria: string | null;
  avos?: number; dias?: number; terco?: number; descricao?: string;
};
export type VerbasOpcionaisLancadas = {
  itens: VerbaOpcionalLancada[]; total: number | null;
  por: { userId: string; nome: string | null; em: string } | null;
};
/** Cálculo das verbas opcionais de sem registro (fora do bruto sugerido). valor null = oculto. */
export type CalculoVerbasOpcionais = {
  base: number | null;
  inicio: string;
  ferias: { avos: number; inicioAquisitivo: string; ferias: number | null; terco: number | null; valor: number | null; memoria: string };
  decimoTerceiro: { avos: number; desde: string; valor: number | null; memoria: string };
  aviso: { dias: number; anos: number; valor: number | null; memoria: string };
  avisoFeriasVencidas: string | null;
};
export type VerbasOpcionaisApuracao = { calculo: CalculoVerbasOpcionais | null; observacao: string | null };
/** O que a tela marcou; o servidor recalcula férias, 13º e aviso. */
export type EscolhaVerbasOpcionais = {
  ferias: boolean; decimoTerceiro: boolean; aviso: boolean;
  livre: { valor: number; descricao: string } | null;
};

export type ApuracaoRescisao = {
  saida: string;
  semRegistro: boolean;
  vt: {
    total: number;
    dias: Array<{ data: string; custo: number; lancamento: string; pago: boolean }>;
    semDetalhe: string[];
    observacao: string | null;
  };
  vales: {
    itens: Array<{ codigo: string | null; data: string | null; tipo: string; descricao: string | null; valor: number }>;
    descontos: number; creditos: number; liquido: number; entraNaRescisao: boolean;
  };
  gorjeta: {
    periodo: string; status: "OPEN" | "CLOSED"; pontos: number; valorPonto: number; gorjeta: number;
    /** null = oculto (sem permissão de ver Funcionários). */
    pendente: boolean; diasSalario: number | null; salarioProporcional: number | null;
  } | null;
  gorjetaObservacao: string | null;
  /** vales inclui o adiantamento salarial e a 1ª quinzena já pagos (a parte de cada um em adiantamento e primeiraQuinzena). */
  /** creditos inclui a hora extra e o adicional noturno (a parte deles em horaExtra). */
  sugestao: {
    salario: number | null; gorjeta: number | null; creditos: number; horaExtra?: number; vales: number; valesRotulo: string | null;
    adiantamento?: number; primeiraQuinzena?: number; vtDesconto: number; bruto: number | null;
  };
  /** Sem registro que recebe adiantamento e saiu no dia dele ou depois. valor null = oculto. */
  adiantamento?: { valor: number | null; data: string } | null;
  /** Sem registro que recebe por quinzena e saiu no dia 15 ou depois. valor null = oculto. */
  primeiraQuinzena?: { valor: number | null; data: string } | null;
  /** Sem registro com horas na gorjeta do período da saída: entra nos créditos. valor (HE + noturno + DSR) null = oculto.
   *  dsr = a parte do DSR (ausente quando não há ou nas apurações de antes dele). */
  horaExtra?: { horaExtra: string | null; adicionalNoturno: string | null; dsr?: number | null; valor: number | null } | null;
  dadosPessoaisOcultos?: boolean;
  /** Salário e gorjeta até a saída já pagos na lista de pagamento da gorjeta (sem registro). */
  jaPagoNaLista?: { valor: number; competencia: string } | null;
  /**
   * Sem registro que saiu depois do fim do ciclo, ainda no mês do salário: [0] o ciclo do
   * mês, [1] os dias depois dele. valor null = não apurado (período inexistente, fora dele
   * ou serviço pendente).
   */
  gorjetaPartes?: Array<{ periodo: string; competencia: string; dias: string; valor: number | null; pendente: boolean; jaPagoNaLista: boolean }> | null;
  /** Sem registro: férias + 1/3, 13º e aviso calculados, fora do bruto sugerido (só entram se marcados). */
  verbasOpcionais?: VerbasOpcionaisApuracao | null;
};

export function getTerminationInfo(employeeId: string) {
  return request<TerminationInfo>(`/payroll/termination/${employeeId}`);
}

// ─── RH → Rescisões ─────────────────────────────────────────────────────────────
/** Termo de rescisão (TRCT) lido na gorjeta do período da saída. */
export type TermoRescisaoResumo = { arquivo: string | null; importadoEm: string | null; gorjeta: number | null; liquido: number | null; pagamento: string | null };
export type RescisaoResumo = {
  employeeId: string; nome: string; apelido: string | null; empresa: string | null; semRegistro: boolean;
  /** aaaa-mm-dd; null = ainda sem data de saída. */
  saida: string | null; motivo: string | null;
  rescisao: {
    parcelas: number; pagas: number; liquido: number; valorPago: number; proximoVencimento: string | null;
    /** Registrada como quitada no termo (líquido zero, nada a pagar): o lançamento, para desfazer. */
    quitadaNoTermo?: { itemId: string } | null;
    /** Quitada sem valor (líquido zero ou saldo devedor perdoado): o lançamento e o perdoado. */
    quitadaSemValor?: { itemId: string; saldoDevedorPerdoado: number } | null;
  } | null;
  termo: TermoRescisaoResumo | null;
};
export type PessoaAtiva = { employeeId: string; nome: string; apelido: string | null; empresa: string | null; semRegistro: boolean };
export type ListaRescisoes = { hoje: string; pessoas: RescisaoResumo[]; ativos: PessoaAtiva[] };
/** Lançamento da Folha ainda não pago que vence depois da saída. */
export type ItemFolhaAposSaida = {
  id: string; tipo: PayrollItemType; rotulo: string; competencia: string; valor: number; vencimento: string;
  /** Bilhete mensal e ajuda de custo ficam com a pessoa no mês da saída; null = VT por trajeto (ou não é VT). */
  ficaComAPessoa: "BILHETE_MENSAL" | "AJUDA_DE_CUSTO" | null;
};
export type DetalheRescisao = {
  pessoa: RescisaoResumo;
  itensAposSaida: ItemFolhaAposSaida[];
  periodoGorjeta: { year: number; month: number; label: string; fechado: boolean; participa: boolean } | null;
  extratoDoMes: { competencia: string; importado: boolean; pessoaNoExtrato: boolean } | null;
};

export function getRescisoes() {
  return request<ListaRescisoes>("/payroll/rescisoes");
}

export function getRescisaoDetalhe(employeeId: string) {
  return request<DetalheRescisao>(`/payroll/rescisoes/${encodeURIComponent(employeeId)}`);
}

/** Prévia do termo (TRCT) para registrar a rescisão como quitada no termo (líquido zero). */
export type TermoSemValorPrevia = {
  employeeId: string; nome: string; nomeNoTermo: string | null; arquivo: string; hash: string;
  admissao: string | null; afastamento: string | null; pagamento: string | null;
  liquido: number | null; totalBruto: number | null; gorjeta: number | null;
  /** Avisos para conferir (não impedem quitar). */
  divergencias: string[];
  podeQuitar: boolean;
  /** Por que não dá para marcar como quitada (null = dá). */
  recusa: string | null;
};
/** Lê o termo; com aplicar=true registra a rescisão de R$ 0,00 paga na data do termo (fora do Contas a Pagar). */
export function registrarTermoSemValor(employeeId: string, fileBase64: string, fileName: string, aplicar: boolean) {
  return request<{ previa: TermoSemValorPrevia; aplicado: boolean; item?: { id: string; competencia: string; pagamento: string } }>(
    `/payroll/rescisoes/${encodeURIComponent(employeeId)}/termo-sem-valor`,
    json("POST", { fileBase64, fileName, aplicar }),
  );
}

export type RescisaoPartes = { salario?: number; gorjeta?: number; valesDiscount?: number; valesLabel?: string; verbasOpcionais?: EscolhaVerbasOpcionais };

export function adjustTermination(employeeId: string, payload: RescisaoPartes & { grossAmount: number; vtDiscount: number; otherDiscount: number; otherDiscountLabel?: string; notes?: string; justificativa: string }) {
  return request<{ ok: boolean; lancada: RescisaoLancada }>(`/payroll/termination/${employeeId}`, json("PUT", payload));
}

export function releaseTermination(employeeId: string, payload: RescisaoPartes & { grossAmount: number; vtDiscount: number; otherDiscount?: number; otherDiscountLabel?: string; dueDate?: string; installments?: number; notes?: string; ajusteJustificativa?: string }) {
  return request<{ id: string; amount: number; installments: number; items: Array<{ id: string; amount: number; dueDate: string; installmentNumber: number }>; quitadaSemValor?: boolean; saldoDevedorPerdoado?: number }>(`/payroll/termination/${employeeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function releaseVacation(payload: { employeeId: string; startDate: string; endDate: string; amount: number; dueDate?: string; notes?: string }) {
  return request<{ id: string; amount: number }>("/payroll/vacation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// ─── Afastamento não remunerado (dias AFASTAMENTO na Escala, sem lançamento) ───
export type Afastamento = { employeeId: string; employeeName: string; inicio: string; fim: string; dias: number; motivo: string | null };
export type AfastamentoPayload = { employeeId: string; inicio: string; fim: string; motivo: string };
export type AfastamentoGravado = { employeeId: string; inicio: string; fim: string; dias: number; motivo: string; substituidas: number; avisos: string[] };

export function getAfastamentos(year: number, month: number) {
  return request<{ year: number; month: number; afastamentos: Afastamento[] }>(`/payroll/afastamentos?year=${year}&month=${month}`);
}

export function lancarAfastamento(payload: AfastamentoPayload) {
  return request<AfastamentoGravado>("/payroll/afastamentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function editarAfastamento(payload: AfastamentoPayload & { inicioAtual: string; fimAtual: string }) {
  return request<AfastamentoGravado>("/payroll/afastamentos", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function excluirAfastamento(a: { employeeId: string; inicio: string; fim: string }) {
  const q = new URLSearchParams({ employeeId: a.employeeId, inicio: a.inicio, fim: a.fim });
  return request<{ ok: boolean; dias: number; avisos: string[] }>(`/payroll/afastamentos?${q.toString()}`, { method: "DELETE" });
}

export function saveEmployee(payload: EmployeePayload) {
  if (payload.id) {
    return request<Employee>(`/employees/${payload.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  return request<Employee>("/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function setEmployeeStatus(id: string, isActive: boolean) {
  return request<Employee>(`/employees/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive })
  });
}

export function terminateEmployee(id: string, terminationDate: string, terminationReason?: string) {
  return request<Employee>(`/employees/${id}/terminate`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terminationDate, terminationReason })
  });
}

export function deleteEmployee(id: string, reason: string) {
  return request<{ ok: boolean }>(`/employees/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export function restoreEmployee(id: string) {
  return request<{ id: string; isActive: boolean }>(`/employees/${id}/restore`, { method: "PATCH" });
}

export function adjustHolidayComp(id: string, delta: number) {
  return request<{ id: string; holidayCompBalance: number }>(`/employees/${id}/holiday-comp`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta })
  });
}

// ─── Leitura de documentos (IA) ───────────────────────────────────────────────
export type DocIntakeAviso = { nivel: "BLOQUEIO" | "ATENCAO"; codigo: string; mensagem: string };

export type DocIntakeParte = {
  nome: string | null;
  cnpj: string | null;
  cnpjDigits: string | null;
  cnpjValido: boolean;
};

export type DocIntakeRubrica = { descricao: string; valor: number | null; valorRaw: string };

export type DocIntakeDocumento = {
  nomeArquivo: string;
  hash: string;
  tipoDocumento: "NFSE" | "NFE" | "BOLETO" | "FATURA" | "OUTRO";
  emissor: DocIntakeParte;
  destinatario: DocIntakeParte;
  numeroDocumento: string | null;
  dataEmissao: string | null;
  dataEmissaoRaw: string | null;
  dataVencimento: string | null;
  dataVencimentoRaw: string | null;
  valorTotal: number | null;
  valorTotalRaw: string | null;
  rubricas: DocIntakeRubrica[];
  linhaDigitavel: string | null;
  documentoReferenciado: string | null;
  observacoes: string | null;
  chaveTitulo: string | null;
  lidoPorImagem: boolean;
  avisos: DocIntakeAviso[];
  fornecedor: { cadastrado: true; id: string; nome: string } | { cadastrado: false };
  empresa: { id: string; nome: string } | null;
  duplicatas: Array<{ id: string; invoiceNumber: string | null; purchaseDate: string; totalAmount: string; status: string }>;
  podeConfirmar: boolean;
  meta: { model: string; tokensUsed: number | null; paginas: number | null };
};

export type DocIntakeProdutoSugerido = {
  id: string;
  nome: string;
  unidade: string | null;
  codigoExterno: string | null;
  categoria: string | null;
  subcategoria: string | null;
};

/** Sugestão de produto para uma linha lida do documento. */
export type DocIntakeSugestaoLinha = {
  descricaoLida: string;
  sugestao: DocIntakeProdutoSugerido | null;
  /** ALTA vem pré-selecionada; MEDIA e BAIXA só são oferecidas. */
  confianca: "ALTA" | "MEDIA" | "BAIXA" | null;
  motivo: string | null;
  alternativas: DocIntakeProdutoSugerido[];
};

/** Uma parcela do título — normalmente veio de um boleto. */
export type DocIntakeParcela = {
  numero: number;
  dataVencimento: string | null;
  valor: number | null;
  /** Arquivo de onde a parcela veio, para a conferência. */
  origem: string;
  linhaDigitavel: string | null;
  rotuloLido: string | null;
};

/** Rascunho consolidado de um título — nota e boletos fundidos num lançamento só. */
export type DocIntakeTitulo = {
  parcelas: DocIntakeParcela[];
  /** Uma sugestão por rubrica lida, na mesma ordem. */
  sugestoesItens: DocIntakeSugestaoLinha[];
  chave: string | null;
  documentos: string[];
  tipoPrincipal: string;
  fornecedor: { cadastrado: true; id: string; nome: string } | { cadastrado: false };
  fornecedorNome: string | null;
  empresa: { id: string; nome: string } | null;
  numeroDocumento: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  valorTotal: number | null;
  rubricas: DocIntakeRubrica[];
  linhaDigitavel: string | null;
  duplicatas: Array<{ id: string; invoiceNumber: string | null; purchaseDate: string; totalAmount: string; status: string }>;
  lidoPorImagem: boolean;
  avisos: DocIntakeAviso[];
  podeConfirmar: boolean;
};

export type DocIntakePreview = {
  documentos: DocIntakeDocumento[];
  titulos: DocIntakeTitulo[];
  falhas: Array<{ arquivo: string; erro: string }>;
};

/** Progresso da leitura, emitido pelo servidor conforme cada arquivo é lido. */
export type DocIntakeProgresso =
  | { tipo: "inicio"; total: number }
  | { tipo: "arquivo"; indice: number; nome: string; situacao: "lendo" | "lido" | "falhou"; erro?: string }
  | { tipo: "etapa"; descricao: string };

/**
 * Lê documentos acompanhando o progresso.
 *
 * A resposta vem em NDJSON (uma linha JSON por evento) porque a leitura leva
 * dezenas de segundos: esperar o JSON inteiro deixaria a tela muda o tempo todo.
 */
export async function previewDocumentos(
  arquivos: Array<{ nome: string; base64: string }>,
  aoProgredir?: (evento: DocIntakeProgresso) => void,
): Promise<DocIntakePreview> {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resposta = await fetch(`${API_BASE_URL}/doc-intake/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ arquivos }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    throw new ApiError(corpo?.message ?? `Falha na leitura (HTTP ${resposta.status}).`, resposta.status, corpo ?? undefined);
  }
  if (!resposta.body) throw new Error("O navegador não entregou a resposta da leitura.");

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let pendente = "";
  let resultado: DocIntakePreview | null = null;

  const processarLinha = (linha: string) => {
    const texto = linha.trim();
    if (!texto) return;
    const evento = JSON.parse(texto) as DocIntakeProgresso | { tipo: "fim" } & DocIntakePreview | { tipo: "erro"; mensagem: string };
    if (evento.tipo === "fim") {
      const { tipo, ...dados } = evento as { tipo: string } & DocIntakePreview;
      resultado = dados;
      return;
    }
    if (evento.tipo === "erro") throw new Error((evento as { mensagem: string }).mensagem);
    aoProgredir?.(evento as DocIntakeProgresso);
  };

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    pendente += decodificador.decode(value, { stream: true });
    // A última parte pode estar cortada no meio: fica para o próximo pedaço.
    const linhas = pendente.split("\n");
    pendente = linhas.pop() ?? "";
    for (const linha of linhas) processarLinha(linha);
  }
  if (pendente.trim()) processarLinha(pendente);

  if (!resultado) throw new Error("A leitura terminou sem devolver o resultado.");
  return resultado;
}

// ─── Gorjeta: contabilidade, conferência dos extratos e folha de líquidos ────
export type TipEtapa = "ENVIADO_CONTABILIDADE" | "OK_CONTABILIDADE" | "FOLHA_PAGA";
export type TipEtapasEstado = {
  estado: Record<TipEtapa, { marcada: boolean; em: string | null; por: string | null; obs: string | null }>;
  historico: Array<{ etapa: string; acao: "MARCOU" | "DESMARCOU"; em: string; por: string; obs: string | null }>;
};
export type TipStatusConferencia =
  | "OK" | "DIVERGE" | "ACEITA" | "SALARIO_COMBINADO"
  | "FALTA_NO_EXTRATO" | "SO_NO_EXTRATO" | "SEM_EXTRATO_DA_EMPRESA" | "NAO_PARTICIPA" | "VINCULO_A_CONFIRMAR";
export type TipLinhaConferencia = {
  chave: string; employeeId: string | null; nome: string; empresa: string | null;
  /** extrato ausente/null: pelo teto do IR, sem permissão de ver Funcionários (o valor do extrato É o teto − salário). */
  apuracao: number | null; extrato?: number | null; diferenca: number | null;
  status: TipStatusConferencia; justificativa: string | null;
  extratoId?: string; nomeNoExtrato?: string;
  apelido?: string | null;
  /** A apuração é a gorjeta informada pelo teto do IR (sem permissão, apuração e diferença vêm null). */
  peloTeto?: boolean;
  /** CLT desligado no mês: a gorjeta foi paga na rescisão (conferida com o extrato quando aparece nele). */
  naRescisao?: boolean;
};
export type TipExtratoMeta = { id: string; empresa: string; cnpj: string; arquivo: string; hash: string; importadoEm: string; importadoPor: string; pessoas: number };
export type TipConferencia = {
  extratos: TipExtratoMeta[];
  linhas: TipLinhaConferencia[];
  pendentes: number;
};
export type TipConferenciaCompleta = TipConferencia & {
  code: string; status: string; etapas: TipEtapasEstado; podeVerFolha: boolean;
};
export type TipLinhaFolha = {
  employeeId: string | null; nome: string; grupo: string; origem: "EXTRATO" | "SALARIO_COMBINADO" | "SEM_REGISTRO";
  /** Ausente/null para quem não vê Funcionários na linha de salário combinado. */
  valor: number; composicao?: string | null; pix: string | null; aviso: string | null;
  /** Tipo da chave PIX (CPF, e-mail, telefone, aleatória) e a conta do cadastro numa linha. */
  pixTipo?: string | null; contaBancaria?: string | null;
};
export type TipFolhaLiquidos = {
  code: string; label: string; linhas: TipLinhaFolha[]; total: number; extratos: string[]; etapas: TipEtapasEstado;
  salariosCombinados?: Array<{ employeeId: string; nome: string; apelido?: string | null; valor: number; motivo: string | null }>;
  /** Salário da competência já baixado no Contas a Pagar: fora da lista e do total. */
  jaPagos?: Array<{ employeeId: string; nome: string; grupo: string; valor: number; pagoEm: string }>;
};

const baseTip = (year: number, month: number) => `/payroll/tip/periods/${year}/${month}`;
const json = (method: string, body?: unknown) => ({
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export function getTipConferencia(year: number, month: number) {
  return request<TipConferenciaCompleta>(`${baseTip(year, month)}/conferencia`);
}
/** Diferença de uma pessoa entre o extrato guardado e o novo (valores null sem ver Funcionários). */
export type TipDiferencaExtrato = {
  employeeId: string | null; nome: string; situacao: "MUDOU" | "ENTROU" | "SAIU";
  liquidoAntes: number | null; liquidoDepois: number | null; gorjetaAntes: number | null; gorjetaDepois: number | null;
};
/** Salário do Contas a Pagar (Retorno do RH, em aberto) diferente do líquido do extrato novo. */
export type TipSalarioDesatualizado = { employeeId: string; nome: string; noContasAPagar: number | null; extratoNovo: number | null; titulo: string | null };
export type TipTrocaExtrato = {
  motivo: string | null; diferencas: TipDiferencaExtrato[]; contasAPagar: TipSalarioDesatualizado[];
  gorjetaMudou: boolean; avisoContasAPagar: string | null;
};
/** Com `substitui` (id do extrato) e `motivo`: troca o extrato da empresa, inclusive com o OK dado e a folha liberada. */
export function enviarTipExtrato(year: number, month: number, fileBase64: string, fileName: string, troca?: { substitui: string; motivo?: string }) {
  return request<TipConferencia & { avisos: string[]; troca?: TipTrocaExtrato }>(`${baseTip(year, month)}/extratos`, json("POST", { fileBase64, fileName, ...troca }));
}
export function removerTipExtrato(year: number, month: number, id: string) {
  return request<TipConferencia>(`${baseTip(year, month)}/extratos/${id}`, { method: "DELETE" });
}
export function aceitarTipDivergencia(year: number, month: number, chave: string, justificativa: string) {
  return request<TipConferencia>(`${baseTip(year, month)}/conferencia/aceites`, json("PUT", { chave, justificativa }));
}
export function desfazerTipAceite(year: number, month: number, chave: string) {
  return request<TipConferencia>(`${baseTip(year, month)}/conferencia/aceites?chave=${encodeURIComponent(chave)}`, { method: "DELETE" });
}
/** Confirma (ou recusa) que a pessoa do extrato, achada pelo nome, é a do cadastro. */
export function confirmarTipVinculo(year: number, month: number, extratoId: string, nome: string, confirma: boolean) {
  return request<TipConferencia>(`${baseTip(year, month)}/extratos/${extratoId}/vinculo`, json("PUT", { nome, confirma }));
}
export function marcarTipEtapa(year: number, month: number, etapa: TipEtapa, acao: "MARCOU" | "DESMARCOU", obs?: string) {
  return request<TipEtapasEstado>(`${baseTip(year, month)}/etapas`, json("POST", { etapa, acao, obs }));
}
export function getTipFolhaLiquidos(year: number, month: number) {
  return request<TipFolhaLiquidos>(`${baseTip(year, month)}/folha-liquidos`);
}

// ─── Lote de pagamento da folha (passo "Liberar para pagamento") ──────────────
export type TipFolhaLote = {
  id: string; rotulo: string; grupo: string; dueDate: string; status: "ABERTO" | "PAGO" | string;
  total: number; pessoas: number; paymentDate: string | null; paidPaymentMethodName: string | null;
};
export type TipFolhaLotePrevia = {
  grupos: Array<{ grupo: string; rotulo: string; total: number; membros: Array<{ payrollItemId: string; employeeId: string; nome: string; valor: number }> }>;
  avisos: string[];
  lotes: TipFolhaLote[];
  vencimento: string;
};
export type TipFolhaLiberada = {
  criados: Array<{ id: string; rotulo: string }>; acrescentados: number; jaLiberada: boolean; avisos: string[];
  lotes: TipFolhaLote[]; etapas: TipEtapasEstado;
  /** Salários da competência em aberto fora dos títulos (a folha paga não marca enquanto houver). */
  soltos?: number;
};
export function getTipFolhaLotes(year: number, month: number) {
  return request<{ lotes: TipFolhaLote[]; soltos?: number }>(`${baseTip(year, month)}/folha-lotes`);
}
export function getTipFolhaLotesPrevia(year: number, month: number) {
  return request<TipFolhaLotePrevia>(`${baseTip(year, month)}/folha-lotes/previa`);
}
export function liberarTipFolha(year: number, month: number) {
  return request<TipFolhaLiberada>(`${baseTip(year, month)}/folha-lotes/liberar`, json("POST", {}));
}
export function cancelarTipFolhaLiberada(year: number, month: number, motivo: string) {
  return request<{ cancelados: number; salariosSoltos: number; etapas: TipEtapasEstado }>(`${baseTip(year, month)}/folha-lotes/cancelar`, json("POST", { motivo }));
}
export function payFolhaLote(id: string, payload: Parameters<typeof payPayrollItem>[1] & { confirmaDuplicidadeIds?: string[] }) {
  return request<{ id: string; status: string; membros: number; folhaPaga: boolean }>(`/payroll/folha-lotes/${id}/pay`, json("PATCH", payload));
}
export function reverseFolhaLote(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/payroll/folha-lotes/${id}/reverse`, json("PATCH", { reason }));
}
export function retirarDoFolhaLote(id: string, payrollItemId: string) {
  return request<{ aParte: { id: string; rotulo: string }; loteCancelado: boolean }>(`/payroll/folha-lotes/${id}/membros/${payrollItemId}/retirar`, json("PATCH", {}));
}
export function devolverAoFolhaLote(id: string, payrollItemId: string) {
  return request<{ destino: { id: string; rotulo: string }; folhaAParteCancelada: boolean }>(`/payroll/folha-lotes/${id}/membros/${payrollItemId}/devolver`, json("PATCH", {}));
}
export type SincronizacaoSalariosCombinados = {
  competencia: string;
  alterados: Array<{ payrollItemId: string; employeeId: string; nome: string; antes: number; depois: number; pendenteGorjeta: boolean }>;
  semMudanca: number;
  pagosIgnorados: number;
  avisos: string[];
};
/** Recalcula o salário (não pago) de quem tem salário combinado no Contas a Pagar com o valor integral. */
export function sincronizarSalariosCombinados(year: number, month: number) {
  return request<SincronizacaoSalariosCombinados>(`${baseTip(year, month)}/salarios-combinados/sincronizar`, json("POST"));
}
export function salvarSalarioCombinado(employeeId: string, valor: number | null, motivo: string | null) {
  return request<{ ok: boolean }>(`/payroll/tip/team/${employeeId}/salario-combinado`, json("PUT", { valor, motivo }));
}

// ─── Extras por diária ────────────────────────────────────────────────────────
export type ExtraOrigem = "CASA" | "FORA";
export type ExtraDuracao = "INTEIRA" | "MEIA";
export type ExtraMotivo = "COBERTURA_FALTA" | "COBERTURA_FOLGA" | "COBERTURA_FERIAS" | "EVENTO" | "MOVIMENTO" | "OUTRO";
export type ExtraStatus = "PREVISTA" | "REALIZADA" | "NAO_COMPARECEU" | "CANCELADA";
export type ExtraPixTipo = "CPF" | "CNPJ" | "EMAIL" | "TELEFONE" | "ALEATORIA";

export type ExtraPessoaCasa = {
  tipo: "CASA";
  id: string;
  nome: string;
  apelido: string | null;
  setor: string | null;
  cargo: string | null;
  modalidade: "CLT" | "NAO_CLT";
  ativo: boolean;
  desligadoEm: string | null;
  telefone: string | null;
};
export type ExtraPessoaFora = {
  tipo: "FORA";
  id: string;
  nome: string;
  apelido: string | null;
  telefone: string | null;
  indicadoPor: string | null;
  observacao: string | null;
  ativo: boolean;
  cpf: string | null;
  pixKeyType: ExtraPixTipo | null;
  pixKey: string | null;
};
export type ExtraPessoas = { podeVerDados: boolean; casa: ExtraPessoaCasa[]; fora: ExtraPessoaFora[] };
export type ExtraPessoaForaPayload = {
  fullName: string;
  displayName?: string | null;
  cpf?: string | null;
  phone?: string | null;
  pixKeyType?: ExtraPixTipo | null;
  pixKey?: string | null;
  referredBy?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type ExtraDiaria = {
  id: string;
  date: string;
  origem: ExtraOrigem;
  pessoaId: string;
  pessoaNome: string;
  pessoaApelido: string | null;
  modalidade: "CLT" | "NAO_CLT" | null;
  sector: string;
  role: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: ExtraDuracao;
  reason: ExtraMotivo;
  eventName: string | null;
  coveredEmployeeId: string | null;
  coveredNome: string | null;
  baseAmount: number;
  baseAdjustReason: string | null;
  transportAmount: number;
  bonusAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: ExtraStatus;
  notes: string | null;
  paymentId: string | null;
  paymentCode: string | null;
  pago: boolean;
};
export type ExtraGrupo = { chave: string; total: number; diarias: number };
export type ExtraResumo = {
  custoRealizado: number;
  // Diferença de valor pago nos títulos do mês (já somada em custoRealizado).
  diferencaPaga: number;
  custoPrevisto: number;
  custoCasa: number;
  custoFora: number;
  diariasRealizadas: number;
  naoCompareceu: number;
  porSetor: ExtraGrupo[];
  porMotivo: ExtraGrupo[];
  porEvento: ExtraGrupo[];
  porPessoa: Array<{ pessoaId: string; nome: string; origem: ExtraOrigem; total: number; diarias: number }>;
};
export type ExtraDiariasMes = {
  year: number;
  month: number;
  itens: ExtraDiaria[];
  resumo: ExtraResumo;
  padrao: { inteira: number; meia: number };
};
export type ExtraDiariaPayload = {
  date: string;
  employeeId: string | null;
  extraWorkerId: string | null;
  sector: string;
  role: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: ExtraDuracao;
  reason: ExtraMotivo;
  eventName: string | null;
  coveredEmployeeId: string | null;
  status: ExtraStatus;
  baseAmount: number;
  baseAdjustReason: string | null;
  transportAmount: number;
  bonusAmount: number;
  discountAmount: number;
  notes: string | null;
};
export type ExtraLimitesHabitualidade = { porSemana: number; em30Dias: number; semanasSeguidas: number };
export type ExtraValores = { diariaValor: number; meiaDiariaValor: number; habitualidade?: ExtraLimitesHabitualidade };

export function getExtraSettings() {
  return request<ExtraValores>("/extras/settings");
}
export function saveExtraSettings(valores: ExtraValores) {
  return request<ExtraValores>("/extras/settings", json("PUT", valores));
}
export function getExtraPessoas(includeInactive = false) {
  return request<ExtraPessoas>(`/extras/people${toQueryString({ includeInactive })}`);
}
export function createExtraPessoa(payload: ExtraPessoaForaPayload) {
  return request<{ id: string }>("/extras/people", json("POST", payload));
}
export function updateExtraPessoa(id: string, payload: ExtraPessoaForaPayload) {
  return request<{ ok: boolean }>(`/extras/people/${id}`, json("PUT", payload));
}
export function deleteExtraPessoa(id: string) {
  return request<{ ok: boolean }>(`/extras/people/${id}`, { method: "DELETE" });
}
export function getExtraDiarias(year: number, month: number) {
  return request<ExtraDiariasMes>(`/extras/shifts${toQueryString({ year: String(year), month: String(month) })}`);
}
export function createExtraDiaria(payload: ExtraDiariaPayload) {
  return request<{ id: string }>("/extras/shifts", json("POST", payload));
}
export function updateExtraDiaria(id: string, payload: ExtraDiariaPayload) {
  return request<{ ok: boolean }>(`/extras/shifts/${id}`, json("PUT", payload));
}
export function deleteExtraDiaria(id: string, reason: string) {
  return request<{ ok: boolean }>(`/extras/shifts/${id}`, json("DELETE", { reason }));
}

// ─── Extras: pagamentos (títulos no Contas a Pagar) ───────────────────────────
export type ExtraSituacaoPagamento = "OPEN" | "OVERDUE" | "PAID" | "CANCELED";
export type ExtraPendente = {
  id: string;
  date: string;
  duration: ExtraDuracao;
  sector: string;
  totalAmount: number;
  origem: ExtraOrigem;
  pessoaId: string;
  nome: string;
  apelido: string | null;
};
export type ExtraPagamento = {
  id: string;
  code: string;
  origem: ExtraOrigem;
  pessoaId: string;
  nome: string;
  apelido: string | null;
  amount: number;
  dueDate: string;
  paymentDate: string | null;
  paidAmount: number | null;
  paidPaymentMethodName: string | null;
  situacao: ExtraSituacaoPagamento;
  cancelReason: string | null;
  diarias: Array<{ id: string; date: string; duration: ExtraDuracao; totalAmount: number }>;
};
export type ExtraPagamentos = { pendentes: ExtraPendente[]; pagamentos: ExtraPagamento[] };
export type ExtraRecibo = {
  code: string;
  origem: ExtraOrigem;
  nome: string;
  apelido: string | null;
  cpf: string | null;
  pixKey: string | null;
  pixKeyType: string | null;
  amount: number;
  dueDate: string;
  paymentDate: string | null;
  paidAmount: number | null;
  paidPaymentMethodName: string | null;
  diarias: Array<{
    date: string; duration: ExtraDuracao; sector: string; role: string | null; eventName: string | null; startTime: string | null; endTime: string | null;
    baseAmount: number; transportAmount: number; bonusAmount: number; discountAmount: number; totalAmount: number;
  }>;
};

export function getExtraPagamentos(year: number, month: number) {
  return request<ExtraPagamentos>(`/extras/payments${toQueryString({ year: String(year), month: String(month) })}`);
}
export function gerarPagamentoExtras(shiftIds: string[], dueDate: string, notes: string | null) {
  return request<{ pagamentos: Array<{ id: string; code: string; amount: number }> }>("/extras/payments", json("POST", { shiftIds, dueDate, notes }));
}
export function cancelarPagamentoExtra(id: string, reason: string) {
  return request<{ ok: boolean; diariasSoltas: number }>(`/extras/payments/${id}/cancel`, json("POST", { reason }));
}
export function getReciboExtra(id: string) {
  return request<ExtraRecibo>(`/extras/payments/${id}/receipt`);
}
export function payExtraPayment(id: string, payload: Parameters<typeof payPayrollItem>[1]) {
  return request<{ id: string; status: string }>(`/extras/payments/${id}/pay`, json("PATCH", payload));
}
export function reverseExtraPayment(id: string, reason: string) {
  return request<{ id: string; status: string }>(`/extras/payments/${id}/reverse`, json("PATCH", { reason }));
}

// ─── Extras: painel por período e habitualidade ───────────────────────────────
export type ExtraMesPainel = {
  mes: string;
  casa: number;
  fora: number;
  diferencaPaga: number;
  total: number;
  diarias: number;
  // null = o usuário não pode ver Folha / Faturamento.
  folha: number | null;
  faturamento: number | null;
};
export type ExtraPainel = {
  ate: string;
  meses: ExtraMesPainel[];
  verFolha: boolean;
  verFaturamento: boolean;
  porSetor: ExtraGrupo[];
  porMotivo: ExtraGrupo[];
  porEvento: ExtraGrupo[];
  porPessoa: Array<{ pessoaId: string; nome: string; origem: ExtraOrigem; total: number; diarias: number }>;
};
export type ExtraAvaliacao = {
  diasUltimos30: number;
  maiorSemana: number;
  semanaDaMaior: string | null;
  semanasSeguidas: number;
  motivos: string[];
  emRisco: boolean;
};
export type ExtraHabitualidade = {
  hoje: string;
  limites: ExtraLimitesHabitualidade;
  pessoas: Array<ExtraAvaliacao & { id: string; nome: string; apelido: string | null; ativo: boolean }>;
  simulacao: (ExtraAvaliacao & { pessoa: string; data: string }) | null;
};

export function getExtraPainel(ate: string, meses: number) {
  return request<ExtraPainel>(`/extras/painel${toQueryString({ ate, meses: String(meses) })}`);
}
export type ExtraEventoUsado = { nome: string; ultimo: string; diarias: number };
export function getExtraEventos() {
  return request<ExtraEventoUsado[]>("/extras/events");
}
export function getExtraHabitualidade(simular?: { pessoa: string; data: string; ignorar?: string }) {
  return request<ExtraHabitualidade>(`/extras/habitualidade${toQueryString(simular ?? {})}`);
}

// ─── Fichas cadastrais (link para a pessoa preencher) ──────────────────────────
export type FichaCadastralStatus = "ENVIADA" | "PREENCHENDO" | "FINALIZADA" | "CONCLUIDA" | "CANCELADA";
export type FichaCadastralTipo = "ADMISSAO" | "ATUALIZACAO";
export type FichaCadastralResumo = {
  id: string; tipo: FichaCadastralTipo; status: FichaCadastralStatus; nomeReferencia: string; employeeId: string | null;
  expiraEm: string; createdAt: string; primeiroAcessoEm: string | null; finalizadaEm: string | null; concluidaEm: string | null;
  canceladaEm: string | null; motivoDevolucao: string | null; arquivos: number; vencida: boolean;
  employee: { firstName: string; lastName: string } | null;
  /** Versão da ficha (updatedAt): o concluir só vale para a versão que o RH viu. */
  updatedAt: string;
};
export type FichaCadastralFilho = { nome: string; dataNascimento: string | null; cpf: string | null; ref?: string | null };
export type FichaCadastralDados = Record<string, string | boolean | null | FichaCadastralFilho[] | undefined> & { filhos?: FichaCadastralFilho[] };
export type FichaCadastralEmpresa = {
  companyId?: string | null; admissao?: string | null; funcao?: string | null; salario?: number | null; modalidade?: "CLT" | "NAO_CLT";
  entrada?: string | null; intervaloInicio?: string | null; intervaloFim?: string | null; saida?: string | null;
  sabadoEntrada?: string | null; sabadoSaida?: string | null; folga?: string | null;
  valeTransporte?: boolean | null; valorVt?: number | null; observacoes?: string | null;
};
export type FichaCadastralArquivo = { id: string; tipo: string; nomeOriginal: string; mimeType: string; tamanho: number; createdAt: string };
export type FichaCadastralDiferenca = { campo: string; rotulo: string; atual: string | null; novo: string };
/** Dependente que já está no cadastro com data de nascimento ou CPF diferente na ficha. */
export type FichaCadastralFilhoAlterado = {
  dependenteId: string; nome: string; nomeNovo?: string;
  dataNascimento?: { atual: string | null; novo: string };
  cpf?: { atual: string | null; novo: string };
};
export type FichaCadastralDetalhe = Omit<FichaCadastralResumo, "arquivos" | "vencida" | "employee"> & {
  dados: FichaCadastralDados; dadosEmpresa: FichaCadastralEmpresa; arquivos: FichaCadastralArquivo[];
  funcionario: { id: string; nome: string; isActive: boolean } | null;
  diferencas: FichaCadastralDiferenca[]; filhosNovos: FichaCadastralFilho[]; filhosAlterados: FichaCadastralFilhoAlterado[]; falta: string[];
  empresas: Array<{ id: string; tradeName: string; legalName: string; cnpj: string }>;
  opcoes: { tiposArquivo: Record<string, string>; rotulos: Record<string, string> };
  bloqueadoAte: string | null;
  /** Sem permissão de ver Funcionários: salário e valores atuais do cadastro vêm ocultos. */
  salarioOculto: boolean;
  /** Admissão de quem já tem cadastro (mesmo CPF): dá para usar a ficha para atualizar esse cadastro. */
  cadastroExistente: { id: string; nome: string; isActive: boolean } | null;
};
export type FichaCadastralLink = { id: string; codigo: string; expiraEm: string };

export function getFichasCadastrais(params: { status?: string; employeeId?: string } = {}) {
  return request<FichaCadastralResumo[]>(`/employee-forms${toQueryString(params)}`);
}
export function criarFichaCadastral(payload: { tipo: FichaCadastralTipo; nomeReferencia?: string; employeeId?: string }) {
  return request<FichaCadastralLink>("/employee-forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function getFichaCadastral(id: string) {
  return request<FichaCadastralDetalhe>(`/employee-forms/${id}`);
}
/** `versao`: a da ficha que o RH está vendo — se ela mudou no meio (devolvida, reenviada), 409. */
export function salvarEmpresaFichaCadastral(id: string, empresa: FichaCadastralEmpresa, versao: string) {
  return request<{ ok: true; versao: string | null }>(`/employee-forms/${id}/empresa`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...empresa, versao }) });
}
/** Admissão de quem já tem cadastro vira atualização dele (o cadastro com o mesmo CPF da ficha). */
export function converterFichaEmAtualizacao(id: string, versao: string) {
  return request<{ ok: true; employeeId: string }>(`/employee-forms/${id}/converter-em-atualizacao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versao }) });
}
export function novoLinkFichaCadastral(id: string) {
  return request<FichaCadastralLink>(`/employee-forms/${id}/novo-link`, { method: "POST" });
}
export function devolverFichaCadastral(id: string, motivo: string) {
  return request<{ ok: true }>(`/employee-forms/${id}/devolver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }) });
}
export function cancelarFichaCadastral(id: string) {
  return request<{ ok: true }>(`/employee-forms/${id}/cancelar`, { method: "POST" });
}
export function concluirFichaCadastral(id: string, versao: string, campos?: string[]) {
  return request<{ ok: true; employeeId: string; auditoria?: false }>(`/employee-forms/${id}/concluir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(campos ? { campos, versao } : { versao }) });
}
export function getArquivoFichaCadastral(id: string, arquivoId: string) {
  return fetchBlob(`/employee-forms/${id}/arquivos/${arquivoId}`);
}
/** RH aceitou trocar o digitado pelo que a leitura dos documentos achou. */
export function corrigirFichaPelaLeitura(id: string, valores: Record<string, string>) {
  return request<{ ok: true; corrigidos: string[] }>(`/employee-forms/${id}/correcoes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valores }) });
}
export type FichaLoteCriada = { fichaId: string; employeeId: string; nome: string; codigo: string; expiraEm: string; celular: string | null };
export type FichaLoteResultado = {
  criadas: FichaLoteCriada[]; jaAbertas: Array<{ fichaId: string; employeeId: string; nome: string }>;
  /** Cadastro sem data de nascimento nem CPF válidos: o link abriria sem confirmação, não foi gerado. */
  semVerificacao: Array<{ employeeId: string; nome: string }>;
};
/** Uma ficha de atualização para cada funcionário ativo sem ficha aberta. Os códigos só vêm nesta resposta. */
export function pedirAtualizacaoEmLote() {
  return request<FichaLoteResultado>("/employee-forms/lote", { method: "POST" });
}

// ── Painel de eventos ──

export type EventOrigin = "CENTRO_CONVENCOES" | "TEATRO" | "GRUPO";
export type EventArea = "SAUDE" | "CORPORATIVO" | "TECNOLOGIA" | "JURIDICO" | "FINANCEIRO" | "FEIRA_VAREJO" | "EDUCACAO" | "ENTRETENIMENTO" | "OUTRO";
export type ServiceMode = "BUFFET" | "BUFFET_EXECUTIVO" | "A_LA_CARTE";
export type EventPosition = "UNICO" | "PRIMEIRO" | "MEIO" | "ULTIMO";

/** O que o restaurante fez no dia, sem os 10% de serviço. */
export type DayRealized = {
  fonte: "PDV" | "PLANILHA";
  almocos: number | null;
  valorAlmoco: number | null;
  jantares: number | null;
  valorJantar: number | null;
};

export type DayForecast = {
  almoco: number;
  minimo: number;
  maximo: number;
  tamanho: EventSize;
  base: string;
  casos: number;
  poucaBase: boolean;
};

export type AgendaEvent = {
  seriesId: string;
  seriesName: string;
  origin: EventOrigin;
  posicao: EventPosition;
  editionId: string;
  editionTitle: string;
  dia: number;
  totalDias: number;
  startTime: string | null;
  endTime: string | null;
};

/** Preço de buffet cobrado no dia, lido das vendas do PDV (o principal é o que mais vendeu). */
export type BuffetCharged = {
  principal: { produto: string; preco: number; vendidos: number };
  outros: Array<{ produto: string; preco: number; vendidos: number }>;
};

export type AgendaDay = {
  date: string;
  eventos: AgendaEvent[];
  previsao: DayForecast | null;
  realizado: DayRealized | null;
  escala: EventSize | null;
  buffetCobrado: BuffetCharged | null;
  /** Modalidade pelo PDV; null em dia sem venda no PDV. */
  modalidadePdv: ServiceMode | null;
  decisao: { serviceMode: ServiceMode | null; buffetPrice: number | null; notes: string | null; forecastLunch: number | null; forecastSize: EventSize | null } | null;
};

export type EventSettings = { smallMaxLunch: number; largeMinLunch: number; lunchCapacity: number | null };

export type EventSeriesSummary = {
  id: string;
  name: string;
  origin: EventOrigin;
  area: EventArea;
  edicoes: number;
  ultimaEdicao: string | null;
  diasComMovimento: number;
  mediaAlmocos: number | null;
};

export type EventEditionDetail = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  announcedAudience: number | null;
  floor: string | null;
  contact: string | null;
  source: string;
  notes: string | null;
  days: Array<{
    date: string;
    dia: number;
    totalDias: number;
    startTime: string | null;
    endTime: string | null;
    realizado: DayRealized | null;
    outrosEventos: Array<{ seriesId: string; seriesName: string; dia: number; totalDias: number }>;
    notes: string | null;
    serviceMode: ServiceMode | null;
    buffetPrice: number | null;
    buffetCobrado: BuffetCharged | null;
    modalidadePdv: ServiceMode | null;
  }>;
};

export type EventSeriesDetail = {
  id: string;
  name: string;
  origin: EventOrigin;
  area: EventArea;
  organizer: string | null;
  notes: string | null;
  editions: EventEditionDetail[];
};

export type EventEditionInput = {
  seriesId?: string | null;
  newSeriesName?: string | null;
  newSeriesOrigin?: EventOrigin;
  title: string;
  startDate: string;
  endDate: string;
  announcedAudience?: number | null;
  floor?: string | null;
  contact?: string | null;
  notes?: string | null;
};

export function getEventsAgenda(year: number, month: number) {
  return request<{ dias: AgendaDay[]; limites: EventSettings }>(`/events/agenda?year=${year}&month=${month}`);
}

export function saveOperationDay(date: string, input: { serviceMode: ServiceMode | null; buffetPrice: number | null; notes: string | null }) {
  return request<{ date: string }>(`/events/days/${date}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(input) });
}

export function getEventSeriesList() {
  return request<EventSeriesSummary[]>("/events/series");
}

export function getEventSeries(id: string) {
  return request<EventSeriesDetail>(`/events/series/${id}`);
}

export function matchEventSeries(name: string) {
  return request<Array<{ id: string; name: string; origin: EventOrigin; exato: boolean }>>(`/events/series-match${toQueryString({ name })}`);
}

export function saveEventSeries(id: string, input: Pick<EventSeriesDetail, "name" | "origin" | "area" | "organizer" | "notes">) {
  return request<EventSeriesDetail>(`/events/series/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(input) });
}

export function mergeEventSeries(id: string, intoId: string) {
  return request<{ ok: boolean; id: string }>(`/events/series/${id}/merge`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ intoId }) });
}

export function createEventEdition(input: EventEditionInput) {
  return request<{ id: string; seriesId: string }>("/events/editions", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) });
}

export function deleteEventEdition(id: string) {
  return request<{ ok: boolean }>(`/events/editions/${id}`, { method: "DELETE" });
}

export function getEventSettings() {
  return request<EventSettings>("/events/settings");
}

export function saveEventSettings(input: EventSettings) {
  return request<EventSettings>("/events/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(input) });
}

// ── Reembolsos a funcionário ──────────────────────────────────────────────────

export type ReimbursementStatus = "OPEN" | "CLOSED" | "PAID" | "CANCELLED";

/** id = fornecedor da pessoa, ou "emp:<id do funcionário>" quando o fornecedor ainda não existe. */
export type ReimbursementPayee = { id: string; name: string };

export type ReimbursementSummary = {
  id: string;
  payeeSupplierId: string;
  payeeName: string;
  status: ReimbursementStatus;
  totalAmount: string;
  dueDate: string | null;
  closedAt: string | null;
  generatedPurchaseId: string | null;
  itemCount: number;
  checkedCount: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  createdAt: string;
};

export type ReimbursementItem = {
  id: string;
  purchaseId: string;
  amount: string;
  purchaseDate: string;
  checked: boolean;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  isSmallExpense: boolean;
  purchaseStatus: string;
  storeName: string;
  firstItemName: string | null;
  itemLines: number;
};

export type ReimbursementDetail = Omit<ReimbursementSummary, "itemCount" | "checkedCount" | "firstPurchaseDate" | "lastPurchaseDate"> & {
  notes: string | null;
  items: ReimbursementItem[];
  installments: Array<{
    id: string;
    amount: string;
    dueDate: string | null;
    status: string;
    paidDate: string | null;
    paidAmount: string | null;
    paymentMethodName: string | null;
  }>;
};

export function getReimbursementPayees() {
  return request<ReimbursementPayee[]>("/purchases/reimbursement-payees");
}

export function getReimbursements(status?: ReimbursementStatus) {
  return request<ReimbursementSummary[]>(`/reimbursements${status ? `?status=${status}` : ""}`);
}

export function getReimbursement(id: string) {
  return request<ReimbursementDetail>(`/reimbursements/${id}`);
}

export function checkReimbursementItem(reportId: string, itemId: string, checked: boolean) {
  return request<{ id: string; checked: boolean }>(`/reimbursements/${reportId}/items/${itemId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checked })
  });
}

export function checkAllReimbursementItems(reportId: string) {
  return request<{ id: string; checked: number }>(`/reimbursements/${reportId}/check-all`, { method: "POST" });
}

export function closeReimbursement(reportId: string, payload: { paymentMethodId: string; dueDate: string; notes?: string }) {
  return request<ReimbursementDetail>(`/reimbursements/${reportId}/close`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}

export function reopenReimbursement(reportId: string) {
  return request<ReimbursementDetail>(`/reimbursements/${reportId}/reopen`, { method: "POST" });
}
