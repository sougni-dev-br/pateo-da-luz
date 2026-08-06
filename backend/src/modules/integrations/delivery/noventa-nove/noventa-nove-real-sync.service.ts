import { prisma } from "../../../../config/database.js";
import {
  getBillDetails,
  getSettlements,
  NoventaNoveApiException,
  type NoventaNoveBillDetail,
  type NoventaNoveSettlement
} from "./noventa-nove-financial-api.js";
import { hasValidCredential } from "./noventa-nove-http-client.js";
import { upsertReceivableFromNoventaNoveSettlement } from "../../../receivables/receivable.service.js";

// Sync real 99 Food — reconcilia o financeiro da Financial API com o que o
// webhook orderNew já gravou em NoventaNoveSale.
//
// Diferença estrutural vs iFood: a 99 NÃO tem endpoint de listagem de
// pedidos. As vendas entram por webhook; aqui usamos o Get Bill Data
// (getShopBillDetail) como fonte financeira autoritativa pra:
//   1. reconciliar a comissão REAL por pedido (substitui a estimativa por %)
//   2. compor bruto/taxas de cada repasse (getShopBillWeek só dá o líquido)
//
// Estornos (orderType 2/3/4): gravados como linha de AJUSTE própria em
// NoventaNoveSale (chave sintética, valores negativos como vêm da 99), na
// competência em que o estorno ocorreu. NÃO sobrescrevem o pedido original —
// o RevenueEntry do dia agrega venda + estorno, mantendo o DRE correto e o
// sync idempotente (rodar 2x converge, não dobra).
//
// Decisões (docs/99food/passo-2-plano.md):
//   A. settlement.grossAmount/totalFees = agregado dos bills do repasse
//      (cruza dayPaymentIDList × dayPaymentId; busca inclui a borda do mês
//      anterior porque repasses são semanais e cruzam a virada).
//   B. noventaNoveFeeAmount = commissionAmount real do bill.
//   C. disparo manual (runSmartSync); cron diário fica pro passo 3.
//
// Valores da 99 vêm em centavos (int) → /100 pro Decimal(14,2).
//
// ⚠️ Sinais em estornos: orderAmount/settlementAmount vêm negativos (reduzem
// faturamento/líquido — o que corrige o DRE). Já commissionAmount/vatAmount de
// estorno têm sinal a confirmar com pedido real no sandbox; afeta só a precisão
// da despesa mensal (Contas a Pagar), não o faturamento.

const PLACEHOLDER_PREFIX = "PENDENTE-";

// orderType do Get Bill Data. 1 = receita; 2/3/4 = estornos; 5 = monthly fee
// (grocery, não se aplica ao restaurante — ignorado).
const BILL_ORDER_TYPE_REVENUE = 1;
const BILL_REFUND_ORDER_TYPES = new Set<number>([2, 3, 4]);

// Repasses são semanais e podem começar até ~1 semana antes do mês pedido.
// Buscamos essa borda anterior só pra compor bruto/taxas do repasse.
const SETTLEMENT_EDGE_DAYS = 8;

// Fuso do restaurante (BRT, sem DST). Mantém o dia-calendário consistente em
// todo o arquivo — datas da 99 e "hoje" são tratados como BRT.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

type StoreStatus = "SUCCESS" | "PARTIAL" | "SKIPPED" | "ERROR";

type StorePerResult = {
  storeId: string;
  storeLabel: string;
  externalId: string;
  status: StoreStatus;
  itemsPersisted: { sales: number; settlements: number; fees: number };
  message: string;
};

export type RealSyncResult = {
  ranAt: string;
  hasCredential: boolean;
  perStore: StorePerResult[];
  totalPersisted: number;
};

function isRealAppShopId(externalId: string): boolean {
  return externalId.trim().length > 0 && !externalId.startsWith(PLACEHOLDER_PREFIX);
}

