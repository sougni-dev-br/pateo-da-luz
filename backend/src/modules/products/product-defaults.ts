import { NATURE_DEFAULTS, type ProductNatureValue } from "./product-nature.js";

export type CategoriaParaPadrao = {
  nature: ProductNatureValue | null;
  defaultDreCategoryId: string | null;
} | null;

export type PadraoDeProdutoNovo = {
  nature: ProductNatureValue | null;
  dreCategoryId: string | null;
  controlsStock: boolean | null;
};

/**
 * O que um produto criado fora da tela de cadastro (importação) herda da categoria.
 * Categoria sem natureza não decide nada: controlsStock vem nulo para o chamador manter o
 * comportamento antigo (planilha, ou ligado), em vez de adivinhar.
 */
export function padraoDeProdutoNovo(categoria: CategoriaParaPadrao): PadraoDeProdutoNovo {
  if (!categoria?.nature) return { nature: null, dreCategoryId: null, controlsStock: null };
  return {
    nature: categoria.nature,
    dreCategoryId: categoria.defaultDreCategoryId ?? null,
    controlsStock: NATURE_DEFAULTS[categoria.nature].controlsStock
  };
}

/**
 * Reimportar a planilha não desfaz a organização: produto que já tem natureza mantém categoria,
 * subcategoria, controle de estoque e situação. Só o produto ainda sem natureza segue sendo
 * atualizado pela planilha como antes.
 */
export function planilhaPodeReclassificar(existente: { nature: ProductNatureValue | null } | null): boolean {
  return !existente?.nature;
}
