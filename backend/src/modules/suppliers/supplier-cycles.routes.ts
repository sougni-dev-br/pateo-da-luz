import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";

export const supplierCyclesRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

async function getNextPurchaseNumber(tx: Prisma.TransactionClient, year: number) {
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

function splitAmountInTwo(totalAmount: number): [Prisma.Decimal, Prisma.Decimal] {
  const totalCents = Math.round(totalAmount * 100);
  const firstCents = Math.floor(totalCents / 2);
  const secondCents = totalCents - firstCents;
  return [new Prisma.Decimal(firstCents / 100), new Prisma.Decimal(secondCents / 100)];
}

// ── GET /supplier-cycles ──────────────────────────────────────────────────────

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
      c."generatedPurchaseId",
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

// ── GET /supplier-cycles/:id ──────────────────────────────────────────────────

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

  // If cycle is closed, also return the generated installments
  let installments: Array<Record<string, unknown>> = [];
  const generatedPurchaseId = cycle.generatedPurchaseId as string | null;
  if (generatedPurchaseId) {
    installments = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        pi."id",
        pi."installment",
        pi."amount"::text AS "amount",
        pi."dueDate",
        pi."status",
        pi."sourceType",
        pi."paymentMethodId",
        COALESCE(pi."paymentMethodName", pm."name") AS "paymentMethodName",
        pi."paidDate",
        pi."paidAmount"::text AS "paidAmount"
      FROM "PaymentInstallment" pi
      LEFT JOIN "PaymentMethod" pm ON pm."id" = pi."paymentMethodId"
      WHERE pi."purchaseId" = ${generatedPurchaseId}
      ORDER BY pi."installment"
    `;
  }

  response.json({ ...cycle, items, installments });
});

// ── POST /supplier-cycles ─────────────────────────────────────────────────────

supplierCyclesRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { supplierId, startDate: rawStartDate, endDate: rawEndDate, notes } = request.body as {
    supplierId: string;
    startDate: string;
    endDate?: string;
    notes?: string;
  };

  if (!supplierId) {
    response.status(400).json({ message: "supplierId obrigatorio." });
    return;
  }
  if (!rawStartDate) {
    response.status(400).json({ message: "startDate obrigatorio." });
    return;
  }

  const startDate = new Date(rawStartDate);
  if (isNaN(startDate.getTime())) {
    response.status(400).json({ message: "startDate invalido." });
    return;
  }

  let endDate: Date | null = null;
  if (rawEndDate) {
    endDate = new Date(rawEndDate);
    if (isNaN(endDate.getTime())) {
      response.status(400).json({ message: "endDate invalido." });
      return;
    }
    if (endDate < startDate) {
      response.status(400).json({ message: "endDate deve ser maior ou igual a startDate." });
      return;
    }
  }

  const [supplier] = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name" FROM "Supplier" WHERE "id" = ${supplierId} AND "isActive" = true LIMIT 1
  `;
  if (!supplier) {
    response.status(404).json({ message: "Fornecedor nao encontrado ou inativo." });
    return;
  }

  const [existing] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "SupplierBillingCycle"
    WHERE "supplierId" = ${supplierId}
      AND "status" IN ('OPEN', 'CHECKED')
    LIMIT 1
  `;
  if (existing) {
    response.status(409).json({ message: "Ja existe um ciclo aberto para este fornecedor. Feche o ciclo atual antes de criar um novo." });
    return;
  }

  const cycleId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "SupplierBillingCycle" (
      "id", "supplierId", "periodStart", "periodEnd", "status",
      "totalAmount", "notes", "createdByUserId",
      "createdAt", "updatedAt"
    ) VALUES (
      ${cycleId}, ${supplierId}, ${startDate}, ${endDate},
      'OPEN', 0, ${notes ?? null}, ${user.id},
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;

  await auditLog({
    userId: user.id,
    action: "CREATE_SUPPLIER_CYCLE",
    entity: "SupplierBillingCycle",
    entityId: cycleId,
    newValue: { supplierId, startDate: rawStartDate, endDate: rawEndDate ?? null } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  const [created] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      c."id",
      c."supplierId",
      s."name" AS "supplierName",
      c."periodStart",
      c."periodEnd",
      c."status",
      c."totalAmount"::text AS "totalAmount",
      c."generatedPurchaseId",
      0::int AS "itemCount",
      0::int AS "checkedCount",
      false AS "hasDivergence",
      c."createdAt",
      c."updatedAt"
    FROM "SupplierBillingCycle" c
    JOIN "Supplier" s ON s."id" = c."supplierId"
    WHERE c."id" = ${cycleId}
  `;

  response.status(201).json(created);
});

