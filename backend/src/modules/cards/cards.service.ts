import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { compraLevaDespesaAoDre } from "../purchases/purchase-aggregators.js";
import { divergenciasDeExtrato, subtotaisPorFinal } from "./finais-da-fatura.js";

export type CardRow = {
  id: string;
  name: string;
  bankName: string;
  last4Digits: string;
  closingDay: number;
  dueDay: number;
};

export async function getNextPurchaseNumber(tx: Prisma.TransactionClient, year: number) {
  await tx.$executeRaw`
    INSERT INTO "PurchaseSequence" ("year", "currentValue", "updatedAt")
    VALUES (${year}, 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO NOTHING
  `;
  const [row] = await tx.$queryRaw<Array<{ currentValue: number }>>`
    UPDATE "PurchaseSequence"
    SET "currentValue" = "currentValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "year" = ${year}
    RETURNING "currentValue"
  `;
  return `CMP-${year}-${String(row.currentValue).padStart(6, "0")}`;
}

export function getCardStatementPeriod(card: CardRow, purchaseDate: Date) {
  const day = purchaseDate.getDate();
  const statementBase = day <= card.closingDay ? purchaseDate : new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + 1, 1);
  const statementYear = statementBase.getFullYear();
  const statementMonthIndex = statementBase.getMonth();
  const lastDayOfMonth = new Date(statementYear, statementMonthIndex + 1, 0).getDate();
  const closingDate = new Date(statementYear, statementMonthIndex, Math.min(card.closingDay, lastDayOfMonth));
  const dueBase = new Date(statementYear, statementMonthIndex + 1, 1);
  const lastDayOfDueMonth = new Date(dueBase.getFullYear(), dueBase.getMonth() + 1, 0).getDate();
  const dueDate = new Date(dueBase.getFullYear(), dueBase.getMonth(), Math.min(card.dueDay, lastDayOfDueMonth));
  return {
    competenceYear: closingDate.getFullYear(),
    competenceMonth: closingDate.getMonth() + 1,
    closingDate,
    dueDate
  };
}

