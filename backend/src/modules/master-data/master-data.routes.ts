import { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES, isOfficialSmallExpenseType } from "./small-expense-type-options.js";
import { inventorySectorOrder, isOfficialInventorySectorName, officialInventorySectorName } from "./inventory-sector-utils.js";

export const masterDataRouter = Router();

masterDataRouter.use(async (request, response, next) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  next();
});

masterDataRouter.get("/sectors", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const forStockCounting = String(request.query.forStockCounting ?? "").toLowerCase() === "true";
  const rows = await prisma.inventorySector.findMany({
    where: forStockCounting
      ? {
          products: {
            some: {
              isActive: true,
              controlsStock: true
            }
          }
        }
      : undefined,
    orderBy: [{ countOrder: "asc" }, { name: "asc" }]
  });

  const deduped = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const officialName = officialInventorySectorName(row.name);
    if (!officialName || !isOfficialInventorySectorName(row.normalizedName)) continue;
    if (search && !officialName.toLowerCase().includes(search.toLowerCase())) continue;
    const key = normalizeText(officialName);
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, {
        ...row,
        name: officialName,
        normalizedName: key
      });
      continue;
    }
    const currentIsCanonical = current.normalizedName === key;
    const rowIsCanonical = normalizeText(row.normalizedName) === key;
    if (!currentIsCanonical && rowIsCanonical) {
      deduped.set(key, { ...row, name: officialName, normalizedName: key });
    }
  }

  response.json(
    [...deduped.values()].sort((a, b) =>
      inventorySectorOrder(a.name) - inventorySectorOrder(b.name)
      || a.name.localeCompare(b.name)
    )
  );
});

masterDataRouter.post("/sectors", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome do setor obrigatorio." });
    return;
  }

  const [sector] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    INSERT INTO "InventorySector" (
      "id", "name", "normalizedName", "description", "countOrder", "isActive", "notes", "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()}, ${name}, ${normalizeText(name)}, ${request.body.description || null},
      ${Number(request.body.countOrder ?? 0)}, ${request.body.isActive ?? true}, ${request.body.notes || null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("normalizedName") DO UPDATE SET
      "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "countOrder" = EXCLUDED."countOrder",
      "isActive" = EXCLUDED."isActive",
      "notes" = EXCLUDED."notes",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;
  await auditLog({
    userId: user.id,
    action: "CREATE_INVENTORY_SECTOR",
    entity: "InventorySector",
    entityId: String(sector.id),
    newValue: sector,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json(sector);
});

masterDataRouter.put("/sectors/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventorySector" WHERE "id" = ${request.params.id}
  `;
  const [sector] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    UPDATE "InventorySector"
    SET
      "name" = ${name},
      "normalizedName" = ${normalizeText(name)},
      "description" = ${request.body.description || null},
      "countOrder" = ${Number(request.body.countOrder ?? 0)},
      "isActive" = ${request.body.isActive ?? true},
      "notes" = ${request.body.notes || null},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
    RETURNING *
  `;
  await auditLog({
    userId: user.id,
    action: "UPDATE_INVENTORY_SECTOR",
    entity: "InventorySector",
    entityId: request.params.id,
    previousValue: previous,
    newValue: sector,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json(sector);
});

masterDataRouter.patch("/sectors/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "InventorySector" WHERE "id" = ${request.params.id}
  `;
  const [sector] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    UPDATE "InventorySector"
    SET "isActive" = ${Boolean(request.body.isActive)}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
    RETURNING *
  `;
  await auditLog({
    userId: user.id,
    action: Boolean(request.body.isActive) ? "REACTIVATE_INVENTORY_SECTOR" : "INACTIVATE_INVENTORY_SECTOR",
    entity: "InventorySector",
    entityId: request.params.id,
    previousValue: previous,
    newValue: sector,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json(sector);
});

masterDataRouter.get("/categories", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.CategoryWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { mainGroup: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};
  response.json(await prisma.category.findMany({ where, orderBy: { name: "asc" } }));
});

masterDataRouter.post("/categories", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const item = await prisma.category.upsert({
    where: { name: String(request.body.name ?? "").trim() },
    create: {
      name: String(request.body.name ?? "").trim(),
      mainGroup: request.body.mainGroup || null,
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true
    },
    update: {
      mainGroup: request.body.mainGroup || null,
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true
    }
  });
  response.status(201).json(item);
});

masterDataRouter.put("/categories/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.category.update({
      where: { id: request.params.id },
      data: {
        name: String(request.body.name ?? "").trim(),
        mainGroup: request.body.mainGroup || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.patch("/categories/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.category.update({
      where: { id: request.params.id },
      data: { isActive: Boolean(request.body.isActive) }
    })
  );
});

masterDataRouter.get("/subcategories", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.SubcategoryWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { category: { name: { contains: search, mode: "insensitive" } } }
        ]
      }
    : {};
  response.json(
    await prisma.subcategory.findMany({ where, include: { category: true }, orderBy: { name: "asc" } })
  );
});

