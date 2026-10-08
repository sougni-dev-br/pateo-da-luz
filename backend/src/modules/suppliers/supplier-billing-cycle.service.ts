import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { escolherCicloDaCompra, type CicloAberto } from "./supplier-cycle-choice.js";

/**
 * Localiza o ciclo OPEN ou CHECKED cujo período cobre a data da compra; sem ele, cria um.
 * A regra está em `escolherCicloDaCompra`. Deve ser chamado dentro de uma transação.
 */
export async function findOrCreateOpenCycle(
  tx: Prisma.TransactionClient,
  supplierId: string,
  userId: string | null,
  purchaseDate?: Date | null
): Promise<string> {
  const abertos = await tx.$queryRaw<CicloAberto[]>`
    SELECT "id", "periodStart", "periodEnd" FROM "SupplierBillingCycle"
    WHERE "supplierId" = ${supplierId}
      AND "status" IN ('OPEN', 'CHECKED')
  `;
  const escolha = escolherCicloDaCompra(abertos, purchaseDate ?? hojeUtc());
  if ("cicloId" in escolha) return escolha.cicloId;

  const cycleId = crypto.randomUUID();
  await tx.$executeRaw`
    INSERT INTO "SupplierBillingCycle" (
      "id", "supplierId", "periodStart", "periodEnd", "status", "totalAmount",
      "createdByUserId", "createdAt", "updatedAt"
    ) VALUES (
      ${cycleId}, ${supplierId}, ${escolha.criar.periodStart}, ${escolha.criar.periodEnd}, 'OPEN', 0,
      ${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  return cycleId;
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

/**
 * Adiciona uma compra ao ciclo e atualiza o totalAmount do ciclo.
 * Deve ser chamado dentro de uma transação.
 */
export async function addPurchaseToCycle(
  tx: Prisma.TransactionClient,
  opts: {
    cycleId: string;
    purchaseId: string;
    amount: number;
    purchaseDate: Date;
    invoiceNumber: string | null;
  }
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "SupplierBillingCycleItem" (
      "id", "cycleId", "purchaseId", "amount", "purchaseDate", "invoiceNumber",
      "checked", "hasDivergence", "createdAt", "updatedAt"
    ) VALUES (
      ${crypto.randomUUID()}, ${opts.cycleId}, ${opts.purchaseId},
      ${new Prisma.Decimal(opts.amount)}, ${opts.purchaseDate}, ${opts.invoiceNumber},
      false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "totalAmount" = "totalAmount" + ${new Prisma.Decimal(opts.amount)},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${opts.cycleId}
  `;
}

/**
 * Atualiza o item de ciclo de uma compra existente e recalcula o totalAmount.
 * Retorna { blocked: true } se o ciclo estiver CLOSED ou PAID.
 * Deve ser chamado dentro de uma transação.
 */
