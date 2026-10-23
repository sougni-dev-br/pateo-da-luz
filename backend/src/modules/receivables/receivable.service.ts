import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  competenciaDe,
  diaDe,
  diasEntre,
  hojeSaoPaulo,
  limitesDoMes,
  paraDataUtc,
  somarDias
} from "./receivable.datas.js";
import type {
  CreateReceivableInput,
  ListQuery,
  MarkReceivedInput,
  ReceiptView,
  ReceivableDetail,
  ReceivableStatus,
  ReceivableSummary,
  ReceivableView
} from "./receivable.types.js";

/** Erro de regra de negócio: a rota devolve `status` e a mensagem ao usuário. */
export class ReceivableError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ReceivableError";
  }
}

type Tx = Prisma.TransactionClient;

const COM_EMPRESA = { company: { select: { tradeName: true } } } satisfies Prisma.ReceivableInclude;
const COM_RECEBIMENTOS = { ...COM_EMPRESA, receipts: { orderBy: [{ receivedDate: "asc" }, { createdAt: "asc" }] } } satisfies Prisma.ReceivableInclude;

type ReceivableRow = Prisma.ReceivableGetPayload<{ include: typeof COM_EMPRESA }>;
type ReceivableRowComRecebimentos = Prisma.ReceivableGetPayload<{ include: typeof COM_RECEBIMENTOS }>;
type ReceiptRow = ReceivableRowComRecebimentos["receipts"][number];

const STATUS_PENDENTES: ReceivableStatus[] = ["OPEN", "PARTIALLY_RECEIVED"];

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(String(value)) || 0;
}

const centavos = (valor: number) => Math.round(valor * 100);
const deCentavos = (c: number) => c / 100;

function toView(row: ReceivableRow, hoje: string = hojeSaoPaulo()): ReceivableView {
  const daysUntilExpected = diasEntre(hoje, diaDe(row.expectedDate));
  const status = row.status as ReceivableStatus;
  const pendente = STATUS_PENDENTES.includes(status);
  const net = toNumber(row.netAmount);
  const paid = row.paidAmount === null ? null : toNumber(row.paidAmount);
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
    expectedDate: diaDe(row.expectedDate),
    receivedDate: row.receivedDate ? diaDe(row.receivedDate) : null,
    grossAmount: toNumber(row.grossAmount),
    fees: toNumber(row.fees),
    netAmount: net,
    paidAmount: paid,
    remainingAmount: pendente ? deCentavos(Math.max(0, centavos(net) - centavos(paid ?? 0))) : 0,
    paymentMethod: row.paymentMethod,
    bankAccountId: row.bankAccountId,
    installmentNumber: row.installmentNumber,
    totalInstallments: row.totalInstallments,
    parentReceivableId: row.parentReceivableId,
    status,
    notes: row.notes,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancellationReason: row.cancellationReason,
    daysUntilExpected,
    // Parcial vencida também está atrasada: o que falta continua sem chegar.
    isLate: pendente && daysUntilExpected < 0,
    createdAt: row.createdAt.toISOString()
  };
}

function receiptView(r: ReceiptRow): ReceiptView {
  return {
    id: r.id,
    receivedDate: diaDe(r.receivedDate),
    amount: toNumber(r.amount),
    paymentMethod: r.paymentMethod,
    bankAccountId: r.bankAccountId,
    notes: r.notes,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
    reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
    reversalReason: r.reversalReason,
    legacy: false
  };
}

/**
 * Conta anterior à tabela de recebimentos: tem valor recebido no resumo, mas nenhum
 * lançamento. Aparece como um recebimento "legado" para dar para ver e estornar.
 */
function recebimentoLegado(row: ReceivableRowComRecebimentos): ReceiptView | null {
  const paid = toNumber(row.paidAmount);
  if (row.receipts.length > 0 || paid <= 0) return null;
  return {
    id: "legacy",
    receivedDate: diaDe(row.receivedDate ?? row.expectedDate),
    amount: paid,
    paymentMethod: row.paymentMethod,
    bankAccountId: row.bankAccountId,
    notes: null,
    createdByUserId: null,
    createdAt: null,
    reversedAt: null,
    reversalReason: null,
    legacy: true
  };
}

