/**
 * Plano de aplicação da reclassificação: dado o que está no banco e as decisões já revisadas, calcula
 * exatamente o que mudaria. Função pura: não lê nem grava nada, por isso dá para simular e testar.
 *
 * Só mexe em categoria, subcategoria e natureza dos produtos. Categoria DRE, controle de estoque, setor,
 * unidade e situação ficam de fora de propósito (mudar a DRE de um produto reescreve o histórico).
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { PROPOSED_CATEGORIES } from "./taxonomy-proposal.js";
import type { ProductNatureValue } from "./product-nature.js";

export type DecisionRow = { codigo: string; nature: ProductNatureValue | null; category: string | null };
export type ProductState = {
  id: string;
  externalCode: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  nature: ProductNatureValue | null;
};
export type CategoryState = {
  id: string;
  name: string;
  nature: ProductNatureValue | null;
  defaultDreCategoryId: string | null;
  isActive: boolean;
};
export type SubcategoryState = { id: string; name: string; categoryId: string };
export type DreState = { id: string; name: string };

/** Referência a uma categoria que pode ainda não existir (identificada pelo nome normalizado). */
export type CategoryRef = { id: string } | { newName: string };
export type SubcategoryRef = { id: string } | { newName: string; category: CategoryRef } | null;

export type ProductChange = {
  productId: string;
  category: CategoryRef | null;
  subcategory: SubcategoryRef;
  nature: ProductNatureValue | null;
  before: { categoryId: string | null; subcategoryId: string | null; nature: ProductNatureValue | null };
};

export type TaxonomyPlan = {
  categoriesToCreate: Array<{ name: string; nature: ProductNatureValue; defaultDreCategoryId: string | null }>;
  categoriesToUpdate: Array<{ id: string; name: string; nature?: ProductNatureValue; defaultDreCategoryId?: string; isActive?: true }>;
  subcategoriesToCreate: Array<{ name: string; category: CategoryRef }>;
  productChanges: ProductChange[];
  subcategoriesToDelete: Array<{ id: string; name: string; categoryId: string }>;
  categoriesToDeactivate: Array<{ id: string; name: string }>;
  warnings: string[];
};

const norm = (valor: string | null | undefined) => normalizeText(valor);
const chaveDe = (ref: CategoryRef) => ("id" in ref ? `id:${ref.id}` : `novo:${norm(ref.newName)}`);

