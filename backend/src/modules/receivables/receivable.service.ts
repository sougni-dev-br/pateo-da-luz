import { prisma } from "../../config/database.js";
import type {
  CreateReceivableInput,
  ListQuery,
  MarkReceivedInput,
  ReceivableStatus,
  ReceivableView
} from "./receivable.types.js";

type ReceivableRow = {
  id: string;
  companyId: string | null;
  company: { tradeName: string } | null;
  sourceType: string;
  sourceRef: string | null;
  ifoodSettlementId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  description: string;
  competenceYear: number;
  competenceMonth: number;
  expectedDate: Date;
  receivedDate: Date | null;
  grossAmount: unknown;
  fees: unknown;
  netAmount: unknown;
  paidAmount: unknown;
  paymentMethod: string | null;
  bankAccountId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  parentReceivableId: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
};

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "object" && "toString" in (value as object)) return Number(String(value)) || 0;
  return 0;
}

function toView(row: ReceivableRow): ReceivableView {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expected = new Date(row.expectedDate);
  expected.setHours(0, 0, 0, 0);
  const diffMs = expected.getTime() - today.getTime();
  const daysUntilExpected = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const isLate = row.status === "OPEN" && daysUntilExpected < 0;
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company?.tradeName ?? null,
    sourceType: row.sourceType as ReceivableView["sourceType"],
    sourceRef: row.sourceRef,
    ifoodSettlementId: row.ifoodSettlementId,
    customerName: row.customerName,
    customerDocument: row.customerDocument,
    description: row.description,
    competenceYear: row.competenceYear,
    competenceMonth: row.competenceMonth,
    expectedDate: row.expectedDate.toISOString().slice(0, 10),
    receivedDate: row.receivedDate ? row.receivedDate.toISOString().slice(0, 10) : null,
    grossAmount: toNumber(row.grossAmount),
    fees: toNumber(row.fees),
    netAmount: toNumber(row.netAmount),
    paidAmount: row.paidAmount === null ? null : toNumber(row.paidAmount),
    paymentMethod: row.paymentMethod,
    bankAccountId: row.bankAccountId,
    installmentNumber: row.installmentNumber,
    totalInstallments: row.totalInstallments,
    parentReceivableId: row.parentReceivableId,
    status: row.status as ReceivableStatus,
    notes: row.notes,
    daysUntilExpected,
    isLate,
    createdAt: row.createdAt.toISOString()
  };
}

function competenceFromDate(iso: string): { year: number; month: number } {
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export async function listReceivables(query: ListQuery): Promise<ReceivableView[]> {
  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.companyId) where.companyId = query.companyId;
  if (query.startDate || query.endDate) {
    const range: Record<string, Date> = {};
    if (query.startDate) range.gte = new Date(query.startDate);
    if (query.endDate) range.lte = new Date(query.endDate);
    where.expectedDate = range;
  }
  const rows = await prisma.receivable.findMany({
    where,
    include: { company: { select: { tradeName: true } } },
    orderBy: [{ expectedDate: "asc" }, { createdAt: "asc" }]
  });
  const views = rows.map(toView);

  // Marca "LATE" em lote virtualmente. Não persistimos aqui pra não gerar
  // update em cascata a cada listagem — a UI já sinaliza via badge amarelo.
  return views;
}

export async function createReceivable(input: CreateReceivableInput): Promise<ReceivableView> {
  const competence = competenceFromDate(input.expectedDate);
  const created = await prisma.receivable.create({
    data: {
      companyId: input.companyId ?? null,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      customerName: input.customerName ?? null,
      customerDocument: input.customerDocument ?? null,
      description: input.description,
      competenceYear: competence.year,
      competenceMonth: competence.month,
      expectedDate: new Date(input.expectedDate),
      grossAmount: input.grossAmount,
      fees: input.fees,
      netAmount: input.netAmount,
      paymentMethod: input.paymentMethod ?? null,
      bankAccountId: input.bankAccountId ?? null,
      installmentNumber: input.installmentNumber ?? null,
      totalInstallments: input.totalInstallments ?? null,
      parentReceivableId: input.parentReceivableId ?? null,
      notes: input.notes ?? null,
      status: "OPEN"
    },
    include: { company: { select: { tradeName: true } } }
  });
  return toView(created);
}

export async function markReceived(id: string, input: MarkReceivedInput, userId: string | null): Promise<ReceivableView> {
  const existing = await prisma.receivable.findUnique({ where: { id } });
  if (!existing) throw new Error("Recebível não encontrado");
  if (existing.status === "CANCELLED") throw new Error("Recebível cancelado não pode ser baixado");
  const paidAmount = input.paidAmount;
  const net = toNumber(existing.netAmount);
  const status: ReceivableStatus = paidAmount >= net - 0.005 ? "RECEIVED" : "PARTIALLY_RECEIVED";
  const updated = await prisma.receivable.update({
    where: { id },
    data: {
      status,
      receivedDate: new Date(input.receivedDate),
      paidAmount,
      paymentMethod: input.paymentMethod ?? existing.paymentMethod,
      bankAccountId: input.bankAccountId ?? existing.bankAccountId,
      notes: input.notes ?? existing.notes
    },
    include: { company: { select: { tradeName: true } } }
  });
  return toView(updated);
}

export async function cancelReceivable(id: string, reason: string | null, userId: string | null): Promise<ReceivableView> {
  const updated = await prisma.receivable.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: userId,
      cancellationReason: reason
    },
    include: { company: { select: { tradeName: true } } }
  });
  return toView(updated);
}