// ── POST /supplier-cycles/:id/check-item ──────────────────────────────────────

supplierCyclesRouter.post("/:id/check-item", async (request, response) => {
  const user = await requireAdmin(request, response);
  if (!user) return;

  const { itemId, checked, hasDivergence, divergenceAmount, notes } = request.body as {
    itemId: string;
    checked: boolean;
    hasDivergence?: boolean;
    divergenceAmount?: number;
    notes?: string;
  };

  if (!itemId) {
    response.status(400).json({ message: "itemId obrigatorio." });
    return;
  }
  if (typeof checked !== "boolean") {
    response.status(400).json({ message: "checked deve ser true ou false." });
    return;
  }

  const [cycle] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status" FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo esta ${cycle.status} — so e possivel conferir itens em ciclos OPEN ou CHECKED.` });
    return;
  }

  const [item] = await prisma.$queryRaw<Array<{ id: string; cycleId: string }>>`
    SELECT "id", "cycleId" FROM "SupplierBillingCycleItem"
    WHERE "id" = ${itemId} AND "cycleId" = ${request.params.id}
    LIMIT 1
  `;
  if (!item) {
    response.status(404).json({ message: "Item nao encontrado neste ciclo." });
    return;
  }

  const divAmount = (hasDivergence && divergenceAmount != null)
    ? new Prisma.Decimal(divergenceAmount)
    : null;

  await prisma.$executeRaw`
    UPDATE "SupplierBillingCycleItem"
    SET
      "checked"         = ${checked},
      "hasDivergence"   = ${hasDivergence ?? false},
      "divergenceAmount" = ${divAmount},
      "notes"           = ${notes ?? null},
      "updatedAt"       = CURRENT_TIMESTAMP
    WHERE "id" = ${itemId}
  `;

  // Promote cycle to CHECKED if all items are now checked
  const [counts] = await prisma.$queryRaw<Array<{ total: number; checkedCount: number }>>`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
    FROM "SupplierBillingCycleItem"
    WHERE "cycleId" = ${request.params.id}
  `;
  const allChecked = counts.total > 0 && counts.checkedCount === counts.total;
  const newCycleStatus = allChecked ? "CHECKED" : "OPEN";

  await prisma.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET
      "status"        = ${newCycleStatus},
      "checkedByUserId" = ${allChecked ? user.id : null},
      "checkedAt"     = ${allChecked ? new Date() : null},
      "updatedAt"     = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;

  response.json({ cycleStatus: newCycleStatus, allChecked, itemCount: counts.total, checkedCount: counts.checkedCount });
});

// ── POST /supplier-cycles/:id/close ──────────────────────────────────────────

