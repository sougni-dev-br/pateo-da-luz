// Painel de Fechamento Mensal (CMV v2 — 2026-07-15)
//
// Consolida o status de fechamento de um mes contabil especifico:
// faturamento, compras, fornecedores obrigatorios, impostos, inventario final,
// CMV real do ciclo (rateado por dias) e justificativas registradas.
//
// Ver docs/arquitetura-cmv-dre-v2.md — dimensao A (mes contabil rigido).

import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import crypto from "node:crypto";

export type ClosingBlockKey =
  | `supplier:${string}`
  | "block:taxes"
  | "block:finalInventory"
  | "block:revenue"
  | `block:${string}`;

export type ClosureJustification = {
  blockKey: string;
  reason: string;
  justifiedByUserId: string;
  justifiedByName?: string | null;
  justifiedAt: string;
};

type CmvContribution = {
  cmvPeriodId: string;
  code: string | null;
  cycleStart: string;
  cycleEnd: string;
  cmvReal: number;
  daysInMonth: number;
  totalDays: number;
  contribution: number;
};

function daysInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86400000) + 1;
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

// Rateio de CMV dos ciclos que interceptam o mes, por dias corridos (decisao Eli 2026-07-14).
export async function getCmvAttributedToMonth(year: number, month: number) {
  const { start: monthStart, end: monthEnd } = monthRange(year, month);
  const cycles = await prisma.$queryRaw<Array<{
    id: string;
    code: string | null;
    dataInicial: Date;
    dataFinal: Date;
    cmvReal: any;
  }>>`
    SELECT id, code, "dataInicial", "dataFinal", "cmvReal"
    FROM "CmvPeriod"
    WHERE "dataInicial" <= ${monthEnd} AND "dataFinal" >= ${monthStart}
    ORDER BY "dataInicial" ASC
  `;

  const contributions: CmvContribution[] = [];
  let total = 0;
  for (const c of cycles) {
    const cycleStart = new Date(c.dataInicial);
    const cycleEnd = new Date(c.dataFinal);
    const overlapStart = cycleStart > monthStart ? cycleStart : monthStart;
    const overlapEnd = cycleEnd < monthEnd ? cycleEnd : monthEnd;
    const daysInMonth = daysInclusive(overlapStart, overlapEnd);
    const totalDays = daysInclusive(cycleStart, cycleEnd);
    const cmvReal = toNumber(c.cmvReal);
    const contribution = totalDays > 0 ? (cmvReal * daysInMonth) / totalDays : 0;
    contributions.push({
      cmvPeriodId: c.id,
      code: c.code,
      cycleStart: toIsoDate(cycleStart),
      cycleEnd: toIsoDate(cycleEnd),
      cmvReal,
      daysInMonth,
      totalDays,
      contribution,
    });
    total += contribution;
  }
  return { total, breakdown: contributions };
}

