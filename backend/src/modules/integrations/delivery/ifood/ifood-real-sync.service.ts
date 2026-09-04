import { prisma } from "../../../../config/database.js";
import { getSales, getSettlements, getMaintenanceFees, getFinancialEvents, getReconciliation, getAnticipations, IfoodApiException } from "./ifood-financial-api.js";
import { hasValidCredential } from "./ifood-http-client.js";
import { upsertReceivableFromIfoodSettlement } from "../../../receivables/receivable.service.js";

// Sync real do iFood: chama Financial API e persiste em IfoodSale/Settlement/Fee.
// Só roda pra lojas com merchantId real (não começa com "PENDENTE-").
// Lojas PENDENTE ficam a cargo do mock service.

const PLACEHOLDER_PREFIX = "PENDENTE-";

type StorePerResult = {
  storeId: string;
  storeLabel: string;
  externalId: string;
  status: "SUCCESS" | "SKIPPED" | "ERROR";
  itemsPersisted: {
    sales: number;
    settlements: number;
    fees: number;
  };
  message: string;
};

export type RealSyncResult = {
  ranAt: string;
  hasCredential: boolean;
  perStore: StorePerResult[];
  totalPersisted: number;
};

function isRealMerchantId(externalId: string): boolean {
  return externalId.trim().length > 0 && !externalId.startsWith(PLACEHOLDER_PREFIX);
}

function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// Retorna o menor entre: último dia do mês pedido OU dia de hoje.
// iFood v3 rejeita endDate/endSalesDate no futuro com HTTP 400.
function endDateCapped(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const day = isCurrentMonth ? Math.min(today.getDate(), lastDay) : lastDay;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCompetence(iso: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 };
  return fallback;
}

function toDecimal(value: number | undefined | null, fallback = 0): number {
  return typeof value === "number" && isFinite(value) ? value : fallback;
}

async function syncStoreSales(store: { id: string; externalId: string }, year: number, month: number): Promise<number> {
  const sales = await getSales({
    merchantId: store.externalId,
    beginSalesDate: firstDayOfMonth(year, month),
    endSalesDate: endDateCapped(year, month)
  });

  // Wipeout do período antes de reinserir — evita duplicatas se rodar sync 2x.
  await prisma.ifoodSale.deleteMany({
    where: {
      deliveryStoreId: store.id,
      competenceYear: year,
      competenceMonth: month
    }
  });

  let count = 0;
  for (const sale of sales) {
    const externalOrderId = sale.orderId ?? sale.id;
    if (!externalOrderId) continue;
    const bb = sale.billingBalance ?? {};
    const gross = toDecimal(bb.grossValue ?? bb.total);
    const ifoodFee = toDecimal(bb.ifoodCommission);
    const promo = toDecimal(bb.promotionDiscount ?? bb.marketingIncentive);
    const deliveryFee = toDecimal(bb.deliveryFee);
    const net = toDecimal(bb.net ?? bb.netValue ?? bb.liquidValue, gross - ifoodFee - promo - deliveryFee);
    const orderDate = sale.createdAt ? new Date(sale.createdAt) : new Date(`${year}-${String(month).padStart(2, "0")}-01`);
    const comp = parseCompetence(sale.competence ?? sale.createdAt, { year, month });
    await prisma.ifoodSale.create({
      data: {
        deliveryStoreId: store.id,
        externalOrderId,
        orderDate,
        competenceYear: comp.year,
        competenceMonth: comp.month,
        grossAmount: gross,
        ifoodFeeAmount: ifoodFee,
        promotionAmount: promo,
        deliveryFeeAmount: deliveryFee,
        netAmount: net,
        paymentMethod: sale.paymentType ?? null,
        channel: sale.billingType ?? null,
        rawPayload: sale as object
      }
    });
    count += 1;
  }
  return count;
}

