// Mock user dev-only para revisar o shell sem backend ativo.
//
// Ativacao:
//   1) NODE_ENV=development / vite dev (isLocal=true), E
//   2) URL contem ?mock-user=1
//
// Ambos devem ser verdadeiros. Em prod (isLocal=false) o modulo e um no-op
// completo — os checks retornam false e installMockFetch nao faz nada.
//
// O que faz:
// - App.tsx pula getMe() / getMenuFavorites() / getStockCountSessions()
// - Injeta MOCK_USER (ADMIN, mustChangePassword=false) na sessao
// - installMockFetch() intercepta fetch da API e devolve respostas vazias
//   (listas [] e objetos {}) para nao gerar toast/erro visivel

import type { AppUser } from "../api/client";
import { API_BASE_URL } from "../api/client";
import { isLocal } from "../utils/env";

export const MOCK_USER: AppUser = {
  id: "mock-user",
  name: "Mock Admin",
  email: "mock@pateodaluz.local",
  role: "ADMIN",
  isActive: true,
  mustChangePassword: false
};

// ─── Builders de shape completo do Dashboard ────────────────────────────
// Cada helper retorna um objeto fresco no shape exato esperado pelo
// api/client.ts (DashboardData, DashboardSummaryData, DashboardAlertsData).
// Todos os campos numericos = 0, arrays = [], nulls onde permitido.
// cmvReal.status = "pending" para exercitar mais UI (status "closed" mostra
// valor, "missing" some, "pending" e o meio-termo com badge warning).

function currentPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStr = String(month).padStart(2, "0");
  const startDate = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { year, month, monthStr, startDate, endDate };
}

function buildEmptyPurchases() {
  const p = currentPeriod();
  return {
    year: p.year,
    month: p.month,
    startDate: p.startDate,
    endDate: p.endDate,
    totalAmount: 0,
    previousMonth: p.month === 1 ? 12 : p.month - 1,
    previousYear: p.month === 1 ? p.year - 1 : p.year,
    previousTotalAmount: 0,
    comparisonAmount: 0,
    comparisonPercent: null,
    revenue: {
      grossAmount: 0,
      serviceAmount: 0,
      netAmount: 0,
      tickets: 0,
      ticketAverageGeneral: 0,
      count: 0,
      byChannel: []
    },
    bySupplier: [],
    byCategory: [],
    byProduct: [],
    recentPurchases: []
  };
}

function buildEmptySummary() {
  const p = currentPeriod();
  return {
    year: p.year,
    month: p.month,
    revenue: {
      grossAmount: 0,
      netAmount: 0,
      serviceAmount: 0,
      tickets: 0,
      count: 0,
      ticketAverage: 0,
      prev: { grossAmount: 0, netAmount: 0 },
      deltaPercent: null
    },
    purchases: {
      total: 0,
      count: 0,
      prev: { total: 0 },
      deltaPercent: null
    },
    smallExpenses: {
      total: 0,
      count: 0,
      prev: { total: 0 },
      deltaPercent: null
    },
    cmvReal: {
      status: "pending" as const,
      value: null,
      percent: null
    },
    estimatedResult: {
      value: 0,
      marginPercent: null
    }
  };
}

function buildEmptyAlerts() {
  const p = currentPeriod();
  return {
    competence: `${p.year}-${p.monthStr}`,
    alerts: [],
    summary: {
      overduePayablesCount: 0,
      overduePayablesAmount: 0,
      dueSoonPayablesCount: 0,
      dueSoonPayablesAmount: 0,
      unpaidPurchasesCount: 0,
      unpaidPurchasesAmount: 0,
      missingRevenueDays: 0,
      cmvStatus: "pending" as const
    }
  };
}

function buildMockSuppliers() {
  const base = {
    phone: null,
    email: null,
    notes: null,
    registrationDate: null,
    defaultPaymentTermDays: null,
    defaultPaymentMethodId: null,
    defaultInstallmentCount: null,
    defaultInstallmentDays: null,
    defaultFinancialNotes: null,
    billingMode: "DIRECT",
    cycleFrequency: null,
    cycleFirstDueDays: null,
    cycleSecondDueDays: null
  };
  return [
    {
      ...base,
      id: "sup-1",
      externalCode: "F001",
      name: "Distribuidora Hortifruti Central do Vale Ltda ME",
      document: "12.345.678/0001-90",
      contactName: "Seu João",
      mainCategory: "Hortifruti",
      isActive: true,
      defaultInstallmentCount: 2,
      defaultInstallmentDays: [15, 30]
    },
    {
      ...base,
      id: "sup-2",
      externalCode: "F002",
      name: "Casa de Carnes Bom Corte",
      document: "98.765.432/0001-10",
      contactName: "Dona Maria",
      mainCategory: "Carnes",
      isActive: true,
      billingMode: "CYCLE",
      cycleFrequency: "WEEKLY",
      cycleFirstDueDays: 15
    },
    {
      ...base,
      id: "sup-3",
      externalCode: "F003",
      name: "Bebidas Serra Azul",
      document: null,
      contactName: null,
      mainCategory: "Bebidas",
      isActive: false,
      defaultPaymentTermDays: 28
    }
  ];
}