supplierCyclesRouter.post("/:id/close", async (request, response) => {
  const user = await requireAdmin(request, response);
  if (!user) return;

  const {
    paymentMethodId,
    installmentCount,
    firstDueDate: rawFirstDueDate,
    secondDueDate: rawSecondDueDate,
    notes,
  } = request.body as {
    paymentMethodId: string;
    installmentCount: 1 | 2;
    firstDueDate: string;
    secondDueDate?: string;
    notes?: string;
  };

  // ── Validações de body ────────────────────────────────────────────────────

  if (!paymentMethodId) {
    response.status(400).json({ message: "paymentMethodId obrigatorio." });
    return;
  }
  if (installmentCount !== 1 && installmentCount !== 2) {
    response.status(400).json({ message: "installmentCount deve ser 1 ou 2." });
    return;
  }
  if (!rawFirstDueDate) {
    response.status(400).json({ message: "firstDueDate obrigatorio." });
    return;
  }
  if (installmentCount === 2 && !rawSecondDueDate) {
    response.status(400).json({ message: "secondDueDate obrigatorio quando installmentCount = 2." });
    return;
  }

  const firstDueDate = new Date(rawFirstDueDate);
  const secondDueDate = rawSecondDueDate ? new Date(rawSecondDueDate) : null;

  if (isNaN(firstDueDate.getTime())) {
    response.status(400).json({ message: "firstDueDate invalido." });
    return;
  }
  if (installmentCount === 2 && secondDueDate && isNaN(secondDueDate.getTime())) {
    response.status(400).json({ message: "secondDueDate invalido." });
    return;
  }

  // ── Validar método de pagamento ───────────────────────────────────────────

  const [paymentMethod] = await prisma.$queryRaw<Array<{ id: string; name: string; type: string }>>`
    SELECT "id", "name", "type" FROM "PaymentMethod" WHERE "id" = ${paymentMethodId} AND "isActive" = true LIMIT 1
  `;
  if (!paymentMethod) {
    response.status(400).json({ message: "Forma de pagamento nao encontrada ou inativa." });
    return;
  }
  if (paymentMethod.type === "CREDIT_CARD") {
    response.status(400).json({ message: "Nao e possivel fechar ciclo com cartao de credito. Use Boleto ou Faturado." });
    return;
  }

  // ── Validar ciclo ─────────────────────────────────────────────────────────

  const [cycle] = await prisma.$queryRaw<Array<{
    id: string; supplierId: string; supplierName: string;
    status: string; totalAmount: string; periodStart: Date;
  }>>`
    SELECT c."id", c."supplierId", s."name" AS "supplierName", c."status",
           c."totalAmount"::text AS "totalAmount", c."periodStart"
    FROM "SupplierBillingCycle" c
    JOIN "Supplier" s ON s."id" = c."supplierId"
    WHERE c."id" = ${request.params.id}
    LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status === "CLOSED" || cycle.status === "PAID") {
    response.status(409).json({ message: `Ciclo ja esta ${cycle.status} — nao e possivel fechar novamente.` });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo esta ${cycle.status} — so e possivel fechar ciclos OPEN ou CHECKED.` });
    return;
  }

  const totalAmount = Number(cycle.totalAmount);
  if (totalAmount <= 0) {
    response.status(400).json({ message: "Ciclo sem valor — totalAmount deve ser maior que zero." });
    return;
  }

  // ── Validar itens ─────────────────────────────────────────────────────────

  const items = await prisma.$queryRaw<Array<{ id: string; checked: boolean }>>`
    SELECT "id", "checked" FROM "SupplierBillingCycleItem" WHERE "cycleId" = ${request.params.id}
  `;
  if (items.length === 0) {
    response.status(400).json({ message: "Ciclo sem itens — adicione compras ao ciclo antes de fechar." });
    return;
  }
  const unchecked = items.filter((i) => !i.checked);
  if (unchecked.length > 0) {
    response.status(400).json({
      message: `${unchecked.length} item(ns) ainda nao conferido(s). Confira todos os itens antes de fechar o ciclo.`
    });
    return;
  }

  // ── Transação: Purchase virtual + installments + close ciclo ──────────────

  const periodStart = new Date(cycle.periodStart);
  const closeDate = new Date();
  const invoiceNumber = `CICLO-${request.params.id.substring(0, 8).toUpperCase()}`;
  const competenceMonth = periodStart.getMonth() + 1;
  const competenceYear = periodStart.getFullYear();

  const result = await prisma.$transaction(async (tx) => {
    const purchaseId = crypto.randomUUID();
    const purchaseNumber = await getNextPurchaseNumber(tx, closeDate.getFullYear());

    // Criar Purchase virtual
    await tx.$executeRaw`
      INSERT INTO "Purchase" (
        "id", "purchaseNumber", "purchaseDate", "competenceMonth", "competenceYear",
        "supplierId", "invoiceNumber", "paymentMethod", "paymentMethodId",
        "totalAmount", "workflowStatus", "status", "createdAt", "updatedAt"
      ) VALUES (
        ${purchaseId}, ${purchaseNumber}, ${closeDate}, ${competenceMonth}, ${competenceYear},
        ${cycle.supplierId}, ${invoiceNumber}, ${paymentMethod.name}, ${paymentMethodId},
        ${new Prisma.Decimal(totalAmount)}, 'SUPPLIER_CYCLE', 'ACTIVE',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    // Criar PaymentInstallments
    if (installmentCount === 1) {
      await tx.$executeRaw`
        INSERT INTO "PaymentInstallment" (
          "id", "purchaseId", "installment", "amount", "dueDate",
          "paymentMethodId", "paymentMethodName", "sourceType", "status",
          "createdAt"
        ) VALUES (
          ${crypto.randomUUID()}, ${purchaseId}, 1,
          ${new Prisma.Decimal(totalAmount)}, ${firstDueDate},
          ${paymentMethodId}, ${paymentMethod.name}, 'SUPPLIER_CYCLE', 'OPEN',
          CURRENT_TIMESTAMP
        )
      `;
    } else {
      const [firstAmount, secondAmount] = splitAmountInTwo(totalAmount);
      await tx.$executeRaw`
        INSERT INTO "PaymentInstallment" (
          "id", "purchaseId", "installment", "amount", "dueDate",
          "paymentMethodId", "paymentMethodName", "sourceType", "status",
          "createdAt"
        ) VALUES (
          ${crypto.randomUUID()}, ${purchaseId}, 1,
          ${firstAmount}, ${firstDueDate},
          ${paymentMethodId}, ${paymentMethod.name}, 'SUPPLIER_CYCLE', 'OPEN',
          CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "PaymentInstallment" (
          "id", "purchaseId", "installment", "amount", "dueDate",
          "paymentMethodId", "paymentMethodName", "sourceType", "status",
          "createdAt"
        ) VALUES (
          ${crypto.randomUUID()}, ${purchaseId}, 2,
          ${secondAmount}, ${secondDueDate},
          ${paymentMethodId}, ${paymentMethod.name}, 'SUPPLIER_CYCLE', 'OPEN',
          CURRENT_TIMESTAMP
        )
      `;
    }

    // Fechar ciclo
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle"
      SET
        "status"              = 'CLOSED',
        "closedAt"            = CURRENT_TIMESTAMP,
        "closedByUserId"      = ${user.id},
        "generatedPurchaseId" = ${purchaseId},
        "periodEnd"           = CURRENT_TIMESTAMP,
        "notes"               = ${notes ?? null},
        "updatedAt"           = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;

    return { purchaseId, purchaseNumber };
  });

  await auditLog({
    userId: user.id,
    action: "CLOSE_SUPPLIER_CYCLE",
    entity: "SupplierBillingCycle",
    entityId: request.params.id,
    newValue: {
      generatedPurchaseId: result.purchaseId,
      purchaseNumber: result.purchaseNumber,
      totalAmount,
      installmentCount,
    } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json({
    cycleId: request.params.id,
    status: "CLOSED",
    generatedPurchaseId: result.purchaseId,
    purchaseNumber: result.purchaseNumber,
    totalAmount,
    installmentCount,
  });
});