async function syncStoreSettlements(store: { id: string; externalId: string; nickname: string; companyId: string | null }, year: number, month: number): Promise<number> {
  const settlements = await getSettlements({
    merchantId: store.externalId,
    beginPaymentDate: firstDayOfMonth(year, month),
    endPaymentDate: endDateCapped(year, month)
  });

  let count = 0;
  for (const settle of settlements) {
    const externalId = settle.id ?? settle.externalId ?? settle.bankReference;
    if (!externalId) continue;
    const totals = settle.totals ?? {};
    const periodStart = settle.periodStart ?? settle.competencePeriodStart ?? firstDayOfMonth(year, month);
    const periodEnd = settle.periodEnd ?? settle.competencePeriodEnd ?? endDateCapped(year, month);
    const upserted = await prisma.ifoodSettlement.upsert({
      where: {
        deliveryStoreId_externalId: {
          deliveryStoreId: store.id,
          externalId
        }
      },
      create: {
        deliveryStoreId: store.id,
        externalId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        grossAmount: toDecimal(totals.grossValue ?? totals.total),
        totalFees: toDecimal(totals.fees ?? totals.totalFees),
        netAmount: toDecimal(totals.net ?? totals.netValue),
        paidAt: settle.paymentDate ? new Date(settle.paymentDate) : null,
        status: settle.status ?? "UNKNOWN",
        rawPayload: settle as object
      },
      update: {
        grossAmount: toDecimal(totals.grossValue ?? totals.total),
        totalFees: toDecimal(totals.fees ?? totals.totalFees),
        netAmount: toDecimal(totals.net ?? totals.netValue),
        paidAt: settle.paymentDate ? new Date(settle.paymentDate) : null,
        status: settle.status ?? "UNKNOWN",
        rawPayload: settle as object
      }
    });
    // Espelha em contas a receber (idempotente). Não bloqueia o sync se falhar —
    // o settlement já foi persistido, o recebível é derivado.
    try {
      await upsertReceivableFromIfoodSettlement(upserted, {
        companyId: store.companyId,
        nickname: store.nickname
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[iFood sync] falha ao espelhar settlement em Receivable", err);
    }
    count += 1;
  }
  return count;
}

// Após persistir vendas iFood, agrupa por (loja, dia) e reflete em RevenueEntry.
// Taxa iFood NÃO entra em platformFees (escolha 2B do usuário: taxa vira despesa
// separada em Purchase mensal, veja Fase D). Aqui platformFees=0, discounts=promoções.
// Só roda se a loja tiver companyId setado — senão o lançamento não bate no DRE certo.
async function reflectSalesIntoRevenueEntries(store: { id: string; companyId: string | null; nickname: string }, year: number, month: number): Promise<number> {
  if (!store.companyId) return 0;
  const sales = await prisma.ifoodSale.findMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
    select: {
      orderDate: true,
      grossAmount: true,
      promotionAmount: true
    }
  });
  if (sales.length === 0) return 0;

  const byDate = new Map<string, { gross: number; discounts: number; count: number; dateObj: Date }>();
  for (const sale of sales) {
    const dateKey = sale.orderDate.toISOString().slice(0, 10);
    const prev = byDate.get(dateKey) ?? { gross: 0, discounts: 0, count: 0, dateObj: new Date(dateKey + "T00:00:00.000Z") };
    prev.gross += Number(sale.grossAmount);
    prev.discounts += Number(sale.promotionAmount);
    prev.count += 1;
    byDate.set(dateKey, prev);
  }

  let count = 0;
  for (const [dateKey, agg] of byDate.entries()) {
    const gross = Math.round(agg.gross * 100) / 100;
    const discounts = Math.round(agg.discounts * 100) / 100;
    const net = Math.round((gross - discounts) * 100) / 100;
    // ID determinístico: mesma loja + mesmo dia = mesmo RevenueEntry.
    // Formato: ifood-<storeId>-<YYYYMMDD>. Idempotente entre syncs.
    const id = `ifood-${store.id}-${dateKey.replace(/-/g, "")}`;
    const dateObj = agg.dateObj;
    const competenceYear = dateObj.getUTCFullYear();
    const competenceMonth = dateObj.getUTCMonth() + 1;
    await prisma.revenueEntry.upsert({
      where: { id },
      create: {
        id,
        date: dateObj,
        competenceYear,
        competenceMonth,
        channel: "Delivery",
        sourcePlatform: "IFOOD",
        description: `Delivery iFood — ${store.nickname}`,
        grossAmount: gross,
        discounts,
        platformFees: 0,
        netAmount: net,
        tickets: agg.count,
        status: "ACTIVE"
      },
      update: {
        date: dateObj,
        competenceYear,
        competenceMonth,
        grossAmount: gross,
        discounts,
        platformFees: 0,
        netAmount: net,
        tickets: agg.count,
        description: `Delivery iFood — ${store.nickname}`,
        status: "ACTIVE"
      }
    });
    count += 1;
  }
  return count;
}

