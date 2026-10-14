import { calculateDishCost, resolveUnitFactor } from "../../dishes/dish-cost.js";
import { conversoesDaFicha } from "../../dishes/dish-detail.js";
import { normalizarUnidade } from "../../../shared/unidades/conversao.js";

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
  const conversoes = conversoesDaFicha({ name: insumo.name, unit: insumo.unit, stockUnit: insumo.stockUnit ?? null, conversions: insumo.conversions as never });
  // Estoque contado em CX/PCT/FD com uma medida no nome ("CERVEJA 350ML"): a ficha técnica infere "1 CX = 350 ML", mas a caixa
  // costuma ter várias unidades. Na ficha um cadastro revisa isso; aqui o custo sairia várias vezes maior sem aviso.
  const base = normalizarUnidade(insumo.stockUnit || insumo.unit);
  // O custo depende da inferência quando SEM as conversões inferidas a unidade do consumo não chegaria à do estoque.
  const cadastradas = conversoes.filter((c) => (c as { inferida?: boolean }).inferida !== true);
  const dependeDaInferencia = resolveUnitFactor(unidade, base, cadastradas) == null && resolveUnitFactor(unidade, base, conversoes) != null;
  if (base !== "UN" && dependeDaInferencia) {
    return {
      custoPorVenda: null,
      custoCompleto: false,
      problema: `O estoque conta em ${base} e a embalagem foi lida só do nome: cadastre a conversão no produto (quantas unidades tem em 1 ${base}) para calcular o custo.`
    };
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
          conversions: conversoes
        }
      }
    ]
  });
  const item = calculo.items[0];
  if (item.itemCost === null) return { custoPorVenda: null, custoCompleto: false, problema: item.issue ?? "Custo não calculado." };
  return { custoPorVenda: item.itemCost, custoCompleto: true, problema: null };
}
