import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";

export const supplierRouter = Router();

type SupplierRow = {
  id: string;
  externalCode: string | null;
  document: string | null;
  name: string;
  normalizedName: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  mainCategory: string | null;
  defaultPaymentTermDays: number | null;
  registrationDate: Date | null;
  isActive: boolean;
  notes: string | null;
};

async function findSupplierRow(id: string) {
  const [supplier] = await prisma.$queryRaw<SupplierRow[]>`
    SELECT
      "id",
      "externalCode",
      "document",
      "name",
      "normalizedName",
      "phone",
      "email",
      "contactName",
      "mainCategory",
      "defaultPaymentTermDays",
      "registrationDate",
      "isActive",
      "notes"
    FROM "Supplier"
    WHERE "id" = ${id}
  `;
  return supplier;
}

async function nextSupplierCode() {
  await prisma.$executeRaw`
    INSERT INTO "SupplierSequence" ("id", "currentValue", "updatedAt")
    VALUES (1, 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO NOTHING
  `;
  const [row] = await prisma.$queryRaw<Array<{ currentValue: number }>>`
    UPDATE "SupplierSequence"
    SET "currentValue" = "currentValue" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 1
    RETURNING "currentValue"
  `;
  return `FOR-${String(row.currentValue).padStart(6, "0")}`;
}

supplierRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const search = request.query.search ? String(request.query.search) : undefined;
  const term = `%${search ?? ""}%`;
  const suppliers = search
    ? await prisma.$queryRaw<SupplierRow[]>`
        SELECT
          "id",
          "externalCode",
          "document",
          "name",
          "normalizedName",
          "phone",
          "email",
          "contactName",
          "mainCategory",
          "defaultPaymentTermDays",
          "registrationDate",
          "isActive",
          "notes"
        FROM "Supplier"
        WHERE "name" ILIKE ${term}
           OR "document" ILIKE ${term}
           OR "externalCode" ILIKE ${term}
           OR "normalizedName" ILIKE ${term}
        ORDER BY "name" ASC
      `
    : await prisma.$queryRaw<SupplierRow[]>`
        SELECT
          "id",
          "externalCode",
          "document",
          "name",
          "normalizedName",
          "phone",
          "email",
          "contactName",
          "mainCategory",
          "defaultPaymentTermDays",
          "registrationDate",
          "isActive",
          "notes"
        FROM "Supplier"
        ORDER BY "name" ASC
      `;
  response.json(suppliers);
});

supplierRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome do fornecedor e obrigatorio." });
    return;
  }
  const externalCode = await nextSupplierCode();
  const [supplier] = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Supplier" (
      "id", "externalCode", "document", "name", "normalizedName", "phone", "email", "contactName",
      "mainCategory", "defaultPaymentTermDays", "notes", "isActive", "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()}, ${externalCode}, ${request.body.document || null}, ${name}, ${normalizeText(name)},
      ${request.body.phone || null}, ${request.body.email || null}, ${request.body.contactName || null},
      ${request.body.mainCategory || null},
      ${request.body.defaultPaymentTermDays === "" || request.body.defaultPaymentTermDays == null ? null : Number(request.body.defaultPaymentTermDays)},
      ${request.body.notes || null}, ${request.body.isActive ?? true}, CURRENT_TIMESTAMP
    )
    RETURNING "id"
  `;
  const registrationDate = parseDate(request.body.registrationDate);
  await prisma.$executeRaw`
    UPDATE "Supplier"
    SET "registrationDate" = ${registrationDate}
    WHERE "id" = ${supplier.id}
  `;
  const created = await findSupplierRow(supplier.id);
  await auditLog({
    userId: user.id,
    action: "CREATE_SUPPLIER",
    entity: "Supplier",
    entityId: supplier.id,
    newValue: created,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(201).json(created);
});

supplierRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await findSupplierRow(request.params.id);
  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome do fornecedor e obrigatorio." });
    return;
  }
  if (!previous) {
    response.status(404).json({ message: "Fornecedor nao encontrado." });
    return;
  }
  if (request.body.externalCode && request.body.externalCode !== previous.externalCode) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_SUPPLIER_CODE_CHANGE",
      entity: "Supplier",
      entityId: request.params.id,
      previousValue: { externalCode: previous.externalCode },
      newValue: { attemptedExternalCode: request.body.externalCode },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
  }
  const [supplier] = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Supplier"
    SET
      "externalCode" = ${previous.externalCode},
      "document" = ${request.body.document || null},
      "name" = ${name},
      "normalizedName" = ${normalizeText(name)},
      "phone" = ${request.body.phone || null},
      "email" = ${request.body.email || null},
      "contactName" = ${request.body.contactName || null},
      "mainCategory" = ${request.body.mainCategory || null},
      "defaultPaymentTermDays" = ${request.body.defaultPaymentTermDays === "" || request.body.defaultPaymentTermDays == null ? null : Number(request.body.defaultPaymentTermDays)},
      "notes" = ${request.body.notes || null},
      "isActive" = ${request.body.isActive ?? true},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
    RETURNING "id"
  `;

  const registrationDate = parseDate(request.body.registrationDate);
  await prisma.$executeRaw`
    UPDATE "Supplier"
    SET "registrationDate" = ${registrationDate}
    WHERE "id" = ${supplier.id}
  `;

  const updated = await findSupplierRow(supplier.id);
  await auditLog({
    userId: user.id,
    action: "UPDATE_SUPPLIER",
    entity: "Supplier",
    entityId: supplier.id,
    previousValue: previous,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(updated);
});

