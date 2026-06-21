import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";

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
  const period = getCardStatementPeriod(input.card, input.purchaseDate);
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
  itemDate?: Date | null;
  totalInstallments?: number | null;
  installment?: number | null;
}) {
  const removed = await tx.creditCardStatementItem.deleteMany({
    where: { purchaseId: input.purchaseId }
  });

  if (!input.cardId || input.value <= 0) {
    return { removed: removed.count, itemId: null, statementId: null };
  }

  const [card] = await tx.$queryRaw<Array<CardRow>>`
    SELECT "id", "name", "bankName", "last4Digits", "closingDay", "dueDay"
    FROM "CreditCard"
    WHERE "id" = ${input.cardId}
    LIMIT 1
  `;
  if (!card) {
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
      categoryName: input.categoryName ?? null,
      smallExpenseTypeId: input.smallExpenseTypeId ?? null,
      responsibleName: input.responsibleName ?? null,
      notes: input.notes ?? null,
      checked: false,
      hasDivergence: false
    }
  });

  const [sumRow] = await tx.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
    SELECT COALESCE(SUM("value"), 0) AS "total"
    FROM "CreditCardStatementItem"
    WHERE "statementId" = ${statement.id}
  `;
  await tx.creditCardStatement.update({
    where: { id: statement.id },
    data: {
      totalAmount: new Prisma.Decimal(Number(sumRow?.total ?? 0))
    }
  });

  return { removed: removed.count, itemId: created.id, statementId: statement.id };
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

export async function removeCardStatementItemsForPurchase(purchaseId: string, client: Prisma.TransactionClient = prisma as Prisma.TransactionClient) {
  const affectedStatements = await client.creditCardStatementItem.findMany({
    where: { purchaseId },
    select: { statementId: true }
  });
  await client.creditCardStatementItem.deleteMany({ where: { purchaseId } });
  const statementIds = [...new Set(affectedStatements.map((item) => item.statementId))];
  for (const statementId of statementIds) {
    const [sumRow] = await client.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
      SELECT COALESCE(SUM("value"), 0) AS "total"
      FROM "CreditCardStatementItem"
      WHERE "statementId" = ${statementId}
    `;
    await client.creditCardStatement.update({
      where: { id: statementId },
      data: {
        totalAmount: new Prisma.Decimal(Number(sumRow?.total ?? 0))
      }
    });
  }
}