masterDataRouter.post("/subcategories", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  const categoryId = String(request.body.categoryId ?? "");
  response.status(201).json(
    await prisma.subcategory.upsert({
      where: { categoryId_name: { categoryId, name } },
      create: { name, categoryId, notes: request.body.notes || null, isActive: request.body.isActive ?? true },
      update: { notes: request.body.notes || null, isActive: request.body.isActive ?? true },
      include: { category: true }
    })
  );
});

masterDataRouter.put("/subcategories/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.subcategory.update({
      where: { id: request.params.id },
      data: {
        name: String(request.body.name ?? "").trim(),
        categoryId: String(request.body.categoryId ?? ""),
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      },
      include: { category: true }
    })
  );
});

masterDataRouter.patch("/subcategories/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.subcategory.update({
      where: { id: request.params.id },
      data: { isActive: Boolean(request.body.isActive) },
      include: { category: true }
    })
  );
});

masterDataRouter.get("/units", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.UnitMeasureWhereInput = search
    ? {
        OR: [
          { code: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { type: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};
  response.json(await prisma.unitMeasure.findMany({ where, orderBy: { code: "asc" } }));
});

masterDataRouter.post("/units", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const code = String(request.body.code ?? "").trim().toUpperCase();
  response.status(201).json(
    await prisma.unitMeasure.upsert({
      where: { code },
      create: {
        code,
        name: String(request.body.name ?? "").trim(),
        type: request.body.type || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      },
      update: {
        name: String(request.body.name ?? "").trim(),
        type: request.body.type || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.put("/units/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.unitMeasure.update({
      where: { id: request.params.id },
      data: {
        code: String(request.body.code ?? "").trim().toUpperCase(),
        name: String(request.body.name ?? "").trim(),
        type: request.body.type || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.patch("/units/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.unitMeasure.update({
      where: { id: request.params.id },
      data: { isActive: Boolean(request.body.isActive) }
    })
  );
});

masterDataRouter.get("/expense-types", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.ExpenseTypeMasterWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { group: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};
  response.json(await prisma.expenseTypeMaster.findMany({ where, orderBy: { name: "asc" } }));
});

masterDataRouter.post("/expense-types", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  response.status(201).json(
    await prisma.expenseTypeMaster.upsert({
      where: { normalizedName: normalizeText(name) },
      create: {
        name,
        normalizedName: normalizeText(name),
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      },
      update: {
        name,
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.put("/expense-types/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  response.json(
    await prisma.expenseTypeMaster.update({
      where: { id: request.params.id },
      data: {
        name,
        normalizedName: normalizeText(name),
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.patch("/expense-types/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  response.json(
    await prisma.expenseTypeMaster.update({
      where: { id: request.params.id },
      data: { isActive: Boolean(request.body.isActive) }
    })
  );
});

masterDataRouter.get("/small-expense-types", async (request, response) => {
  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.SmallExpenseTypeWhereInput = search
    ? {
        normalizedName: { in: OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES },
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { normalizedName: { contains: normalizeText(search), mode: "insensitive" } },
          { group: { contains: search, mode: "insensitive" } }
        ]
      }
    : { normalizedName: { in: OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES } };

  const rows = await prisma.smallExpenseType.findMany({ where });
  const order = new Map(OFFICIAL_SMALL_EXPENSE_NORMALIZED_TYPES.map((name, index) => [name, index]));
  response.json(rows.sort((a, b) => (order.get(a.normalizedName) ?? 999) - (order.get(b.normalizedName) ?? 999)));
});

masterDataRouter.post("/small-expense-types", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!isOfficialSmallExpenseType(name)) {
    response.status(400).json({ message: "Tipo de pequeno gasto fora da lista oficial." });
    return;
  }
  response.status(201).json(
    await prisma.smallExpenseType.upsert({
      where: { normalizedName: normalizeText(name) },
      create: {
        name,
        normalizedName: normalizeText(name),
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      },
      update: {
        name,
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.put("/small-expense-types/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!isOfficialSmallExpenseType(name)) {
    response.status(400).json({ message: "Tipo de pequeno gasto fora da lista oficial." });
    return;
  }
  response.json(
    await prisma.smallExpenseType.update({
      where: { id: request.params.id },
      data: {
        name,
        normalizedName: normalizeText(name),
        group: request.body.group || null,
        notes: request.body.notes || null,
        isActive: request.body.isActive ?? true
      }
    })
  );
});

masterDataRouter.patch("/small-expense-types/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const current = await prisma.smallExpenseType.findUnique({ where: { id: request.params.id } });
  if (current && isOfficialSmallExpenseType(current.name) && request.body.isActive === false) {
    response.status(400).json({ message: "Tipos oficiais de pequeno gasto devem permanecer ativos." });
    return;
  }

  response.json(
    await prisma.smallExpenseType.update({
      where: { id: request.params.id },
      data: { isActive: Boolean(request.body.isActive) }
    })
  );
});