/** Resumo da conta (status, valor e data recebidos) a partir dos recebimentos não estornados. */
export function derivarSituacao(netAmount: number, recebimentos: Array<{ amount: number; receivedDate: Date; reversedAt: Date | null }>) {
  const ativos = recebimentos.filter((r) => !r.reversedAt);
  const totalC = ativos.reduce((soma, r) => soma + centavos(r.amount), 0);
  if (totalC <= 0) return { status: "OPEN" as const, paidAmount: null, receivedDate: null };
  const ultima = ativos.reduce((maior, r) => (r.receivedDate > maior ? r.receivedDate : maior), ativos[0].receivedDate);
  return {
    status: totalC >= centavos(netAmount) ? ("RECEIVED" as const) : ("PARTIALLY_RECEIVED" as const),
    paidAmount: deCentavos(totalC),
    receivedDate: ultima
  };
}

/** Trava a linha até o fim da transação: duas baixas simultâneas não passam do saldo. */
async function travar(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Receivable" WHERE "id" = ${id} FOR UPDATE`;
}

async function carregar(tx: Tx, id: string): Promise<ReceivableRowComRecebimentos> {
  const row = await tx.receivable.findUnique({ where: { id }, include: COM_RECEBIMENTOS });
  if (!row) throw new ReceivableError("Conta a receber não encontrada.", 404);
  return row;
}

/** Materializa o recebimento legado como lançamento (para poder estornar ou somar a ele). */
async function materializarLegado(tx: Tx, row: ReceivableRowComRecebimentos): Promise<void> {
  const legado = recebimentoLegado(row);
  if (!legado) return;
  await tx.receivableReceipt.create({
    data: {
      receivableId: row.id,
      receivedDate: paraDataUtc(legado.receivedDate),
      amount: legado.amount,
      paymentMethod: legado.paymentMethod,
      bankAccountId: legado.bankAccountId,
      notes: "Recebimento anterior ao controle por lançamento"
    }
  });
}

async function recalcular(tx: Tx, id: string): Promise<ReceivableRow> {
  const row = await carregar(tx, id);
  const situacao = derivarSituacao(
    toNumber(row.netAmount),
    row.receipts.map((r) => ({ amount: toNumber(r.amount), receivedDate: r.receivedDate, reversedAt: r.reversedAt }))
  );
  return tx.receivable.update({
    where: { id },
    data: { status: situacao.status, paidAmount: situacao.paidAmount, receivedDate: situacao.receivedDate },
    include: COM_EMPRESA
  });
}

export async function listReceivables(query: ListQuery): Promise<{ rows: ReceivableView[]; total: number }> {
  const hoje = hojeSaoPaulo();
  const and: Prisma.ReceivableWhereInput[] = [];

  switch (query.status) {
    case "PENDING":
      and.push({ status: { in: STATUS_PENDENTES } });
      break;
    case "LATE":
      and.push({ status: { in: STATUS_PENDENTES }, expectedDate: { lt: paraDataUtc(hoje) } });
      break;
    case undefined:
      break;
    default:
      and.push({ status: query.status });
  }
  if (query.sourceType) and.push({ sourceType: query.sourceType });
  if (query.companyId) and.push({ companyId: query.companyId });
  if (query.startDate || query.endDate) {
    const faixa: Prisma.DateTimeFilter = {};
    if (query.startDate) faixa.gte = paraDataUtc(query.startDate);
    if (query.endDate) faixa.lt = paraDataUtc(somarDias(query.endDate, 1));
    and.push(query.dateField === "received" ? { receivedDate: faixa } : { expectedDate: faixa });
  }
  if (query.search) {
    const contem = { contains: query.search, mode: "insensitive" as const };
    and.push({ OR: [{ description: contem }, { customerName: contem }, { sourceRef: contem }] });
  }

  const where: Prisma.ReceivableWhereInput = and.length ? { AND: and } : {};
  // Pendentes: o que vence primeiro no topo. Histórico (recebidas, canceladas, tudo): o mais recente primeiro.
  const pendentes = query.status === "PENDING" || query.status === "LATE" || query.status === "OPEN" || query.status === "PARTIALLY_RECEIVED";
  const ordem = pendentes ? "asc" : "desc";

  const [rows, total] = await Promise.all([
    prisma.receivable.findMany({
      where,
      include: COM_EMPRESA,
      orderBy: [{ expectedDate: ordem }, { createdAt: ordem }],
      take: query.limit,
      skip: query.offset
    }),
    prisma.receivable.count({ where })
  ]);
  return { rows: rows.map((r) => toView(r, hoje)), total };
}

