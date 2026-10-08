import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { z } from "zod";
import { calculateDishCost, type CostItemInput } from "./dish-cost.js";
import { parseBody } from "../../shared/validate-body.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { conversoesDoProduto, embalagemDoNome, normalizarUnidade } from "../../shared/unidades/conversao.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";

export const dishesRouter = Router();

type ItemComProduto = {
  quantity: Prisma.Decimal | number;
  unit: string;
  wasteFactor: Prisma.Decimal | number;
  product: {
    name: string;
    unit: string | null;
    stockUnit?: string | null;
    inventoryStock: { averageCost: Prisma.Decimal | null } | null;
    conversions: Array<{ fromUnit: string; toUnit: string; factor: Prisma.Decimal | number }>;
  };
};

/**
 * Texto vazio e null viram "ausente"; string aparada e numero passam; qualquer outra coisa
 * (true, [], {}) vira NaN e e recusada. z.coerce sozinho transformava "  " em 0 e true em 1.
 */
const numeroOuAusente = (valor: unknown): unknown => {
  if (valor == null) return null;
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") return valor.trim() === "" ? null : valor.trim();
  return Number.NaN;
};

const precoOpcional = z.preprocess(
  numeroOuAusente,
  z.coerce.number({ invalid_type_error: "preco de venda invalido" }).min(0, "preco de venda nao pode ser negativo").max(99_999_999, "preco de venda alto demais").nullable()
);

const rendimento = z.preprocess(
  (valor) => numeroOuAusente(valor) ?? 1,
  z.coerce.number({ invalid_type_error: "rendimento invalido" }).gt(0, "rendimento deve ser maior que zero").max(99_999, "rendimento alto demais")
);

const textoOpcional = z.string().trim().nullish().transform((valor) => valor || null);

const dishItemsSchema = z.array(
  z.object({
    productId: z.string().trim().min(1, "produto obrigatorio"),
    quantity: z.coerce.number().positive("quantidade deve ser maior que zero"),
    unit: z.string().trim().min(1, "unidade obrigatoria"),
    wasteFactor: z.coerce.number().min(0, "perda nao pode ser negativa").max(1, "perda deve ser uma fracao entre 0 e 1").optional(),
    notes: z.string().trim().nullable().optional()
  })
);

const dishBodySchema = z.object({
  name: z.string({ required_error: "Nome do prato é obrigatório." }).trim().min(1, "Nome do prato é obrigatório."),
  code: textoOpcional,
  categoryId: textoOpcional,
  salePriceDefault: precoOpcional,
  yieldQty: rendimento,
  yieldUnit: z.string().trim().nullish().transform((valor) => valor || "UN"),
  notes: textoOpcional,
  isActive: z.boolean().optional(),
  items: dishItemsSchema.optional()
});

const ehCodigoDuplicado = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const ehRegistroInexistente = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

/** Chave estrangeira: categoria ou produto apagado depois que a tela carregou. */
const ehReferenciaInvalida = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

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
type ProdutoParaConversao = ItemComProduto["product"];

/**
 * Conversoes que valem na ficha: as cadastradas no produto mais, quando o estoque conta em
 * UN/pacote/caixa, o peso ou volume lido do NOME ("FARINHA TRIGO 5KG"). Assim a receita
 * pode ser lancada em g/ml. A mesma lista vai para a tela (previa de custo) e para o calculo.
 */
function conversoesDaFicha(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions">) {
  const cadastradas = produto.conversions.map((c) => ({
    fromUnit: c.fromUnit,
    toUnit: c.toUnit,
    factor: Number(c.factor)
  }));
  return conversoesDoProduto(produto.name, produto.stockUnit || produto.unit, cadastradas);
}

/** "1 UN = 5 KG (lido do nome)" quando a conversao e inferida; null quando nao ha. */
function textoDaEmbalagemInferida(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions">): string | null {
  const conversoes = conversoesDaFicha(produto);
  if (!conversoes.some((c) => c.inferida)) return null;
  const embalagem = embalagemDoNome(produto.name);
  const base = normalizarUnidade(produto.stockUnit || produto.unit);
  return embalagem ? `1 ${base} = ${embalagem.quantidade.toLocaleString("pt-BR")} ${embalagem.unidade} (lido do nome do produto)` : null;
}

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
      conversions: conversoesDaFicha(item.product)
    }
  };
}

type ItemValidado = z.infer<typeof dishItemsSchema>[number];

function itemParaGravar(dishId: string, item: ItemValidado, index: number) {
  return {
    id: crypto.randomUUID(),
    dishId,
    productId: item.productId,
    quantity: item.quantity,
    unit: item.unit,
    wasteFactor: item.wasteFactor ?? 0,
    notes: item.notes || null,
    sortOrder: index
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
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { dishes: { where: { isActive: true } } } } }
  });
  response.json(rows.map(({ _count, ...category }) => ({ ...category, dishesCount: _count.dishes })));
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
      listings: { where: { isActive: true }, select: { price: true } },
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
    const precosNosCanais = dish.listings.map((listing) => Number(listing.price));

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
      listingsCount: precosNosCanais.length,
      listingPriceMin: precosNosCanais.length ? Math.min(...precosNosCanais) : null,
      listingPriceMax: precosNosCanais.length ? Math.max(...precosNosCanais) : null,
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
      listings: {
        include: { deliveryStore: { select: { nickname: true, platform: true } } },
        orderBy: [{ isActive: "desc" }, { price: "asc" }]
      },
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
      conversions: conversoesDaFicha(item.product),
      embalagemInferida: textoDaEmbalagemInferida(item.product),
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
    // Onde o prato e vendido e por quanto (hoje so o cardapio da 99). O preco de
    // venda padrao da ficha nao substitui isto: varia por loja.
    listings: dish.listings.map((listing) => ({
      id: listing.id,
      channel: listing.channel,
      storeName: listing.deliveryStore?.nickname ?? null,
      externalName: listing.externalName,
      price: Number(listing.price),
      isActive: listing.isActive,
      lastSeenAt: listing.lastSeenAt
    })),
    createdAt: dish.createdAt,
    updatedAt: dish.updatedAt
  });
});

