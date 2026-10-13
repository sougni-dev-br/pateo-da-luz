import type { DishUnitConversion } from "../../api/client";
import { fatorConversao, lerNumero, normalizarUnidade, unidadesPossiveis } from "../../lib/fichaTecnica";

// Quantidade do desperdício em g, ml, kg... e a conversão para a unidade do estoque. As regras de
// conversão são as da ficha técnica (lib/fichaTecnica): o mesmo produto converte igual nas duas telas.
// O servidor refaz a conta e é quem manda; aqui ela só aparece enquanto a pessoa digita.

const formato = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });

/** Até 6 casas: 1 g de uma embalagem de 25 kg é 0,00004 UN e não pode aparecer como "0". */
export const formatarQuantidade = (valor: number) => formato.format(valor);

const MEDIDAS = ["G", "KG", "ML", "L"];

/**
 * Unidades em que dá para lançar o item: a do estoque primeiro, depois as que convertem para ela.
 * Oferecer só estas evita lançar "500 G" num item que o servidor não saberia converter.
 */
export function unidadesDoLancamento(unidadeDoEstoque: string | null, conversoes: DishUnitConversion[]): string[] {
  const base = normalizarUnidade(unidadeDoEstoque);
  if (!base) return [];
  const possiveis = unidadesPossiveis(base, conversoes);
  return [base, ...possiveis.filter((u) => u !== base)];
}

export type PreviaDaConversao = { tipo: "CONVERTE"; texto: string } | { tipo: "SO_ESTOQUE"; texto: string } | null;

/**
 * O que mostrar sob o campo: o resultado da conversão quando a unidade digitada não é a do estoque, ou o
 * aviso de que o item só aceita a unidade do estoque (sem peso/volume cadastrado nem no nome).
 */
export function previaDaConversao(entrada: {
  quantidade: string;
  unidade: string;
  unidadeDoEstoque: string | null;
  conversoes: DishUnitConversion[];
}): PreviaDaConversao {
  const base = normalizarUnidade(entrada.unidadeDoEstoque);
  const unidade = normalizarUnidade(entrada.unidade);
  if (!base) return null;

  if (unidade && unidade !== base) {
    const numero = lerNumero(entrada.quantidade);
    const fator = fatorConversao(unidade, base, entrada.conversoes);
    if (!Number.isFinite(numero) || numero <= 0 || fator == null) return null;
    return { tipo: "CONVERTE", texto: `${formatarQuantidade(numero)} ${unidade} = ${formatarQuantidade(numero * fator)} ${base}` };
  }

  const opcoes = unidadesDoLancamento(base, entrada.conversoes);
  if (opcoes.length <= 1 && !MEDIDAS.includes(base)) {
    return { tipo: "SO_ESTOQUE", texto: `Este item só aceita ${base}: não tem peso nem volume cadastrado. Para lançar em g ou ml, informe na ficha técnica.` };
  }
  return null;
}