export async function getReceivable(id: string): Promise<ReceivableDetail> {
  const row = await prisma.receivable.findUnique({ where: { id }, include: COM_RECEBIMENTOS });
  if (!row) throw new ReceivableError("Conta a receber não encontrada.", 404);
  const legado = recebimentoLegado(row);
  return { ...toView(row), receipts: legado ? [legado] : row.receipts.map(receiptView) };
}

export async function summarizeReceivables(): Promise<ReceivableSummary> {
  const hoje = hojeSaoPaulo();
  const { inicio, fimExclusivo } = limitesDoMes(hoje);
  const pendentes = await prisma.receivable.findMany({
    where: { status: { in: STATUS_PENDENTES } },
    select: { expectedDate: true, netAmount: true, paidAmount: true }
  });

  const vazio = () => ({ count: 0, centavos: 0 });
  const baldes = { overdue: vazio(), dueToday: vazio(), next7: vazio(), next30: vazio(), pending: vazio() };
  const somar = (b: { count: number; centavos: number }, c: number) => {
    b.count += 1;
    b.centavos += c;
  };
  for (const p of pendentes) {
    const falta = Math.max(0, centavos(toNumber(p.netAmount)) - centavos(toNumber(p.paidAmount)));
    const dias = diasEntre(hoje, diaDe(p.expectedDate));
    somar(baldes.pending, falta);
    if (dias < 0) somar(baldes.overdue, falta);
    else if (dias === 0) somar(baldes.dueToday, falta);
    // Janelas cumulativas, como "próx. 7 dias" na tela de Contas a Pagar: hoje conta, atrasado não.
    if (dias >= 0 && dias <= 7) somar(baldes.next7, falta);
    if (dias >= 0 && dias <= 30) somar(baldes.next30, falta);
  }

  const noMes = { gte: inicio, lt: fimExclusivo };
  const [lancamentos, legadas] = await Promise.all([
    prisma.receivableReceipt.aggregate({
      where: { reversedAt: null, receivedDate: noMes },
      _sum: { amount: true },
      _count: true
    }),
    prisma.receivable.aggregate({
      where: { status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] }, receivedDate: noMes, receipts: { none: {} } },
      _sum: { paidAmount: true },
      _count: true
    })
  ]);

  const fora = (b: { count: number; centavos: number }) => ({ count: b.count, amount: deCentavos(b.centavos) });
  return {
    today: hoje,
    overdue: fora(baldes.overdue),
    dueToday: fora(baldes.dueToday),
    next7: fora(baldes.next7),
    next30: fora(baldes.next30),
    pending: fora(baldes.pending),
    receivedThisMonth: {
      count: lancamentos._count + legadas._count,
      amount: deCentavos(centavos(toNumber(lancamentos._sum.amount)) + centavos(toNumber(legadas._sum.paidAmount)))
    }
  };
}

export async function createReceivable(input: CreateReceivableInput): Promise<ReceivableView> {
  const expected = paraDataUtc(input.expectedDate);
  const competence = competenciaDe(expected);
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
      expectedDate: expected,
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
    include: COM_EMPRESA
  });
  return toView(created);
}

export type AcaoResultado = { view: ReceivableView; antes: { status: string; paidAmount: number | null }; receiptId?: string };

/** Registra um recebimento (total ou parcial). `input.paidAmount` é o valor deste recebimento. */
export async function markReceived(id: string, input: MarkReceivedInput, userId: string | null): Promise<AcaoResultado> {
  return prisma.$transaction(async (tx) => {
    await travar(tx, id);
    const row = await carregar(tx, id);
    const antes = { status: row.status, paidAmount: row.paidAmount === null ? null : toNumber(row.paidAmount) };
    if (row.status === "CANCELLED") throw new ReceivableError("Conta cancelada não pode receber baixa.", 409);
    if (row.status === "RECEIVED") {
      throw new ReceivableError("Esta conta já foi recebida. Estorne o recebimento antes de lançar outro.", 409);
    }

    await materializarLegado(tx, row);
    const legado = recebimentoLegado(row);
    const jaRecebidoC = row.receipts.filter((r) => !r.reversedAt).reduce((soma, r) => soma + centavos(toNumber(r.amount)), 0)
      + (legado ? centavos(legado.amount) : 0);
    const saldoC = Math.max(0, centavos(toNumber(row.netAmount)) - jaRecebidoC);
    const valorC = centavos(input.paidAmount);
    if (valorC > saldoC && !input.differenceReason) {
      throw new ReceivableError(`O valor passa do saldo a receber (R$ ${deCentavos(saldoC).toFixed(2).replace(".", ",")}). Informe o motivo da diferença.`);
    }

    const observacao = [input.notes, input.differenceReason ? `Diferença: ${input.differenceReason}` : null].filter(Boolean).join(" · ") || null;
    const receipt = await tx.receivableReceipt.create({
      data: {
        receivableId: id,
        receivedDate: paraDataUtc(input.receivedDate),
        amount: input.paidAmount,
        paymentMethod: input.paymentMethod ?? row.paymentMethod,
        bankAccountId: input.bankAccountId ?? row.bankAccountId,
        notes: observacao,
        createdByUserId: userId
      }
    });
    if (input.paymentMethod || input.bankAccountId) {
      await tx.receivable.update({
        where: { id },
        data: { paymentMethod: input.paymentMethod ?? undefined, bankAccountId: input.bankAccountId ?? undefined }
      });
    }
    const atualizada = await recalcular(tx, id);
    return { view: toView(atualizada), antes, receiptId: receipt.id };
  });
}

