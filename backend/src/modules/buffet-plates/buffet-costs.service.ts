import type { Request } from "express";
import { prisma } from "../../config/database.js";
import { getSessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { carregarDetalhe } from "../dishes/dish-detail.js";
import { custoDoPrato, type CustoDoPrato, type FichaParaCusto } from "./buffet-costs.js";

export const MAX_PRATOS_NO_CUSTO = 300;
const FICHAS_POR_VEZ = 5;

/** Custo por kg de cada prato das plaquinhas, pela ficha técnica ligada a ele (R$ de hoje). */
export async function custosDosPratos(itemIds: string[]): Promise<Map<string, CustoDoPrato>> {
  const unicos = [...new Set(itemIds)].slice(0, MAX_PRATOS_NO_CUSTO);
  if (!unicos.length) return new Map();
  const itens = await prisma.buffetPlateItem.findMany({ where: { id: { in: unicos } }, select: { id: true, dishId: true } });
  const dishIds = [...new Set(itens.flatMap((i) => (i.dishId ? [i.dishId] : [])))];

  const fichas = new Map<string, FichaParaCusto | null>();
  // carregarDetalhe é pesado (ingredientes, estoque, conversões): poucas fichas por vez para não esgotar o pool do banco.
  for (let i = 0; i < dishIds.length; i += FICHAS_POR_VEZ) {
    await Promise.all(dishIds.slice(i, i + FICHAS_POR_VEZ).map(async (id) => {
      const d = await carregarDetalhe(prisma, id);
      fichas.set(id, d ? {
        id: d.id, name: d.name, yieldUnit: d.yieldUnit, custoPorcao: d.custoPorcao, custoIncompleto: d.custoIncompleto,
        portionWeightG: d.portionWeightG, fichaPendente: d.fichaPendente,
      } : null);
    }));
  }

  const dishDoItem = new Map(itens.map((i) => [i.id, i.dishId]));
  return new Map(unicos.map((id) => {
    const dishId = dishDoItem.get(id);
    return [id, custoDoPrato(dishId ? fichas.get(dishId) ?? null : null)] as const;
  }));
}

/** Valores em R$ só saem para quem tem "inventory-costs" (a mesma regra do desperdício e das movimentações de estoque). */
export async function custoVisivel(request: Request): Promise<boolean> {
  const user = await getSessionUser(request);
  return user ? userHasPermission(user as never, "inventory-costs", "view") : false;
}

/** Sem a permissão a cozinha ainda vê o estado da ficha (para ligar e montar), mas nunca o custo. */
export const semValores = (c: CustoDoPrato): CustoDoPrato => ({ ...c, costPerKg: null });
