import type { Prisma } from "@prisma/client";

/** Próximo código do pedido (PC-AAAA-0001), dentro da transação que grava o pedido. */
export async function nextPurchaseOrderCode(tx: Prisma.TransactionClient, year: number) {
  await tx.$executeRaw`
    INSERT INTO "PurchaseOrderSequence" ("year", "currentValue", "updatedAt")
    VALUES (${year}, 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO NOTHING
  `;
  const [row] = await tx.$queryRaw<Array<{ currentValue: number }>>`
    UPDATE "PurchaseOrderSequence"
    SET "currentValue" = "currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "year" = ${year}
    RETURNING "currentValue"
  `;
  return `PC-${year}-${String(row.currentValue).padStart(4, "0")}`;
}