// centavos (int) → unidade monetária. Aceita undefined/null.
function cents(value: number | undefined | null): number {
  return typeof value === "number" && isFinite(value) ? value / 100 : 0;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

// YYYYMMDD do 1º dia do mês.
function firstDayYmd(year: number, month: number): string {
  return `${year}${String(month).padStart(2, "0")}01`;
}

// YYYYMMDD do último dia do mês; capa em hoje (BRT) quando é o mês corrente (a
// 99 rejeita datas futuras). "Hoje" em BRT pra não virar o dia entre 21h–23h59.
function endDayYmdCapped(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const nowBrt = new Date(Date.now() - BRT_OFFSET_MS);
  const isCurrentMonth = nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === month;
  const day = isCurrentMonth ? Math.min(nowBrt.getUTCDate(), lastDay) : lastDay;
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

// "YYYYMMDD" → Date (UTC meia-noite).
function parseYmd(ymd: string | undefined, fallback: Date): Date {
  if (ymd && /^\d{8}$/.test(ymd)) {
    return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  }
  return fallback;
}

function toYmd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function ymdMinusDays(ymd: string, days: number): string {
  const base = parseYmd(ymd, new Date());
  return toYmd(new Date(base.getTime() - days * 86_400_000));
}

// businessDateTime "YYYY-MM-DD HH:mm:ss" (horário local BRT, sem offset) →
// Date. Anexar "Z" preserva o dia-calendário do fato quando lido de volta com
// getUTC*(). Fallback: businessTs (epoch), com ajuste de -3h pra BRT manter o
// mesmo dia-calendário; por fim, 1º dia do período.
function parseBillDate(bill: NoventaNoveBillDetail, fallback: Date): Date {
  if (bill.businessDateTime) {
    const d = new Date(bill.businessDateTime.replace(" ", "T") + "Z");
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof bill.businessTs === "number" && bill.businessTs > 0) {
    return new Date(bill.businessTs * 1000 - BRT_OFFSET_MS);
  }
  return fallback;
}

// Chave sintética idempotente pra linha de ajuste de estorno. Estável entre
// syncs: usa dayPaymentId (quando presente) ou businessTs; por fim o tipo.
function refundExternalId(orderId: string, bill: NoventaNoveBillDetail): string {
  // dayPaymentId sozinho é o LOTE (diário/semanal) e colide quando o mesmo
  // pedido tem 2 estornos no mesmo lote (ex.: parcial tipo 3 + pós-venda tipo 4)
  // — o 2º upsert sobrescreveria o 1º. Compomos com orderType SEMPRE + todos os
  // ids disponíveis pra minimizar colisão.
  const parts = [`t${bill.orderType}`];
  if (bill.orderIndex && bill.orderIndex.length > 0) parts.push(bill.orderIndex);
  if (typeof bill.businessTs === "number" && bill.businessTs > 0) parts.push(String(bill.businessTs));
  if (bill.dayPaymentId && bill.dayPaymentId.length > 0) parts.push(bill.dayPaymentId);
  return `${orderId}::R${parts.join("-")}`;
}

// ---------------------------------------------------------------------------
// 1. Sales — reconcilia NoventaNoveSale com a comissão real (decisão B) e
//    grava estornos como linha de ajuste própria.
// ---------------------------------------------------------------------------

async function persistSales(
  store: { id: string },
  bills: NoventaNoveBillDetail[],
  year: number,
  month: number
): Promise<number> {
  const fallbackDate = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  for (const bill of bills) {
    if (!bill.orderId) continue;
    const isRevenue = bill.orderType === BILL_ORDER_TYPE_REVENUE;
    const isRefund = BILL_REFUND_ORDER_TYPES.has(bill.orderType);
    if (!isRevenue && !isRefund) continue;

    const orderDate = parseBillDate(bill, fallbackDate);
    // Receita: chave = orderId (reconcilia o que o webhook gravou).
    // Estorno: chave sintética própria (não sobrescreve o pedido original).
    const externalOrderId = isRevenue ? bill.orderId : refundExternalId(bill.orderId, bill);
    const data = {
      orderDate,
      competenceYear: orderDate.getUTCFullYear(),
      competenceMonth: orderDate.getUTCMonth() + 1,
      grossAmount: cents(bill.orderAmount), // estorno vem negativo → reduz faturamento
      noventaNoveFeeAmount: cents(bill.commissionAmount),
      promotionAmount: isRevenue ? Math.abs(cents(bill.shopActivityOutcome)) : 0,
      deliveryFeeAmount: cents(bill.b2pDeliveryAmount),
      netAmount: cents(bill.settlementAmount),
      paymentMethod: bill.paymentChannel != null ? String(bill.paymentChannel) : null,
      channel: isRevenue ? "DELIVERY" : "DELIVERY_REFUND",
      rawPayload: bill as object
    };
    await prisma.noventaNoveSale.upsert({
      where: { deliveryStoreId_externalOrderId: { deliveryStoreId: store.id, externalOrderId } },
      create: { deliveryStoreId: store.id, externalOrderId, ...data },
      update: data
    });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 2. Settlements — repasse + Contas a Receber, bruto/taxas dos bills (decisão A)
// ---------------------------------------------------------------------------

// Compõe bruto e taxas do repasse somando os bills cujo dayPaymentId consta no
// dayPaymentIDList do settlement. `matched` conta quantos IDs do repasse foram
// cobertos pelos bills disponíveis — se ficar incompleto, sinalizamos ao
// chamador em vez de fingir taxa zero.
function composeSettlementTotals(
  settlement: NoventaNoveSettlement,
  billsByDayPayment: Map<string, NoventaNoveBillDetail[]>
): { grossAmount: number; totalFees: number; complete: boolean } {
  const ids = settlement.dayPaymentIDList ?? [];
  let gross = 0;
  let fees = 0;
  let matchedIds = 0;
  for (const dayId of ids) {
    const group = billsByDayPayment.get(dayId);
    if (!group) continue;
    matchedIds += 1;
    for (const bill of group) {
      gross += cents(bill.orderAmount);
      fees += cents(bill.commissionAmount) + cents(bill.b2pDeliveryAmount) + cents(bill.payCommissionAmount) + cents(bill.vatAmount);
    }
  }
  const complete = ids.length > 0 && matchedIds === ids.length;
  if (matchedIds === 0) {
    // Sem nenhum bill do repasse à mão: grava o líquido e marca incompleto.
    return { grossAmount: cents(settlement.withdrawAmount), totalFees: 0, complete: false };
  }
  return { grossAmount: round2(gross), totalFees: round2(Math.abs(fees)), complete };
}

async function persistSettlements(
  store: { id: string; nickname: string; companyId: string | null },
  settlements: NoventaNoveSettlement[],
  bills: NoventaNoveBillDetail[],
  year: number,
  month: number
): Promise<{ count: number; incomplete: number }> {
  const billsByDayPayment = new Map<string, NoventaNoveBillDetail[]>();
  for (const bill of bills) {
    if (!bill.dayPaymentId) continue;
    const list = billsByDayPayment.get(bill.dayPaymentId) ?? [];
    list.push(bill);
    billsByDayPayment.set(bill.dayPaymentId, list);
  }

  const fallbackStart = new Date(Date.UTC(year, month - 1, 1));
  const fallbackEnd = new Date(Date.UTC(year, month, 0));
  let count = 0;
  let incomplete = 0;
  for (const settle of settlements) {
    if (!settle.weekPaymentId) continue;
    const periodStart = parseYmd(settle.settleStartDate, fallbackStart);
    const periodEnd = parseYmd(settle.settleEndDate, fallbackEnd);
    const netAmount = cents(settle.withdrawAmount);
    const paidAt = settle.withdrawDate ? new Date(settle.withdrawDate) : null;
    const { grossAmount, totalFees, complete } = composeSettlementTotals(settle, billsByDayPayment);
    if (!complete) incomplete += 1;
    const status = paidAt ? "PAID" : "PENDING";

    const upserted = await prisma.noventaNoveSettlement.upsert({
      where: { deliveryStoreId_externalId: { deliveryStoreId: store.id, externalId: settle.weekPaymentId } },
      create: {
        deliveryStoreId: store.id,
        externalId: settle.weekPaymentId,
        periodStart,
        periodEnd,
        grossAmount,
        totalFees,
        netAmount,
        paidAt,
        status,
        rawPayload: settle as object
      },
      update: { periodStart, periodEnd, grossAmount, totalFees, netAmount, paidAt, status, rawPayload: settle as object }
    });
    // Espelha em Contas a Receber. Não bloqueia o sync se falhar — o
    // settlement já foi persistido, o recebível é derivado.
    try {
      await upsertReceivableFromNoventaNoveSettlement(upserted, { companyId: store.companyId, nickname: store.nickname });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[99Food sync] falha ao espelhar settlement em Receivable", err);
    }
    count += 1;
  }
  return { count, incomplete };
}

// ---------------------------------------------------------------------------
// 3. RevenueEntry — faturamento delivery no DRE (só com companyId)
// ---------------------------------------------------------------------------

async function reflectSalesIntoRevenueEntries(
  store: { id: string; companyId: string | null; nickname: string },
  year: number,
  month: number
): Promise<number> {
  if (!store.companyId) return 0;
  const sales = await prisma.noventaNoveSale.findMany({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
    select: { orderDate: true, grossAmount: true, promotionAmount: true, channel: true }
  });
  if (sales.length === 0) return 0;

  // Agrega por dia (venda + estorno do mesmo dia se cancelam no líquido).
  const byDate = new Map<string, { gross: number; discounts: number; count: number; dateObj: Date }>();
  for (const sale of sales) {
    const dateKey = sale.orderDate.toISOString().slice(0, 10);
    const prev = byDate.get(dateKey) ?? { gross: 0, discounts: 0, count: 0, dateObj: new Date(dateKey + "T00:00:00.000Z") };
    prev.gross += Number(sale.grossAmount);
    prev.discounts += Number(sale.promotionAmount);
    // Estorno é linha de ajuste — reduz o gross do dia, mas não conta como
    // "pedido" (senão distorce o ticket médio).
    if (sale.channel !== "DELIVERY_REFUND") prev.count += 1;
    byDate.set(dateKey, prev);
  }

  let count = 0;
  for (const [dateKey, agg] of byDate.entries()) {
    const gross = round2(agg.gross);
    const discounts = round2(agg.discounts);
    const net = round2(gross - discounts);
    const id = `nnfood-${store.id}-${dateKey.replace(/-/g, "")}`;
    const competenceYear = agg.dateObj.getUTCFullYear();
    const competenceMonth = agg.dateObj.getUTCMonth() + 1;
    await prisma.revenueEntry.upsert({
      where: { id },
      create: {
        id,
        date: agg.dateObj,
        competenceYear,
        competenceMonth,
        channel: "Delivery",
        sourcePlatform: "NOVENTA_NOVE",
        description: `Delivery 99 Food — ${store.nickname}`,
        grossAmount: gross,
        discounts,
        platformFees: 0,
        netAmount: net,
        tickets: agg.count,
        status: "ACTIVE"
      },
      update: {
        date: agg.dateObj,
        competenceYear,
        competenceMonth,
        grossAmount: gross,
        discounts,
        platformFees: 0,
        netAmount: net,
        tickets: agg.count,
        description: `Delivery 99 Food — ${store.nickname}`,
        status: "ACTIVE"
      }
    });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 4. MonthlyExpense — taxas do mês em Contas a Pagar
// ---------------------------------------------------------------------------

async function reflectFeesIntoMonthlyExpense(
  store: { id: string; companyId: string | null },
  bills: NoventaNoveBillDetail[],
  year: number,
  month: number
): Promise<number> {
  // Comissão + entrega saem das sales (já reconciliadas e líquidas de estorno).
  const salesAgg = await prisma.noventaNoveSale.aggregate({
    where: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month },
    _sum: { noventaNoveFeeAmount: true, deliveryFeeAmount: true }
  });
  // Agregado LÍQUIDO de estornos. max(0,…): num mês em que a 99 devolve mais
  // comissão do que cobra (crédito, líquido negativo) a despesa NÃO vira
  // positiva — clampa a zero em vez de inflar Contas a Pagar. ⚠️ Sinal de
  // comissão/IVA em estorno ainda a confirmar no sandbox (ver topo do arquivo).
  const commissionAmount = Math.max(0, Number(salesAgg._sum.noventaNoveFeeAmount ?? 0));
  const deliveryFeeAmount = Math.max(0, Number(salesAgg._sum.deliveryFeeAmount ?? 0));

  // Taxa de pagamento + IVA saem dos bills (não estão nas sales). Vêm como
  // dedução (negativa) → despesa = -soma; estorno reverte (positivo). max(0,…)
  // impede que um período de crédito líquido vire despesa. Ignora tipo 5 (grocery).
  let otherRaw = 0;
  for (const bill of bills) {
    if (bill.orderType === 5) continue;
    otherRaw += cents(bill.payCommissionAmount) + cents(bill.vatAmount);
  }
  const otherAmount = round2(Math.max(0, -otherRaw));

  const totalAmount = round2(commissionAmount + deliveryFeeAmount + otherAmount);
  if (totalAmount <= 0) return 0;

  const dueDate = new Date(Date.UTC(year + (month === 12 ? 1 : 0), month === 12 ? 0 : month, 10));

  const existing = await prisma.noventaNoveMonthlyExpense.findUnique({
    where: { deliveryStoreId_competenceYear_competenceMonth: { deliveryStoreId: store.id, competenceYear: year, competenceMonth: month } }
  });

  if (existing) {
    if (!existing.autoGenerated || existing.status !== "OPEN") return 0;
    await prisma.noventaNoveMonthlyExpense.update({
      where: { id: existing.id },
      data: {
        companyId: store.companyId ?? existing.companyId,
        commissionAmount: round2(commissionAmount),
        deliveryFeeAmount: round2(deliveryFeeAmount),
        otherAmount: round2(otherAmount),
        totalAmount
      }
    });
    return 1;
  }

  await prisma.noventaNoveMonthlyExpense.create({
    data: {
      deliveryStoreId: store.id,
      companyId: store.companyId,
      competenceYear: year,
      competenceMonth: month,
      dueDate,
      commissionAmount: round2(commissionAmount),
      deliveryFeeAmount: round2(deliveryFeeAmount),
      otherAmount: round2(otherAmount),
      totalAmount,
      status: "OPEN",
      autoGenerated: true
    }
  });
  return 1;
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

function formatApiError(error: unknown): string {
  if (error instanceof NoventaNoveApiException) {
    return error.info.message + (error.info.detail ? ` — ${error.info.detail.slice(0, 120)}` : "");
  }
  return error instanceof Error ? error.message : "erro desconhecido";
}

// Sincroniza uma loja já elegível (AppShopID real + credencial presente).
async function syncEligibleStore(
  store: { id: string; externalId: string; nickname: string; companyId: string | null },
  year: number,
  month: number
): Promise<{ result: StorePerResult; persisted: number }> {
  const monthPeriod = { startDate: firstDayYmd(year, month), endDate: endDayYmdCapped(year, month) };
  const errors: string[] = [];
  let billDataFailed = false;
  let settlementsFailed = false;

  // Bills do mês — base de sales/DRE/despesas.
  let monthlyBills: NoventaNoveBillDetail[] = [];
  try {
    monthlyBills = await getBillDetails({ appShopId: store.externalId, ...monthPeriod });
  } catch (error: unknown) {
    billDataFailed = true;
    errors.push(`billData: ${formatApiError(error)}`);
  }

  // Bills da borda anterior (~1 semana) — SÓ pra compor repasses semanais que
  // cruzam a virada do mês. Best-effort: falha aqui não invalida o sync.
  let edgeBills: NoventaNoveBillDetail[] = [];
  if (!billDataFailed) {
    try {
      edgeBills = await getBillDetails({
        appShopId: store.externalId,
        startDate: ymdMinusDays(monthPeriod.startDate, SETTLEMENT_EDGE_DAYS),
        endDate: ymdMinusDays(monthPeriod.startDate, 1)
      });
    } catch {
      /* borda é best-effort */
    }
  }
  const settlementBills = monthlyBills.concat(edgeBills);

  let salesCount = 0;
  try {
    salesCount = await persistSales(store, monthlyBills, year, month);
  } catch (error: unknown) {
    errors.push(`sales: ${formatApiError(error)}`);
  }

  let settlementsCount = 0;
  let settlementsIncomplete = 0;
  try {
    const settlements = await getSettlements({ appShopId: store.externalId, ...monthPeriod });
    const r = await persistSettlements(store, settlements, settlementBills, year, month);
    settlementsCount = r.count;
    settlementsIncomplete = r.incomplete;
  } catch (error: unknown) {
    settlementsFailed = true;
    errors.push(`settlements: ${formatApiError(error)}`);
  }

  let revenueEntries = 0;
  try {
    revenueEntries = await reflectSalesIntoRevenueEntries(store, year, month);
  } catch (error: unknown) {
    errors.push(`revenueEntries: ${formatApiError(error)}`);
  }

  let monthlyExpense = 0;
  try {
    monthlyExpense = await reflectFeesIntoMonthlyExpense(store, monthlyBills, year, month);
  } catch (error: unknown) {
    errors.push(`monthlyExpense: ${formatApiError(error)}`);
  }

  const persisted = salesCount + settlementsCount + monthlyExpense;

  let status: StoreStatus;
  if (billDataFailed && settlementsFailed) status = "ERROR"; // nenhuma fonte respondeu
  else if (errors.length > 0) status = "PARTIAL";
  else status = "SUCCESS";

  const messageParts: string[] = [];
  if (persisted > 0) {
    messageParts.push(
      `Persistidos: ${salesCount} pedidos, ${settlementsCount} repasses${monthlyExpense > 0 ? ", taxas do mês consolidadas" : ""}${revenueEntries > 0 ? `, ${revenueEntries} lançamentos no DRE` : ""}.`
    );
  }
  if (persisted > 0 && !store.companyId) {
    messageParts.push("⚠️ Loja sem Empresa vinculada — dados não entraram no DRE. Configure em Integrações.");
  }
  if (settlementsIncomplete > 0) {
    messageParts.push(`⚠️ ${settlementsIncomplete} repasse(s) com bruto/taxas incompletos (pedidos fora da janela sincronizada).`);
  }
  if (errors.length > 0) messageParts.push(`Falhas parciais: ${errors.join(" | ")}`);
  if (persisted === 0 && errors.length === 0) {
    messageParts.push("99 Food retornou zero registros neste período. Normal em sandbox sem histórico.");
  }

  return {
    result: {
      storeId: store.id,
      storeLabel: store.nickname,
      externalId: store.externalId,
      status,
      itemsPersisted: { sales: salesCount, settlements: settlementsCount, fees: monthlyExpense },
      message: messageParts.join(" ")
    },
    persisted
  };
}

export async function runRealSync(params: {
  year: number;
  month: number;
  triggeredByUserId: string | null;
}): Promise<RealSyncResult> {
  const startedAt = new Date();
  const hasCredential = await hasValidCredential();
  const stores = await prisma.deliveryStore.findMany({
    where: { platform: "NOVENTA_NOVE", active: true },
    orderBy: { createdAt: "asc" }
  });

  const perStore: StorePerResult[] = [];
  let totalPersisted = 0;

  for (const store of stores) {
    if (!isRealAppShopId(store.externalId) || !hasCredential) {
      perStore.push({
        storeId: store.id,
        storeLabel: store.nickname,
        externalId: store.externalId,
        status: "SKIPPED",
        itemsPersisted: { sales: 0, settlements: 0, fees: 0 },
        message: !hasCredential
          ? "Credencial 99 Food não configurada. Salve app_id/app_secret antes de sincronizar."
          : "AppShopID ainda é placeholder (PENDENTE-*). Sync real ignorou; mantém mock na tela."
      });
      continue;
    }
    const { result, persisted } = await syncEligibleStore(store, params.year, params.month);
    perStore.push(result);
    totalPersisted += persisted;
  }

  await prisma.noventaNoveSyncLog.create({
    data: {
      syncType: "REAL",
      startedAt,
      finishedAt: new Date(),
      status: perStore.every((r) => r.status === "SUCCESS" || r.status === "SKIPPED") ? "SUCCESS" : "PARTIAL",
      itemsProcessed: totalPersisted,
      triggeredByUserId: params.triggeredByUserId,
      errorMessage: perStore.filter((r) => r.status === "ERROR").map((r) => `${r.storeLabel}: ${r.message}`).join(" | ") || null
    }
  });

  return { ranAt: startedAt.toISOString(), hasCredential, perStore, totalPersisted };
}