export function planTaxonomy(input: {
  decisions: DecisionRow[];
  products: ProductState[];
  categories: CategoryState[];
  subcategories: SubcategoryState[];
  dreCategories: DreState[];
}): TaxonomyPlan {
  const { decisions, products, categories, subcategories, dreCategories } = input;
  const warnings: string[] = [];
  const categoriaPorNome = new Map(categories.map((categoria) => [norm(categoria.name), categoria]));
  const subPorId = new Map(subcategories.map((sub) => [sub.id, sub]));
  const drePorNome = new Map(dreCategories.map((dre) => [norm(dre.name), dre]));
  const decisaoPorCodigo = new Map<string, DecisionRow>();
  for (const decisao of decisions) {
    const anterior = decisaoPorCodigo.get(decisao.codigo);
    if (anterior && (anterior.category !== decisao.category || anterior.nature !== decisao.nature)) {
      warnings.push(`Código ${decisao.codigo} aparece mais de uma vez com decisões diferentes; vale a última.`);
    }
    decisaoPorCodigo.set(decisao.codigo, decisao);
  }
  const codigosDosProdutos = new Set(products.map((produto) => produto.externalCode).filter((codigo): codigo is string => Boolean(codigo)));
  const orfas = [...decisaoPorCodigo.keys()].filter((codigo) => !codigosDosProdutos.has(codigo));
  if (orfas.length > 0) warnings.push(`${orfas.length} decisão(ões) sem produto correspondente foram ignoradas.`);

  // 1. Categorias que as decisões usam: criar as que faltam, completar natureza e DRE usual das que existem.
  const categoriesToCreate: TaxonomyPlan["categoriesToCreate"] = [];
  const categoriesToUpdate: TaxonomyPlan["categoriesToUpdate"] = [];
  // Só conta decisão que casou com algum produto, e uma vez por nome normalizado ("Bebidas" e "BEBIDAS" são a mesma).
  const nomesUsados = new Map<string, string>();
  for (const decisao of decisaoPorCodigo.values()) {
    if (decisao.category && codigosDosProdutos.has(decisao.codigo) && !nomesUsados.has(norm(decisao.category))) {
      nomesUsados.set(norm(decisao.category), decisao.category);
    }
  }
  for (const nome of nomesUsados.values()) {
    const definicao = Object.entries(PROPOSED_CATEGORIES).find(([chave]) => norm(chave) === norm(nome));
    if (!definicao) {
      warnings.push(`Categoria "${nome}" não faz parte da estrutura proposta; os produtos dela ficam como estão.`);
      continue;
    }
    const dre = drePorNome.get(norm(definicao[1].dreName));
    if (!dre) warnings.push(`Categoria DRE "${definicao[1].dreName}" não existe; a categoria "${nome}" fica sem DRE usual.`);
    const existente = categoriaPorNome.get(norm(nome));
    if (!existente) {
      categoriesToCreate.push({ name: definicao[0], nature: definicao[1].nature, defaultDreCategoryId: dre?.id ?? null });
      continue;
    }
    // Não sobrescreve o que alguém já definiu à mão.
    const atualizacao: TaxonomyPlan["categoriesToUpdate"][number] = { id: existente.id, name: existente.name };
    if (!existente.nature) atualizacao.nature = definicao[1].nature;
    if (!existente.defaultDreCategoryId && dre) atualizacao.defaultDreCategoryId = dre.id;
    // Produtos vão para uma categoria que alguém desativou antes: ela volta a aparecer nos seletores.
    if (!existente.isActive) atualizacao.isActive = true;
    if (atualizacao.nature || atualizacao.defaultDreCategoryId || atualizacao.isActive) categoriesToUpdate.push(atualizacao);
  }
  const nomeValido = (nome: string) => Object.keys(PROPOSED_CATEGORIES).some((chave) => norm(chave) === norm(nome));
  const refDaCategoria = (nome: string): CategoryRef => {
    const existente = categoriaPorNome.get(norm(nome));
    return existente ? { id: existente.id } : { newName: nome };
  };

  // 2. Produtos: nova categoria, subcategoria coerente com ela, natureza.
  const subcategoriesToCreate: TaxonomyPlan["subcategoriesToCreate"] = [];
  const subNovasVistas = new Set<string>();
  const productChanges: ProductChange[] = [];
  for (const produto of products) {
    const decisao = produto.externalCode ? decisaoPorCodigo.get(produto.externalCode) : undefined;
    if (!decisao) continue;
    const trocaCategoria = Boolean(decisao.category && nomeValido(decisao.category));
    const novaCategoria: CategoryRef | null = trocaCategoria ? refDaCategoria(decisao.category as string) : null;

    let subcategoria: SubcategoryRef = produto.subcategoryId ? { id: produto.subcategoryId } : null;
    if (novaCategoria && produto.subcategoryId) {
      const sub = subPorId.get(produto.subcategoryId);
      const mesmaCategoria = sub && "id" in novaCategoria && sub.categoryId === novaCategoria.id;
      if (!sub || /^[0-9]+$/.test(sub.name.trim())) {
        subcategoria = null; // resíduo de importação: o produto fica sem subcategoria
      } else if (!mesmaCategoria) {
        // A subcategoria pertencia à categoria antiga: recria sob a nova, mesmo nome.
        const destino = categoriaPorNome.get(norm(decisao.category));
        const existente = destino ? subcategories.find((s) => s.categoryId === destino.id && norm(s.name) === norm(sub.name)) : undefined;
        if (existente) {
          subcategoria = { id: existente.id };
        } else {
          subcategoria = { newName: sub.name, category: novaCategoria };
          const chave = `${chaveDe(novaCategoria)}|${norm(sub.name)}`;
          if (!subNovasVistas.has(chave)) {
            subNovasVistas.add(chave);
            subcategoriesToCreate.push({ name: sub.name, category: novaCategoria });
          }
        }
      }
    }

    const categoriaFinal: CategoryRef | null = novaCategoria ?? (produto.categoryId ? { id: produto.categoryId } : null);
    const natureFinal = decisao.nature ?? produto.nature;
    const mudouCategoria = Boolean(novaCategoria) && !("id" in novaCategoria! && novaCategoria.id === produto.categoryId);
    const mudouSub = (subcategoria === null ? null : "id" in subcategoria ? subcategoria.id : "novo") !== produto.subcategoryId;
    const mudouNatureza = natureFinal !== produto.nature;
    if (!mudouCategoria && !mudouSub && !mudouNatureza) continue;
    productChanges.push({
      productId: produto.id,
      category: categoriaFinal,
      subcategory: subcategoria,
      nature: natureFinal,
      before: { categoryId: produto.categoryId, subcategoryId: produto.subcategoryId, nature: produto.nature }
    });
  }

  // 3. Estado final: aplica as mudanças sobre os produtos e conta o que sobra em cada subcategoria e categoria.
  const mudancaPorProduto = new Map(productChanges.map((mudanca) => [mudanca.productId, mudanca]));
  const finalPorSub = new Map<string, number>();
  const finalPorCategoria = new Map<string, number>();
  const antesPorSub = new Map<string, number>();
  const antesPorCategoria = new Map<string, number>();
  const somar = (mapa: Map<string, number>, id: string | null | undefined) => {
    if (id) mapa.set(id, (mapa.get(id) ?? 0) + 1);
  };
  for (const produto of products) {
    somar(antesPorSub, produto.subcategoryId);
    somar(antesPorCategoria, produto.categoryId);
    const mudanca = mudancaPorProduto.get(produto.id);
    if (!mudanca) {
      somar(finalPorSub, produto.subcategoryId);
      somar(finalPorCategoria, produto.categoryId);
      continue;
    }
    somar(finalPorSub, mudanca.subcategory && "id" in mudanca.subcategory ? mudanca.subcategory.id : null);
    somar(finalPorCategoria, mudanca.category && "id" in mudanca.category ? mudanca.category.id : null);
  }

  // Some a subcategoria que ficou vazia por causa do plano ou que é só um número (resíduo de importação).
  // Subcategoria vazia com nome de verdade fica: pode ser cadastro feito de propósito.
  const subcategoriesToDelete = subcategories.filter(
    (sub) =>
      (finalPorSub.get(sub.id) ?? 0) === 0 && ((antesPorSub.get(sub.id) ?? 0) > 0 || /^[0-9]+$/.test(sub.name.trim()))
  );
  const categoriesToDeactivate = categories
    .filter((categoria) => categoria.isActive && (antesPorCategoria.get(categoria.id) ?? 0) > 0 && (finalPorCategoria.get(categoria.id) ?? 0) === 0)
    .map((categoria) => ({ id: categoria.id, name: categoria.name }));

  return { categoriesToCreate, categoriesToUpdate, subcategoriesToCreate, productChanges, subcategoriesToDelete, categoriesToDeactivate, warnings };
}