export function isMockUserMode(): boolean {
  if (!isLocal) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("mock-user");
}

// URLs consideradas "de API" para intercept. Cobre:
// - http://localhost:3334/* (backend dev direto, sem proxy)
// - /api/* (proxy vite)
// - /auth/* (algumas rotas legadas)
// - API_BASE_URL configurado
function isApiUrl(url: string): boolean {
  if (url.includes(":3334")) return true;
  if (url.startsWith("/api/") || url === "/api") return true;
  if (url.startsWith("/auth/")) return true;
  if (API_BASE_URL && API_BASE_URL !== "/api" && url.startsWith(API_BASE_URL)) return true;
  return false;
}

function pathFrom(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname;
  } catch {
    return url;
  }
}

function mockResponseFor(url: string): unknown {
  const path = pathFrom(url);

  if (path.endsWith("/auth/me") || path.endsWith("/me")) return MOCK_USER;
  if (path.endsWith("/health")) return { status: "ok" };
  if (path.includes("/auth/logout")) return { ok: true };

  // Endpoints do Dashboard exigem shape completo (varios acessos aninhados
  // tipo summary.revenue.deltaPercent que crasham em undefined). Mock zerado
  // valido para exercitar a UI sem crash.
  //
  // Datas dinamicas: mes/ano corrente no momento da chamada — evita o mock
  // apontar para "junho/2026" enquanto o cliente esta em outro mes.
  if (path.endsWith("/dashboard/purchases")) return buildEmptyPurchases();
  if (path.endsWith("/dashboard/summary")) return buildEmptySummary();
  if (path.endsWith("/dashboard/alerts")) return buildEmptyAlerts();

  // Fornecedores: lista pequena com nome longo para exercitar a tabela DS
  // (truncate + tooltip) e o historico com shape completo (evita crash em
  // history.recentInvoices.map).
  if (path.includes("/suppliers") && path.includes("/history")) {
    return {
      monthTotal: 0,
      yearTotal: 0,
      lastPurchase: null,
      averagePaymentTermDays: null,
      recentInvoices: [],
      topProducts: [],
      paymentMethods: []
    };
  }
  if (path.endsWith("/suppliers")) return buildMockSuppliers();

  // DRE: shape completo do DRESummary (revenue/cmv/expenses/expenseGroups
  // acessados sem defesa nas paginas — inclui expenses.filter na linha 597).
  if (path.includes("/dre/summary") || path.endsWith("/dre")) {
    const p = currentPeriod();
    const emptyDreBlock = () => ({
      period: { from: p.startDate, to: p.endDate },
      revenue: { grossAmount: 0, netAmount: 0, serviceAmount: 0, byChannel: {}, discounts: 0, platformFees: 0, deductions: 0, tickets: 0 },
      cmv: { cmvReal: 0, cmvPercent: null, estoqueInicial: 0, compras: 0, estoqueFinal: 0, hasInventoryData: false, warning: null },
      lucroBruto: 0,
      margemBruta: 0,
      expenses: [],
      expenseGroups: [],
      totalExpenses: 0,
      ebitda: 0,
      ebitdaPercent: 0
    });
    return { current: emptyDreBlock(), prevMonth: null, prevYear: null };
  }
  if (path.includes("/dre/categories")) return [];
  if (path.includes("/dre/pending")) return { total: 0, totalAmount: 0, page: 1, perPage: 20, rows: [] };

  // Fechamento mensal (/cmv/fechamento-mensal — pagina MonthlyClosing):
  // /monthly/inventory e uma lista de InventorySnapshot[] usada em .map/.length.
  if (path.endsWith("/monthly/inventory")) return [];

  // CMV Real (/cmv/real — pagina CmvReal): 3 endpoints em Promise.all.
  // /monthly/cmv-real → CmvPeriod[] (.find, .filter, .length)
  // /monthly/cmv-real/bases → StockBase[]
  // /monthly/cmv-real/suggestions → objeto com latestPeriod nullable
  if (path.endsWith("/monthly/cmv-real")) return [];
  if (path.endsWith("/monthly/cmv-real/bases")) return [];
  if (path.endsWith("/monthly/cmv-real/suggestions")) {
    const p = currentPeriod();
    return {
      suggestedStartDate: p.startDate,
      suggestedInitialSnapshotId: null,
      suggestedInitialSessionId: null,
      continuityLocked: false,
      latestPeriod: null
    };
  }

  // Impostos e Guias (/financeiro/impostos — pagina TaxPayments):
  // /tax-payments retorna TaxPaymentListResponse com shape { data, pagination,
  // summary }, nao lista crua. O listPatterns generico pegaria "tax-payments"
  // e devolveria [] — este special vence.
  if (path.startsWith("/tax-payments")) {
    return {
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      summary: { total: "0", paid: "0", pending: "0", overdue: "0", withoutReceipt: "0" }
    };
  }
  if (path.includes("/dre/drill")) return [];

  // Usuarios: /menu-permissions retorna shape estruturado (menus/actions
  // usados em reduce) — precisa antes do fallback list-patterns.
  if (path.endsWith("/menu-permissions")) {
    return { menus: [], accessLevels: ["NONE", "VIEW", "FULL"], actions: ["view", "create", "edit", "delete", "approve", "admin"] };
  }
  if (path.endsWith("/users")) {
    return [
      { id: "u-1", name: "Rafael Admin", email: "rafael@pateo.local", role: "ADMIN", isActive: true, mustChangePassword: false, lastLoginAt: new Date().toISOString(), modulePermissions: {}, menuPermissions: {} },
      { id: "u-2", name: "Marcos Vinícius de Albuquerque Nascimento", email: "marcos@pateo.local", role: "ESTOQUISTA", isActive: true, mustChangePassword: false, lastLoginAt: null, modulePermissions: {}, menuPermissions: {} },
      { id: "u-3", name: "Ana Silva", email: "ana@pateo.local", role: "VISUALIZACAO", isActive: false, mustChangePassword: false, lastLoginAt: null, modulePermissions: {}, menuPermissions: {} }
    ];
  }
  if (path.endsWith("/users/sessions") || path.includes("/users/sessions")) return [];

  // Auditoria: shape { data, pagination }.
  if (path.includes("/audit")) {
    const now = new Date().toISOString();
    return {
      data: [
        { id: "aud-1", createdAt: now, userName: "Mock Admin", userEmail: "mock@pateodaluz.local", userId: "mock-user", action: "DELETE_PAYROLL_ITEM", entity: "PayrollItem", entityId: "pi-fer", ipAddress: "127.0.0.1", previousValue: { type: "FERIAS", amount: "1500.00" }, newValue: { reason: "lançado errado" }, userAgent: "mock" },
        { id: "aud-2", createdAt: now, userName: "Mock Admin", userEmail: "mock@pateodaluz.local", userId: "mock-user", action: "DELETE_EMPLOYEE", entity: "Employee", entityId: "emp-3", ipAddress: "127.0.0.1", previousValue: { firstName: "Ana", lastName: "Souza" }, newValue: { reason: "cadastro duplicado" }, userAgent: "mock" },
        { id: "aud-3", createdAt: now, userName: "Mock Admin", userEmail: null, userId: "mock-user", action: "UPDATE_PAYROLL_SETTINGS", entity: "PayrollSettings", entityId: "singleton", ipAddress: "127.0.0.1", previousValue: null, newValue: null, userAgent: "mock" }
      ],
      pagination: { page: 1, totalPages: 1, total: 3, limit: 50 }
    };
  }

  // Estoque: endpoints com shape estruturado que o fallback {} quebraria
  // (agenda.items.find, buyer-support.summary, operational e counts = listas).
  if (path.includes("/inventory/agenda")) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, items: [], rules: [] };
  }
  if (path.includes("/inventory/operational") && path.includes("buyer-support")) {
    return {
      summary: {
        itemsWithSuggestion: 0,
        suggestedSuppliers: 0,
        productsWithoutSupplier: 0,
        zeros: 0,
        belowMinimum: 0,
        withoutCount: 0,
        divergent: 0,
        incompleteRegistration: 0,
        withoutIdeal: 0,
        withoutMinimum: 0,
        controlledTotal: 0,
        latestFinalCmv: null,
        source: {
          sourceType: "DEFAULT",
          sourceId: null,
          code: null,
          status: null,
          type: null,
          date: null,
          totalItems: 0,
          partial: false,
          scopeLabel: null,
          note: null,
          purpose: "buyer-support",
          canUseForBuyer: true
        }
      },
      supplierGroups: [],
      prelist: [],
      items: []
    };
  }
  if (path.includes("/inventory/operational")) return [];
  if (path.includes("/inventory/counts")) return [];

  // Faturamento: shape { entries, summary } — summary.byChannel/byPlatform
  // sao acessados sem optional chaining na pagina.
  if (path.endsWith("/revenue")) {
    const today = new Date().toISOString();
    const entryBase = { serviceAmount: 118.4, tickets: 62, ticketAverage: 21.3, status: "ACTIVE" };
    return {
      entries: [
        { ...entryBase, id: "rev-1", date: today, weekdayName: "Quinta", channel: "Salao", salesFirstShift: 812.5, salesSecondShift: 508.9, grossAmount: 1321.4, accumulatedAmount: 1321.4 },
        { ...entryBase, id: "rev-2", date: today, weekdayName: "Quinta", channel: "Delivery", salesFirstShift: 240, salesSecondShift: 388.6, grossAmount: 628.6, accumulatedAmount: 1950, status: "CANCELLED" }
      ],
      summary: {
        grossAmount: 1950,
        serviceAmount: 236.8,
        netAmount: 1713.2,
        tickets: 124,
        ticketAverageGeneral: 15.7,
        salesFirstShift: 1052.5,
        salesSecondShift: 897.5,
        byChannel: [],
        byPlatform: []
      }
    };
  }

  // Contas a pagar: titulos variados (aberto/vencido/pago/imposto) para
  // exercitar KPIs clicaveis, chips e a lista.
  if (path.endsWith("/payables")) {
    const today = new Date();
    const iso = (d: Date) => d.toISOString();
    const plusDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
    const base = {
      purchaseId: null,
      purchaseNumber: null,
      invoiceNumber: null,
      installment: null,
      totalInstallments: null,
      paymentMethodName: null,
      paidDate: null,
      paidAmount: null,
      paymentNotes: null,
      notes: null,
      sourceType: "DIRECT",
      taxDocumentType: null,
      taxCompanyName: null,
      taxDescription: null,
      taxCompetenceDate: null,
      taxDreCategoryName: null
    };
    return [
      { ...base, id: "pay-1", supplierName: "Distribuidora Hortifruti Central do Vale Ltda ME", invoiceNumber: "48213", purchaseNumber: "C-0101", amount: 920.25, dueDate: plusDays(3), status: "OPEN", installment: 1, totalInstallments: 2, paymentMethodName: "BOLETO / 2x" },
      { ...base, id: "pay-2", supplierName: "Casa de Carnes Bom Corte", amount: 1840.5, dueDate: plusDays(-4), status: "OVERDUE", paymentMethodName: "PIX", notes: "Renegociar com o vendedor" },
      { ...base, id: "pay-3", supplierName: "Bebidas Serra Azul", amount: 640, dueDate: plusDays(-10), status: "PAID", paidDate: iso(today), paidAmount: 640, paymentMethodName: "PIX" },
      { ...base, id: "pay-4", supplierName: "DAS — Simples Nacional", amount: 2312.4, dueDate: plusDays(12), status: "OPEN", sourceType: "TAX_PAYMENT", taxDocumentType: "DAS", taxCompanyName: "Pateo da Luz", taxDescription: "Competência anterior", taxCompetenceDate: plusDays(-30), taxDreCategoryName: "Impostos" },
      { ...base, id: "pay-5", supplierName: "Maria Silva", amount: 227.96, dueDate: plusDays(2), status: "OPEN", sourceType: "PAYROLL", notes: "Vale-transporte · VT 1ª quinzena", taxDocumentType: "Vale-transporte", taxDescription: "VT 1ª quinzena", taxCompanyName: "Maria Silva", taxCompetenceDate: plusDays(-5), taxDreCategoryName: "Vale-Transporte" },
      { ...base, id: "pay-6", supplierName: "Edson Carvalho", amount: 1500, dueDate: plusDays(6), status: "OPEN", sourceType: "PAYROLL", notes: "Férias", taxDocumentType: "Férias", taxDescription: "Férias", taxCompanyName: "Edson Carvalho", taxCompetenceDate: plusDays(-2), taxDreCategoryName: "Férias" }
    ];
  }

  // Compras: lista minima para exercitar a tabela DS da listagem.
  if (path.endsWith("/purchases")) {
    const today = new Date().toISOString();
    const period = currentPeriod();
    return [
      {
        id: "pu-1",
        purchaseNumber: "C-0101",
        invoiceNumber: "48213",
        purchaseDate: today,
        competenceMonth: period.month,
        competenceYear: period.year,
        status: "ACTIVE",
        totalAmount: 1840.5,
        paymentMethod: "BOLETO",
        creditCardId: null,
        cycleStatus: null,
        cancellationReason: null,
        rawSupplierCode: null,
        supplier: { id: "sup-1", name: "Distribuidora Hortifruti Central do Vale Ltda ME", document: "12.345.678/0001-90" },
        items: [
          { id: "it-1", rawProductCode: "P001", rawProductName: "Tomate italiano kg" },
          { id: "it-2", rawProductCode: "P002", rawProductName: "Alface crespa un" }
        ],
        installments: [{ id: "in-1", paymentMethodName: "Boleto", status: "OPEN" }]
      },
      {
        id: "pu-2",
        purchaseNumber: "C-0102",
        invoiceNumber: null,
        purchaseDate: today,
        competenceMonth: period.month,
        competenceYear: period.year,
        status: "CANCELLED",
        totalAmount: 920,
        paymentMethod: "PIX",
        creditCardId: null,
        cycleStatus: "OPEN",
        cancellationReason: "Lancamento duplicado",
        rawSupplierCode: "F002",
        supplier: { id: "sup-2", name: "Casa de Carnes Bom Corte", document: null },
        items: [{ id: "it-3", rawProductCode: null, rawProductName: "Picanha kg" }],
        installments: []
      }
    ];
  }

  // Ciclos de fornecedor: lista para exercitar a tabela DS.
  if (path.endsWith("/supplier-cycles")) {
    return [
      {
        id: "cy-1",
        supplierId: "sup-2",
        supplierName: "Casa de Carnes Bom Corte",
        periodStart: new Date().toISOString(),
        periodEnd: null,
        status: "OPEN",
        totalAmount: 3120.4,
        itemCount: 3,
        checkedCount: 1,
        hasDivergence: true
      },
      {
        id: "cy-2",
        supplierId: "sup-1",
        supplierName: "Distribuidora Hortifruti Central do Vale Ltda ME",
        periodStart: new Date().toISOString(),
        periodEnd: new Date().toISOString(),
        status: "PAID",
        totalAmount: 1890,
        itemCount: 5,
        checkedCount: 5,
        hasDivergence: false
      }
    ];
  }

  // Pedidos de compra: shape { orders, summary } — lista crua quebraria
  // data.orders.map na pagina.
  if (path.endsWith("/purchase-orders")) {
    return {
      orders: [
        {
          id: "po-1",
          code: "PC-0001",
          supplierNameSnapshot: "Distribuidora Hortifruti Central do Vale Ltda ME",
          status: "RASCUNHO",
          source: "PLANEJAMENTO_COMPRA",
          createdAt: new Date().toISOString(),
          expectedDeliveryDate: null,
          totalItems: 12,
          estimatedTotal: 1840.5,
          createdByUserName: "Mock Admin"
        },
        {
          id: "po-2",
          code: "PC-0002",
          supplierNameSnapshot: "Casa de Carnes Bom Corte",
          status: "ENVIADO",
          source: "MANUAL",
          createdAt: new Date().toISOString(),
          expectedDeliveryDate: new Date().toISOString(),
          totalItems: 4,
          estimatedTotal: 920,
          createdByUserName: "Mock Admin"
        }
      ],
      summary: { RASCUNHO: 1, ENVIADO: 1 }
    };
  }
  if (path.includes("/companies") && path.includes("bank-accounts")) {
    return [
      {
        id: "acc-1",
        name: "Conta principal Bradesco",
        accountType: "CONTA_CORRENTE",
        bankName: "Bradesco",
        agency: "1234",
        account: "56789",
        accountDigit: "0",
        pixKey: "12.345.678/0001-90",
        notes: null,
        isActive: true
      }
    ];
  }
  if (path.endsWith("/companies")) {
    return [
      {
        id: "co-1",
        code: "EMP01",
        tradeName: "Pateo da Luz",
        legalName: "Pateo da Luz Restaurante Ltda",
        cnpj: "12.345.678/0001-90",
        city: "São Paulo",
        state: "SP",
        activeBankAccountCount: 1,
        isActive: true
      },
      {
        id: "co-2",
        code: "EMP02",
        tradeName: "Pateo Eventos",
        legalName: "Pateo Eventos e Producoes Gastronomicas Eireli",
        cnpj: "98.765.432/0001-10",
        city: null,
        state: null,
        activeBankAccountCount: 0,
        isActive: false
      }
    ];
  }
  if (path.endsWith("/payment-methods")) {
    return [
      { id: "pm-1", name: "PIX", isActive: true },
      { id: "pm-2", name: "Boleto", isActive: true }
    ];
  }

  // Folha de pagamento (/pessoal/folha — página Folha).
  if (path.endsWith("/payroll/settings")) return { id: "singleton", busFare: "5.30", metroFare: "5.40", integratedFare: "9.38", monthlyPassBus: "257.53", monthlyPassIntegrated: "411.13", advancePercent: "40", advanceDueDay: 20, salaryDueDay: 5, bufferDays: 1 };
  if (path.includes("/payroll/preview")) {
    const p = currentPeriod();
    const iso = (d: number) => new Date(Date.UTC(p.year, p.month - 1, d)).toISOString();
    return {
      year: p.year, month: p.month,
      settings: { id: "singleton", busFare: "5.30", metroFare: "5.40", integratedFare: "9.38", monthlyPassBus: "257.53", monthlyPassIntegrated: "411.13", advancePercent: "40", advanceDueDay: 20, salaryDueDay: 5, bufferDays: 1 },
      items: [
        { employeeId: "emp-1", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "VALE_TRANSPORTE", periodLabel: "VT 1ª quinzena", periodStart: iso(1), periodEnd: iso(15), dueDate: iso(1), amount: 227.96, workedDays: 13, freeDays: 2, bufferAmount: 18.76, creditApplied: 18.76, dreCategoryName: "Vale-Transporte", details: null, exists: false },
        { employeeId: "emp-1", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "ADIANTAMENTO", periodLabel: "Adiantamento", periodStart: null, periodEnd: null, dueDate: iso(20), amount: 880, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, dreCategoryName: "Folha de Pagamento", details: null, exists: false },
        { employeeId: "emp-1", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "SALARIO", periodLabel: "Salário", periodStart: null, periodEnd: null, dueDate: iso(28), amount: 1320, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, dreCategoryName: "Folha de Pagamento", details: null, exists: false },
        { employeeId: "emp-2", employeeName: "Edson Carvalho", employeeDisplayName: "Dão", sector: "Salão/Bar", type: "VALE_TRANSPORTE", periodLabel: "Ajuda de custo mensal", periodStart: null, periodEnd: null, dueDate: iso(1), amount: 300, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, dreCategoryName: "Vale-Transporte", details: null, exists: false }
      ],
      warnings: ["Edson Carvalho tem férias e salário na mesma competência (07/2026) — confira os valores para não pagar em dobro."]
    };
  }
  if (path.includes("/payroll/generate")) { const p = currentPeriod(); return { year: p.year, month: p.month, created: 4, skipped: 0 }; }
  if (path.match(/\/payroll\/termination\/[^/]+$/)) {
    const p = currentPeriod();
    return {
      employee: { id: "emp-3", name: "Ana Souza", terminationDate: new Date(Date.UTC(p.year, p.month - 1, 10)).toISOString(), terminationReason: "pediu demissão" },
      vtCreditBalance: 18.76,
      vtItems: [{ id: "pi-vt", periodLabel: "VT 1ª quinzena", competenceYear: p.year, competenceMonth: p.month, amount: "227.96", status: "PAID", dueDate: new Date(Date.UTC(p.year, p.month - 1, 1)).toISOString() }],
      alreadyReleased: false, rescisaoId: null
    };
  }
  if (path.includes("/payroll/vacation")) return { id: "vac-mock", amount: 1500 };
  if (path.match(/\/payroll\/[^/]+\/(pay|reverse|restore)$/)) return { id: "pi-mock", status: "PENDING" };
  if (path.match(/\/payroll\/[^/]+$/)) return { id: "pi-mock", status: "PENDING", ok: true };
  if (path.startsWith("/payroll")) {
    const p = currentPeriod();
    const iso = (d: number) => new Date(Date.UTC(p.year, p.month - 1, d)).toISOString();
    const items = [
      { id: "pi-1", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "VALE_TRANSPORTE", periodLabel: "VT 1ª quinzena", periodStart: iso(1), periodEnd: iso(15), dueDate: iso(1), amount: "227.96", workedDays: 13, freeDays: 2, bufferAmount: "18.76", creditApplied: "18.76", paymentDate: null, paidAmount: null, status: "PENDING", dreCategoryId: null },
      { id: "pi-2", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "ADIANTAMENTO", periodLabel: "Adiantamento", periodStart: null, periodEnd: null, dueDate: iso(20), amount: "880.00", workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, paymentDate: null, paidAmount: null, status: "PENDING", dreCategoryId: null },
      { id: "pi-3", employeeName: "Maria Silva", employeeDisplayName: null, sector: "Cozinha", type: "SALARIO", periodLabel: "Salário", periodStart: null, periodEnd: null, dueDate: iso(28), amount: "1320.00", workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, paymentDate: null, paidAmount: null, status: "PENDING", dreCategoryId: null },
      { id: "pi-fer", employeeName: "Edson Carvalho", employeeDisplayName: "Dão", sector: "Salão/Bar", type: "FERIAS", periodLabel: "Férias", periodStart: iso(16), periodEnd: iso(20), dueDate: iso(14), amount: "1500.00", workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null, paymentDate: null, paidAmount: null, status: "PENDING", dreCategoryId: null }
    ];
    const sum = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).reduce((a, i) => a + Number(i.amount), 0);
    return { year: p.year, month: p.month, items, summary: { total: sum(() => true), vt: sum((i) => i.type === "VALE_TRANSPORTE"), advance: sum((i) => i.type === "ADIANTAMENTO"), salary: sum((i) => i.type === "SALARIO"), ferias: sum((i) => i.type === "FERIAS"), paid: 0, pending: sum(() => true), overdue: 0, count: items.length } };
  }

  // Escala mensal (/pessoal/escala — página Escala).
  if (path.includes("/schedule/bulk")) return { ok: true, year: new Date().getFullYear(), month: new Date().getMonth() + 1, count: 0 };
  if (path.startsWith("/schedule")) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth() + 1;
    const daysInMonth = new Date(y, mo, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      days.push({ day: d, dow, isSunday: dow === 0, isHoliday: false, holidayName: null });
    }
    return {
      year: y, month: mo, daysInMonth, days,
      employees: [
        { id: "emp-lid", firstName: "Rafael", lastName: "Gerente", displayName: "Rafa", sector: "Liderança", subgroup: null, position: "Gerente geral", shiftStart: "10:00", shiftEnd: "20:00", scheduleRegime: "CINCO_POR_DOIS", admissionDate: null, terminationDate: null, holidayCompBalance: 0 },
        { id: "emp-1", firstName: "Maria", lastName: "Silva", displayName: null, sector: "Cozinha", subgroup: "Quente", position: "Cozinheira", shiftStart: "08:00", shiftEnd: "16:20", scheduleRegime: "SEIS_POR_UM", admissionDate: null, terminationDate: null, holidayCompBalance: 1 },
        { id: "emp-fria", firstName: "Lidiane", lastName: "Rocha", displayName: "Lidi", sector: "Cozinha", subgroup: "Fria", position: "Auxiliar", shiftStart: "08:00", shiftEnd: "16:20", scheduleRegime: "SEIS_POR_UM", admissionDate: null, terminationDate: null, holidayCompBalance: 0 },
        { id: "emp-2", firstName: "Edson", lastName: "Carvalho", displayName: "Dão", sector: "Salão", subgroup: "Bar", position: "Barman", shiftStart: "12:00", shiftEnd: "22:20", scheduleRegime: "CINCO_POR_DOIS", admissionDate: null, terminationDate: null, holidayCompBalance: 0 },
        { id: "emp-pia", firstName: "Ordonio", lastName: "Alves", displayName: null, sector: "Pia", subgroup: "Manhã", position: "Copeiro", shiftStart: "07:00", shiftEnd: "15:00", scheduleRegime: "SEIS_POR_UM", admissionDate: null, terminationDate: null, holidayCompBalance: 0 }
      ],
      entries: [
        { employeeId: "emp-1", day: 7, type: "FOLGA" },
        { employeeId: "emp-1", day: 3, type: "TURNO" },
        { employeeId: "emp-2", day: 3, type: "FOLGA" },
        { employeeId: "emp-2", day: 4, type: "FOLGA" }
      ],
      vacationDays: [16, 17, 18, 19, 20].map((day) => ({ employeeId: "emp-2", day }))
    };
  }

  // Funcionários (/pessoal/funcionarios — página Funcionarios): lista + aniversariantes.
  if (path.match(/\/employees\/[^/]+\/holiday-comp$/)) return { id: "emp-x", holidayCompBalance: 1 };
  if (path.match(/\/employees\/[^/]+\/restore$/)) return { id: "emp-mock", isActive: false };
  if (path.endsWith("/employees/options")) return { sectors: ["Cozinha", "Salão/Bar", "Pizzaria"], positions: ["Cozinheiro", "Garçom", "Gerente de salão"] };
  if (path.endsWith("/employees/birthdays")) return [];
  if (path.endsWith("/employees")) {
    return [
      {
        id: "emp-1", firstName: "Maria", lastName: "Silva", displayName: null, cpf: "12345678909",
        rg: null, pis: null, birthDate: "1992-08-14T00:00:00.000Z", phone: null, email: null,
        zipCode: null, address: null, addressNumber: null, addressComplement: null,
        neighborhood: null, city: "São Paulo", state: "SP",
        bankName: "Bradesco", bankAgency: "1234", bankAccount: "56789", bankAccountDigit: "0",
        bankAccountType: "CONTA_CORRENTE", pixKeyType: "CPF", pixKey: "123.456.789-09",
        sector: "Cozinha", position: "Cozinheira", baseSalary: "2200.00",
        shiftStart: "08:00", shiftEnd: "16:20", modality: "CLT", scheduleRegime: "SEIS_POR_UM",
        admissionDate: "2024-03-01T00:00:00.000Z",
        vtType: "TRANSPORTE_PUBLICO", vtPeriodicity: "QUINZENAL", vtCommute: "INTEGRADO",
        vtTripsPerDay: 2, vtFixedAmount: null, terminationDate: null, terminationReason: null,
        isActive: true, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      },
      {
        id: "emp-2", firstName: "Edson", lastName: "Carvalho", displayName: "Dão", cpf: "98765432100",
        rg: null, pis: null, birthDate: "1988-02-09T00:00:00.000Z", phone: null, email: null,
        zipCode: null, address: null, addressNumber: null, addressComplement: null,
        neighborhood: null, city: "São Paulo", state: "SP",
        bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null,
        bankAccountType: "CONTA_CORRENTE", pixKeyType: "TELEFONE", pixKey: "(11) 99999-0000",
        sector: "Salão/Bar", position: "Garçom", baseSalary: "1800.00",
        shiftStart: "12:00", shiftEnd: "22:20", modality: "NAO_CLT", scheduleRegime: "CINCO_POR_DOIS",
        admissionDate: "2025-06-15T00:00:00.000Z",
        vtType: "AUXILIO_COMBUSTIVEL", vtPeriodicity: "MENSAL", vtCommute: null,
        vtTripsPerDay: null, vtFixedAmount: "300.00", terminationDate: null, terminationReason: null,
        isActive: true, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      },
      {
        id: "emp-3", firstName: "Ana", lastName: "Souza", displayName: null, cpf: "11122233396",
        rg: null, pis: null, birthDate: "1995-05-20T00:00:00.000Z", phone: null, email: null,
        zipCode: null, address: null, addressNumber: null, addressComplement: null,
        neighborhood: null, city: "São Paulo", state: "SP",
        bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null,
        bankAccountType: "CONTA_CORRENTE", pixKeyType: null, pixKey: null,
        sector: "Salão/Bar", position: "Garçom", baseSalary: "1800.00",
        shiftStart: "12:00", shiftEnd: "22:20", modality: "CLT", scheduleRegime: "SEIS_POR_UM",
        admissionDate: "2024-01-10T00:00:00.000Z",
        vtType: "TRANSPORTE_PUBLICO", vtPeriodicity: "QUINZENAL", vtCommute: "INTEGRADO",
        vtTripsPerDay: 2, vtFixedAmount: null, terminationDate: new Date().toISOString(), terminationReason: "pediu demissão",
        isActive: false, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
    ];
  }

  // Endpoints que sabidamente devolvem lista. Larga rede — qualquer
  // ambiguidade cai para [] em vez de {}, o que evita crashes de
  // `resposta.filter(...)` em callsites nao-defensivos.
  const listPatterns = [
    "favorites",
    "alerts",
    "sessions",
    "purchases",
    "suppliers",
    "products",
    "categories",
    "subcategories",
    "sectors",
    "units",
    "companies",
    "payables",
    "orders",
    "requisitions",
    "dishes",
    "cards",
    "cash-entries",
    "movements",
    "users",
    "audit",
    "payment-methods",
    "tax-payments",
    "dre",
    "menu-favorites",
    "stock",
    "cycles"
  ];
  if (listPatterns.some((p) => path.includes(p))) return [];

  // Fallback: objeto vazio. Paginas devem lidar com campos undefined
  // (a maioria ja faz por ter erro de rede em prod).
  return {};
}

let installed = false;

export function installMockFetch(): void {
  if (installed) return;
  if (!isMockUserMode()) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!isApiUrl(url)) return originalFetch(input, init);
    const body = mockResponseFor(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  installed = true;
  // eslint-disable-next-line no-console
  console.info("[mock-user] fetch interceptor ativo — respostas de API mockadas");
}
