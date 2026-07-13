import { prisma } from "../../../../config/database.js";
import type {
  NoventaNoveCredentialInput,
  NoventaNoveCredentialStatusView,
  NoventaNovePeriodSummary,
  NoventaNoveStatusView,
  NoventaNoveStoreInput,
  NoventaNoveStoreView
} from "./noventa-nove.types.js";
import { buildMockSummary, consolidateSummaries } from "./noventa-nove-mock.service.js";
import { runRealSync, type RealSyncResult } from "./noventa-nove-real-sync.service.js";
import { hasValidCredential } from "./noventa-nove-http-client.js";

// Lojas 99 Food do Pateo — usadas na primeira execução para popular a tabela
// DeliveryStore com platform=NOVENTA_NOVE. Depois de criadas, o admin edita
// AppShopID/apelido pela UI. externalId começa "PENDENTE-*" e Eli substitui
// pelo AppShopID real quando o 99 aprovar o app e cada loja for autorizada.
const DEFAULT_STORES: readonly { nickname: string; externalId: string }[] = [
  { nickname: "Pateo Frei Caneca", externalId: "PENDENTE-99-1" },
  { nickname: "Pateo da Luz & Pizza", externalId: "PENDENTE-99-2" },
  { nickname: "Pateo da Luz Pizzaria", externalId: "PENDENTE-99-3" },
  { nickname: "Peposo Frei Caneca", externalId: "PENDENTE-99-4" }
];

function toStoreView(store: {
  id: string;
  externalId: string;
  nickname: string;
  active: boolean;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  company?: { tradeName: string } | null;
}): NoventaNoveStoreView {
  return {
    id: store.id,
    externalId: store.externalId,
    nickname: store.nickname,
    active: store.active,
    companyId: store.companyId,
    companyName: store.company?.tradeName ?? null,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString()
  };
}

async function ensureDefaultStores(): Promise<void> {
  const existing = await prisma.deliveryStore.count({ where: { platform: "NOVENTA_NOVE" } });
  if (existing > 0) return;
  for (const store of DEFAULT_STORES) {
    await prisma.deliveryStore.create({
      data: {
        platform: "NOVENTA_NOVE",
        externalId: store.externalId,
        nickname: store.nickname,
        active: true
      }
    });
  }
}

export async function listStores(): Promise<NoventaNoveStoreView[]> {
  await ensureDefaultStores();
  const rows = await prisma.deliveryStore.findMany({
    where: { platform: "NOVENTA_NOVE" },
    orderBy: { createdAt: "asc" },
    include: { company: { select: { tradeName: true } } }
  });
  return rows.map(toStoreView);
}

export async function updateStore(id: string, input: NoventaNoveStoreInput): Promise<NoventaNoveStoreView> {
  const updated = await prisma.deliveryStore.update({
    where: { id },
    data: {
      externalId: input.externalId,
      nickname: input.nickname,
      active: input.active,
      companyId: input.companyId ?? null
    },
    include: { company: { select: { tradeName: true } } }
  });
  return toStoreView(updated);
}

export async function createStore(input: NoventaNoveStoreInput): Promise<NoventaNoveStoreView> {
  const created = await prisma.deliveryStore.create({
    data: {
      platform: "NOVENTA_NOVE",
      externalId: input.externalId,
      nickname: input.nickname,
      active: input.active,
      companyId: input.companyId ?? null
    },
    include: { company: { select: { tradeName: true } } }
  });
  return toStoreView(created);
}

function maskClientId(clientId: string): string {
  if (clientId.length <= 8) return `${clientId.slice(0, 2)}***`;
  return `${clientId.slice(0, 4)}...${clientId.slice(-4)}`;
}

export async function saveCredential(input: NoventaNoveCredentialInput): Promise<NoventaNoveCredentialStatusView> {
  const existing = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (existing) {
    await prisma.noventaNoveCredential.update({
      where: { id: existing.id },
      data: {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        environment: input.environment,
        commissionPercent: input.commissionPercent
      }
    });
  } else {
    await prisma.noventaNoveCredential.create({
      data: {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        environment: input.environment,
        commissionPercent: input.commissionPercent,
        active: true
      }
    });
  }
  return getCredentialStatus();
}

