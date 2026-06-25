import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import { addPurchaseToCycle } from "./supplier-billing-cycle.service.js";

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
      s."cycleFirstDueDays",
      s."cycleSecondDueDays",
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

  // Block only if an active cycle has a period that OVERLAPS with the new one.
  // Overlap exists when NOT (existing.end < new.start OR new.end < existing.start).
  // NULL periodEnd means the cycle is open-ended (extends to infinity).
  const [overlapping] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "SupplierBillingCycle"
    WHERE "supplierId" = ${supplierId}
      AND "status" IN ('OPEN', 'CHECKED')
      AND NOT (
        ("periodEnd" IS NOT NULL AND "periodEnd" < ${startDate})
        OR
        (${endDate} IS NOT NULL AND ${endDate} < "periodStart")
      )
    LIMIT 1
  `;
  if (overlapping) {
    response.status(409).json({ message: "Ja existe um ciclo ativo para este fornecedor com periodo sobreposto. Ajuste as datas ou feche o ciclo existente antes de criar um novo." });
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

// ── PATCH /supplier-cycles/:id ────────────────────────────────────────────────

supplierCyclesRouter.patch("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { startDate: rawStartDate, endDate: rawEndDate, notes } = request.body as {
    startDate?: string;
    endDate?: string;
    notes?: string;
  };

  const [cycle] = await prisma.$queryRaw<Array<{ id: string; status: string; periodStart: Date; periodEnd: Date | null; notes: string | null }>>`
    SELECT "id", "status", "periodStart", "periodEnd", "notes"
    FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo esta ${cycle.status} — so e possivel editar ciclos OPEN ou CHECKED.` });
    return;
  }

  let startDate: Date = new Date(cycle.periodStart);
  if (rawStartDate) {
    startDate = new Date(rawStartDate);
    if (isNaN(startDate.getTime())) {
      response.status(400).json({ message: "startDate invalido." });
      return;
    }
  }

  let endDate: Date | null = cycle.periodEnd ? new Date(cycle.periodEnd) : null;
  if (rawEndDate !== undefined) {
    if (rawEndDate === "") {
      endDate = null;
    } else {
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
  }

  const notesValue = notes !== undefined ? (notes || null) : cycle.notes;

  await prisma.$executeRaw`
    UPDATE "SupplierBillingCycle"
    SET "periodStart" = ${startDate},
        "periodEnd"   = ${endDate},
        "notes"       = ${notesValue},
        "updatedAt"   = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;

  await auditLog({
    userId: user.id,
    action: "EDIT_SUPPLIER_CYCLE",
    entity: "SupplierBillingCycle",
    entityId: request.params.id,
    newValue: { startDate: startDate.toISOString(), endDate: endDate?.toISOString() ?? null, notes: notesValue } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: request.params.id, periodStart: startDate, periodEnd: endDate, notes: notesValue });
});

// ── GET /supplier-cycles/:id/available-purchases ──────────────────────────────

