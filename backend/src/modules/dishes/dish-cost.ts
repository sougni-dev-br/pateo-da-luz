// A conversao de unidades vive em shared/unidades: e a mesma regra que traz uma
// compra em caixa para a unidade em que o estoque e contado. Enquanto havia duas
// copias, correcoes como reconhecer "GR" como grama chegavam so num dos lados.
import { normalizarUnidade, resolveUnitFactor } from "../../shared/unidades/conversao.js";

export { resolveUnitFactor };
export type { UnitConversion } from "../../shared/unidades/conversao.js";
import type { UnitConversion } from "../../shared/unidades/conversao.js";

export type CostProduct = {
  /** Unidade em que o custo medio esta expresso (unidade de estoque). */
  unit: string | null;
  averageCost: number | null;
  conversions: UnitConversion[];
};

export type CostItemInput = {
  quantity: number;
  unit: string;
  wasteFactor: number;
  product: CostProduct;
};

export type CostItemResult = {
  quantity: number;
  unit: string;
  wasteFactor: number;
  unitCost: number | null;
  unitFactor: number | null;
  itemCost: number | null;
  issue: string | null;
};

export type DishCostResult = {
  items: CostItemResult[];
  /** Custo do rendimento inteiro. */
  totalCost: number;
  /** Custo de uma porcao — e este que se compara com o preco de venda. */
  costPerServing: number;
  margemBruta: number | null;
  cmvPercentual: number | null;
  hasUnresolvedUnit: boolean;
  hasMissingCost: boolean;
};

const clean = normalizarUnidade;

/**
 * Custo de uma ficha tecnica.
 *
 * A versao anterior fazia `quantidade * (1 + perda) * custoMedio` ignorando
 * duas coisas: a unidade do ingrediente (200 G de um produto cotado por KG
 * viravam 200 KG, custo mil vezes maior) e o rendimento do prato (o custo da
 * receita inteira era comparado com o preco de uma porcao).
 *
 * Item que nao converte fica com custo null e uma observacao, em vez de entrar
 * na conta com numero errado.
 */
export function calculateDishCost(input: {
  yieldQty: number;
  salePrice: number | null;
  items: CostItemInput[];
}): DishCostResult {
  let hasUnresolvedUnit = false;
  let hasMissingCost = false;

  const items = input.items.map<CostItemResult>((item) => {
    const stockUnit = item.product.unit;
    const unitCost = item.product.averageCost;
    const base: Omit<CostItemResult, "unitFactor" | "itemCost" | "issue"> = {
      quantity: item.quantity,
      unit: item.unit,
      wasteFactor: item.wasteFactor,
      unitCost
    };

    if (unitCost == null || !Number.isFinite(unitCost) || unitCost === 0) {
      hasMissingCost = true;
      return { ...base, unitFactor: null, itemCost: null, issue: "Produto sem custo medio no estoque." };
    }

    const factor = resolveUnitFactor(item.unit, stockUnit, item.product.conversions);
    if (factor == null) {
      hasUnresolvedUnit = true;
      return {
        ...base,
        unitFactor: null,
        itemCost: null,
        issue: `Sem conversao de ${clean(item.unit) || "(vazio)"} para ${clean(stockUnit) || "(vazio)"}.`
      };
    }

    const quantityInStockUnit = item.quantity * factor;
    const itemCost = quantityInStockUnit * (1 + item.wasteFactor) * unitCost;
    return { ...base, unitFactor: factor, itemCost, issue: null };
  });

  const totalCost = items.reduce((sum, item) => sum + (item.itemCost ?? 0), 0);
  const yieldQty = Number.isFinite(input.yieldQty) && input.yieldQty > 0 ? input.yieldQty : 1;
  const costPerServing = totalCost / yieldQty;

  const salePrice = input.salePrice;
  const margemBruta = salePrice != null ? salePrice - costPerServing : null;
  const cmvPercentual = salePrice != null && salePrice > 0 ? (costPerServing / salePrice) * 100 : null;

  return {
    items,
    totalCost,
    costPerServing,
    margemBruta,
    cmvPercentual: input.items.length === 0 && salePrice != null ? 0 : cmvPercentual,
    hasUnresolvedUnit,
    hasMissingCost
  };
}
