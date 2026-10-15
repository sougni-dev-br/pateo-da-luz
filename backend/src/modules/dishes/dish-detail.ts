import { calculateDishCost } from "./dish-cost.js";
import { anexarFichas } from "./dish-fichas-de-producao.js";
import {
  conversoesDaFicha,
  separarItensPorCardapio,
  textoDaEmbalagemInferida,
  toCostItem,
  type ClienteDoBanco,
  type ItemComProduto,
  type ProdutoParaConversao
} from "./dish-itens.js";

// O que o cálculo precisa de cada ingrediente vive em dish-itens (sem importação circular com a ficha de produção);
// reexportado aqui para quem já importava deste arquivo.
export { conversoesDaFicha, separarItensPorCardapio, textoDaEmbalagemInferida, toCostItem };
export type { ClienteDoBanco, ItemComProduto, ProdutoParaConversao };

/** Preço lançado à mão no ERP (iFood, Keeta, loja ainda não importada), em vez de vindo do cardápio da plataforma. */
export const PREFIXO_MANUAL = "manual:";
export const ehListagemManual = (externalItemId: string) => externalItemId.startsWith(PREFIXO_MANUAL);

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
      alsoCategory: { include: { parent: { select: { id: true, name: true } } } },
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

  // Ingrediente pode ser um produto comprado ou outra ficha (de produção): as duas coisas entram no cálculo como "produto".
  const itensDaFicha = await anexarFichas(client, dish.items);
  const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;
  // A quantidade do a la carte nao e a do delivery: cada cardapio tem a sua lista, e o custo de cada um sai da propria.
  const { principais, doOutro } = separarItensPorCardapio({ menu: dish.menu, alsoMenu: dish.alsoMenu, items: itensDaFicha });
  const custo = calculateDishCost({
    yieldQty: Number(dish.yieldQty),
    salePrice,
    items: principais.map((item) => toCostItem(item))
  });
  const custoDoOutro = calculateDishCost({
    yieldQty: Number(dish.yieldQty),
    salePrice: null,
    items: doOutro.map((item) => toCostItem(item))
  });

  const mapear = (lista: typeof itensDaFicha, calculo: typeof custo) => lista.map((item, index) => {
    const calculado = calculo.items[index];
    return {
      id: item.id,
      productId: item.productId,
      // Preenchido quando o ingrediente é outra ficha (de produção) em vez de um produto comprado.
      componentDishId: item.componentDishId,
      productCode: item.product.externalCode ?? null,
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
  const items = mapear(principais, custo);
  const alsoItems = mapear(doOutro, custoDoOutro);

  return {
    id: dish.id,
    code: dish.code,
    name: dish.name,
    menu: dish.menu,
    category: categoriaResumida(dish.category),
    alsoMenu: dish.alsoMenu,
    alsoCategory: categoriaResumida(dish.alsoCategory),
    salePriceDefault: salePrice,
    yieldQty: Number(dish.yieldQty),
    yieldUnit: dish.yieldUnit,
    portionWeightG: dish.portionWeightG == null ? null : Number(dish.portionWeightG),
    shelfLifeDays: dish.shelfLifeDays,
    notes: dish.notes,
    isActive: dish.isActive,
    // Preparação do buffet criada pelo desperdício: inativa por desenho (não é vendida), mas se edita e, pendente, aguarda a ficha.
    fichaDeBuffet: dish.fichaDeBuffet,
    fichaPendente: dish.fichaPendente,
    fichaDeProducao: dish.fichaDeProducao,
    // Conferência pela cozinha: nula = ainda não conferida.
    conferidaEm: dish.fichaConferidaEm,
    conferidaPorId: dish.fichaConferidaPorId,
    calculatedCost: custo.totalCost,
    custoPorcao: custo.costPerServing,
    margemBruta: custo.margemBruta,
    cmvPercentual: custo.cmvPercentual,
    custoIncompleto: custo.hasUnresolvedUnit || custo.hasMissingCost,
    items,
    // Prato vendido nos dois cardapios: as quantidades do outro cardapio (o delivery) e o custo delas.
    alsoItems,
    alsoCusto: {
      calculatedCost: custoDoOutro.totalCost,
      custoPorcao: custoDoOutro.costPerServing,
      custoIncompleto: custoDoOutro.hasUnresolvedUnit || custoDoOutro.hasMissingCost,
      itemsCount: doOutro.length
    },
    // Onde o prato e vendido e por quanto (hoje so o cardapio da 99). O preco de
    // venda padrao da ficha nao substitui isto: varia por loja.
    listings: dish.listings.map((listing) => ({
      id: listing.id,
      channel: listing.channel,
      deliveryStoreId: listing.deliveryStoreId,
      storeName: listing.deliveryStore?.nickname ?? null,
      // Lançado à mão aqui (iFood, Keeta, loja ainda não importada); o resto vem do cardápio da plataforma.
      manual: ehListagemManual(listing.externalItemId),
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