supplierCyclesRouter.get("/:id/available-purchases", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [cycle] = await prisma.$queryRaw<Array<{ id: string; supplierId: string; status: string; periodStart: Date; periodEnd: Date | null }>>`
    SELECT "id", "supplierId", "status", "periodStart", "periodEnd"
    FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: "So e possivel consultar compras disponiveis para ciclos OPEN ou CHECKED." });
    return;
  }

  const purchases = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      p."id",
      p."purchaseNumber",
      p."purchaseDate",
      p."invoiceNumber",
      p."totalAmount"::text AS "totalAmount",
      p."status",
      (
        SELECT ci."cycleId" FROM "SupplierBillingCycleItem" ci WHERE ci."purchaseId" = p."id" LIMIT 1
      ) AS "currentCycleId",
      (
        SELECT c2."status" FROM "SupplierBillingCycleItem" ci2
        JOIN "SupplierBillingCycle" c2 ON c2."id" = ci2."cycleId"
        WHERE ci2."purchaseId" = p."id" LIMIT 1
      ) AS "currentCycleStatus"
    FROM "Purchase" p
    WHERE p."supplierId" = ${cycle.supplierId}
      AND p."status" = 'ACTIVE'
      AND p."workflowStatus" != 'SUPPLIER_CYCLE'
      AND NOT EXISTS (
        SELECT 1 FROM "SupplierBillingCycleItem" ci
        WHERE ci."purchaseId" = p."id" AND ci."cycleId" = ${request.params.id}
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM "SupplierBillingCycleItem" ci2 WHERE ci2."purchaseId" = p."id"
        )
        OR EXISTS (
          SELECT 1 FROM "SupplierBillingCycleItem" ci3
          JOIN "SupplierBillingCycle" c3 ON c3."id" = ci3."cycleId"
          WHERE ci3."purchaseId" = p."id" AND c3."status" IN ('OPEN', 'CHECKED')
        )
      )
    ORDER BY p."purchaseDate" DESC
    LIMIT 100
  `;

  const periodStart = new Date(cycle.periodStart);
  const periodEnd = cycle.periodEnd ? new Date(cycle.periodEnd) : null;

  const result = purchases.map((p) => {
    const purchaseDate = new Date(p.purchaseDate as string);
    const isOutsidePeriod = purchaseDate < periodStart || (periodEnd != null && purchaseDate > periodEnd);
    return { ...p, isOutsidePeriod };
  });

  response.json(result);
});

// ── POST /supplier-cycles/:id/purchases ───────────────────────────────────────

