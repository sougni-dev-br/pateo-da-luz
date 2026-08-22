import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { z } from "zod";
import { calculateDishCost, type CostItemInput } from "./dish-cost.js";
import { parseBody } from "../../shared/validate-body.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";

export const dishesRouter = Router();

type ItemComProduto = {
  quantity: Prisma.Decimal | number;
  unit: string;
  wasteFactor: Prisma.Decimal | number;
  product: {
    unit: string | null;
    stockUnit?: string | null;
    inventoryStock: { averageCost: Prisma.Decimal | null } | null;
    conversions: Array<{ fromUnit: string; toUnit: string; factor: Prisma.Decimal | number }>;
  };
};

const dishItemsSchema = z.array(
  z.object({
    productId: z.string().trim().min(1, "produto obrigatorio"),
    quantity: z.coerce.number().positive("quantidade deve ser maior que zero"),
    unit: z.string().trim().min(1, "unidade obrigatoria"),
    wasteFactor: z.coerce.number().min(0, "perda nao pode ser negativa").max(1, "perda deve ser uma fracao entre 0 e 1").optional(),
    notes: z.string().trim().nullable().optional()
  })
);

/**
 * Number(item.quantity) virava NaN em silencio e productId inexistente so
 * aparecia como erro de chave estrangeira depois do delete dos itens antigos.
 */
async function primeiroProdutoInvalido(items: Array<{ productId: string }>) {
  const ids = [...new Set(items.map((item) => item.productId))];
  if (ids.length === 0) return null;

  const encontrados = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const existe = new Set(encontrados.map((p) => p.id));
  const ausente = ids.find((id) => !existe.has(id));
  return ausente ? `Produto do ingrediente nao encontrado: ${ausente}` : null;
}

/**
 * O custo medio do estoque e expresso em "stockUnit" quando ele existe; caindo
 * para "unit" quando o produto ainda nao tem unidade de estoque definida.
 */
function toCostItem(item: ItemComProduto): CostItemInput {
  return {
    quantity: Number(item.quantity),
    unit: item.unit,
    wasteFactor: Number(item.wasteFactor),
    product: {
      unit: item.product.stockUnit || item.product.unit,
      averageCost: item.product.inventoryStock?.averageCost == null
        ? null
        : Number(item.product.inventoryStock.averageCost),
      conversions: item.product.conversions.map((c) => ({
        fromUnit: c.fromUnit,
        toUnit: c.toUnit,
        factor: Number(c.factor)
      }))
    }
  };
}

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
              stockUnit: true,
              inventoryStock: { select: { averageCost: true } },
              conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
            }
          }
        },
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }]
  });

  const result = dishes.map((dish) => {
    const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;
    const custo = calculateDishCost({
      yieldQty: Number(dish.yieldQty),
      salePrice,
      items: dish.items.map((item) => toCostItem(item))
    });
    const cost = custo.totalCost;
    const margemBruta = custo.margemBruta;
    const cmvPercentual = custo.cmvPercentual;

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
      custoPorcao: custo.costPerServing,
      margemBruta,
      cmvPercentual,
      custoIncompleto: custo.hasUnresolvedUnit || custo.hasMissingCost,
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
              stockUnit: true,
              inventoryStock: { select: { averageCost: true, currentQuantity: true } },
              conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
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

  const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;
  const custo = calculateDishCost({
    yieldQty: Number(dish.yieldQty),
    salePrice,
    items: dish.items.map((item) => toCostItem(item))
  });

  const items = dish.items.map((item, index) => {
    const calculado = custo.items[index];
    return {
      id: item.id,
      productId: item.productId,
      productCode: item.product.externalCode,
      productName: item.product.name,
      productUnit: item.product.stockUnit || item.product.unit,
      quantity: Number(item.quantity),
      unit: item.unit,
      wasteFactor: Number(item.wasteFactor),
      unitCost: calculado.unitCost,
      unitFactor: calculado.unitFactor,
      itemCost: calculado.itemCost,
      issue: calculado.issue,
      // A tela reprevê o custo enquanto se edita a quantidade, entao precisa
      // das conversoes do produto junto do item.
      conversions: item.product.conversions.map((c) => ({
        fromUnit: c.fromUnit,
        toUnit: c.toUnit,
        factor: Number(c.factor)
      })),
      notes: item.notes,
      sortOrder: item.sortOrder
    };
  });

  const totalCost = custo.totalCost;

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
    custoPorcao: custo.costPerServing,
    margemBruta: custo.margemBruta,
    cmvPercentual: custo.cmvPercentual,
    custoIncompleto: custo.hasUnresolvedUnit || custo.hasMissingCost,
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
    const items = parseBody(dishItemsSchema, request.body.items, response);
    if (!items) return;

    const invalido = await primeiroProdutoInvalido(items);
    if (invalido) {
      response.status(400).json({ message: invalido });
      return;
    }

    await prisma.dishItem.createMany({
      data: items.map((item, index) => ({
        id: crypto.randomUUID(),
        dishId: id,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        wasteFactor: item.wasteFactor ?? 0,
        notes: item.notes || null,
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
    const items = parseBody(dishItemsSchema, request.body.items, response);
    if (!items) return;

    const invalido = await primeiroProdutoInvalido(items);
    if (invalido) {
      response.status(400).json({ message: invalido });
      return;
    }

    // Em transacao: o delete seguido de create sem transacao deixava a ficha
    // permanentemente sem ingredientes se o create falhasse no meio.
    await prisma.$transaction([
      prisma.dishItem.deleteMany({ where: { dishId: request.params.id } }),
      ...(items.length > 0
        ? [
            prisma.dishItem.createMany({
              data: items.map((item, index) => ({
                id: crypto.randomUUID(),
                dishId: request.params.id,
                productId: item.productId,
                quantity: item.quantity,
                unit: item.unit,
                wasteFactor: item.wasteFactor ?? 0,
                notes: item.notes || null,
                sortOrder: index
              }))
            })
          ]
        : [])
    ]);
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
      stockUnit: true,
      inventoryStock: { select: { averageCost: true } },
      conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
    },
    orderBy: { name: "asc" },
    take: 20
  });

  // stockUnit e conversions vao junto para a tela conseguir prever o custo do
  // ingrediente antes de salvar. O calculo que vale continua sendo o do
  // backend, em dish-cost.ts.
  response.json(products.map((p) => ({
    id: p.id,
    externalCode: p.externalCode,
    name: p.name,
    unit: p.stockUnit || p.unit,
    averageCost: Number(p.inventoryStock?.averageCost ?? 0),
    conversions: p.conversions.map((c) => ({
      fromUnit: c.fromUnit,
      toUnit: c.toUnit,
      factor: Number(c.factor)
    }))
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
