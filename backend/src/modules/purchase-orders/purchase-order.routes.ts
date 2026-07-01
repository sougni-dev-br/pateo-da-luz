import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { buildBuyerSupportReport } from "../inventory/inventory.routes.js";

export const purchaseOrderRouter = Router();

const editableStatuses = new Set(["RASCUNHO"]);
const terminalStatuses = new Set(["RECEBIDO", "CANCELADO"]);

type PurchaseOrderRecord = Record<string, unknown> & {
  id: string;
  code: string;
  supplierNameSnapshot: string;
  status: string;
  items: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  totalItems: number;
  estimatedTotal: number;
};

function toNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asDate(value: unknown) {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function nextPurchaseOrderCode(tx: Prisma.TransactionClient, year: number) {
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

async function getOrder(id: string): Promise<PurchaseOrderRecord | null> {
  const [order] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT po.*, u."name" AS "createdByUserName", au."name" AS "approvedByUserName"
    FROM "PurchaseOrder" po
    LEFT JOIN "User" u ON u."id" = po."createdByUserId"
    LEFT JOIN "User" au ON au."id" = po."approvedByUserId"
    WHERE po."id" = ${id}
  `;
  if (!order) return null;
  const [items, audits] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        i.*,
        i."suggestedQuantity"::text AS "suggestedQuantity",
        i."requestedQuantity"::text AS "requestedQuantity",
        i."approvedQuantity"::text AS "approvedQuantity",
        i."receivedQuantity"::text AS "receivedQuantity",
        i."lastCountedQuantity"::text AS "lastCountedQuantity",
        i."estoqueMinimoSnapshot"::text AS "estoqueMinimoSnapshot",
        i."estoqueIdealSnapshot"::text AS "estoqueIdealSnapshot",
        i."unitPriceEstimated"::text AS "unitPriceEstimated",
        i."totalEstimated"::text AS "totalEstimated"
      FROM "PurchaseOrderItem" i
      WHERE i."purchaseOrderId" = ${id}
      ORDER BY i."productNameSnapshot"
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT a.*, u."name" AS "userName"
      FROM "AuditLog" a
      LEFT JOIN "User" u ON u."id" = a."userId"
      WHERE a."entity" IN ('PurchaseOrder', 'PurchaseOrderItem')
        AND (a."entityId" = ${id} OR a."newValue"::text ILIKE ${`%${id}%`})
      ORDER BY a."createdAt" DESC
      LIMIT 40
    `
  ]);
  const estimatedTotal = items.reduce((sum, item) => sum + Number(item.totalEstimated ?? 0), 0);
  return { ...order, items, audits, totalItems: items.length, estimatedTotal } as PurchaseOrderRecord;
}

purchaseOrderRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const status = asText(request.query.status);
  const search = asText(request.query.search);
  const orders = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      po.*,
      u."name" AS "createdByUserName",
      COUNT(i."id")::int AS "totalItems",
      COALESCE(SUM(i."totalEstimated"), 0)::text AS "estimatedTotal"
    FROM "PurchaseOrder" po
    LEFT JOIN "PurchaseOrderItem" i ON i."purchaseOrderId" = po."id"
    LEFT JOIN "User" u ON u."id" = po."createdByUserId"
    WHERE (${status}::text IS NULL OR po."status" = ${status})
      AND (
        ${search}::text IS NULL
        OR po."code" ILIKE ${`%${search ?? ""}%`}
        OR po."supplierNameSnapshot" ILIKE ${`%${search ?? ""}%`}
      )
    GROUP BY po."id", u."name"
    ORDER BY po."createdAt" DESC
  `;
  const summary = orders.reduce<Record<string, number>>((acc, order) => {
    const key = String(order.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  response.json({ summary, orders });
});

purchaseOrderRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const order = await getOrder(request.params.id);
  if (!order) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  response.json(order);
});

purchaseOrderRouter.post("/from-prelist", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const supplierIds = new Set(Array.isArray(request.body?.supplierIds) ? request.body.supplierIds.map(String) : []);
  const productIds = new Set(Array.isArray(request.body?.productIds) ? request.body.productIds.map(String) : []);
  const expectedDeliveryDate = asDate(request.body?.expectedDeliveryDate);
  const notes = asText(request.body?.notes);
  const report = await buildBuyerSupportReport(request.body?.filters ?? {});
  const selectedGroups = report.prelist
    .filter((group) => group.supplierId)
    .filter((group) => supplierIds.size === 0 || supplierIds.has(String(group.supplierId)))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => productIds.size === 0 || productIds.has(item.productId))
    }))
    .filter((group) => group.items.length > 0);
  const pending = report.prelist.filter((group) => !group.supplierId).flatMap((group) => group.items);

  const orders = await prisma.$transaction(async (tx) => {
    const created: Array<{ id: string; code: string; supplierName: string; items: number }> = [];
    for (const group of selectedGroups) {
      const id = crypto.randomUUID();
      const code = await nextPurchaseOrderCode(tx, new Date().getFullYear());
      await tx.$executeRaw`
        INSERT INTO "PurchaseOrder" (
          "id", "code", "supplierId", "supplierNameSnapshot", "status", "source",
          "createdByUserId", "expectedDeliveryDate", "notes", "createdAt", "updatedAt"
        )
        VALUES (
          ${id}, ${code}, ${String(group.supplierId)}, ${group.supplierName}, 'RASCUNHO', 'PRE_LISTA_COMPRADOR',
          ${user.id}, ${expectedDeliveryDate}, ${notes}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      for (const item of group.items) {
        const suggested = toNumber(item.suggestedQuantity) ?? 0;
        await tx.$executeRaw`
          INSERT INTO "PurchaseOrderItem" (
            "id", "purchaseOrderId", "productId", "productCodeSnapshot", "productNameSnapshot", "unitSnapshot",
            "suggestedQuantity", "requestedQuantity", "lastCountedQuantity", "estoqueMinimoSnapshot",
            "estoqueIdealSnapshot", "alertSnapshot", "suggestionTypeSnapshot", "notes", "createdAt", "updatedAt"
          )
          VALUES (
            ${crypto.randomUUID()}, ${id}, ${item.productId}, ${item.productCode}, ${item.productName}, ${item.unit},
            ${suggested}, ${suggested}, ${toNumber(item.lastQuantity)}, ${toNumber(item.estoqueMinimo)},
            ${toNumber(item.estoqueIdeal)}, ${item.alerts.join(", ")}, ${item.suggestionType}, ${item.logisticsNotes},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
      }
      created.push({ id, code, supplierName: group.supplierName, items: group.items.length });
    }
    return created;
  });

  await auditLog({
    userId: user.id,
    action: "CREATE_PURCHASE_ORDER_FROM_PRELIST",
    entity: "PurchaseOrder",
    newValue: { orders, pendingWithoutSupplier: pending.length },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json({ orders, pendingWithoutSupplier: pending.length });
});

purchaseOrderRouter.post("/from-planning", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const expectedDeliveryDate = asDate(request.body?.expectedDeliveryDate);
  const rawItems: Array<Record<string, unknown>> = Array.isArray(request.body?.items) ? request.body.items : [];
  const skippedItems: Array<{ productId: string | null; reason: string }> = [];

  // Guarda de sanidade: qualquer restaurante que digite acima disso e' erro grosseiro
  // (99% dos itens sao <= 500 no dia-a-dia). Aborta o batch inteiro com HTTP 400 para
  // forcar o comprador a revisar antes de gerar o pedido.
  const MAX_REQUESTED_QUANTITY = 100_000;
  // Cap defensivo do tamanho do batch: um restaurante nao gera mais que dezenas de
  // itens por planejamento; 1000 e' folga larga. Bloqueia payloads gigantes que
  // poderiam pesar a query IN(...) subsequente.
  const MAX_ITEMS_PER_REQUEST = 1000;
  if (rawItems.length > MAX_ITEMS_PER_REQUEST) {
    response.status(400).json({
      message: `Payload excede o limite de ${MAX_ITEMS_PER_REQUEST} itens por requisicao (recebido: ${rawItems.length}).`
    });
    return;
  }
  const overLimit: Array<{ productId: string; requestedQuantity: number }> = [];

  const candidates = rawItems.flatMap((raw) => {
    const productId = asText(raw?.productId);
    const supplierId = asText(raw?.supplierId);
    const requestedQuantity = toNumber(raw?.requestedQuantity);
    if (!productId) {
      skippedItems.push({ productId: null, reason: "Produto invalido." });
      return [];
    }
    if (requestedQuantity == null || requestedQuantity <= 0) {
      skippedItems.push({ productId, reason: "Quantidade invalida." });
      return [];
    }
    if (requestedQuantity > MAX_REQUESTED_QUANTITY) {
      // Prioridade sobre a checagem de supplierId: quantidade fora de escala e' erro
      // de digitacao mais grave (ex: virgula/ponto trocados) — precisa parar tudo.
      overLimit.push({ productId, requestedQuantity });
      return [];
    }
    if (!supplierId) {
      skippedItems.push({ productId, reason: "Fornecedor nao selecionado." });
      return [];
    }
    const unitPriceEstimatedRaw = toNumber(raw?.unitPriceEstimated);
    return [{
      productId,
      supplierId,
      requestedQuantity,
      purchaseModel: asText(raw?.purchaseModel),
      unitSnapshot: asText(raw?.unitSnapshot),
      unitPriceEstimated: unitPriceEstimatedRaw != null && unitPriceEstimatedRaw >= 0 ? unitPriceEstimatedRaw : null,
      notes: asText(raw?.notes)
    }];
  });

  if (overLimit.length > 0) {
    // Resolve nomes para uma mensagem clara ao comprador.
    const names = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "Product" WHERE "id" IN (${Prisma.join(overLimit.map((o) => o.productId))})
    `;
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const details = overLimit.map((o) => `${nameById.get(o.productId) ?? o.productId}: ${o.requestedQuantity}`);
    response.status(400).json({
      message: `Quantidade fora do intervalo aceitavel (maximo ${MAX_REQUESTED_QUANTITY}). Reveja o(s) item(ns): ${details.join("; ")}.`,
      overLimit: overLimit.map((o) => ({ ...o, productName: nameById.get(o.productId) ?? null }))
    });
    return;
  }

  const productIds = Array.from(new Set(candidates.map((item) => item.productId)));
  const supplierIds = Array.from(new Set(candidates.map((item) => item.supplierId)));
  const [products, suppliers] = await Promise.all([
    productIds.length
      ? prisma.$queryRaw<Array<{ id: string; code: string | null; name: string; unit: string | null; isActive: boolean }>>`
          SELECT "id", "externalCode" AS "code", "name", "unit", "isActive" FROM "Product" WHERE "id" IN (${Prisma.join(productIds)})
        `
      : Promise.resolve([]),
    supplierIds.length
      ? prisma.$queryRaw<Array<{ id: string; name: string; isActive: boolean }>>`
          SELECT "id", "name", "isActive" FROM "Supplier" WHERE "id" IN (${Prisma.join(supplierIds)})
        `
      : Promise.resolve([])
  ]);
  const activeProductById = new Map(products.filter((product) => product.isActive).map((product) => [product.id, product]));
  const activeSupplierById = new Map(suppliers.filter((supplier) => supplier.isActive).map((supplier) => [supplier.id, supplier]));

  const validItems: Array<typeof candidates[number] & { product: { code: string | null; name: string; unit: string | null }; supplierName: string }> = [];
  for (const item of candidates) {
    const product = activeProductById.get(item.productId);
    if (!product) {
      skippedItems.push({ productId: item.productId, reason: "Produto nao encontrado ou inativo." });
      continue;
    }
    const supplier = activeSupplierById.get(item.supplierId);
    if (!supplier) {
      skippedItems.push({ productId: item.productId, reason: "Fornecedor nao encontrado ou inativo." });
      continue;
    }
    validItems.push({ ...item, product, supplierName: supplier.name });
  }

  const groups = new Map<string, { supplierId: string; supplierName: string; items: typeof validItems }>();
  for (const item of validItems) {
    const group = groups.get(item.supplierId) ?? { supplierId: item.supplierId, supplierName: item.supplierName, items: [] };
    group.items.push(item);
    groups.set(item.supplierId, group);
  }

  const createdOrders = await prisma.$transaction(async (tx) => {
    const created: Array<{ id: string; code: string; supplierId: string; supplierName: string; totalItems: number; totalEstimated: number; status: string }> = [];
    for (const group of groups.values()) {
      const id = crypto.randomUUID();
      const code = await nextPurchaseOrderCode(tx, new Date().getFullYear());
      await tx.$executeRaw`
        INSERT INTO "PurchaseOrder" (
          "id", "code", "supplierId", "supplierNameSnapshot", "status", "source",
          "createdByUserId", "expectedDeliveryDate", "createdAt", "updatedAt"
        )
        VALUES (
          ${id}, ${code}, ${group.supplierId}, ${group.supplierName}, 'RASCUNHO', 'PLANEJAMENTO_COMPRA',
          ${user.id}, ${expectedDeliveryDate}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      let totalEstimated = 0;
      for (const item of group.items) {
        const unitSnapshot = item.purchaseModel || item.unitSnapshot || item.product.unit;
        const totalEstimatedItem = item.unitPriceEstimated != null ? item.unitPriceEstimated * item.requestedQuantity : null;
        totalEstimated += totalEstimatedItem ?? 0;
        await tx.$executeRaw`
          INSERT INTO "PurchaseOrderItem" (
            "id", "purchaseOrderId", "productId", "productCodeSnapshot", "productNameSnapshot", "unitSnapshot",
            "requestedQuantity", "unitPriceEstimated", "totalEstimated", "notes", "createdAt", "updatedAt"
          )
          VALUES (
            ${crypto.randomUUID()}, ${id}, ${item.productId}, ${item.product.code}, ${item.product.name}, ${unitSnapshot},
            ${item.requestedQuantity}, ${item.unitPriceEstimated}, ${totalEstimatedItem}, ${item.notes},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
      }
      created.push({ id, code, supplierId: group.supplierId, supplierName: group.supplierName, totalItems: group.items.length, totalEstimated, status: "RASCUNHO" });
    }
    return created;
  });

  await auditLog({
    userId: user.id,
    action: "CREATE_PURCHASE_ORDER_FROM_PLANNING",
    entity: "PurchaseOrder",
    newValue: { createdOrders, skippedItems },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json({ createdOrders, skippedItems });
});

purchaseOrderRouter.patch("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const current = await getOrder(request.params.id);
  if (!current) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  if (!editableStatuses.has(String(current.status))) {
    return response.status(409).json({ message: "Somente pedidos em rascunho podem ser editados." });
  }
  const expectedDeliveryDate = asDate(request.body?.expectedDeliveryDate);
  const notes = asText(request.body?.notes);
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "PurchaseOrder"
      SET "expectedDeliveryDate" = ${expectedDeliveryDate}, "notes" = ${notes}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
    for (const item of items) {
      const quantity = toNumber(item.requestedQuantity);
      if (!item.id || quantity == null || quantity < 0) continue;
      await tx.$executeRaw`
        UPDATE "PurchaseOrderItem"
        SET "requestedQuantity" = ${quantity}, "notes" = ${asText(item.notes)}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${String(item.id)} AND "purchaseOrderId" = ${request.params.id}
      `;
    }
  });
  await auditLog({ userId: user.id, action: "UPDATE_PURCHASE_ORDER", entity: "PurchaseOrder", entityId: request.params.id, previousValue: current, newValue: request.body, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
  response.json(await getOrder(request.params.id));
});

