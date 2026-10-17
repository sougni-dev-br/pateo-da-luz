import type { Prisma } from "@prisma/client";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { NATURE_DEFAULTS, type ProductNatureValue } from "./product-nature.js";
import { proposeCategory } from "./taxonomy-proposal.js";

const CATEGORIAS_LEGADAS = new Set(["insumos", "despesas"]);

/** Nome de categoria do vocabulário antigo: a importação não a recria quando ela não existe. */
export function ehNomeDeCategoriaLegada(nome: string | null | undefined): boolean {
  return CATEGORIAS_LEGADAS.has(normalizeText(nome));
}

/**
 * Categoria que a planilha de importação ainda usa mas que não faz parte da estrutura: inativa, ou uma das
 * antigas (INSUMOS, DESPESAS) sem natureza. Produto novo nunca é gravado nela.
 */
export function ehCategoriaLegada(categoria: { name: string; nature?: ProductNatureValue | null; isActive?: boolean } | null | undefined): boolean {
  if (!categoria) return false;
  if (categoria.isActive === false) return true;
  return !categoria.nature && CATEGORIAS_LEGADAS.has(normalizeText(categoria.name));
}

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
// Embalagem e descartável perdem para palavras de alimento nas regras de insumo ("sacola para pão"),
// e aqui o efeito é automático e vai para o CMV: com qualquer sinal de embalagem, não decide sozinho.
const SINAL_DE_EMBALAGEM = /(?<![a-z0-9])(embalagem|embalagens|sacola|sacolas|saco|sacos|caixa|caixas|bobina|descart[a-z]*|copo|copos|pote|potes|tampa|tampas|filme|pvc|marmitex|papel|guardanapo|canudo|talher|talheres)(?![a-z0-9])/;

export function categoriaDaEstruturaParaItemNovo(descricao: string, categoriaDaPlanilha: string): string | null {
  if (SINAL_DE_EMBALAGEM.test(normalizeText(descricao))) return null;
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

const CATEGORIA_SELECT = { id: true, name: true, nature: true, defaultDreCategoryId: true, isActive: true } as const;

type CategoriaCarregada = { id: string; name: string; nature: ProductNatureValue | null; defaultDreCategoryId: string | null; isActive?: boolean };

/** Onde um produto criado por importação deve nascer: categoria final e o que ela define. */
export async function estruturaDeProdutoNovo(
  db: Pick<Prisma.TransactionClient, "category">,
  entrada: { descricao: string; categoryId: string | null | undefined; categoria?: CategoriaCarregada | null }
): Promise<EstruturaDeProdutoNovo> {
  const categoria =
    entrada.categoria ??
    (entrada.categoryId ? await db.category.findUnique({ where: { id: entrada.categoryId }, select: CATEGORIA_SELECT }) : null);
  if (categoria && !categoria.nature) {
    const nomeDestino = categoriaDaEstruturaParaItemNovo(entrada.descricao, categoria.name);
    const destino = nomeDestino
      ? await db.category.findFirst({
          where: { name: { equals: nomeDestino, mode: "insensitive" }, isActive: true },
          orderBy: { name: "asc" },
          select: CATEGORIA_SELECT
        })
      : null;
    if (destino?.nature) {
      return { categoryId: destino.id, reclassificada: true, padrao: padraoDeProdutoNovo(destino) };
    }
  }
  // Sem regra clara para mandar o item à estrutura nova: categoria legada não recebe produto novo. Fica sem
  // categoria, aparece em "sem categoria" na lista e é classificado à mão.
  if (ehCategoriaLegada(categoria)) {
    return { categoryId: null, reclassificada: false, padrao: padraoDeProdutoNovo(null) };
  }
  return { categoryId: entrada.categoryId, reclassificada: false, padrao: padraoDeProdutoNovo(categoria) };
}