export async function getCredentialStatus(): Promise<NoventaNoveCredentialStatusView> {
  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (!cred) {
    return { configured: false, environment: null, clientIdMasked: null, lastTokenAt: null, commissionPercent: 0 };
  }
  return {
    configured: true,
    environment: cred.environment as "PRODUCTION" | "SANDBOX",
    clientIdMasked: maskClientId(cred.clientId),
    lastTokenAt: cred.lastTokenAt ? cred.lastTokenAt.toISOString() : null,
    commissionPercent: Number(cred.commissionPercent)
  };
}

async function readSummaryFromDb(store: NoventaNoveStoreView, year: number, month: number): Promise<NoventaNovePeriodSummary | null> {
  const sales = await prisma.noventaNoveSale.findMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
    orderBy: { orderDate: "asc" }
  });
  if (sales.length === 0) return null;

  const dailyMap = new Map<string, { orders: number; grossAmount: number; noventaNoveFeeAmount: number; promotionAmount: number; deliveryFeeAmount: number; netAmount: number }>();
  let totalOrders = 0;
  let totalGross = 0;
  let totalNoventaNoveFee = 0;
  let totalPromo = 0;
  let totalDeliveryFee = 0;
  let totalNet = 0;

  for (const sale of sales) {
    const dateKey = sale.orderDate.toISOString().slice(0, 10);
    const gross = Number(sale.grossAmount);
    const noventaNoveFee = Number(sale.noventaNoveFeeAmount);
    const promo = Number(sale.promotionAmount);
    const deliveryFee = Number(sale.deliveryFeeAmount);
    const net = Number(sale.netAmount);
    totalOrders += 1;
    totalGross += gross;
    totalNoventaNoveFee += noventaNoveFee;
    totalPromo += promo;
    totalDeliveryFee += deliveryFee;
    totalNet += net;
    const prev = dailyMap.get(dateKey);
    dailyMap.set(dateKey, {
      orders: (prev?.orders ?? 0) + 1,
      grossAmount: (prev?.grossAmount ?? 0) + gross,
      noventaNoveFeeAmount: (prev?.noventaNoveFeeAmount ?? 0) + noventaNoveFee,
      promotionAmount: (prev?.promotionAmount ?? 0) + promo,
      deliveryFeeAmount: (prev?.deliveryFeeAmount ?? 0) + deliveryFee,
      netAmount: (prev?.netAmount ?? 0) + net
    });
  }

  const [feeRows, settlementRows] = await Promise.all([
    prisma.noventaNoveFee.findMany({ where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month } }),
    prisma.noventaNoveSettlement.findMany({
      where: { deliveryStoreId: store.id, periodStart: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } },
      orderBy: { periodStart: "asc" }
    })
  ]);

  const otherFees = feeRows.reduce((sum, fee) => sum + Number(fee.amount), 0);

  return {
    period: { year, month },
    storeId: store.id,
    storeLabel: store.nickname,
    totals: {
      orders: totalOrders,
      grossAmount: Math.round(totalGross * 100) / 100,
      noventaNoveFeeAmount: Math.round(totalNoventaNoveFee * 100) / 100,
      promotionAmount: Math.round(totalPromo * 100) / 100,
      deliveryFeeAmount: Math.round(totalDeliveryFee * 100) / 100,
      netAmount: Math.round((totalNet - otherFees) * 100) / 100,
      otherFees: Math.round(otherFees * 100) / 100
    },
    daily: Array.from(dailyMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, values]) => ({ date, ...values })),
    fees: feeRows.map((fee) => ({
      feeType: fee.feeType,
      description: fee.description,
      amount: Number(fee.amount)
    })),
    settlements: settlementRows.map((row) => ({
      id: row.id,
      externalId: row.externalId,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      grossAmount: Number(row.grossAmount),
      totalFees: Number(row.totalFees),
      netAmount: Number(row.netAmount),
      paidAt: row.paidAt ? row.paidAt.toISOString().slice(0, 10) : null,
      status: row.status
    })),
    isMock: false
  };
}

