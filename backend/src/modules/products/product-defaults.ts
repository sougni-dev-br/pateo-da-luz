import type { Prisma } from "@prisma/client";
import { NATURE_DEFAULTS, type ProductNatureValue } from "./product-nature.js";
import { proposeCategory } from "./taxonomy-proposal.js";

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

/**
 * A planilha ainda traz a categoria antiga (INSUMOS, DESPESAS). Só quando o nome do item casa com uma
 * regra de alta confiança o produto novo vai direto para a categoria da estrutura nova; o resto fica
 * onde a planilha disse e entra sem natureza, para o dono classificar.
 */
export function categoriaDaEstruturaParaItemNovo(descricao: string, categoriaDaPlanilha: string): string | null {
  const proposta = proposeCategory({
    name: descricao,
    categoryName: categoriaDaPlanilha,
    subcategoryName: null,
    sectorName: null,
    dreName: null,
    dreGroup: null,
    controlsStock: true
  });
  return proposta.confidence === "alta" ? proposta.category : null;
}

export type EstruturaDeProdutoNovo = {
  categoryId: string | null | undefined;
  /** A categoria mudou em relação à da planilha: a subcategoria da planilha não vale mais. */
  reclassificada: boolean;
  padrao: PadraoDeProdutoNovo;
};

const CATEGORIA_SELECT = { id: true, name: true, nature: true, defaultDreCategoryId: true } as const;

/** Onde um produto criado por importação deve nascer: categoria final e o que ela define. */
export async function estruturaDeProdutoNovo(
  db: Pick<Prisma.TransactionClient, "category">,
  entrada: { descricao: string; categoryId: string | null | undefined }
): Promise<EstruturaDeProdutoNovo> {
  const categoria = entrada.categoryId
    ? await db.category.findUnique({ where: { id: entrada.categoryId }, select: CATEGORIA_SELECT })
    : null;
  if (categoria && !categoria.nature) {
    const nomeDestino = categoriaDaEstruturaParaItemNovo(entrada.descricao, categoria.name);
    const destino = nomeDestino
      ? await db.category.findUnique({ where: { name: nomeDestino }, select: CATEGORIA_SELECT })
      : null;
    if (destino?.nature) {
      return { categoryId: destino.id, reclassificada: true, padrao: padraoDeProdutoNovo(destino) };
    }
  }
  return { categoryId: entrada.categoryId, reclassificada: false, padrao: padraoDeProdutoNovo(categoria) };
}
