import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

/**
 * Localiza o ciclo OPEN ou CHECKED cujo período cobre a data da compra.
 * Se não encontrar por data, usa o ciclo mais recente como fallback.
 * Se não houver nenhum ciclo ativo, cria um novo ciclo OPEN.
 * Deve ser chamado dentro de uma transação.
 */
export async function findOrCreateOpenCycle(
  tx: Prisma.TransactionClient,
  supplierId: string,
  userId: string | null,
  purchaseDate?: Date | null
): Promise<string> {
  // 1. Prefer the cycle whose period contains the purchase date
  if (purchaseDate) {
    const [byDate] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "SupplierBillingCycle"
      WHERE "supplierId" = ${supplierId}
        AND "status" IN ('OPEN', 'CHECKED')
        AND "periodStart" <= ${purchaseDate}
        AND ("periodEnd" IS NULL OR "periodEnd" >= ${purchaseDate})
      ORDER BY "periodStart" DESC
      LIMIT 1
    `;
    if (byDate) return byDate.id;
  }

  // 2. Fallback: any OPEN/CHECKED cycle for this supplier (most recent period)
  const [fallback] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "SupplierBillingCycle"
    WHERE "supplierId" = ${supplierId}
      AND "status" IN ('OPEN', 'CHECKED')
    ORDER BY "periodStart" DESC
    LIMIT 1
  `;
  if (fallback) return fallback.id;

  // 3. Create a new catch-all cycle (no end date)
  const cycleId = crypto.randomUUID();
  await tx.$executeRaw`
    INSERT INTO "SupplierBillingCycle" (
      "id", "supplierId", "periodStart", "status", "totalAmount",
      "createdByUserId", "createdAt", "updatedAt"
    ) VALUES (
      ${cycleId}, ${supplierId}, CURRENT_TIMESTAMP, 'OPEN', 0,
      ${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  return cycleId;
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
