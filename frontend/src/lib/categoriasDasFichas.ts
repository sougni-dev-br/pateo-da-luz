// Cardápio (salão) x delivery e categoria › subcategoria nas fichas técnicas. Funções puras: a árvore
// de categorias, as opções do seletor agrupadas e o "caminho" mostrado na lista.

import type { DishCategory, DishCategoryRef, DishListItem, DishMenu } from "../api/client";
import type { SelectOption } from "../design-system";

export type FiltroDeCardapio = "todos" | DishMenu;

export const ROTULO_DO_CARDAPIO: Record<DishMenu, string> = {
  CARDAPIO: "Cardápio",
  DELIVERY: "Delivery"
};

export const DESCRICAO_DO_CARDAPIO: Record<DishMenu, string> = {
  CARDAPIO: "Pratos do salão",
  DELIVERY: "Pratos do delivery"
};

export const SEM_CATEGORIA = "Sem categoria";

/** "Massas › Fresca", "Massas" ou "Sem categoria". */
export function caminhoDaCategoria(categoria: Pick<DishCategoryRef, "name" | "parentName"> | null): string {
  if (!categoria) return SEM_CATEGORIA;
  return categoria.parentName ? `${categoria.parentName} › ${categoria.name}` : categoria.name;
}

/** O filtro por categoria principal inclui as subcategorias dela. */
export function categoriaCombina(prato: Pick<DishListItem, "category">, categoriaId: string): boolean {
  return prato.category?.id === categoriaId || prato.category?.parentId === categoriaId;
}

export function cardapioCombina(prato: Pick<DishListItem, "menu">, filtro: FiltroDeCardapio): boolean {
  return filtro === "todos" || prato.menu === filtro;
}

const porOrdemENome = (a: DishCategory, b: DishCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR");

export type NoDaCategoria = {
  categoria: DishCategory;
  filhas: DishCategory[];
  /** Pratos ativos só nesta categoria. */
  pratosDiretos: number;
  /** Pratos ativos nesta categoria e nas subcategorias dela. */
  pratosTotal: number;
  /** Pratos ativos por subcategoria, pelo id. */
  pratosPorFilha: Record<string, number>;
};

/**
 * Árvore de categorias principal › subcategorias, só do cardápio pedido, com a contagem de pratos
 * ativos. Subcategoria cujo pai sumiu da lista não some: vira principal, para não ficar invisível.
 */
export function montarArvore(categorias: DishCategory[], pratos: DishListItem[], filtro: FiltroDeCardapio): NoDaCategoria[] {
  const visiveis = categorias.filter((categoria) => filtro === "todos" || categoria.menu === filtro);
  const ids = new Set(visiveis.map((categoria) => categoria.id));
  const principais = visiveis.filter((categoria) => !categoria.parentId || !ids.has(categoria.parentId)).sort(porOrdemENome);

  const contagem = new Map<string, number>();
  for (const prato of pratos) {
    if (!prato.isActive || !prato.category) continue;
    contagem.set(prato.category.id, (contagem.get(prato.category.id) ?? 0) + 1);
  }

  return principais.map((categoria) => {
    const filhas = visiveis.filter((candidata) => candidata.parentId === categoria.id).sort(porOrdemENome);
    const pratosPorFilha = Object.fromEntries(filhas.map((filha) => [filha.id, contagem.get(filha.id) ?? 0]));
    const pratosDiretos = contagem.get(categoria.id) ?? 0;
    return {
      categoria,
      filhas,
      pratosDiretos,
      pratosTotal: pratosDiretos + Object.values(pratosPorFilha).reduce((soma, n) => soma + n, 0),
      pratosPorFilha
    };
  });
}

/**
 * Opções do seletor de categoria de UM cardápio. Principal com subcategorias vira um grupo
 * ("Massas" › "Massas (geral)", "Fresca", "Recheada"); sem subcategorias, uma opção solta.
 * Categoria inativa só aparece se for a que o prato já tem, para não sumir da tela em silêncio.
 */
export function opcoesDeCategoria(categorias: DishCategory[], menu: DishMenu, atualId = ""): SelectOption[] {
  const sobra = categorias.filter((categoria) => categoria.menu === menu && (categoria.isActive || categoria.id === atualId));
  const ids = new Set(sobra.map((categoria) => categoria.id));
  const principais = sobra.filter((categoria) => !categoria.parentId || !ids.has(categoria.parentId)).sort(porOrdemENome);
  const rotulo = (categoria: DishCategory) => (categoria.isActive ? categoria.name : `${categoria.name} (inativa)`);

  const opcoes: SelectOption[] = [];
  for (const principal of principais) {
    const filhas = sobra.filter((categoria) => categoria.parentId === principal.id).sort(porOrdemENome);
    if (filhas.length === 0) {
      opcoes.push({ value: principal.id, label: rotulo(principal) });
      continue;
    }
    opcoes.push({ value: principal.id, label: `${rotulo(principal)} (geral)`, group: principal.name });
    for (const filha of filhas) opcoes.push({ value: filha.id, label: rotulo(filha), group: principal.name });
  }
  return opcoes;
}

/** Quantos pratos ativos há em cada cardápio, para os contadores do seletor. */
export function contarPorCardapio(pratos: DishListItem[]): Record<FiltroDeCardapio, number> {
  const ativos = pratos.filter((prato) => prato.isActive);
  return {
    todos: ativos.length,
    CARDAPIO: ativos.filter((prato) => prato.menu === "CARDAPIO").length,
    DELIVERY: ativos.filter((prato) => prato.menu === "DELIVERY").length
  };
}

/**
 * Opções do filtro de categoria da lista. Com um cardápio escolhido, é o seletor de sempre; com "todos",
 * junta os dois e escreve o cardápio na frente, para "Pizzas" do delivery não se confundir com a do salão.
 */
export function opcoesDoFiltroDeCategoria(categorias: DishCategory[], filtro: FiltroDeCardapio, atualId = ""): SelectOption[] {
  if (filtro !== "todos") return opcoesDeCategoria(categorias, filtro, atualId);
  const marcar = (menu: DishMenu) =>
    opcoesDeCategoria(categorias, menu, atualId).map((opcao) => ({
      ...opcao,
      label: opcao.group ? opcao.label : `${ROTULO_DO_CARDAPIO[menu]} · ${opcao.label}`,
      group: opcao.group ? `${ROTULO_DO_CARDAPIO[menu]} · ${opcao.group}` : undefined
    }));
  return [...marcar("CARDAPIO"), ...marcar("DELIVERY")];
}