// Consolida taxas iFood do mês em IfoodMonthlyExpense (aparece em contas a pagar).
// Deve rodar DEPOIS de syncStoreSales e syncStoreFees, porque agrega ambos.
// Idempotente: mesma (loja, ano, mês) → mesmo registro atualizado.
// Só sobrescreve se o registro for autoGenerated E status=OPEN (respeita edição manual).
async function reflectFeesIntoMonthlyExpense(store: { id: string; companyId: string | null }, year: number, month: number): Promise<number> {
  const [salesAgg, feeRows] = await Promise.all([
    prisma.ifoodSale.aggregate({
      where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
      _sum: { ifoodFeeAmount: true, deliveryFeeAmount: true }
    }),
    prisma.ifoodFee.findMany({
      where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
      select: { feeType: true, amount: true }
    })
  ]);

  const commissionAmount = Number(salesAgg._sum.ifoodFeeAmount ?? 0);
  const deliveryFeeAmount = Number(salesAgg._sum.deliveryFeeAmount ?? 0);

  const feeByType = new Map<string, number>();
  for (const row of feeRows) {
    const key = row.feeType.toUpperCase();
    feeByType.set(key, (feeByType.get(key) ?? 0) + Number(row.amount));
  }
  const marketingAmount = feeByType.get("MARKETING") ?? 0;
  const maintenanceAmount = feeByType.get("MANUTENCAO") ?? feeByType.get("MAINTENANCE") ?? 0;
  const anticipationAmount = feeByType.get("ANTECIPACAO") ?? feeByType.get("ANTICIPATION") ?? 0;
  let otherAmount = 0;
  for (const [type, amount] of feeByType.entries()) {
    if (!["MARKETING", "MANUTENCAO", "MAINTENANCE", "ANTECIPACAO", "ANTICIPATION", "COMISSAO", "COMMISSION"].includes(type)) {
      otherAmount += amount;
    }
  }

  const totalAmount = Math.round((commissionAmount + deliveryFeeAmount + marketingAmount + maintenanceAmount + anticipationAmount + otherAmount) * 100) / 100;

  if (totalAmount === 0) {
    // Nada a lançar. Se já existir registro auto-gerado zerado, limpa.
    return 0;
  }

  // Vencimento: iFood normalmente compensa taxas do mês nos repasses do mês seguinte.
  // Usamos dia 10 do mês seguinte como referência editável.
  const dueDate = new Date(Date.UTC(year + (month === 12 ? 1 : 0), month === 12 ? 0 : month, 10));

  const existing = await prisma.ifoodMonthlyExpense.findUnique({
    where: {
      deliveryStoreId_competenceYear_competenceMonth: {
        deliveryStoreId: store.id,
        competenceYear: year,
        competenceMonth: month
      }
    }
  });

  const round2 = (v: number) => Math.round(v * 100) / 100;

  if (existing) {
    // Respeita edição manual: só reescreve se auto-gerado e ainda OPEN.
    if (!existing.autoGenerated || existing.status !== "OPEN") return 0;
    await prisma.ifoodMonthlyExpense.update({
      where: { id: existing.id },
      data: {
        companyId: store.companyId ?? existing.companyId,
        commissionAmount: round2(commissionAmount),
        deliveryFeeAmount: round2(deliveryFeeAmount),
        marketingAmount: round2(marketingAmount),
        maintenanceAmount: round2(maintenanceAmount),
        anticipationAmount: round2(anticipationAmount),
        otherAmount: round2(otherAmount),
        totalAmount
      }
    });
    return 1;
  }

  await prisma.ifoodMonthlyExpense.create({
    data: {
      deliveryStoreId: store.id,
      companyId: store.companyId,
      competenceYear: year,
      competenceMonth: month,
      dueDate,
      commissionAmount: round2(commissionAmount),
      deliveryFeeAmount: round2(deliveryFeeAmount),
      marketingAmount: round2(marketingAmount),
      maintenanceAmount: round2(maintenanceAmount),
      anticipationAmount: round2(anticipationAmount),
      otherAmount: round2(otherAmount),
      totalAmount,
      status: "OPEN",
      autoGenerated: true
    }
  });
  return 1;
}

async function syncStoreFinancialEvents(store: { id: string; externalId: string }, year: number, month: number): Promise<number> {
  const events = await getFinancialEvents({
    merchantId: store.externalId,
    beginDate: firstDayOfMonth(year, month),
    endDate: endDateCapped(year, month)
  });

  await prisma.ifoodFinancialEvent.deleteMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month }
  });

  let count = 0;
  for (const ev of events) {
    const externalId = ev.id ?? ev.eventId ?? ev.externalId;
    if (!externalId) continue;
    const eventDate = ev.eventDate ?? ev.createdAt ?? firstDayOfMonth(year, month);
    const comp = parseCompetence(ev.competence ?? eventDate, { year, month });
    await prisma.ifoodFinancialEvent.create({
      data: {
        deliveryStoreId: store.id,
        externalId,
        eventType: (ev.type ?? ev.eventType ?? ev.category ?? "UNKNOWN").toUpperCase(),
        eventDate: new Date(eventDate),
        competenceYear: comp.year,
        competenceMonth: comp.month,
        amount: toDecimal(ev.amount ?? ev.value),
        description: ev.description ?? null,
        referenceOrderId: ev.referenceOrderId ?? ev.orderId ?? ev.reference ?? null,
        status: ev.status ?? null,
        rawPayload: ev as object
      }
    });
    count += 1;
  }
  return count;
}