export async function ensureCardSupplier(tx: Prisma.TransactionClient, card: CardRow) {
  const externalCode = `CARD-${card.id}`;
  const existing = await tx.supplier.findFirst({
    where: { externalCode },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  const name = `Fatura ${card.bankName} ${card.name} final ${card.last4Digits}`.trim();
  return tx.supplier.create({
    data: {
      id: crypto.randomUUID(),
      externalCode,
      document: null,
      name,
      normalizedName: normalizeText(name),
      isActive: true,
      notes: "Fornecedor sintetico para fatura de cartao de credito."
    }
  });
}

export async function findOrCreateStatementForPurchase(tx: Prisma.TransactionClient, input: {
  card: CardRow;
  purchaseDate: Date;
  purchaseId: string;
}) {
  const shift = await resolveOpenStatementShift(tx, input.card, input.purchaseDate, 1);
  const period = getCardStatementPeriodForInstallment(input.card, input.purchaseDate, shift);
  const existing = await tx.creditCardStatement.findFirst({
    where: {
      creditCardId: input.card.id,
      competenceYear: period.competenceYear,
      competenceMonth: period.competenceMonth
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return tx.creditCardStatement.create({
    data: {
      id: crypto.randomUUID(),
      creditCardId: input.card.id,
      competenceYear: period.competenceYear,
      competenceMonth: period.competenceMonth,
      closingDate: period.closingDate,
      dueDate: period.dueDate,
      status: "OPEN",
      name: `Fatura ${input.card.name} ${String(period.competenceMonth).padStart(2, "0")}/${period.competenceYear}`
    }
  });
}

type LinhaAnterior = { statementId: string; cardFinalId: string | null; installment: number | null };

// Editar a compra apaga e recria a linha dela na fatura. O cartao vinculado
// (fisico/virtual) ja classificado precisa sobreviver: a leitura da linha anterior
// acontece ANTES de qualquer apagamento e o final so e reaproveitado se ainda for
// ativo e do mesmo cartao.
async function lerLinhasAnteriores(tx: Prisma.TransactionClient, purchaseId: string): Promise<LinhaAnterior[]> {
  const linhas = await tx.creditCardStatementItem.findMany({
    where: { purchaseId },
    select: { statementId: true, cardFinalId: true, installment: true },
    orderBy: [{ installment: "asc" }, { createdAt: "asc" }]
  });
  return linhas as LinhaAnterior[];
}

async function finalValido(tx: Prisma.TransactionClient, candidato: string | null | undefined, cardId: string | null) {
  if (!candidato || !cardId) return null;
  const valido = await tx.creditCardFinal.findFirst({
    where: { id: candidato, creditCardId: cardId, isActive: true },
    select: { id: true }
  });
  return valido ? candidato : null;
}

function primeiroFinal(anteriores: LinhaAnterior[]): string | null {
  return anteriores.find((linha) => linha.cardFinalId)?.cardFinalId ?? null;
}

/**
 * Uma fatura CONFERIDA com total do extrato informado so vale enquanto os subtotais por
 * cartao batem com esse total. Qualquer caminho que mude as linhas (editar compra, realocar,
 * reclassificar, mexer no total do extrato) chama isto: se deixou de bater, volta para Aberta.
 */
export async function reabrirSeDivergir(tx: Prisma.TransactionClient, statementId: string): Promise<boolean> {
  const fatura = await tx.creditCardStatement.findUnique({
    where: { id: statementId },
    include: {
      creditCard: { include: { finais: true } },
      finalTotals: true,
      items: { select: { cardFinalId: true, value: true } }
    }
  });
  if (!fatura || fatura.status !== "CHECKED" || fatura.finalTotals.length === 0) return false;
  const divergentes = divergenciasDeExtrato(
    subtotaisPorFinal(fatura.items.map((item) => ({ cardFinalId: item.cardFinalId, value: item.value })), fatura.creditCard.finais),
    fatura.finalTotals
  );
  if (divergentes.length === 0) return false;
  await tx.creditCardStatement.update({ where: { id: statementId }, data: { status: "OPEN" } });
  return true;
}

export async function recalcularEReabrir(tx: Prisma.TransactionClient, statementIds: Iterable<string>) {
  for (const statementId of new Set(statementIds)) {
    const [sumRow] = await tx.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
      SELECT COALESCE(SUM("value"), 0) AS "total" FROM "CreditCardStatementItem" WHERE "statementId" = ${statementId}
    `;
    await tx.creditCardStatement.update({
      where: { id: statementId },
      data: { totalAmount: new Prisma.Decimal(Number(sumRow?.total ?? 0)) }
    });
    await reabrirSeDivergir(tx, statementId);
  }
}

export async function syncCardStatementItemForPurchase(tx: Prisma.TransactionClient, input: {
  purchaseId: string;
  cardId: string | null;
  purchaseDate: Date;
  description: string;
  supplierName: string;
  value: number;
  categoryName?: string | null;
  smallExpenseTypeId?: string | null;
  responsibleName?: string | null;
  notes?: string | null;
  purchaseItemId?: string | null;
  /** Cartao (fisico/virtual) escolhido no lancamento; ausente = preserva o da linha anterior. */
  cardFinalId?: string | null;
  itemDate?: Date | null;
  totalInstallments?: number | null;
  installment?: number | null;
}) {
  const anteriores = await lerLinhasAnteriores(tx, input.purchaseId);
  const cardFinalId = await finalValido(tx, input.cardFinalId || primeiroFinal(anteriores), input.cardId);
  const removed = await tx.creditCardStatementItem.deleteMany({
    where: { purchaseId: input.purchaseId }
  });
  const afetadas = new Set(anteriores.map((linha) => linha.statementId).filter(Boolean));

  if (!input.cardId || input.value <= 0) {
    await recalcularEReabrir(tx, afetadas);
    return { removed: removed.count, itemId: null, statementId: null };
  }

  const [card] = await tx.$queryRaw<Array<CardRow>>`
    SELECT "id", "name", "bankName", "last4Digits", "closingDay", "dueDay"
    FROM "CreditCard"
    WHERE "id" = ${input.cardId}
    LIMIT 1
  `;
  if (!card) {
    await recalcularEReabrir(tx, afetadas);
    return { removed: removed.count, itemId: null, statementId: null };
  }

  const statement = await findOrCreateStatementForPurchase(tx, {
    card,
    purchaseDate: input.purchaseDate,
    purchaseId: input.purchaseId
  });

  const created = await tx.creditCardStatementItem.create({
    data: {
      id: crypto.randomUUID(),
      statementId: statement.id,
      purchaseId: input.purchaseId,
      purchaseItemId: input.purchaseItemId,
      itemDate: input.itemDate ?? input.purchaseDate,
      description: input.description,
      supplierName: input.supplierName,
      value: new Prisma.Decimal(input.value),
      installment: input.installment ?? null,
      totalInstallments: input.totalInstallments ?? null,
      cardFinalId,
      categoryName: input.categoryName ?? null,
      smallExpenseTypeId: input.smallExpenseTypeId ?? null,
      responsibleName: input.responsibleName ?? null,
      notes: input.notes ?? null,
      checked: false,
      hasDivergence: false
    }
  });

  afetadas.add(statement.id);
  await recalcularEReabrir(tx, afetadas);

  return { removed: removed.count, itemId: created.id, statementId: statement.id };
}

/** Competência (ano/mês) daqui a `meses` meses; negativo volta no tempo. */
export function competenciaDepois(ano: number, mes: number, meses: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) + meses;
  return { ano: Math.floor(total / 12), mes: (total % 12 + 12) % 12 + 1 };
}

/** Datas de fechamento e vencimento de uma competência, pelo cadastro do cartão (mesma regra da criação automática). */
export function periodoDaCompetencia(card: { closingDay: number; dueDay: number }, ano: number, mes: number) {
  const ultimoDoMes = new Date(ano, mes, 0).getDate();
  const closingDate = new Date(ano, mes - 1, Math.min(card.closingDay, ultimoDoMes));
  const proximo = new Date(ano, mes, 1);
  const ultimoDoVencimento = new Date(proximo.getFullYear(), proximo.getMonth() + 1, 0).getDate();
  const dueDate = new Date(proximo.getFullYear(), proximo.getMonth(), Math.min(card.dueDay, ultimoDoVencimento));
  return { closingDate, dueDate };
}

export function getCardStatementPeriodForInstallment(card: CardRow, purchaseDate: Date, installmentIndex: number) {
  const base = getCardStatementPeriod(card, purchaseDate);
  const totalMonths = (base.competenceYear * 12 + (base.competenceMonth - 1)) + installmentIndex;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const closingDate = new Date(targetYear, targetMonth - 1, Math.min(card.closingDay, lastDay));
  const dueBase = new Date(targetYear, targetMonth - 1, 1);
  const lastDayDue = new Date(dueBase.getFullYear(), dueBase.getMonth() + 1, 0).getDate();
  const dueDate = new Date(dueBase.getFullYear(), dueBase.getMonth(), Math.min(card.dueDay, lastDayDue));
  return { competenceYear: targetYear, competenceMonth: targetMonth, closingDate, dueDate };
}

const BLOCKED_STATEMENT_STATUSES = ["CLOSED", "PAID", "CANCELLED"];
const MAX_STATEMENT_SCALE = 12;

// Calcula o deslocamento minimo (em meses) para que TODAS as competencias
// [purchaseDate+shift .. purchaseDate+shift+installmentCount-1] apontem para
// faturas que aceitam lancamento (nao CLOSED/PAID/CANCELLED). Retorna 0 quando
// a competencia natural ja aceita. Retorna erro apos MAX_STATEMENT_SCALE
// competencias consecutivas bloqueadas.
async function resolveOpenStatementShift(
  tx: Prisma.TransactionClient,
  card: CardRow,
  purchaseDate: Date,
  installmentCount: number
): Promise<number> {
  for (let shift = 0; shift <= MAX_STATEMENT_SCALE; shift++) {
    let allClear = true;
    for (let i = 0; i < installmentCount; i++) {
      const period = getCardStatementPeriodForInstallment(card, purchaseDate, i + shift);
      const existing = await tx.creditCardStatement.findFirst({
        where: {
          creditCardId: card.id,
          competenceYear: period.competenceYear,
          competenceMonth: period.competenceMonth
        },
        orderBy: { createdAt: "asc" }
      });
      if (existing && BLOCKED_STATEMENT_STATUSES.includes(existing.status)) {
        allClear = false;
        break;
      }
    }
    if (allClear) return shift;
  }
  throw new Error(
    `Nao foi possivel encontrar fatura aberta para este cartao apos ${MAX_STATEMENT_SCALE} competencias consecutivas. ` +
      "Todas as faturas encontradas estao CLOSED/PAID/CANCELLED. " +
      "Verifique o cadastro do cartao e o status das faturas."
  );
}

export async function syncCardStatementItemsForPurchase(tx: Prisma.TransactionClient, input: {
  purchaseId: string;
  cardId: string;
  purchaseDate: Date;
  description: string;
  supplierName: string;
  totalAmount: number;
  numberOfInstallments: number;
  categoryName?: string | null;
  notes?: string | null;
  cardFinalId?: string | null;
  /** Cartão de cada parcela (número da parcela → final), p.ex. vindo do que foi guardado ao cancelar. */
  finaisPorParcela?: Record<string, string | null | undefined>;
}) {
  const anteriores = await lerLinhasAnteriores(tx, input.purchaseId);
  const finalPadrao = await finalValido(tx, input.cardFinalId || primeiroFinal(anteriores), input.cardId);
  // Cada parcela volta para o cartao em que estava (o usuario pode ter separado as parcelas).
  const finalPorParcela = new Map<number, string>();
  if (!input.cardFinalId) {
    const candidatos: Array<[number, string]> = [
      ...anteriores.filter((linha) => linha.installment != null && linha.cardFinalId).map((linha): [number, string] => [linha.installment as number, linha.cardFinalId as string]),
      ...Object.entries(input.finaisPorParcela ?? {}).filter(([, id]) => id).map(([parcela, id]): [number, string] => [Number(parcela), id as string])
    ];
    for (const [parcela, final] of candidatos) {
      if (!finalPorParcela.has(parcela) && (await finalValido(tx, final, input.cardId))) finalPorParcela.set(parcela, final);
    }
  }
  await tx.creditCardStatementItem.deleteMany({ where: { purchaseId: input.purchaseId } });
  const anterioresIds = anteriores.map((linha) => linha.statementId).filter(Boolean);

  if (input.totalAmount <= 0) {
    await recalcularEReabrir(tx, anterioresIds);
    return [];
  }

  const card = await tx.creditCard.findUnique({ where: { id: input.cardId } });
  if (!card) {
    await recalcularEReabrir(tx, anterioresIds);
    return [];
  }

  const n = Math.max(1, Math.floor(input.numberOfInstallments));
  const totalCents = Math.round(input.totalAmount * 100);
  const baseCents = Math.floor(totalCents / n);
  const extraCents = totalCents - baseCents * n;

  const affectedStatementIds = new Set<string>();
  const results: { statementId: string; installment: number; value: number }[] = [];

  const statementShift = await resolveOpenStatementShift(tx, card, input.purchaseDate, n);

  for (let i = 0; i < n; i++) {
    const period = getCardStatementPeriodForInstallment(card, input.purchaseDate, i + statementShift);

    const existing = await tx.creditCardStatement.findFirst({
      where: { creditCardId: card.id, competenceYear: period.competenceYear, competenceMonth: period.competenceMonth },
      orderBy: { createdAt: "asc" }
    });
    const statement = existing ?? await tx.creditCardStatement.create({
      data: {
        id: crypto.randomUUID(),
        creditCardId: card.id,
        competenceYear: period.competenceYear,
        competenceMonth: period.competenceMonth,
        closingDate: period.closingDate,
        dueDate: period.dueDate,
        status: "OPEN",
        name: `Fatura ${card.name} ${String(period.competenceMonth).padStart(2, "0")}/${period.competenceYear}`
      }
    });

    const cents = baseCents + (i === 0 ? extraCents : 0);
    const value = cents / 100;

    await tx.creditCardStatementItem.create({
      data: {
        id: crypto.randomUUID(),
        statementId: statement.id,
        purchaseId: input.purchaseId,
        itemDate: input.purchaseDate,
        description: input.description,
        supplierName: input.supplierName,
        value: new Prisma.Decimal(value),
        installment: n > 1 ? i + 1 : null,
        totalInstallments: n > 1 ? n : null,
        // Com o cartao de cada parcela conhecido, parcela sem cartao continua sem cartao;
        // so quando nao ha esse detalhe todas herdam o cartao padrao.
        cardFinalId: finalPorParcela.size > 0 ? (finalPorParcela.get(i + 1) ?? null) : finalPadrao,
        categoryName: input.categoryName ?? null,
        notes: input.notes ?? null,
        checked: false,
        hasDivergence: false
      }
    });

    affectedStatementIds.add(statement.id);
    results.push({ statementId: statement.id, installment: i + 1, value });
  }

  await recalcularEReabrir(tx, [...affectedStatementIds, ...anterioresIds]);

  return results;
}

type LinhaDeFatura = {
  description: string;
  value: Prisma.Decimal | number | string;
  purchaseId: string | null;
  purchase: { status: string; _count: { items: number } } | null;
};

/**
 * Linhas cuja despesa nao chegaria ao DRE. O titulo da fatura fica fora dele
 * (ver excludeAggregatorsSql) porque a despesa ja esta nos itens das compras de
 * cada linha; uma linha avulsa — anuidade, juros, linha lancada a mao — ou com
 * compra sem item nao teria onde aparecer. Fechar a fatura exige lista vazia.
 */
export function linhasForaDoDre(linhas: LinhaDeFatura[]) {
  return linhas
    .filter((linha) => !compraLevaDespesaAoDre(
      linha.purchaseId && linha.purchase
        ? { status: linha.purchase.status, itens: linha.purchase._count.items }
        : null
    ))
    .map((linha) => ({ description: linha.description, value: Number(linha.value ?? 0) }));
}

export async function createCardStatementPurchase(tx: Prisma.TransactionClient, input: {
  statementId: string;
  card: CardRow;
  closingDate: Date;
  dueDate: Date;
  totalAmount: number;
}) {
  const statement = await tx.creditCardStatement.findUnique({
    where: { id: input.statementId },
    include: { creditCard: true }
  });
  if (!statement) throw new Error("Fatura nao encontrada.");

  const supplier = await ensureCardSupplier(tx, input.card);
  const purchaseNumber = await getNextPurchaseNumber(tx, input.closingDate.getFullYear());
  const purchase = await tx.purchase.create({
    data: {
      id: crypto.randomUUID(),
      purchaseNumber,
      workflowStatus: "CARD_STATEMENT",
      purchaseDate: input.closingDate,
      competenceMonth: input.closingDate.getMonth() + 1,
      competenceYear: input.closingDate.getFullYear(),
      supplierId: supplier.id,
      invoiceNumber: `FATURA-${input.card.last4Digits}-${String(input.closingDate.getMonth() + 1).padStart(2, "0")}/${input.closingDate.getFullYear()}`,
      paymentMethod: "Cartao de credito/fatura",
      creditCardId: input.card.id,
      totalAmount: new Prisma.Decimal(input.totalAmount),
      status: "ACTIVE",
      rawRow: {
        type: "CARD_STATEMENT",
        statementId: input.statementId,
        cardId: input.card.id
      } as Prisma.InputJsonValue
    }
  });

  await tx.paymentInstallment.create({
    data: {
      id: crypto.randomUUID(),
      purchaseId: purchase.id,
      dueDate: input.dueDate,
      amount: new Prisma.Decimal(input.totalAmount),
      installment: 1,
      paymentMethodName: "Cartao de credito/fatura",
      status: "OPEN",
      sourceType: "CARD_STATEMENT",
      rawValue: `Fatura ${statement.name ?? input.statementId}`
    }
  });

  await tx.creditCardStatement.update({
    where: { id: input.statementId },
    data: {
      generatedPurchaseId: purchase.id,
      totalAmount: new Prisma.Decimal(input.totalAmount),
      status: "CLOSED"
    }
  });

  return purchase;
}

type LinhaCompleta = {
  statementId: string;
  cardFinalId: string | null;
  installment: number | null;
  totalInstallments: number | null;
  description: string;
  categoryName: string | null;
  notes: string | null;
  smallExpenseTypeId: string | null;
};

async function lerLinhasCompletas(tx: Prisma.TransactionClient, purchaseId: string): Promise<LinhaCompleta[]> {
  const linhas = await tx.creditCardStatementItem.findMany({
    where: { purchaseId },
    orderBy: [{ installment: "asc" }, { createdAt: "asc" }]
  });
  return linhas as unknown as LinhaCompleta[];
}

export type SnapshotDasLinhas = {
  parcelas: number;
  tipo: "NORMAL" | "PEQUENO_GASTO";
  descricao: string;
  categoryName: string | null;
  notes: string | null;
  finaisPorParcela: Record<string, string>;
};

function snapshotDe(linhas: LinhaCompleta[]): SnapshotDasLinhas | null {
  if (linhas.length === 0) return null;
  const primeira = linhas[0];
  const finaisPorParcela: Record<string, string> = {};
  for (const linha of linhas) {
    if (linha.cardFinalId) finaisPorParcela[String(linha.installment ?? 1)] = linha.cardFinalId;
  }
  return {
    parcelas: Math.max(linhas.length, ...linhas.map((linha) => linha.totalInstallments ?? 1)),
    tipo: linhas.some((linha) => linha.smallExpenseTypeId) ? "PEQUENO_GASTO" : "NORMAL",
    descricao: primeira.description,
    categoryName: primeira.categoryName ?? null,
    notes: primeira.notes ?? null,
    finaisPorParcela
  };
}

/**
 * Cancelar a compra apaga as linhas dela nas faturas. Antes disso, guarda na propria compra
 * quantas parcelas eram, a descricao e o cartao (fisico/virtual) de cada parcela: e o que
 * permite restaurar a compra como estava, em vez de uma linha so com o total.
 */
export async function guardarSnapshotDasLinhas(tx: Prisma.TransactionClient, purchaseId: string): Promise<void> {
  const snapshot = snapshotDe(await lerLinhasCompletas(tx, purchaseId));
  if (!snapshot) return;
  await tx.$executeRaw`
    UPDATE "Purchase"
    SET "rawRow" = COALESCE("rawRow", '{}'::jsonb) || jsonb_build_object('cartaoSnapshot', ${JSON.stringify(snapshot)}::jsonb)
    WHERE "id" = ${purchaseId}
  `;
}

export type CompraParaReconstruir = {
  id: string;
  purchaseDate: Date;
  creditCardId: string | null;
  totalAmount: Prisma.Decimal | number | string;
  supplierName: string;
  invoiceNumber: string | null;
  purchaseNumber: string | null;
  smallExpenseTypeId: string | null;
  smallExpenseResponsibleName: string | null;
  smallExpenseNotes: string | null;
  rawRow?: unknown;
};

/**
 * Recria as linhas da compra na fatura do jeito que eram: as parcelas que ela ja tem na fatura
 * (revincular) ou as que foram guardadas ao cancelar (restaurar). Sem nenhum dos dois — compra
 * cancelada antes de existir o snapshot — volta a linha unica de sempre.
 */
export async function reconstruirLinhasDaCompra(tx: Prisma.TransactionClient, compra: CompraParaReconstruir): Promise<void> {
  const guardado = (compra.rawRow as { cartaoSnapshot?: SnapshotDasLinhas } | null | undefined)?.cartaoSnapshot ?? null;
  const fonte = snapshotDe(await lerLinhasCompletas(tx, compra.id)) ?? guardado;

  if (fonte && fonte.tipo === "NORMAL" && compra.creditCardId && !compra.smallExpenseTypeId) {
    await syncCardStatementItemsForPurchase(tx, {
      purchaseId: compra.id,
      cardId: compra.creditCardId,
      purchaseDate: compra.purchaseDate,
      description: fonte.descricao,
      supplierName: compra.supplierName,
      totalAmount: Number(compra.totalAmount),
      numberOfInstallments: fonte.parcelas,
      categoryName: fonte.categoryName,
      notes: fonte.notes,
      finaisPorParcela: fonte.finaisPorParcela
    });
    return;
  }

  await syncCardStatementItemForPurchase(tx, {
    purchaseId: compra.id,
    cardId: compra.creditCardId,
    purchaseDate: compra.purchaseDate,
    description: compra.invoiceNumber || compra.purchaseNumber || "Pequeno gasto no cartao",
    supplierName: compra.supplierName,
    value: Number(compra.totalAmount),
    smallExpenseTypeId: compra.smallExpenseTypeId,
    responsibleName: compra.smallExpenseResponsibleName,
    notes: compra.smallExpenseNotes,
    cardFinalId: fonte?.finaisPorParcela["1"] ?? null
  });
}

/**
 * Apaga as linhas da compra nas faturas, recalcula os totais e devolve o cartao
 * (fisico/virtual) que a primeira linha tinha: quem recria a linha em seguida (editar a
 * compra) precisa dele, porque depois daqui ele nao existe mais.
 */
export async function removeCardStatementItemsForPurchase(
  purchaseId: string,
  client: Prisma.TransactionClient = prisma as Prisma.TransactionClient
): Promise<{ cardFinalId: string | null }> {
  const anteriores = await lerLinhasAnteriores(client, purchaseId);
  await client.creditCardStatementItem.deleteMany({ where: { purchaseId } });
  await recalcularEReabrir(client, anteriores.map((linha) => linha.statementId).filter(Boolean));
  return { cardFinalId: primeiroFinal(anteriores) };
}