purchaseOrderRouter.post("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const current = await getOrder(request.params.id);
  if (!current) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  const action = asText(request.body?.action);
  const status = String(current.status);
  const transitions: Record<string, { from: string[]; to: string; stamp?: string; userField?: string; adminOnly?: boolean }> = {
    SEND_REVIEW: { from: ["RASCUNHO"], to: "EM_REVISAO", stamp: "sentToReviewAt", userField: "reviewedByUserId" },
    APPROVE: { from: ["EM_REVISAO"], to: "APROVADO", stamp: "approvedAt", userField: "approvedByUserId", adminOnly: true },
    MARK_SENT: { from: ["APROVADO"], to: "ENVIADO", stamp: "sentAt" }
  };
  const transition = action ? transitions[action] : null;
  if (!transition) return response.status(400).json({ message: "Acao de status invalida." });
  if (transition.adminOnly && !(user.role === "ADMIN" || await userHasPermission(user, "purchase-orders", "approve"))) {
    return response.status(403).json({ message: "Usuario sem permissao para aprovar pedido de compra." });
  }
  if (!transition.from.includes(status)) return response.status(409).json({ message: `Pedido em status ${status} nao permite esta acao.` });

  const setUserField = transition.userField ? Prisma.sql`, "${Prisma.raw(transition.userField)}" = ${user.id}` : Prisma.empty;
  const setStamp = transition.stamp ? Prisma.sql`, "${Prisma.raw(transition.stamp)}" = CURRENT_TIMESTAMP` : Prisma.empty;
  await prisma.$executeRaw`
    UPDATE "PurchaseOrder"
    SET "status" = ${transition.to}, "updatedAt" = CURRENT_TIMESTAMP ${setStamp} ${setUserField}
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({ userId: user.id, action: `PURCHASE_ORDER_${action}`, entity: "PurchaseOrder", entityId: request.params.id, previousValue: { status }, newValue: { status: transition.to }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
  response.json(await getOrder(request.params.id));
});

purchaseOrderRouter.post("/:id/receive", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const current = await getOrder(request.params.id);
  if (!current) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  if (!["ENVIADO", "RECEBIDO_PARCIAL"].includes(String(current.status))) {
    return response.status(409).json({ message: "Somente pedidos enviados podem receber mercadoria." });
  }
  const inputItems = Array.isArray(request.body?.items) ? request.body.items : [];
  await prisma.$transaction(async (tx) => {
    for (const item of inputItems) {
      const quantity = toNumber(item.receivedQuantity);
      if (!item.id || quantity == null || quantity < 0) continue;
      await tx.$executeRaw`
        UPDATE "PurchaseOrderItem"
        SET "receivedQuantity" = ${quantity}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${String(item.id)} AND "purchaseOrderId" = ${request.params.id}
      `;
    }
    const rows = await tx.$queryRaw<Array<{ requestedQuantity: Prisma.Decimal; approvedQuantity: Prisma.Decimal | null; receivedQuantity: Prisma.Decimal | null }>>`
      SELECT "requestedQuantity", "approvedQuantity", "receivedQuantity"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = ${request.params.id}
    `;
    const anyReceived = rows.some((row) => Number(row.receivedQuantity ?? 0) > 0);
    const allReceived = rows.length > 0 && rows.every((row) => Number(row.receivedQuantity ?? 0) >= Number(row.approvedQuantity ?? row.requestedQuantity ?? 0));
    const nextStatus = allReceived ? "RECEBIDO" : anyReceived ? "RECEBIDO_PARCIAL" : "ENVIADO";
    await tx.$executeRaw`
      UPDATE "PurchaseOrder"
      SET "status" = ${nextStatus}, "receivedAt" = CASE WHEN ${allReceived} THEN CURRENT_TIMESTAMP ELSE "receivedAt" END, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${request.params.id}
    `;
  });
  await auditLog({ userId: user.id, action: "RECEIVE_PURCHASE_ORDER", entity: "PurchaseOrder", entityId: request.params.id, previousValue: { status: current.status }, newValue: request.body, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
  response.json(await getOrder(request.params.id));
});

purchaseOrderRouter.post("/:id/cancel", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const reason = asText(request.body?.reason);
  if (!reason) return response.status(400).json({ message: "Informe o motivo do cancelamento." });
  const current = await getOrder(request.params.id);
  if (!current) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  if (terminalStatuses.has(String(current.status))) return response.status(409).json({ message: "Pedido ja esta finalizado." });
  await prisma.$executeRaw`
    UPDATE "PurchaseOrder"
    SET "status" = 'CANCELADO', "cancelReason" = ${reason}, "canceledAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({ userId: user.id, action: "CANCEL_PURCHASE_ORDER", entity: "PurchaseOrder", entityId: request.params.id, previousValue: current, newValue: { reason }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
  response.json(await getOrder(request.params.id));
});

purchaseOrderRouter.get("/:id/export.csv", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const order = await getOrder(request.params.id);
  if (!order) return response.status(404).json({ message: "Pedido de compra nao encontrado." });
  const headers = ["Pedido", "Fornecedor", "Status", "Produto", "Unidade", "Qtd solicitada", "Qtd aprovada", "Qtd recebida", "Observacao"];
  const rows = (order.items as Array<Record<string, unknown>>).map((item) => [
    order.code,
    order.supplierNameSnapshot,
    order.status,
    item.productNameSnapshot,
    item.unitSnapshot,
    item.requestedQuantity,
    item.approvedQuantity,
    item.receivedQuantity,
    item.notes
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
  await auditLog({ userId: user.id, action: "EXPORT_PURCHASE_ORDER_CSV", entity: "PurchaseOrder", entityId: request.params.id, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${String(order.code)}.csv"`);
  response.send(`\uFEFF${csv}`);
});