// Chamado pelo sync do iFood pra cada IfoodSettlement.
// Idempotente: se já existe Receivable ligado a este settlement, atualiza.
export async function upsertReceivableFromIfoodSettlement(settlement: {
  id: string;
  externalId: string;
  deliveryStoreId: string;
  periodStart: Date;
  periodEnd: Date;
  netAmount: unknown;
  grossAmount: unknown;
  totalFees: unknown;
  paidAt: Date | null;
  status: string;
}, storeContext: { companyId: string | null; nickname: string }): Promise<void> {
  const expectedDate = settlement.paidAt ?? settlement.periodEnd;
  const competence = { year: expectedDate.getFullYear(), month: expectedDate.getMonth() + 1 };
  const isPaidByIfood = settlement.status.toUpperCase().includes("PAID");
  const targetStatus: ReceivableStatus = isPaidByIfood && expectedDate <= new Date() ? "RECEIVED" : "OPEN";

  const description = `Repasse iFood ${settlement.periodStart.toISOString().slice(0,10)} → ${settlement.periodEnd.toISOString().slice(0,10)} · ${storeContext.nickname}`;
  const netAmount = toNumber(settlement.netAmount);
  const grossAmount = toNumber(settlement.grossAmount);
  const fees = toNumber(settlement.totalFees);

  const existing = await prisma.receivable.findUnique({ where: { ifoodSettlementId: settlement.id } });
  if (existing) {
    // Só atualiza se ainda não foi baixado manualmente pelo operador.
    if (existing.status === "RECEIVED" || existing.status === "CANCELLED") return;
    await prisma.receivable.update({
      where: { id: existing.id },
      data: {
        companyId: storeContext.companyId ?? existing.companyId,
        description,
        expectedDate,
        grossAmount,
        fees,
        netAmount,
        status: targetStatus,
        receivedDate: targetStatus === "RECEIVED" ? expectedDate : null,
        paidAmount: targetStatus === "RECEIVED" ? netAmount : null,
        competenceYear: competence.year,
        competenceMonth: competence.month
      }
    });
    return;
  }
  await prisma.receivable.create({
    data: {
      companyId: storeContext.companyId,
      sourceType: "IFOOD_SETTLEMENT",
      sourceRef: settlement.externalId,
      ifoodSettlementId: settlement.id,
      customerName: "iFood",
      description,
      competenceYear: competence.year,
      competenceMonth: competence.month,
      expectedDate,
      receivedDate: targetStatus === "RECEIVED" ? expectedDate : null,
      grossAmount,
      fees,
      netAmount,
      paidAmount: targetStatus === "RECEIVED" ? netAmount : null,
      paymentMethod: "IFOOD_REPASSE",
      status: targetStatus
    }
  });
}

// Espelha um repasse (settlement) do 99 Food em Contas a Receber. Mesma
// lógica do iFood, trocando a fonte (noventaNoveSettlementId /
// NOVENTA_NOVE_SETTLEMENT). Idempotente por noventaNoveSettlementId; não
// sobrescreve recebível já baixado ou cancelado manualmente.
export async function upsertReceivableFromNoventaNoveSettlement(settlement: {
  id: string;
  externalId: string;
  deliveryStoreId: string;
  periodStart: Date;
  periodEnd: Date;
  netAmount: unknown;
  grossAmount: unknown;
  totalFees: unknown;
  paidAt: Date | null;
  status: string;
}, storeContext: { companyId: string | null; nickname: string }): Promise<void> {
  const expectedDate = settlement.paidAt ?? settlement.periodEnd;
  const competence = { year: expectedDate.getFullYear(), month: expectedDate.getMonth() + 1 };
  const isPaidByPlatform = settlement.status.toUpperCase() === "PAID";
  const targetStatus: ReceivableStatus = isPaidByPlatform && expectedDate <= new Date() ? "RECEIVED" : "OPEN";

  const description = `Repasse 99 Food ${settlement.periodStart.toISOString().slice(0, 10)} → ${settlement.periodEnd.toISOString().slice(0, 10)} · ${storeContext.nickname}`;
  const netAmount = toNumber(settlement.netAmount);
  const grossAmount = toNumber(settlement.grossAmount);
  const fees = toNumber(settlement.totalFees);

  const existing = await prisma.receivable.findUnique({ where: { noventaNoveSettlementId: settlement.id } });
  if (existing) {
    if (existing.status === "RECEIVED" || existing.status === "CANCELLED") return;
    await prisma.receivable.update({
      where: { id: existing.id },
      data: {
        companyId: storeContext.companyId ?? existing.companyId,
        description,
        expectedDate,
        grossAmount,
        fees,
        netAmount,
        status: targetStatus,
        receivedDate: targetStatus === "RECEIVED" ? expectedDate : null,
        paidAmount: targetStatus === "RECEIVED" ? netAmount : null,
        competenceYear: competence.year,
        competenceMonth: competence.month
      }
    });
    return;
  }
  await prisma.receivable.create({
    data: {
      companyId: storeContext.companyId,
      sourceType: "NOVENTA_NOVE_SETTLEMENT",
      sourceRef: settlement.externalId,
      noventaNoveSettlementId: settlement.id,
      customerName: "99 Food",
      description,
      competenceYear: competence.year,
      competenceMonth: competence.month,
      expectedDate,
      receivedDate: targetStatus === "RECEIVED" ? expectedDate : null,
      grossAmount,
      fees,
      netAmount,
      paidAmount: targetStatus === "RECEIVED" ? netAmount : null,
      paymentMethod: "NOVENTA_NOVE_REPASSE",
      status: targetStatus
    }
  });
}
