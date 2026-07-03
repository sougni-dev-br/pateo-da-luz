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
        controlledTotal: 0
      },
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
      { ...base, id: "pay-4", supplierName: "DAS — Simples Nacional", amount: 2312.4, dueDate: plusDays(12), status: "OPEN", sourceType: "TAX_PAYMENT", taxDocumentType: "DAS", taxCompanyName: "Pateo da Luz", taxDescription: "Competência anterior", taxCompetenceDate: plusDays(-30), taxDreCategoryName: "Impostos" }
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
