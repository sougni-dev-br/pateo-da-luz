import { calculateDishCost } from "../../dishes/dish-cost.js";
import { conversoesDaFicha } from "../../dishes/dish-detail.js";

// Custo de COMPRA de uma bebida vendida no PDV: o insumo comprado, a quantidade que uma venda consome e a
// unidade dessa quantidade. É a mesma conta da ficha técnica (custo médio do estoque, conversão de unidade,
// inclusive a embalagem lida do nome "750ML"), com um item só.

export type InsumoDoBanco = {
  name: string;
  unit: string | null;
  stockUnit?: string | null;
  averageCost: number | null;
  conversions: Array<{ fromUnit: string; toUnit: string; factor: number }>;
};

export type CustoDoVinculo = { custoPorVenda: number | null; custoCompleto: boolean; problema: string | null };

export function custoDoVinculo(insumo: InsumoDoBanco, quantidade: number, unidade: string): CustoDoVinculo {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return { custoPorVenda: null, custoCompleto: false, problema: "A quantidade consumida por venda deve ser maior que zero." };
  }
  const calculo = calculateDishCost({
    yieldQty: 1,
    salePrice: null,
    items: [
      {
        quantity: quantidade,
        unit: unidade,
        wasteFactor: 0,
        product: {
          unit: insumo.stockUnit || insumo.unit,
          averageCost: insumo.averageCost,
          conversions: conversoesDaFicha({ name: insumo.name, unit: insumo.unit, stockUnit: insumo.stockUnit ?? null, conversions: insumo.conversions as never })
        }
      }
    ]
  });
  const item = calculo.items[0];
  if (item.itemCost === null) return { custoPorVenda: null, custoCompleto: false, problema: item.issue ?? "Custo não calculado." };
  return { custoPorVenda: item.itemCost, custoCompleto: true, problema: null };
}