supplierRouter.patch("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await findSupplierRow(request.params.id);
  const supplier = await prisma.supplier.update({
    where: { id: request.params.id },
    data: { isActive: Boolean(request.body.isActive) }
  });
  await auditLog({
    userId: user.id,
    action: Boolean(request.body.isActive) ? "REACTIVATE_SUPPLIER" : "INACTIVATE_SUPPLIER",
    entity: "Supplier",
    entityId: supplier.id,
    previousValue: previous,
    newValue: supplier,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(supplier);
});

supplierRouter.get("/:id/history", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const now = new Date();
  const year = request.query.year ? Number(request.query.year) : now.getFullYear();
  const month = request.query.month ? Number(request.query.month) : now.getMonth() + 1;
  const startMonth = new Date(year, month - 1, 1);
  const endMonth = new Date(year, month, 1);
  const startYear = new Date(year, 0, 1);
  const endYear = new Date(year + 1, 0, 1);

  const [monthTotal, yearTotal, lastPurchase, recentInvoices, topProducts, paymentMethods, averageTerm] = await Promise.all([
    prisma.$queryRaw<Array<{ total: string | null }>>`
      SELECT SUM("totalAmount")::text AS "total" FROM "Purchase"
      WHERE "supplierId" = ${request.params.id} AND "purchaseDate" >= ${startMonth} AND "purchaseDate" < ${endMonth} AND "status" <> 'CANCELLED'
    `,
    prisma.$queryRaw<Array<{ total: string | null }>>`
      SELECT SUM("totalAmount")::text AS "total" FROM "Purchase"
      WHERE "supplierId" = ${request.params.id} AND "purchaseDate" >= ${startYear} AND "purchaseDate" < ${endYear} AND "status" <> 'CANCELLED'
    `,
    prisma.purchase.findFirst({ where: { supplierId: request.params.id }, orderBy: { purchaseDate: "desc" } }),
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "purchaseNumber", "invoiceNumber", "purchaseDate", "totalAmount"::text AS "totalAmount", "status"
      FROM "Purchase"
      WHERE "supplierId" = ${request.params.id}
      ORDER BY "purchaseDate" DESC
      LIMIT 10
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT p."name", SUM(i."quantity")::text AS "quantity", SUM(i."totalPrice")::text AS "total"
      FROM "PurchaseItem" i
      JOIN "Purchase" pu ON pu."id" = i."purchaseId"
      JOIN "Product" p ON p."id" = i."productId"
      WHERE pu."supplierId" = ${request.params.id} AND pu."status" <> 'CANCELLED'
      GROUP BY p."name"
      ORDER BY SUM(i."totalPrice") DESC
      LIMIT 10
    `,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COALESCE("paymentMethod", 'Sem pagamento') AS "name", COUNT(*)::int AS "count"
      FROM "Purchase"
      WHERE "supplierId" = ${request.params.id}
      GROUP BY COALESCE("paymentMethod", 'Sem pagamento')
      ORDER BY COUNT(*) DESC
    `,
    prisma.$queryRaw<Array<{ days: string | null }>>`
      SELECT AVG(EXTRACT(DAY FROM pi."dueDate" - pu."purchaseDate"))::text AS "days"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" pu ON pu."id" = pi."purchaseId"
      WHERE pu."supplierId" = ${request.params.id} AND pi."dueDate" IS NOT NULL
    `
  ]);

  response.json({
    monthTotal: Number(monthTotal[0]?.total ?? 0),
    yearTotal: Number(yearTotal[0]?.total ?? 0),
    lastPurchase,
    recentInvoices,
    topProducts,
    paymentMethods,
    averagePaymentTermDays: averageTerm[0]?.days ? Number(averageTerm[0].days) : null
  });
});