supplierCyclesRouter.post("/:id/purchases", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { purchaseId } = request.body as { purchaseId: string };
  if (!purchaseId) {
    response.status(400).json({ message: "purchaseId obrigatorio." });
    return;
  }

  const [cycle] = await prisma.$queryRaw<Array<{ id: string; supplierId: string; status: string }>>`
    SELECT "id", "supplierId", "status" FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo esta ${cycle.status} — so e possivel adicionar compras a ciclos OPEN ou CHECKED.` });
    return;
  }

  const [purchase] = await prisma.$queryRaw<Array<{ id: string; supplierId: string; totalAmount: string; purchaseDate: Date; invoiceNumber: string | null; workflowStatus: string }>>`
    SELECT "id", "supplierId", "totalAmount"::text AS "totalAmount", "purchaseDate", "invoiceNumber", "workflowStatus"
    FROM "Purchase"
    WHERE "id" = ${purchaseId} AND "status" = 'ACTIVE'
    LIMIT 1
  `;
  if (!purchase) {
    response.status(404).json({ message: "Compra nao encontrada ou inativa." });
    return;
  }
  if (purchase.supplierId !== cycle.supplierId) {
    response.status(400).json({ message: "Compra pertence a outro fornecedor." });
    return;
  }
  if (purchase.workflowStatus === "SUPPLIER_CYCLE") {
    response.status(400).json({ message: "Compra virtual de fechamento de ciclo nao pode ser adicionada manualmente." });
    return;
  }

  const [existingItem] = await prisma.$queryRaw<Array<{ cycleId: string }>>`
    SELECT "cycleId" FROM "SupplierBillingCycleItem" WHERE "purchaseId" = ${purchaseId} LIMIT 1
  `;
  if (existingItem) {
    if (existingItem.cycleId === request.params.id) {
      response.status(409).json({ message: "Compra ja esta neste ciclo." });
    } else {
      response.status(409).json({ message: "Compra ja pertence a outro ciclo. Use Mover para transferi-la." });
    }
    return;
  }

  let newCycleStatus: string = cycle.status;
  await prisma.$transaction(async (tx) => {
    await addPurchaseToCycle(tx, {
      cycleId: request.params.id,
      purchaseId,
      amount: Number(purchase.totalAmount),
      purchaseDate: new Date(purchase.purchaseDate),
      invoiceNumber: purchase.invoiceNumber,
    });
    // New item is unchecked — if cycle was CHECKED, revert to OPEN
    const [counts] = await tx.$queryRaw<Array<{ total: number; checkedCount: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
      FROM "SupplierBillingCycleItem" WHERE "cycleId" = ${request.params.id}
    `;
    newCycleStatus = counts.total > 0 && counts.checkedCount === counts.total ? "CHECKED" : "OPEN";
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle" SET "status" = ${newCycleStatus}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
  });

  await auditLog({
    userId: user.id,
    action: "ADD_PURCHASE_TO_CYCLE",
    entity: "SupplierBillingCycle",
    entityId: request.params.id,
    newValue: { purchaseId, amount: purchase.totalAmount } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ success: true, purchaseId, cycleId: request.params.id, cycleStatus: newCycleStatus });
});

// ── DELETE /supplier-cycles/:id/purchases/:purchaseId ─────────────────────────

supplierCyclesRouter.delete("/:id/purchases/:purchaseId", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [cycle] = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status" FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!cycle) {
    response.status(404).json({ message: "Ciclo nao encontrado." });
    return;
  }
  if (cycle.status !== "OPEN" && cycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo esta ${cycle.status} — so e possivel remover compras de ciclos OPEN ou CHECKED.` });
    return;
  }

  const [item] = await prisma.$queryRaw<Array<{ id: string; amount: string }>>`
    SELECT "id", "amount"::text AS "amount"
    FROM "SupplierBillingCycleItem"
    WHERE "purchaseId" = ${request.params.purchaseId} AND "cycleId" = ${request.params.id}
    LIMIT 1
  `;
  if (!item) {
    response.status(404).json({ message: "Compra nao encontrada neste ciclo." });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "SupplierBillingCycleItem" WHERE "id" = ${item.id}
    `;
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle"
      SET "totalAmount" = GREATEST(0, "totalAmount" - ${new Prisma.Decimal(Number(item.amount))}),
          "updatedAt"   = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;

    const [counts] = await tx.$queryRaw<Array<{ total: number; checkedCount: number }>>`
      SELECT COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
      FROM "SupplierBillingCycleItem"
      WHERE "cycleId" = ${request.params.id}
    `;
    const newStatus = counts.total > 0 && counts.checkedCount === counts.total ? "CHECKED" : "OPEN";
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle"
      SET "status"          = ${newStatus},
          "checkedByUserId" = ${newStatus === "CHECKED" ? user.id : null},
          "checkedAt"       = ${newStatus === "CHECKED" ? new Date() : null},
          "updatedAt"       = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
  });

  await auditLog({
    userId: user.id,
    action: "REMOVE_PURCHASE_FROM_CYCLE",
    entity: "SupplierBillingCycle",
    entityId: request.params.id,
    newValue: { purchaseId: request.params.purchaseId } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ success: true, purchaseId: request.params.purchaseId, cycleId: request.params.id });
});

// ── POST /supplier-cycles/:id/purchases/:purchaseId/move ──────────────────────

supplierCyclesRouter.post("/:id/purchases/:purchaseId/move", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { targetCycleId } = request.body as { targetCycleId: string };
  if (!targetCycleId) {
    response.status(400).json({ message: "targetCycleId obrigatorio." });
    return;
  }
  if (targetCycleId === request.params.id) {
    response.status(400).json({ message: "targetCycleId deve ser diferente do ciclo origem." });
    return;
  }

  const [sourceCycle] = await prisma.$queryRaw<Array<{ id: string; supplierId: string; status: string }>>`
    SELECT "id", "supplierId", "status" FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1
  `;
  if (!sourceCycle) {
    response.status(404).json({ message: "Ciclo origem nao encontrado." });
    return;
  }
  if (sourceCycle.status !== "OPEN" && sourceCycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo origem esta ${sourceCycle.status} — nao e possivel mover compras.` });
    return;
  }

  const [targetCycle] = await prisma.$queryRaw<Array<{ id: string; supplierId: string; status: string }>>`
    SELECT "id", "supplierId", "status" FROM "SupplierBillingCycle" WHERE "id" = ${targetCycleId} LIMIT 1
  `;
  if (!targetCycle) {
    response.status(404).json({ message: "Ciclo destino nao encontrado." });
    return;
  }
  if (targetCycle.status !== "OPEN" && targetCycle.status !== "CHECKED") {
    response.status(409).json({ message: `Ciclo destino esta ${targetCycle.status} — so e possivel mover para ciclos OPEN ou CHECKED.` });
    return;
  }
  if (targetCycle.supplierId !== sourceCycle.supplierId) {
    response.status(400).json({ message: "Ciclo destino pertence a outro fornecedor." });
    return;
  }

  const [item] = await prisma.$queryRaw<Array<{ id: string; amount: string; purchaseDate: Date; invoiceNumber: string | null }>>`
    SELECT "id", "amount"::text AS "amount", "purchaseDate", "invoiceNumber"
    FROM "SupplierBillingCycleItem"
    WHERE "purchaseId" = ${request.params.purchaseId} AND "cycleId" = ${request.params.id}
    LIMIT 1
  `;
  if (!item) {
    response.status(404).json({ message: "Compra nao encontrada no ciclo origem." });
    return;
  }

  const amount = Number(item.amount);

  await prisma.$transaction(async (tx) => {
    // Remove da origem e recalcula
    await tx.$executeRaw`
      DELETE FROM "SupplierBillingCycleItem" WHERE "id" = ${item.id}
    `;
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle"
      SET "totalAmount" = GREATEST(0, "totalAmount" - ${new Prisma.Decimal(amount)}),
          "updatedAt"   = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    const [srcCounts] = await tx.$queryRaw<Array<{ total: number; checkedCount: number }>>`
      SELECT COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
      FROM "SupplierBillingCycleItem" WHERE "cycleId" = ${request.params.id}
    `;
    const srcStatus = srcCounts.total > 0 && srcCounts.checkedCount === srcCounts.total ? "CHECKED" : "OPEN";
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle"
      SET "status"          = ${srcStatus},
          "checkedByUserId" = ${srcStatus === "CHECKED" ? user.id : null},
          "checkedAt"       = ${srcStatus === "CHECKED" ? new Date() : null},
          "updatedAt"       = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;

    // Adiciona ao destino (sem checked — fresh start)
    await addPurchaseToCycle(tx, {
      cycleId: targetCycleId,
      purchaseId: request.params.purchaseId,
      amount,
      purchaseDate: new Date(item.purchaseDate),
      invoiceNumber: item.invoiceNumber,
    });
    // Recalculate target cycle status — new item is unchecked, may revert from CHECKED to OPEN
    const [tgtCounts] = await tx.$queryRaw<Array<{ total: number; checkedCount: number }>>`
      SELECT COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE "checked" = true)::int AS "checkedCount"
      FROM "SupplierBillingCycleItem" WHERE "cycleId" = ${targetCycleId}
    `;
    const tgtStatus = tgtCounts.total > 0 && tgtCounts.checkedCount === tgtCounts.total ? "CHECKED" : "OPEN";
    await tx.$executeRaw`
      UPDATE "SupplierBillingCycle" SET "status" = ${tgtStatus}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${targetCycleId}
    `;
  });

  await auditLog({
    userId: user.id,
    action: "MOVE_PURCHASE_BETWEEN_CYCLES",
    entity: "SupplierBillingCycle",
    entityId: request.params.id,
    newValue: { purchaseId: request.params.purchaseId, sourceCycleId: request.params.id, targetCycleId } as Prisma.InputJsonValue,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  const [src] = await prisma.$queryRaw<Array<{ totalAmount: string; status: string }>>`SELECT "totalAmount"::text, "status" FROM "SupplierBillingCycle" WHERE "id" = ${request.params.id} LIMIT 1`;
  const [tgt] = await prisma.$queryRaw<Array<{ totalAmount: string; status: string }>>`SELECT "totalAmount"::text, "status" FROM "SupplierBillingCycle" WHERE "id" = ${targetCycleId} LIMIT 1`;
  response.json({ success: true, purchaseId: request.params.purchaseId, sourceCycleId: request.params.id, targetCycleId, sourceTotalAmount: src?.totalAmount, sourceStatus: src?.status, targetTotalAmount: tgt?.totalAmount, targetStatus: tgt?.status });
});