export async function updatePurchaseInCycle(
  tx: Prisma.TransactionClient,
  opts: {
    purchaseId: string;
    amount: number;
    purchaseDate: Date;
    invoiceNumber: string | null;
  }
): Promise<{ blocked: boolean; cycleStatus?: string }> {
  const [item] = await tx.$queryRaw<Array<{ id: string; cycleId: string; amount: string }>>`
    SELECT "id", "cycleId", "amount"::text
    FROM "SupplierBillingCycleItem"
    WHERE "purchaseId" = ${opts.purchaseId}
    LIMIT 1
  `;
  if (!item) return { blocked: false };

  const [cycle] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "SupplierBillingCycle" WHERE "id" = ${item.cycleId} LIMIT 1
  `;
  const cycleStatus = cycle?.status ?? "OPEN";

  if (cycleStatus === "CLOSED" || cycleStatus === "PAID") {
    return { blocked: true, cycleStatus };
  }

  const delta = opts.amount - Number(item.amount);
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycleItem"
    SET "amount"       = ${new Prisma.Decimal(opts.amount)},
        "purchaseDate" = ${opts.purchaseDate},
        "invoiceNumber" = ${opts.invoiceNumber},
        "updatedAt"    = CURRENT_TIMESTAMP
    WHERE "id" = ${item.id}
  `;
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "totalAmount" = GREATEST(0, "totalAmount" + ${new Prisma.Decimal(delta)}),
        "updatedAt"   = CURRENT_TIMESTAMP
    WHERE "id" = ${item.cycleId}
  `;
  return { blocked: false };
}

/**
 * Remove a compra do ciclo e recalcula o totalAmount.
 * Retorna { blocked: true } se o ciclo estiver CLOSED ou PAID.
 * Pode ser chamado fora de transação (usa `prisma` por padrão).
 */
export async function removePurchaseFromCycleIfAllowed(
  purchaseId: string,
  client: Prisma.TransactionClient = prisma as Prisma.TransactionClient
): Promise<{ blocked: boolean; cycleStatus?: string }> {
  const [item] = await client.$queryRaw<Array<{ id: string; cycleId: string; amount: string }>>`
    SELECT "id", "cycleId", "amount"::text
    FROM "SupplierBillingCycleItem"
    WHERE "purchaseId" = ${purchaseId}
    LIMIT 1
  `;
  if (!item) return { blocked: false };

  const [cycle] = await client.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "SupplierBillingCycle" WHERE "id" = ${item.cycleId} LIMIT 1
  `;
  const cycleStatus = cycle?.status ?? "OPEN";

  if (cycleStatus === "CLOSED" || cycleStatus === "PAID") {
    return { blocked: true, cycleStatus };
  }

  await client.$executeRaw`
    DELETE FROM "SupplierBillingCycleItem" WHERE "id" = ${item.id}
  `;
  await client.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "totalAmount" = GREATEST(0, "totalAmount" - ${new Prisma.Decimal(Number(item.amount))}),
        "updatedAt"   = CURRENT_TIMESTAMP
    WHERE "id" = ${item.cycleId}
  `;
  return { blocked: false };
}

/**
 * Passa a compra de um ciclo para outro, recalculando total e status dos dois.
 * O item chega ao destino sem conferência; se a origem ficar toda conferida, vira CHECKED.
 * Deve ser chamado dentro de uma transação.
 */
export async function moverCompraEntreCiclos(
  tx: Prisma.TransactionClient,
  opts: { purchaseId: string; origemId: string; destinoId: string; userId: string }
): Promise<{ amount: number; invoiceNumber: string | null } | null> {
  const [item] = await tx.$queryRaw<Array<{ id: string; amount: string; purchaseDate: Date; invoiceNumber: string | null }>>`
    SELECT "id", "amount"::text AS "amount", "purchaseDate", "invoiceNumber"
    FROM "SupplierBillingCycleItem"
    WHERE "purchaseId" = ${opts.purchaseId} AND "cycleId" = ${opts.origemId}
    LIMIT 1
  `;
  if (!item) return null;
  const amount = Number(item.amount);

  await tx.$executeRaw`DELETE FROM "SupplierBillingCycleItem" WHERE "id" = ${item.id}`;
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "totalAmount" = GREATEST(0, "totalAmount" - ${new Prisma.Decimal(amount)}),
        "updatedAt"   = CURRENT_TIMESTAMP
    WHERE "id" = ${opts.origemId}
  `;
  const origemConferida = await cicloTodoConferido(tx, opts.origemId);
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "status"          = ${origemConferida ? "CHECKED" : "OPEN"},
        "checkedByUserId" = ${origemConferida ? opts.userId : null},
        "checkedAt"       = ${origemConferida ? new Date() : null},
        "updatedAt"       = CURRENT_TIMESTAMP
    WHERE "id" = ${opts.origemId}
  `;

  await addPurchaseToCycle(tx, {
    cycleId: opts.destinoId,
    purchaseId: opts.purchaseId,
    amount,
    purchaseDate: new Date(item.purchaseDate),
    invoiceNumber: item.invoiceNumber
  });
  const destinoConferido = await cicloTodoConferido(tx, opts.destinoId);
  await tx.$executeRaw`
    UPDATE "SupplierBillingCycle" SET "status" = ${destinoConferido ? "CHECKED" : "OPEN"}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${opts.destinoId}
  `;
  return { amount, invoiceNumber: item.invoiceNumber };
}

async function cicloTodoConferido(tx: Prisma.TransactionClient, cycleId: string): Promise<boolean> {
  const [contagem] = await tx.$queryRaw<Array<{ total: number; checkedCount: number }>>`
    SELECT COUNT(*)::int AS "total",
           COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
    FROM "SupplierBillingCycleItem" WHERE "cycleId" = ${cycleId}
  `;
  return contagem.total > 0 && contagem.checkedCount === contagem.total;
}