async function syncStoreReconciliation(store: { id: string; externalId: string }, year: number, month: number): Promise<number> {
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  const items = await getReconciliation({ merchantId: store.externalId, competence });

  await prisma.ifoodReconciliationItem.deleteMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month }
  });

  let count = 0;
  for (const it of items) {
    const externalId = it.id ?? it.externalId;
    if (!externalId) continue;
    const referenceDate = it.referenceDate ?? it.date ?? it.createdAt ?? firstDayOfMonth(year, month);
    await prisma.ifoodReconciliationItem.create({
      data: {
        deliveryStoreId: store.id,
        externalId,
        referenceDate: new Date(referenceDate),
        competenceYear: year,
        competenceMonth: month,
        itemType: (it.type ?? it.itemType ?? it.category ?? "UNKNOWN").toUpperCase(),
        orderId: it.orderId ?? null,
        amount: toDecimal(it.amount ?? it.value),
        description: it.description ?? null,
        settlementRef: it.settlementId ?? it.settlementRef ?? null,
        rawPayload: it as object
      }
    });
    count += 1;
  }
  return count;
}

async function syncStoreAnticipations(store: { id: string; externalId: string }, year: number, month: number): Promise<number> {
  const rows = await getAnticipations({
    merchantId: store.externalId,
    beginDate: firstDayOfMonth(year, month),
    endDate: endDateCapped(year, month)
  });

  let count = 0;
  for (const row of rows) {
    const externalId = row.id ?? row.externalId;
    if (!externalId) continue;
    const requestedAt = row.requestedAt ?? row.createdAt ?? firstDayOfMonth(year, month);
    const requested = toDecimal(row.requestedAmount ?? row.amount);
    const fee = toDecimal(row.fee ?? row.feeAmount);
    const net = toDecimal(row.net ?? row.netAmount, requested - fee);
    await prisma.ifoodAnticipation.upsert({
      where: {
        deliveryStoreId_externalId: {
          deliveryStoreId: store.id,
          externalId
        }
      },
      create: {
        deliveryStoreId: store.id,
        externalId,
        requestedAt: new Date(requestedAt),
        paidAt: row.paidAt ? new Date(row.paidAt) : row.paymentDate ? new Date(row.paymentDate) : null,
        competenceYear: year,
        competenceMonth: month,
        requestedAmount: requested,
        feeAmount: fee,
        netAmount: net,
        status: row.status ?? "UNKNOWN",
        rawPayload: row as object
      },
      update: {
        paidAt: row.paidAt ? new Date(row.paidAt) : row.paymentDate ? new Date(row.paymentDate) : null,
        requestedAmount: requested,
        feeAmount: fee,
        netAmount: net,
        status: row.status ?? "UNKNOWN",
        rawPayload: row as object
      }
    });
    count += 1;
  }
  return count;
}

async function syncStoreFees(store: { id: string; externalId: string }, year: number, month: number): Promise<number> {
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  const fees = await getMaintenanceFees({ merchantId: store.externalId, competence });

  // Wipeout do período antes de reinserir.
  await prisma.ifoodFee.deleteMany({
    where: {
      deliveryStoreId: store.id,
      competenceYear: year,
      competenceMonth: month
    }
  });

  let count = 0;
  for (const fee of fees) {
    const amount = toDecimal(fee.amount ?? fee.value);
    if (amount === 0) continue;
    await prisma.ifoodFee.create({
      data: {
        deliveryStoreId: store.id,
        competenceYear: year,
        competenceMonth: month,
        feeType: (fee.category ?? "MAINTENANCE").toUpperCase(),
        description: fee.description ?? null,
        amount,
        rawPayload: fee as object
      }
    });
    count += 1;
  }
  return count;
}