async function summaryForStore(store: NoventaNoveStoreView, year: number, month: number): Promise<NoventaNovePeriodSummary> {
  const real = await readSummaryFromDb(store, year, month);
  if (real) return real;
  return buildMockSummary({ storeId: store.id, storeLabel: store.nickname, year, month });
}

export async function getPeriodSummary(params: {
  year: number;
  month: number;
  storeId?: string;
}): Promise<NoventaNovePeriodSummary> {
  const stores = await listStores();
  const activeStores = stores.filter((store) => store.active);

  if (params.storeId) {
    const selected = activeStores.find((store) => store.id === params.storeId);
    if (!selected) {
      return {
        period: { year: params.year, month: params.month },
        storeId: params.storeId,
        storeLabel: "Loja não encontrada",
        totals: { orders: 0, grossAmount: 0, noventaNoveFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 },
        daily: [],
        fees: [],
        settlements: [],
        isMock: true
      };
    }
    return summaryForStore(selected, params.year, params.month);
  }

  const summaries = await Promise.all(
    activeStores.map((store) => summaryForStore(store, params.year, params.month))
  );
  return consolidateSummaries(summaries, params.year, params.month);
}

export async function getStatus(): Promise<NoventaNoveStatusView> {
  const [credential, stores, lastSync] = await Promise.all([
    getCredentialStatus(),
    listStores(),
    prisma.noventaNoveSyncLog.findFirst({ orderBy: { startedAt: "desc" } })
  ]);
  const anyRealStore = stores.some((store) => store.active && !store.externalId.startsWith("PENDENTE-"));
  const awaitingApproval = !credential.configured || !anyRealStore;
  return {
    credential,
    stores,
    lastSync: lastSync
      ? {
          status: lastSync.status,
          startedAt: lastSync.startedAt.toISOString(),
          finishedAt: lastSync.finishedAt ? lastSync.finishedAt.toISOString() : null,
          itemsProcessed: lastSync.itemsProcessed,
          errorMessage: lastSync.errorMessage
        }
      : null,
    mockMode: awaitingApproval,
    awaitingApproval
  };
}

export async function runMockSync(triggeredByUserId: string | null): Promise<{ log: NoventaNoveStatusView["lastSync"] }> {
  const startedAt = new Date();
  const log = await prisma.noventaNoveSyncLog.create({
    data: {
      syncType: "MOCK",
      startedAt,
      status: "SUCCESS",
      finishedAt: new Date(),
      itemsProcessed: DEFAULT_STORES.length,
      triggeredByUserId
    }
  });
  return {
    log: {
      status: log.status,
      startedAt: log.startedAt.toISOString(),
      finishedAt: log.finishedAt ? log.finishedAt.toISOString() : null,
      itemsProcessed: log.itemsProcessed,
      errorMessage: log.errorMessage
    }
  };
}

export type SmartSyncResult = {
  mode: "REAL" | "MOCK";
  real?: RealSyncResult;
  log: NoventaNoveStatusView["lastSync"];
};

export async function runSmartSync(triggeredByUserId: string | null, year: number, month: number): Promise<SmartSyncResult> {
  const credentialOk = await hasValidCredential();
  const anyRealStore = await prisma.deliveryStore.count({
    where: {
      platform: "NOVENTA_NOVE",
      active: true,
      NOT: { externalId: { startsWith: "PENDENTE-" } }
    }
  });
  if (credentialOk && anyRealStore > 0) {
    const real = await runRealSync({ year, month, triggeredByUserId });
    const lastLog = await prisma.noventaNoveSyncLog.findFirst({ orderBy: { startedAt: "desc" } });
    return {
      mode: "REAL",
      real,
      log: lastLog ? {
        status: lastLog.status,
        startedAt: lastLog.startedAt.toISOString(),
        finishedAt: lastLog.finishedAt ? lastLog.finishedAt.toISOString() : null,
        itemsProcessed: lastLog.itemsProcessed,
        errorMessage: lastLog.errorMessage
      } : null
    };
  }
  const mock = await runMockSync(triggeredByUserId);
  return { mode: "MOCK", log: mock.log };
}