async function getRevenueSummary(year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [salon] = await prisma.$queryRaw<Array<{
    grossAmount: any; netAmount: any; daysCount: any; entryCount: any;
  }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
           COALESCE(SUM("netAmount"), 0) AS "netAmount",
           COUNT(DISTINCT DATE("date" AT TIME ZONE 'UTC')) AS "daysCount",
           COUNT(*) AS "entryCount"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= ${start} AND "date" <= ${end}
  `;
  const [ifood] = await prisma.$queryRaw<Array<{ grossAmount: any; count: any }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount", COUNT(*) AS "count"
    FROM "IfoodSale"
    WHERE "orderDate" >= ${start} AND "orderDate" <= ${end}
  `;
  const [nn] = await prisma.$queryRaw<Array<{ grossAmount: any; count: any }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount", COUNT(*) AS "count"
    FROM "NoventaNoveSale"
    WHERE "orderDate" >= ${start} AND "orderDate" <= ${end}
  `;
  return {
    salon: {
      grossAmount: toNumber(salon?.grossAmount),
      netAmount: toNumber(salon?.netAmount),
      daysCount: toNumber(salon?.daysCount),
      entryCount: toNumber(salon?.entryCount),
    },
    ifood: {
      grossAmount: toNumber(ifood?.grossAmount),
      count: toNumber(ifood?.count),
    },
    noventaNove: {
      grossAmount: toNumber(nn?.grossAmount),
      count: toNumber(nn?.count),
    },
  };
}

async function getPurchasesSummary(year: number, month: number) {
  const [total] = await prisma.$queryRaw<Array<{ total: any; count: any }>>`
    SELECT COALESCE(SUM("totalAmount"), 0) AS "total", COUNT(*) AS "count"
    FROM "Purchase"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month} AND "status" = 'ACTIVE'
  `;
  const byCategory = await prisma.$queryRaw<Array<{ categoryName: string | null; total: any; count: any }>>`
    SELECT COALESCE(dc."name", 'Sem categoria DRE') AS "categoryName",
           COALESCE(SUM(pi."totalPrice"), 0) AS "total",
           COUNT(DISTINCT p."id") AS "count"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."competenceYear" = ${year} AND p."competenceMonth" = ${month} AND p."status" = 'ACTIVE'
    GROUP BY dc."name"
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
  `;
  return {
    total: toNumber(total?.total),
    count: toNumber(total?.count),
    byCategory: byCategory.map(c => ({
      categoryName: c.categoryName ?? "Sem categoria DRE",
      total: toNumber(c.total),
      count: toNumber(c.count),
    })),
  };
}

// Verifica se um fornecedor obrigatorio precisa aparecer neste mes conforme frequencia.
// MONTHLY: sempre cobra
// QUARTERLY: cobra mes 1,4,7,10 (jan/abr/jul/out) — heuristica simples
// ANNUAL: cobra so em janeiro (heuristica; ajustavel via dados historicos futuros)
function frequencyRequiresThisMonth(freq: string, month: number): boolean {
  if (freq === "MONTHLY") return true;
  if (freq === "QUARTERLY") return [1, 4, 7, 10].includes(month);
  if (freq === "ANNUAL") return month === 1;
  return true;
}

async function getRequiredSuppliersStatus(year: number, month: number) {
  const suppliers = await prisma.$queryRaw<Array<{
    id: string; name: string; group: string | null; frequency: string;
  }>>`
    SELECT "id", "name",
           "closingChecklistGroup" AS "group",
           "expectedClosingFrequency"::text AS "frequency"
    FROM "Supplier"
    WHERE "requiredInMonthlyClosing" = true AND "isActive" = true
    ORDER BY "closingChecklistGroup" NULLS LAST, "name"
  `;

  const totalsBySupplier = await prisma.$queryRaw<Array<{ supplierId: string; total: any; count: any }>>`
    SELECT "supplierId",
           COALESCE(SUM("totalAmount"), 0) AS "total",
           COUNT(*) AS "count"
    FROM "Purchase"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
      AND "status" = 'ACTIVE'
      AND "supplierId" = ANY(${suppliers.map(s => s.id)})
    GROUP BY "supplierId"
  `;
  const totalMap = new Map<string, { total: number; count: number }>();
  for (const t of totalsBySupplier) totalMap.set(t.supplierId, { total: toNumber(t.total), count: toNumber(t.count) });

  return suppliers.map(s => {
    const appliesThisMonth = frequencyRequiresThisMonth(s.frequency, month);
    const t = totalMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      group: s.group ?? "Outros",
      frequency: s.frequency,
      appliesThisMonth,
      present: (t?.count ?? 0) > 0,
      total: t?.total ?? 0,
      purchaseCount: t?.count ?? 0,
    };
  });
}

async function getTaxesStatus(year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const taxes = await prisma.$queryRaw<Array<{
    id: string; documentType: string; description: string | null;
    amount: any; dueDate: Date; paymentDate: Date | null; status: string;
  }>>`
    SELECT "id", "documentType", "description", "amount", "dueDate", "paymentDate", "status"::text AS "status"
    FROM "TaxPayment"
    WHERE "competenceDate" >= ${start} AND "competenceDate" <= ${end}
      AND "deletedAt" IS NULL
    ORDER BY "dueDate" ASC
  `;
  return taxes.map(t => ({
    id: t.id,
    documentType: t.documentType,
    description: t.description,
    amount: toNumber(t.amount),
    dueDate: t.dueDate.toISOString(),
    paymentDate: t.paymentDate?.toISOString() ?? null,
    status: t.status,
  }));
}

async function getFinalInventoryStatus(year: number, month: number) {
  const [snap] = await prisma.$queryRaw<Array<{
    id: string; countDate: Date; totalValue: any; totalItems: number;
  }>>`
    SELECT "id", "countDate", "totalValue", "totalItems"
    FROM "InventorySnapshot"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
      AND type = 'INVENTARIO_FINAL' AND status = 'ACTIVE'
    ORDER BY "countDate" DESC
    LIMIT 1
  `;
  if (!snap) return { hasSnapshot: false as const };
  return {
    hasSnapshot: true as const,
    snapshotId: snap.id,
    countDate: snap.countDate.toISOString(),
    totalValue: toNumber(snap.totalValue),
    totalItems: snap.totalItems,
  };
}

async function getMonthlyCmvRow(year: number, month: number) {
  return prisma.monthlyCmv.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
}

async function ensureMonthlyCmvRow(year: number, month: number) {
  const existing = await getMonthlyCmvRow(year, month);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "MonthlyCmv" ("id", "competenceYear", "competenceMonth", "status", "updatedAt")
    VALUES (${id}, ${year}, ${month}, CAST('OPEN' AS "MonthlyCloseStatus"), CURRENT_TIMESTAMP)
    ON CONFLICT ("competenceYear", "competenceMonth") DO NOTHING
  `;
  return getMonthlyCmvRow(year, month);
}

