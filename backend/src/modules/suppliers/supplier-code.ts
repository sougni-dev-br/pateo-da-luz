import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

/** Proximo codigo de fornecedor (FOR-000123). Aceita a transacao de quem chama. */
export async function nextSupplierCode(client: Prisma.TransactionClient = prisma) {
  await client.$executeRaw`
    INSERT INTO "SupplierSequence" ("id", "currentValue", "updatedAt")
    VALUES (1, 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO NOTHING
  `;
  const [row] = await client.$queryRaw<Array<{ currentValue: number }>>`
    UPDATE "SupplierSequence"
    SET "currentValue" = "currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 1
    RETURNING "currentValue"
  `;
  return `FOR-${String(row.currentValue).padStart(6, "0")}`;
}