/** Estorna um recebimento (preserva o lançamento, marcado como estornado) e recalcula a conta. */
export async function reverseReceipt(id: string, receiptId: string, reason: string, userId: string | null): Promise<AcaoResultado> {
  return prisma.$transaction(async (tx) => {
    await travar(tx, id);
    const row = await carregar(tx, id);
    const antes = { status: row.status, paidAmount: row.paidAmount === null ? null : toNumber(row.paidAmount) };
    if (row.status === "CANCELLED") throw new ReceivableError("Conta cancelada: não há recebimento a estornar.", 409);

    let alvoId = receiptId;
    if (receiptId === "legacy") {
      if (!recebimentoLegado(row)) throw new ReceivableError("Recebimento não encontrado.", 404);
      await materializarLegado(tx, row);
      const criado = await tx.receivableReceipt.findFirst({ where: { receivableId: id }, orderBy: { createdAt: "desc" } });
      alvoId = criado!.id;
    }
    const receipt = await tx.receivableReceipt.findUnique({ where: { id: alvoId } });
    if (!receipt || receipt.receivableId !== id) throw new ReceivableError("Recebimento não encontrado.", 404);
    if (receipt.reversedAt) throw new ReceivableError("Este recebimento já foi estornado.", 409);

    await tx.receivableReceipt.update({
      where: { id: alvoId },
      data: { reversedAt: new Date(), reversedByUserId: userId, reversalReason: reason }
    });
    return { view: toView(await recalcular(tx, id)), antes, receiptId: alvoId };
  });
}

/** Cancela uma conta ainda sem recebimento. Com recebimento, é preciso estornar antes. */
export async function cancelReceivable(id: string, reason: string, userId: string | null): Promise<AcaoResultado> {
  return prisma.$transaction(async (tx) => {
    await travar(tx, id);
    const row = await carregar(tx, id);
    const antes = { status: row.status, paidAmount: row.paidAmount === null ? null : toNumber(row.paidAmount) };
    if (row.status === "CANCELLED") throw new ReceivableError("Esta conta já está cancelada.", 409);
    const temRecebimento = row.status !== "OPEN" || toNumber(row.paidAmount) > 0 || row.receipts.some((r) => !r.reversedAt);
    if (temRecebimento) {
      throw new ReceivableError("Esta conta tem recebimento registrado. Estorne o recebimento antes de cancelar.", 409);
    }
    const updated = await tx.receivable.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: userId, cancellationReason: reason },
      include: COM_EMPRESA
    });
    return { view: toView(updated), antes };
  });
}

/**
 * Status de repasse que significa "a plataforma já pagou". Exato de propósito: "UNPAID",
 * "NOT_PAID" e "PARTIALLY_PAID" contêm "PAID" e NÃO são pagos.
 */
export function statusIndicaPago(status: string): boolean {
  const s = status.trim().toUpperCase();
  return s === "PAID" || s === "SETTLED" || (s.endsWith("_PAID") && !/(^|_)(UN|NOT_|PARTIALLY_)PAID$/.test(s));
}

type RepasseDePlataforma = {
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
};

type Plataforma = {
  rotulo: string;
  nome: string;
  sourceType: "IFOOD_SETTLEMENT" | "NOVENTA_NOVE_SETTLEMENT";
  campoChave: "ifoodSettlementId" | "noventaNoveSettlementId";
  formaPagamento: string;
};