/**
 * Erro de negocio conhecido (codigo repetido, prato inexistente) vira resposta
 * legivel; o resto continua sendo 500 para nao esconder falha de verdade.
 */
function responderErroDeGravacao(error: unknown, codigo: string | null, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (ehCodigoDuplicado(error)) {
    response.status(409).json({ message: `Já existe um prato com o código "${codigo ?? ""}".` });
    return true;
  }
  if (ehRegistroInexistente(error)) {
    response.status(404).json({ message: "Prato não encontrado." });
    return true;
  }
  if (ehReferenciaInvalida(error)) {
    response.status(400).json({ message: "A categoria ou um dos produtos da ficha não existe mais. Recarregue a tela e tente de novo." });
    return true;
  }
  return false;
}

dishesRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  // Tudo e validado antes de gravar: antes, o prato era criado e so depois os
  // ingredientes eram conferidos, deixando um prato vazio quando algum falhava.
  const body = parseBody(dishBodySchema, request.body, response);
  if (!body) return;

  const items = body.items ?? [];
  const invalido = await primeiroProdutoInvalido(items);
  if (invalido) {
    response.status(400).json({ message: invalido });
    return;
  }

  const id = crypto.randomUUID();
  try {
    const dish = await prisma.$transaction(async (tx) => {
      const created = await tx.dish.create({
        data: {
          id,
          name: body.name,
          code: body.code,
          categoryId: body.categoryId,
          salePriceDefault: body.salePriceDefault,
          yieldQty: body.yieldQty,
          yieldUnit: body.yieldUnit,
          notes: body.notes
        }
      });

      if (items.length > 0) {
        await tx.dishItem.createMany({ data: items.map((item, index) => itemParaGravar(id, item, index)) });
      }
      return created;
    });

    await auditLog({ userId: user.id, action: "CREATE", entity: "Dish", entityId: dish.id, newValue: dish });
    response.json({ id: dish.id });
  } catch (error) {
    if (!responderErroDeGravacao(error, body.code, response)) throw error;
  }
});

dishesRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const body = parseBody(dishBodySchema, request.body, response);
  if (!body) return;

  const invalido = body.items ? await primeiroProdutoInvalido(body.items) : null;
  if (invalido) {
    response.status(400).json({ message: invalido });
    return;
  }

  const id = request.params.id;
  try {
    // Prato e ingredientes na mesma transacao: o delete seguido de create sem
    // transacao deixava a ficha permanentemente sem ingredientes se o create
    // falhasse no meio.
    const [dish] = await prisma.$transaction([
      prisma.dish.update({
        where: { id },
        data: {
          name: body.name,
          code: body.code,
          categoryId: body.categoryId,
          salePriceDefault: body.salePriceDefault,
          yieldQty: body.yieldQty,
          yieldUnit: body.yieldUnit,
          notes: body.notes,
          isActive: body.isActive !== false
        }
      }),
      ...(body.items
        ? [
            prisma.dishItem.deleteMany({ where: { dishId: id } }),
            ...(body.items.length > 0
              ? [prisma.dishItem.createMany({ data: body.items.map((item, index) => itemParaGravar(id, item, index)) })]
              : [])
          ]
        : [])
    ]);

    await auditLog({ userId: user.id, action: "UPDATE", entity: "Dish", entityId: dish.id, newValue: dish });
    response.json({ id: dish.id });
  } catch (error) {
    if (!responderErroDeGravacao(error, body.code, response)) throw error;
  }
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
    conversions: conversoesDaFicha(p),
    embalagemInferida: textoDaEmbalagemInferida(p)
  })));
});

dishesRouter.delete("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  try {
    await prisma.dish.update({ where: { id: request.params.id }, data: { isActive: false } });
  } catch (error) {
    if (responderErroDeGravacao(error, null, response)) return;
    throw error;
  }

  await auditLog({ userId: user.id, action: "DELETE", entity: "Dish", entityId: request.params.id });
  response.json({ ok: true });
});

// Inativar nao era reversivel pela tela: o prato so aparecia com "mostrar inativos"
// e nao havia como voltar.
dishesRouter.post("/:id/reactivate", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  try {
    await prisma.dish.update({ where: { id: request.params.id }, data: { isActive: true } });
  } catch (error) {
    if (responderErroDeGravacao(error, null, response)) return;
    throw error;
  }

  await auditLog({ userId: user.id, action: "REACTIVATE", entity: "Dish", entityId: request.params.id });
  response.json({ ok: true });
});
