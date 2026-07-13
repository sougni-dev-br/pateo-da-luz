import { prisma } from "../../../../config/database.js";
import type {
  IfoodCredentialInput,
  IfoodCredentialStatusView,
  IfoodPeriodSummary,
  IfoodStatusView,
  IfoodStoreInput,
  IfoodStoreView
} from "./ifood.types.js";
import { buildMockSummary, consolidateSummaries } from "./ifood-mock.service.js";
import { runRealSync, type RealSyncResult } from "./ifood-real-sync.service.js";
import { hasValidCredential } from "./ifood-http-client.js";

// Lojas iFood do Pateo — usadas na primeira execução para popular a tabela
// DeliveryStore. Depois de criadas, o admin edita merchantId/apelido pela UI.
// externalId inicia com placeholder ("PENDENTE-*") e Eli substitui pelo real
// quando o iFood aprovar a credencial.
const DEFAULT_STORES: readonly { nickname: string; externalId: string }[] = [
  { nickname: "Pateo da Luz", externalId: "PENDENTE-1" },
  { nickname: "Pateo da Luz Massas e Parmeggiana", externalId: "PENDENTE-2" },
  { nickname: "Pateo da Luz Pizzaria", externalId: "PENDENTE-3" },
  { nickname: "Peposo Frei Caneca", externalId: "PENDENTE-4" }
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
}): IfoodStoreView {
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
  const existing = await prisma.deliveryStore.count({ where: { platform: "IFOOD" } });
  if (existing > 0) return;
  for (const store of DEFAULT_STORES) {
    await prisma.deliveryStore.create({
      data: {
        platform: "IFOOD",
        externalId: store.externalId,
        nickname: store.nickname,
        active: true
      }
    });
  }
}

export async function listStores(): Promise<IfoodStoreView[]> {
  await ensureDefaultStores();
  const rows = await prisma.deliveryStore.findMany({
    where: { platform: "IFOOD" },
    orderBy: { createdAt: "asc" },
    include: { company: { select: { tradeName: true } } }
  });
  return rows.map(toStoreView);
}

