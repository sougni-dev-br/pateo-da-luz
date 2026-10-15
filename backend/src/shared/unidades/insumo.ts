import type { Prisma } from "@prisma/client";
import { conversoesDoProduto, embalagemDoNome, normalizarUnidade, type ConversaoDoProduto } from "./conversao.js";

/** O que a conversão precisa de um insumo: nome (a embalagem pode estar nele), unidade e as conversões cadastradas. */
export const SELECT_DE_UNIDADES = {
  name: true,
  unit: true,
  unitMeasure: { select: { code: true } },
  conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } },
} as const;

export type ProdutoComUnidades = {
  name: string;
  unit: string | null;
  unitMeasure: { code: string } | null;
  conversions: Array<{ fromUnit: string; toUnit: string; factor: Prisma.Decimal | number }>;
};

/** A unidade em que o insumo é guardado, contado na conferência e valorado: a mesma em todas as telas. */
export const unidadeDoInsumo = (p: Pick<ProdutoComUnidades, "unit" | "unitMeasure">) => p.unitMeasure?.code ?? p.unit;

/**
 * As conversões que valem na ficha técnica (cadastradas no produto + o peso lido do nome, "ARROZ 5KG"),
 * para quem lança em g, ml, kg e l converter para a unidade do estoque.
 */
export function conversoesDoInsumo(p: ProdutoComUnidades): ConversaoDoProduto[] {
  const cadastradas = p.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }));
  return conversoesDoProduto(p.name, unidadeDoInsumo(p), cadastradas);
}

export function textoDaEmbalagem(p: ProdutoComUnidades, conversoes: ConversaoDoProduto[]): string | null {
  if (!conversoes.some((c) => c.inferida)) return null;
  const embalagem = embalagemDoNome(p.name);
  const base = normalizarUnidade(unidadeDoInsumo(p));
  return embalagem ? `1 ${base} = ${embalagem.quantidade.toLocaleString("pt-BR")} ${embalagem.unidade} (lido do nome do produto)` : null;
}