const IFOOD: Plataforma = { rotulo: "Repasse iFood", nome: "iFood", sourceType: "IFOOD_SETTLEMENT", campoChave: "ifoodSettlementId", formaPagamento: "IFOOD_REPASSE" };
const NOVENTA_NOVE: Plataforma = { rotulo: "Repasse 99 Food", nome: "99 Food", sourceType: "NOVENTA_NOVE_SETTLEMENT", campoChave: "noventaNoveSettlementId", formaPagamento: "NOVENTA_NOVE_REPASSE" };

const OBS_PLATAFORMA = "Repasse confirmado pela plataforma";

// Idempotente por repasse. Só mexe em conta ainda em aberto: o que o operador já recebeu
// (total ou em parte) ou cancelou à mão não é refeito pela sincronização.
async function espelharRepasse(p: Plataforma, settlement: RepasseDePlataforma, storeContext: { companyId: string | null; nickname: string }): Promise<void> {
  const expectedDate = settlement.paidAt ?? settlement.periodEnd;
  const competence = competenciaDe(expectedDate);
  const paga = statusIndicaPago(settlement.status) && expectedDate <= new Date();
  const status: ReceivableStatus = paga ? "RECEIVED" : "OPEN";
  // O repasse traz instante com hora; o recebimento é um dia de calendário, o de São Paulo.
  const diaDoRecebimento = paraDataUtc(hojeSaoPaulo(expectedDate));
  const description = `${p.rotulo} ${diaDe(settlement.periodStart)} → ${diaDe(settlement.periodEnd)} · ${storeContext.nickname}`;
  const netAmount = toNumber(settlement.netAmount);
  const grossAmount = toNumber(settlement.grossAmount);
  const fees = toNumber(settlement.totalFees);
  const recebimento = { receivedDate: diaDoRecebimento, amount: netAmount, paymentMethod: p.formaPagamento, notes: OBS_PLATAFORMA };
  const valores = { description, expectedDate, grossAmount, fees, netAmount, competenceYear: competence.year, competenceMonth: competence.month };

  const existing = await prisma.receivable.findUnique({ where: { [p.campoChave]: settlement.id } as never });
  if (existing) {
    if (existing.status !== "OPEN") return;
    // O status lido acima pode ter mudado (baixa feita agora na tela): relê com a linha travada.
    await prisma.$transaction(async (tx) => {
      await travar(tx, existing.id);
      const atual = await tx.receivable.findUnique({ where: { id: existing.id }, include: { receipts: { select: { id: true } } } });
      if (!atual || atual.status !== "OPEN") return;
      // Já teve recebimento estornado à mão: a sincronização atualiza os valores, mas não refaz o recebimento.
      const estornadoAMao = atual.receipts.length > 0;
      await tx.receivable.update({
        where: { id: existing.id },
        data: {
          ...valores,
          companyId: storeContext.companyId ?? existing.companyId,
          ...(estornadoAMao ? {} : { status, receivedDate: paga ? diaDoRecebimento : null, paidAmount: paga ? netAmount : null })
        }
      });
      if (paga && !estornadoAMao) await tx.receivableReceipt.create({ data: { receivableId: existing.id, ...recebimento } });
    });
    return;
  }
  await prisma.receivable.create({
    data: {
      ...valores,
      companyId: storeContext.companyId,
      sourceType: p.sourceType,
      sourceRef: settlement.externalId,
      [p.campoChave]: settlement.id,
      customerName: p.nome,
      receivedDate: paga ? diaDoRecebimento : null,
      paidAmount: paga ? netAmount : null,
      paymentMethod: p.formaPagamento,
      status,
      ...(paga ? { receipts: { create: recebimento } } : {})
    }
  });
}

// Chamado pelo sync do iFood pra cada IfoodSettlement.
export function upsertReceivableFromIfoodSettlement(
  settlement: RepasseDePlataforma,
  storeContext: { companyId: string | null; nickname: string }
): Promise<void> {
  return espelharRepasse(IFOOD, settlement, storeContext);
}

// Espelha um repasse (settlement) do 99 Food em Contas a Receber.
export function upsertReceivableFromNoventaNoveSettlement(
  settlement: RepasseDePlataforma,
  storeContext: { companyId: string | null; nickname: string }
): Promise<void> {
  return espelharRepasse(NOVENTA_NOVE, settlement, storeContext);
}
