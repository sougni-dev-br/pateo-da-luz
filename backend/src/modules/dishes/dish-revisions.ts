import { Prisma } from "@prisma/client";
import type { ClienteDoBanco, DetalheDoPrato } from "./dish-detail.js";

export type AcaoDaRevisao = "CRIADA" | "ALTERADA" | "INATIVADA" | "REATIVADA";

/**
 * O que a versão guarda. Fica em JSON de propósito: a ficha de hoje e a de ontem apontam para os
 * mesmos produtos, mas o custo, o nome e a categoria mudam — a foto do momento é o que vale no histórico.
 */
export function montarSnapshot(detalhe: DetalheDoPrato) {
  return {
    name: detalhe.name,
    code: detalhe.code,
    menu: detalhe.menu,
    category: detalhe.category ? { id: detalhe.category.id, name: detalhe.category.name, parentName: detalhe.category.parentName } : null,
    salePriceDefault: detalhe.salePriceDefault,
    yieldQty: detalhe.yieldQty,
    yieldUnit: detalhe.yieldUnit,
    notes: detalhe.notes,
    isActive: detalhe.isActive,
    custoPorcao: detalhe.custoPorcao,
    cmvPercentual: detalhe.cmvPercentual,
    custoIncompleto: detalhe.custoIncompleto,
    items: detalhe.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      wasteFactor: item.wasteFactor,
      itemCost: item.itemCost
    }))
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
