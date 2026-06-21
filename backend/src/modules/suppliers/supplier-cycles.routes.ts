import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { requireRole } from "../security/security-utils.js";

export const supplierCyclesRouter = Router();

supplierCyclesRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const supplierId = request.query.supplierId ? String(request.query.supplierId) : null;
  const status = request.query.status ? String(request.query.status) : null;

  const cycles = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      c."id",
      c."supplierId",
      s."name" AS "supplierName",
      c."periodStart",
      c."periodEnd",
      c."status",
      c."totalAmount"::text AS "totalAmount",
      COUNT(i."id")::int AS "itemCount",
      COUNT(i."id") FILTER (WHERE i."checked" = true)::int AS "checkedCount",
      COALESCE(BOOL_OR(i."hasDivergence"), false) AS "hasDivergence",
      c."createdAt",
      c."updatedAt"
    FROM "SupplierBillingCycle" c
    JOIN "Supplier" s ON s."id" = c."supplierId"
    LEFT JOIN "SupplierBillingCycleItem" i ON i."cycleId" = c."id"
    WHERE
      ${supplierId ? Prisma.sql`c."supplierId" = ${supplierId}` : Prisma.sql`true`}
      AND ${status ? Prisma.sql`c."status" = ${status}` : Prisma.sql`true`}
    GROUP BY c."id", s."name"
    ORDER BY c."createdAt" DESC
  `;

  response.json(cycles);
});

supplierCyclesRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const [cycle] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      c."id",
      c."supplierId",
      s."name" AS "supplierName",
      c."periodStart",
      c."periodEnd",
      c."status",
      c."totalAmount"::text AS "totalAmount",
      c."notes",
      c."createdByUserId",
      c."checkedByUserId",
      c."closedByUserId",
      c."checkedAt",
      c."closedAt",
      c."generatedPurchaseId",
      c."createdAt",
      c."updatedAt"
    FROM "SupplierBillingCycle" c
    JOIN "Supplier" s ON s."id" = c."supplierId"
    WHERE c."id" = ${request.params.id}
  `;

  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }

  const items = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      i."id",
      i."purchaseId",
      i."amount"::text AS "amount",
      i."purchaseDate",
      i."invoiceNumber",
      i."checked",
      i."hasDivergence",
      i."divergenceAmount"::text AS "divergenceAmount",
      i."notes",
      i."createdAt",
      i."updatedAt",
      p."purchaseNumber",
      p."status" AS "purchaseStatus",
      p."totalAmount"::text AS "purchaseTotalAmount"
    FROM "SupplierBillingCycleItem" i
    JOIN "Purchase" p ON p."id" = i."purchaseId"
    WHERE i."cycleId" = ${request.params.id}
    ORDER BY i."purchaseDate" ASC, i."createdAt" ASC
  `;

  response.json({ ...cycle, items });
});
