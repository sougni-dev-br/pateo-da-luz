import { calculateDishCost } from "./dish-cost.js";
import { toCostItem, type ClienteDoBanco } from "./dish-detail.js";

/** O cardápio do salão é o "CARDAPIO" das fichas: o delivery tem quantidades e custo próprios. */
export const MENU_DO_SALAO = "CARDAPIO";
export const UNIDADES_DE_PORCAO = new Set(["UN", "UND", "POR", "PORCAO", "PORÇÃO"]);

export type PratoDoSalaoComCusto = {
  id: string;
  nome: string;
  precoFicha: number | null;
  /** Custo de UMA porção pelos itens do cardápio do salão; null se a ficha do salão não tem itens. */
  custoPorcao: number | null;
  itensNaFicha: number;
  /** false = há ingrediente sem custo médio ou sem conversão de unidade: o custo está subestimado. */
  custoCompleto: boolean;
};

/**
 * Pratos vendidos no salão (principal ou também) com o custo da porção calculado só pelos itens do
 * cardápio do salão. Uma leitura só para todos os pratos: serve ao relatório de margem sem uma
 * consulta por prato.
 */
export async function carregarPratosDoSalaoComCusto(client: ClienteDoBanco): Promise<PratoDoSalaoComCusto[]> {
  const pratos = await client.dish.findMany({
    where: { isActive: true, OR: [{ menu: MENU_DO_SALAO }, { alsoMenu: MENU_DO_SALAO }] },
    select: {
      id: true,
      name: true,
      salePriceDefault: true,
      yieldQty: true,
      yieldUnit: true,
      items: {
        where: { menu: MENU_DO_SALAO },
        select: {
          quantity: true,
          unit: true,
          wasteFactor: true,
          product: {
            select: {
              name: true,
              unit: true,
              stockUnit: true,
              inventoryStock: { select: { averageCost: true } },
              conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
            }
          }
        }
      }
    },
    orderBy: { name: "asc" }
  });

  return pratos.map((prato) => {
    const precoFicha = prato.salePriceDefault ? Number(prato.salePriceDefault) : null;
    if (prato.items.length === 0) {
      return { id: prato.id, nome: prato.name, precoFicha, custoPorcao: null, itensNaFicha: 0, custoCompleto: false };
    }
    const custo = calculateDishCost({ yieldQty: Number(prato.yieldQty), salePrice: precoFicha, items: prato.items.map((i) => toCostItem(i)) });
    // O relatorio trata cada unidade vendida como UMA porcao: ficha com rendimento em KG ou L daria custo por quilo.
    const rendimentoEmPorcao = UNIDADES_DE_PORCAO.has(String(prato.yieldUnit ?? "").trim().toUpperCase());
    return {
      id: prato.id,
      nome: prato.name,
      precoFicha,
      custoPorcao: custo.costPerServing,
      itensNaFicha: prato.items.length,
      custoCompleto: !(custo.hasMissingCost || custo.hasUnresolvedUnit) && rendimentoEmPorcao
    };
  });
}