export async function updateStore(id: string, input: IfoodStoreInput): Promise<IfoodStoreView> {
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

export async function createStore(input: IfoodStoreInput): Promise<IfoodStoreView> {
  const created = await prisma.deliveryStore.create({
    data: {
      platform: "IFOOD",
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

export async function saveCredential(input: IfoodCredentialInput): Promise<IfoodCredentialStatusView> {
  const existing = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  if (existing) {
    await prisma.ifoodCredential.update({
      where: { id: existing.id },
      data: {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        environment: input.environment
      }
    });
  } else {
    await prisma.ifoodCredential.create({
      data: {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        environment: input.environment,
        active: true
      }
    });
  }
  return getCredentialStatus();
}

export async function getCredentialStatus(): Promise<IfoodCredentialStatusView> {
  const cred = await prisma.ifoodCredential.findFirst({ where: { active: true } });
  if (!cred) {
    return { configured: false, environment: null, clientIdMasked: null, lastTokenAt: null };
  }
  return {
    configured: true,
    environment: cred.environment as "PRODUCTION" | "SANDBOX",
    clientIdMasked: maskClientId(cred.clientId),
    lastTokenAt: cred.lastTokenAt ? cred.lastTokenAt.toISOString() : null
  };
}

// Lê dados persistidos no banco pra uma loja num período.
// Se não houver nenhuma venda no DB, devolve null e o chamador decide se cai no mock.
async function readSummaryFromDb(store: IfoodStoreView, year: number, month: number): Promise<IfoodPeriodSummary | null> {
  const sales = await prisma.ifoodSale.findMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
    orderBy: { orderDate: "asc" }
  });
  if (sales.length === 0) return null;

  const dailyMap = new Map<string, { orders: number; grossAmount: number; ifoodFeeAmount: number; promotionAmount: number; deliveryFeeAmount: number; netAmount: number }>();
  let totalOrders = 0;
  let totalGross = 0;
  let totalIfoodFee = 0;
  let totalPromo = 0;
  let totalDeliveryFee = 0;
  let totalNet = 0;

  for (const sale of sales) {
    const dateKey = sale.orderDate.toISOString().slice(0, 10);
    const gross = Number(sale.grossAmount);
    const ifoodFee = Number(sale.ifoodFeeAmount);
    const promo = Number(sale.promotionAmount);
    const deliveryFee = Number(sale.deliveryFeeAmount);
    const net = Number(sale.netAmount);
    totalOrders += 1;
    totalGross += gross;
    totalIfoodFee += ifoodFee;
    totalPromo += promo;
    totalDeliveryFee += deliveryFee;
    totalNet += net;
    const prev = dailyMap.get(dateKey);
    dailyMap.set(dateKey, {
      orders: (prev?.orders ?? 0) + 1,
      grossAmount: (prev?.grossAmount ?? 0) + gross,
      ifoodFeeAmount: (prev?.ifoodFeeAmount ?? 0) + ifoodFee,
      promotionAmount: (prev?.promotionAmount ?? 0) + promo,
      deliveryFeeAmount: (prev?.deliveryFeeAmount ?? 0) + deliveryFee,
      netAmount: (prev?.netAmount ?? 0) + net
    });
  }

  const [feeRows, settlementRows] = await Promise.all([
    prisma.ifoodFee.findMany({ where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month } }),
    prisma.ifoodSettlement.findMany({
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
      ifoodFeeAmount: Math.round(totalIfoodFee * 100) / 100,
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

async function summaryForStore(store: IfoodStoreView, year: number, month: number): Promise<IfoodPeriodSummary> {
  const real = await readSummaryFromDb(store, year, month);
  if (real) return real;
  return buildMockSummary({ storeId: store.id, storeLabel: store.nickname, year, month });
}

export async function getPeriodSummary(params: {
  year: number;
  month: number;
  storeId?: string;
}): Promise<IfoodPeriodSummary> {
  const stores = await listStores();
  const activeStores = stores.filter((store) => store.active);

  if (params.storeId) {
    const selected = activeStores.find((store) => store.id === params.storeId);
    if (!selected) {
      return {
        period: { year: params.year, month: params.month },
        storeId: params.storeId,
        storeLabel: "Loja não encontrada",
        totals: { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 },
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

export async function getStatus(): Promise<IfoodStatusView> {
  const [credential, stores, lastSync] = await Promise.all([
    getCredentialStatus(),
    listStores(),
    prisma.ifoodSyncLog.findFirst({ orderBy: { startedAt: "desc" } })
  ]);
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
    mockMode: true
  };
}

export async function runMockSync(triggeredByUserId: string | null): Promise<{ log: IfoodStatusView["lastSync"] }> {
  const startedAt = new Date();
  const log = await prisma.ifoodSyncLog.create({
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

// Sync unificada: se existe credencial e ao menos 1 loja com merchantId real,
// roda sync real (persiste no DB). Sempre também loga como fallback.
// Retorna detalhes por loja pra UI mostrar o que aconteceu.
export type SmartSyncResult = {
  mode: "REAL" | "MOCK";
  real?: RealSyncResult;
  log: IfoodStatusView["lastSync"];
};

export async function runSmartSync(triggeredByUserId: string | null, year: number, month: number): Promise<SmartSyncResult> {
  const credentialOk = await hasValidCredential();
  const anyRealStore = await prisma.deliveryStore.count({
    where: {
      platform: "IFOOD",
      active: true,
      NOT: { externalId: { startsWith: "PENDENTE-" } }
    }
  });
  if (credentialOk && anyRealStore > 0) {
    const real = await runRealSync({ year, month, triggeredByUserId });
    const lastLog = await prisma.ifoodSyncLog.findFirst({ orderBy: { startedAt: "desc" } });
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