export async function runRealSync(params: {
  year: number;
  month: number;
  triggeredByUserId: string | null;
}): Promise<RealSyncResult> {
  const startedAt = new Date();
  const hasCredential = await hasValidCredential();
  const stores = await prisma.deliveryStore.findMany({
    where: { platform: "IFOOD", active: true },
    orderBy: { createdAt: "asc" }
  });

  const perStore: StorePerResult[] = [];
  let totalPersisted = 0;

  for (const store of stores) {
    if (!isRealMerchantId(store.externalId)) {
      perStore.push({
        storeId: store.id,
        storeLabel: store.nickname,
        externalId: store.externalId,
        status: "SKIPPED",
        itemsPersisted: { sales: 0, settlements: 0, fees: 0 },
        message: "merchantId ainda é placeholder (PENDENTE-*). Sync real ignorou; mantém mock na tela."
      });
      continue;
    }
    if (!hasCredential) {
      perStore.push({
        storeId: store.id,
        storeLabel: store.nickname,
        externalId: store.externalId,
        status: "SKIPPED",
        itemsPersisted: { sales: 0, settlements: 0, fees: 0 },
        message: "Credencial iFood não configurada. Salve clientId/clientSecret antes de sincronizar."
      });
      continue;
    }
    // Executa os 3 fetches de forma independente. Um 404/erro num deles
    // não deve invalidar os outros — sandbox pode não expor todos os módulos.
    const items = { sales: 0, settlements: 0, fees: 0, revenueEntries: 0, monthlyExpense: 0, events: 0, reconciliation: 0, anticipations: 0 };
    const errors: string[] = [];

    async function runStep(label: string, fn: () => Promise<number>) {
      try {
        const n = await fn();
        (items as Record<string, number>)[label] = n;
      } catch (error: unknown) {
        if (error instanceof IfoodApiException) {
          // 404 aqui geralmente significa "módulo não habilitado pro merchant",
          // não é erro crítico. Registra sem marcar como ERROR grande.
          const soft = error.info.status === 404;
          errors.push(`${label}: HTTP ${error.info.status}${error.info.detail ? " — " + error.info.detail.slice(0, 120) : ""}${soft ? " (endpoint indisponível)" : ""}`);
        } else {
          errors.push(`${label}: ${error instanceof Error ? error.message : "erro desconhecido"}`);
        }
      }
    }

    await runStep("sales", () => syncStoreSales(store, params.year, params.month));
    await runStep("settlements", () => syncStoreSettlements(store, params.year, params.month));
    await runStep("fees", () => syncStoreFees(store, params.year, params.month));
    await runStep("events", () => syncStoreFinancialEvents(store, params.year, params.month));
    await runStep("reconciliation", () => syncStoreReconciliation(store, params.year, params.month));
    await runStep("anticipations", () => syncStoreAnticipations(store, params.year, params.month));
    // Após vendas persistidas, reflete no faturamento oficial do ERP.
    // Não conta como "erro" se não fizer nada — depende de companyId estar setado.
    await runStep("revenueEntries", () => reflectSalesIntoRevenueEntries(store, params.year, params.month));
    await runStep("monthlyExpense", () => reflectFeesIntoMonthlyExpense(store, params.year, params.month));

    const persisted = items.sales + items.settlements + items.fees;
    totalPersisted += persisted;
    const status: StorePerResult["status"] = errors.length === 3
      ? "ERROR"
      : "SUCCESS";
    const messageParts: string[] = [];
    if (persisted > 0) messageParts.push(`Persistidos: ${items.sales} vendas, ${items.settlements} repasses, ${items.fees} taxas${items.revenueEntries > 0 ? `, ${items.revenueEntries} lançamentos de faturamento no DRE` : ""}.`);
    if (persisted > 0 && !store.companyId) messageParts.push("⚠️ Loja sem Empresa vinculada — dados não entraram no DRE. Configure em Integrações.");
    if (errors.length > 0) messageParts.push(`Falhas parciais: ${errors.join(" | ")}`);
    if (persisted === 0 && errors.length === 0) messageParts.push("iFood retornou zero registros neste período. Normal em sandbox sem histórico.");
    perStore.push({
      storeId: store.id,
      storeLabel: store.nickname,
      externalId: store.externalId,
      status,
      itemsPersisted: items,
      message: messageParts.join(" ")
    });
  }

  await prisma.ifoodSyncLog.create({
    data: {
      syncType: "REAL",
      startedAt,
      finishedAt: new Date(),
      status: perStore.every((r) => r.status !== "ERROR") ? "SUCCESS" : "PARTIAL",
      itemsProcessed: totalPersisted,
      triggeredByUserId: params.triggeredByUserId,
      errorMessage: perStore.filter((r) => r.status === "ERROR").map((r) => `${r.storeLabel}: ${r.message}`).join(" | ") || null
    }
  });

  return {
    ranAt: startedAt.toISOString(),
    hasCredential,
    perStore,
    totalPersisted
  };
}