function parseJustifications(raw: any): ClosureJustification[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ClosureJustification[];
  return [];
}

export async function getMonthlyClosure(year: number, month: number) {
  const { start: monthStart, end: monthEnd } = monthRange(year, month);
  const [revenue, purchases, requiredSuppliers, taxes, finalInventory, cmvAttribution, monthlyCmv] = await Promise.all([
    getRevenueSummary(year, month),
    getPurchasesSummary(year, month),
    getRequiredSuppliersStatus(year, month),
    getTaxesStatus(year, month),
    getFinalInventoryStatus(year, month),
    getCmvAttributedToMonth(year, month),
    getMonthlyCmvRow(year, month),
  ]);

  const justifications = parseJustifications(monthlyCmv?.justifications);
  const justificationByKey = new Map<string, ClosureJustification>();
  for (const j of justifications) justificationByKey.set(j.blockKey, j);

  // Compute pending blocks
  const pending: Array<{ key: string; label: string }> = [];

  // Fornecedores obrigatorios pendentes
  for (const s of requiredSuppliers) {
    if (!s.appliesThisMonth) continue;
    if (s.present) continue;
    if (justificationByKey.has(`supplier:${s.id}`)) continue;
    pending.push({ key: `supplier:${s.id}`, label: `Fornecedor: ${s.name}` });
  }

  // Impostos: soft-warn (nao gera pending se ausente — cada operacao tem impostos diferentes)
  if (taxes.length === 0 && !justificationByKey.has("block:taxes")) {
    pending.push({ key: "block:taxes", label: "Impostos: nenhum lancamento registrado" });
  }

  // Inventario final ausente → pending
  if (!finalInventory.hasSnapshot && !justificationByKey.has("block:finalInventory")) {
    pending.push({ key: "block:finalInventory", label: "Inventario final do mes ausente" });
  }

  // Faturamento salao com <25 dias no mes → aviso soft
  if (revenue.salon.daysCount < 25 && !justificationByKey.has("block:revenue")) {
    pending.push({ key: "block:revenue", label: `Faturamento salao com apenas ${revenue.salon.daysCount} dias (esperado >= 25)` });
  }

  const canLock = pending.length === 0;
  const status = monthlyCmv?.status ?? "OPEN";

  return {
    competenceYear: year,
    competenceMonth: month,
    monthStart: monthStart.toISOString(),
    monthEnd: monthEnd.toISOString(),
    status,
    closedAt: monthlyCmv?.closedAt?.toISOString() ?? null,
    closedByUserId: monthlyCmv?.closedByUserId ?? null,
    reopenReason: monthlyCmv?.reopenReason ?? null,
    revenue,
    purchases,
    requiredSuppliers,
    taxes,
    finalInventory,
    cmvAttribution: {
      total: cmvAttribution.total,
      breakdown: cmvAttribution.breakdown,
    },
    justifications,
    summary: {
      pendingCount: pending.length,
      pending,
      canLock,
    },
  };
}

