import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateDishCost, type CostItemInput } from "./dish-cost.js";
import { conversoesDoProduto, embalagemDoNome, normalizarUnidade } from "../../shared/unidades/conversao.js";

/** Cliente do Prisma ou o de dentro de uma transacao: a mesma leitura serve aos dois. */
export type ClienteDoBanco = Prisma.TransactionClient | PrismaClient;

export type ItemComProduto = {
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
 * O custo medio do estoque e expresso em "stockUnit" quando ele existe; caindo
 * para "unit" quando o produto ainda nao tem unidade de estoque definida.
 */
export type ProdutoParaConversao = ItemComProduto["product"];

/**
 * Conversoes que valem na ficha: as cadastradas no produto mais, quando o estoque conta em
 * UN/pacote/caixa, o peso ou volume lido do NOME ("FARINHA TRIGO 5KG"). Assim a receita
 * pode ser lancada em g/ml. A mesma lista vai para a tela (previa de custo) e para o calculo.
 */
export function conversoesDaFicha(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions">) {
  const cadastradas = produto.conversions.map((c) => ({
    fromUnit: c.fromUnit,
    toUnit: c.toUnit,
    factor: Number(c.factor)
  }));
  return conversoesDoProduto(produto.name, produto.stockUnit || produto.unit, cadastradas);
}

/** "1 UN = 5 KG (lido do nome)" quando a conversao e inferida; null quando nao ha. */
export function textoDaEmbalagemInferida(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions">): string | null {
  const conversoes = conversoesDaFicha(produto);
  if (!conversoes.some((c) => c.inferida)) return null;
  const embalagem = embalagemDoNome(produto.name);
  const base = normalizarUnidade(produto.stockUnit || produto.unit);
  return embalagem ? `1 ${base} = ${embalagem.quantidade.toLocaleString("pt-BR")} ${embalagem.unidade} (lido do nome do produto)` : null;
}

export function toCostItem(item: ItemComProduto): CostItemInput {
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


/** Categoria como a tela precisa: com o nome da de cima, para mostrar "Massas › Fresca". */
export function categoriaResumida(
  categoria: { id: string; name: string; parentId: string | null; menu?: string; parent?: { id: string; name: string } | null } | null
) {
  if (!categoria) return null;
  return {
    id: categoria.id,
    name: categoria.name,
    parentId: categoria.parentId,
    parentName: categoria.parent?.name ?? null,
    menu: categoria.menu ?? null
  };
}

/** Prato completo, com custo calculado, ingredientes e onde e vendido; null se nao existir. */
export async function carregarDetalhe(client: ClienteDoBanco, id: string) {
  const dish = await client.dish.findUnique({
    where: { id },
    include: {
      category: { include: { parent: { select: { id: true, name: true } } } },
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
  if (!dish) return null;

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

  return {
    id: dish.id,
    code: dish.code,
    name: dish.name,
    menu: dish.menu,
    category: categoriaResumida(dish.category),
    salePriceDefault: salePrice,
    yieldQty: Number(dish.yieldQty),
    yieldUnit: dish.yieldUnit,
    notes: dish.notes,
    isActive: dish.isActive,
    calculatedCost: custo.totalCost,
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
  };
}

export type DetalheDoPrato = NonNullable<Awaited<ReturnType<typeof carregarDetalhe>>>;
