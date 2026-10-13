import { Prisma } from "@prisma/client";
import type { ClienteDoBanco, DetalheDoPrato } from "./dish-detail.js";

export type AcaoDaRevisao = "CRIADA" | "ALTERADA" | "INATIVADA" | "REATIVADA";

/**
 * O que a versão guarda. Fica em JSON de propósito: a ficha de hoje e a de ontem apontam para os
 * mesmos produtos, mas o custo, o nome e a categoria mudam — a foto do momento é o que vale no histórico.
 */
const itemDoSnapshot = (item: DetalheDoPrato["items"][number]) => ({
  productId: item.productId,
  productName: item.productName,
  quantity: item.quantity,
  unit: item.unit,
  wasteFactor: item.wasteFactor,
  itemCost: item.itemCost
});

export function montarSnapshot(detalhe: DetalheDoPrato) {
  return {
    name: detalhe.name,
    code: detalhe.code,
    menu: detalhe.menu,
    category: detalhe.category ? { id: detalhe.category.id, name: detalhe.category.name, parentName: detalhe.category.parentName } : null,
    alsoMenu: detalhe.alsoMenu,
    alsoCategory: detalhe.alsoCategory
      ? { id: detalhe.alsoCategory.id, name: detalhe.alsoCategory.name, parentName: detalhe.alsoCategory.parentName }
      : null,
    salePriceDefault: detalhe.salePriceDefault,
    yieldQty: detalhe.yieldQty,
    yieldUnit: detalhe.yieldUnit,
    notes: detalhe.notes,
    isActive: detalhe.isActive,
    // Preço em cada loja no momento: o histórico mostra quando o preço de uma loja mudou.
    canais: detalhe.listings
      .filter((listagem) => listagem.isActive)
      .map((listagem) => ({ canal: listagem.channel, loja: listagem.storeName, preco: listagem.price })),
    custoPorcao: detalhe.custoPorcao,
    cmvPercentual: detalhe.cmvPercentual,
    custoIncompleto: detalhe.custoIncompleto,
    items: detalhe.items.map(itemDoSnapshot),
    // Vendido nos dois: as quantidades do delivery e o custo por porção delas.
    alsoItems: detalhe.alsoItems.map(itemDoSnapshot),
    alsoCustoPorcao: detalhe.alsoItems.length > 0 ? detalhe.alsoCusto.custoPorcao : null
  };
}

export async function registrarRevisao(
  client: ClienteDoBanco,
  entrada: { detalhe: DetalheDoPrato; action: AcaoDaRevisao; user: { id: string; name?: string | null } }
) {
  const { detalhe, action, user } = entrada;
  await client.dishRevision.create({
    data: {
      dishId: detalhe.id,
      action,
      userId: user.id,
      userName: user.name ?? null,
      snapshot: montarSnapshot(detalhe) as Prisma.InputJsonValue,
      costPerServing: detalhe.custoPorcao,
      salePrice: detalhe.salePriceDefault,
      cmvPercent: detalhe.cmvPercentual
    }
  });
}