export async function justifyClosureBlock(input: { year: number; month: number; blockKey: string; reason: string; userId: string }) {
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio.");
  const row = await ensureMonthlyCmvRow(input.year, input.month);
  if (!row) throw new Error("Nao foi possivel iniciar fechamento mensal.");
  if (row.status === "CLOSED") throw new Error("Fechamento ja travado. Reabra antes de justificar novos itens.");

  const current = parseJustifications((row as any).justifications);
  const filtered = current.filter(j => j.blockKey !== input.blockKey);
  filtered.push({
    blockKey: input.blockKey,
    reason: input.reason.trim(),
    justifiedByUserId: input.userId,
    justifiedAt: new Date().toISOString(),
  });
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "justifications" = ${JSON.stringify(filtered)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function removeClosureJustification(input: { year: number; month: number; blockKey: string }) {
  const row = await getMonthlyCmvRow(input.year, input.month);
  if (!row) return getMonthlyClosure(input.year, input.month);
  if (row.status === "CLOSED") throw new Error("Fechamento travado. Reabra antes de remover justificativas.");
  const current = parseJustifications((row as any).justifications);
  const filtered = current.filter(j => j.blockKey !== input.blockKey);
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "justifications" = ${JSON.stringify(filtered)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function lockMonthlyClosure(input: { year: number; month: number; userId: string }) {
  const state = await getMonthlyClosure(input.year, input.month);
  if (state.status === "CLOSED") throw new Error("Fechamento ja esta travado.");
  if (!state.summary.canLock) {
    throw new Error(`Existem ${state.summary.pendingCount} pendencia(s) sem justificativa. Justifique todas antes de travar.`);
  }
  await ensureMonthlyCmvRow(input.year, input.month);
  const cmvAttribution = state.cmvAttribution;
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = CAST('CLOSED' AS "MonthlyCloseStatus"),
        "closedByUserId" = ${input.userId},
        "closedAt" = CURRENT_TIMESTAMP,
        "cmvAttributedValue" = ${cmvAttribution.total},
        "attributionBreakdown" = ${JSON.stringify(cmvAttribution.breakdown)}::jsonb,
        "revenueGrossValue" = ${state.revenue.salon.grossAmount + state.revenue.ifood.grossAmount + state.revenue.noventaNove.grossAmount},
        "revenueNetValue" = ${state.revenue.salon.netAmount},
        "purchasesValue" = ${state.purchases.total},
        "finalInventoryValue" = ${state.finalInventory.hasSnapshot ? state.finalInventory.totalValue : 0},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function unlockMonthlyClosure(input: { year: number; month: number; reason: string; userId: string }) {
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio para reabrir.");
  const row = await getMonthlyCmvRow(input.year, input.month);
  if (!row) throw new Error("Fechamento nao encontrado.");
  if (row.status !== "CLOSED") throw new Error("Fechamento nao esta travado.");
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = CAST('OPEN' AS "MonthlyCloseStatus"),
        "reopenedByUserId" = ${input.userId},
        "reopenedAt" = CURRENT_TIMESTAMP,
        "reopenReason" = ${input.reason.trim()},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

// Suppress unused warning on Prisma import (kept for future typed queries).
void Prisma;
