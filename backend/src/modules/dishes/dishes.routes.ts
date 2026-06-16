import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";

export const dishesRouter = Router();

dishesRouter.use(async (request, response, next) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  next();
});

// ──────────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────────

dishesRouter.get("/categories", async (_request, response) => {
  const rows = await prisma.dishCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(rows);
});

dishesRouter.post("/categories", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome da categoria é obrigatório." });
    return;
  }

  const existing = await prisma.dishCategory.findFirst({ where: { name } });
  if (existing) {
    response.status(400).json({ message: "Já existe uma categoria com este nome." });
    return;
  }

  const row = await prisma.dishCategory.create({
    data: {
      id: crypto.randomUUID(),
      name,
      sortOrder: Number(request.body.sortOrder ?? 0),
      notes: String(request.body.notes ?? "").trim() || null
    }
  });

  await auditLog({ userId: user.id, action: "CREATE", entity: "DishCategory", entityId: row.id, newValue: row });
  response.json(row);
});

dishesRouter.put("/categories/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome da categoria é obrigatório." });
    return;
  }

  const duplicate = await prisma.dishCategory.findFirst({ where: { name, NOT: { id: request.params.id } } });
  if (duplicate) {
    response.status(400).json({ message: "Já existe uma categoria com este nome." });
    return;
  }

  const row = await prisma.dishCategory.update({
    where: { id: request.params.id },
    data: {
      name,
      sortOrder: Number(request.body.sortOrder ?? 0),
      notes: String(request.body.notes ?? "").trim() || null,
      isActive: request.body.isActive !== false
    }
  });

  await auditLog({ userId: user.id, action: "UPDATE", entity: "DishCategory", entityId: row.id, newValue: row });
  response.json(row);
});

// ──────────────────────────────────────────────
// DISHES
// ──────────────────────────────────────────────

dishesRouter.get("/", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const categoryId = String(request.query.categoryId ?? "").trim() || undefined;
  const showInactive = String(request.query.showInactive ?? "") === "true";

  const dishes = await prisma.dish.findMany({
    where: {
      isActive: showInactive ? undefined : true,
      categoryId: categoryId || undefined,
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {})
    },
    include: {
      category: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              inventoryStock: { select: { averageCost: true } }
            }
          }
        },
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }]
  });

  const result = dishes.map((dish) => {
    const cost = dish.items.reduce((sum, item) => {
      const unitCost = Number(item.product.inventoryStock?.averageCost ?? 0);
      const qty = Number(item.quantity);
      const waste = Number(item.wasteFactor);
      return sum + qty * (1 + waste) * unitCost;
    }, 0);

    const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;
    const margemBruta = salePrice != null ? salePrice - cost : null;
    const cmvPercentual = salePrice != null && salePrice > 0 ? (cost / salePrice) * 100 : null;

    return {
      id: dish.id,
      code: dish.code,
      name: dish.name,
      category: dish.category,
      salePriceDefault: salePrice,
      yieldQty: Number(dish.yieldQty),
      yieldUnit: dish.yieldUnit,
      notes: dish.notes,
      isActive: dish.isActive,
      itemsCount: dish.items.length,
      calculatedCost: cost,
      margemBruta,
      cmvPercentual,
      createdAt: dish.createdAt,
      updatedAt: dish.updatedAt
    };
  });

  response.json(result);
});

dishesRouter.get("/:id", async (request, response) => {
  const dish = await prisma.dish.findUnique({
    where: { id: request.params.id },
    include: {
      category: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              externalCode: true,
              name: true,
              unit: true,
              inventoryStock: { select: { averageCost: true, currentQuantity: true } }
            }
          }
        },
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  if (!dish) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }

  const items = dish.items.map((item) => {
    const unitCost = Number(item.product.inventoryStock?.averageCost ?? 0);
    const qty = Number(item.quantity);
    const waste = Number(item.wasteFactor);
    const itemCost = qty * (1 + waste) * unitCost;

    return {
      id: item.id,
      productId: item.productId,
      productCode: item.product.externalCode,
      productName: item.product.name,
      productUnit: item.product.unit,
      quantity: qty,
      unit: item.unit,
      wasteFactor: waste,
      unitCost,
      itemCost,
      notes: item.notes,
      sortOrder: item.sortOrder
    };
  });

  const totalCost = items.reduce((sum, i) => sum + i.itemCost, 0);
  const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;

  response.json({
    id: dish.id,
    code: dish.code,
    name: dish.name,
    category: dish.category,
    salePriceDefault: salePrice,
    yieldQty: Number(dish.yieldQty),
    yieldUnit: dish.yieldUnit,
    notes: dish.notes,
    isActive: dish.isActive,
    calculatedCost: totalCost,
    margemBruta: salePrice != null ? salePrice - totalCost : null,
    cmvPercentual: salePrice != null && salePrice > 0 ? (totalCost / salePrice) * 100 : null,
    items,
    createdAt: dish.createdAt,
    updatedAt: dish.updatedAt
  });
});

dishesRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome do prato é obrigatório." });
    return;
  }

  const id = crypto.randomUUID();
  const dish = await prisma.dish.create({
    data: {
      id,
      name,
      code: String(request.body.code ?? "").trim() || null,
      categoryId: String(request.body.categoryId ?? "").trim() || null,
      salePriceDefault: request.body.salePriceDefault != null ? Number(request.body.salePriceDefault) : null,
      yieldQty: Number(request.body.yieldQty ?? 1),
      yieldUnit: String(request.body.yieldUnit ?? "UN").trim() || "UN",
      notes: String(request.body.notes ?? "").trim() || null
    }
  });

  if (Array.isArray(request.body.items) && request.body.items.length > 0) {
    await prisma.dishItem.createMany({
      data: request.body.items.map((item: Record<string, unknown>, index: number) => ({
        id: crypto.randomUUID(),
        dishId: id,
        productId: String(item.productId),
        quantity: Number(item.quantity),
        unit: String(item.unit ?? ""),
        wasteFactor: Number(item.wasteFactor ?? 0),
        notes: String(item.notes ?? "").trim() || null,
        sortOrder: index
      }))
    });
  }

  await auditLog({ userId: user.id, action: "CREATE", entity: "Dish", entityId: dish.id, newValue: dish });
  response.json({ id: dish.id });
});

dishesRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome do prato é obrigatório." });
    return;
  }

  const dish = await prisma.dish.update({
    where: { id: request.params.id },
    data: {
      name,
      code: String(request.body.code ?? "").trim() || null,
      categoryId: String(request.body.categoryId ?? "").trim() || null,
      salePriceDefault: request.body.salePriceDefault != null ? Number(request.body.salePriceDefault) : null,
      yieldQty: Number(request.body.yieldQty ?? 1),
      yieldUnit: String(request.body.yieldUnit ?? "UN").trim() || "UN",
      notes: String(request.body.notes ?? "").trim() || null,
      isActive: request.body.isActive !== false
    }
  });

  if (Array.isArray(request.body.items)) {
    await prisma.dishItem.deleteMany({ where: { dishId: request.params.id } });
    if (request.body.items.length > 0) {
      await prisma.dishItem.createMany({
        data: request.body.items.map((item: Record<string, unknown>, index: number) => ({
          id: crypto.randomUUID(),
          dishId: request.params.id,
          productId: String(item.productId),
          quantity: Number(item.quantity),
          unit: String(item.unit ?? ""),
          wasteFactor: Number(item.wasteFactor ?? 0),
          notes: String(item.notes ?? "").trim() || null,
          sortOrder: index
        }))
      });
    }
  }

  await auditLog({ userId: user.id, action: "UPDATE", entity: "Dish", entityId: dish.id, newValue: dish });
  response.json({ id: dish.id });
});

// Product search with average cost (for ingredient picker)
dishesRouter.get("/products/search", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {})
    },
    select: {
      id: true,
      externalCode: true,
      name: true,
      unit: true,
      inventoryStock: { select: { averageCost: true } }
    },
    orderBy: { name: "asc" },
    take: 20
  });

  response.json(products.map((p) => ({
    id: p.id,
    externalCode: p.externalCode,
    name: p.name,
    unit: p.unit,
    averageCost: Number(p.inventoryStock?.averageCost ?? 0)
  })));
});

dishesRouter.delete("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  await prisma.dish.update({
    where: { id: request.params.id },
    data: { isActive: false }
  });

  await auditLog({ userId: user.id, action: "DELETE", entity: "Dish", entityId: request.params.id });
  response.json({ ok: true });
});
