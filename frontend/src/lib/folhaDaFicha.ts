// A folha de papel da ficha técnica: o que vai impresso em cada cenário (em branco, só com o prato
// escolhido, ou já preenchida com a ficha do sistema). Funções puras — a tela só desenha o resultado.

import type { BuffetDish, DishDetail, DishListItem, DishMenu } from "../api/client";
import { formatarQuantidade } from "./fichaTecnica";

export type IngredienteDaFolha = {
  nome: string;
  codigo: string;
  quantidade: string;
  unidade: string;
  perda: string;
  observacao: string;
};

export type FolhaDados = {
  /** Ficha de produção (não vendida): a folha sai sem cardápio, categoria nem preço. */
  producao?: boolean;
  prato: string;
  codigo: string;
  /** Marca o cardápio com um X; null deixa os dois quadradinhos vazios. */
  menu: DishMenu | null;
  categoria: string;
  subcategoria: string;
  rendimento: string;
  unidadeDoRendimento: string;
  /** Peso de cada porção e validade de uso, quando informados na ficha. */
  pesoDaPorcao: string;
  validadeDeUso: string;
  preco: string;
  modoDePreparo: string;
  observacoes: string;
  ingredientes: IngredienteDaFolha[];
  /** Quantas linhas de ingrediente a folha tem (as preenchidas contam). */
  linhas: number;
};

export const OPCOES_DE_LINHAS = [12, 16, 20, 24] as const;
export const LINHAS_PADRAO = 16;
/** Folhas de uma vez: mais que isso quase sempre é engano de digitação. */
export const MAXIMO_DE_COPIAS = 50;
/** Linhas em branco que sobram numa folha preenchida, para acrescentar à mão. */
const SOBRA_EM_FOLHA_PREENCHIDA = 3;

/**
 * Altura da linha por quantidade de linhas, para a tabela sempre caber numa A4 (com o modo de preparo encolhido
 * quando a lista é longa: ver `linhasDoModoDePreparo`). Abaixo de ~5,6 mm ninguém escreve à mão.
 */
export function alturaDaLinha(linhas: number): string {
  if (linhas <= 12) return "9.2mm";
  if (linhas <= 16) return "7.6mm";
  if (linhas <= 20) return "6.4mm";
  if (linhas <= 24) return "5.8mm";
  return "5.4mm";
}

/** Folha com muitos ingredientes: o espaço que sobra para o modo de preparo é menor, senão a assinatura cai na segunda página. */
const LINHAS_DO_MODO_DE_PREPARO = 7;
const LINHAS_DO_MODO_DE_PREPARO_FOLHA_CHEIA = 4;
const LINHAS_DO_MODO_DE_PREPARO_FOLHA_MUITO_CHEIA = 3;
const LIMITE_DE_LINHAS_PARA_ENCOLHER = 16;
const LIMITE_DE_LINHAS_PARA_ENCOLHER_MAIS = 22;
/** Caracteres de uma linha da pauta (9 pt em 190 mm): para saber quantas linhas um texto escrito ocupa. */
const CARACTERES_POR_LINHA_DA_PAUTA = 105;

/**
 * Linhas da pauta do modo de preparo: o padrão (7), menos quando a lista de ingredientes é longa, e nunca
 * menos do que o texto já escrito precisa (o texto da ficha não pode ser cortado).
 */
export function linhasDoModoDePreparo(linhasDeIngrediente: number, texto = ""): number {
  const base = linhasDeIngrediente > LIMITE_DE_LINHAS_PARA_ENCOLHER_MAIS
    ? LINHAS_DO_MODO_DE_PREPARO_FOLHA_MUITO_CHEIA
    : linhasDeIngrediente > LIMITE_DE_LINHAS_PARA_ENCOLHER ? LINHAS_DO_MODO_DE_PREPARO_FOLHA_CHEIA : LINHAS_DO_MODO_DE_PREPARO;
  const necessarias = Math.ceil(texto.trim().length / CARACTERES_POR_LINHA_DA_PAUTA);
  return Math.max(base, necessarias);
}

const BRANCO: IngredienteDaFolha = { nome: "", codigo: "", quantidade: "", unidade: "", perda: "", observacao: "" };

function normalizarLinhas(linhas: number): number {
  return Number.isFinite(linhas) && linhas > 0 ? Math.min(Math.round(linhas), 40) : LINHAS_PADRAO;
}

const base = (linhas: number): FolhaDados => ({
  prato: "", codigo: "", menu: null, categoria: "", subcategoria: "", rendimento: "", unidadeDoRendimento: "", pesoDaPorcao: "", validadeDeUso: "", preco: "",
  modoDePreparo: "", observacoes: "", ingredientes: [], linhas: normalizarLinhas(linhas)
});

/** Ficha em branco: o cardápio e a categoria já podem vir marcados, o resto é preenchido à mão. */
export function folhaEmBranco(opcoes: { linhas?: number; menu?: DishMenu | null; categoria?: string; subcategoria?: string } = {}): FolhaDados {
  return {
    ...base(opcoes.linhas ?? LINHAS_PADRAO),
    menu: opcoes.menu ?? null,
    categoria: opcoes.categoria ?? "",
    subcategoria: opcoes.subcategoria ?? ""
  };
}

/** Folha de um prato que ainda não tem ficha: nome, cardápio e categoria preenchidos; ingredientes em branco. */
export function folhaDoNome(prato: Pick<DishListItem, "name" | "code" | "menu" | "category" | "yieldQty" | "yieldUnit"> & Partial<Pick<DishListItem, "portionWeightG" | "shelfLifeDays" | "fichaDeProducao">>, linhas = LINHAS_PADRAO): FolhaDados {
  const producao = Boolean(prato.fichaDeProducao);
  return {
    ...base(linhas),
    ...(producao ? { producao: true } : {}),
    prato: prato.name,
    codigo: prato.code ?? "",
    menu: producao ? null : prato.menu,
    categoria: producao ? "" : prato.category?.parentName ?? prato.category?.name ?? "",
    subcategoria: producao ? "" : prato.category?.parentName ? prato.category.name : "",
    rendimento: formatarQuantidade(prato.yieldQty),
    unidadeDoRendimento: prato.yieldUnit,
    pesoDaPorcao: prato.portionWeightG != null ? formatarQuantidade(prato.portionWeightG) : "",
    validadeDeUso: prato.shelfLifeDays != null ? String(prato.shelfLifeDays) : ""
  };
}

/**
 * Folha de uma preparação do buffet que aguarda ficha (criada pelo desperdício): nome e unidade já escritos, e o que a
 * pessoa que lançou disse que leva, para a cozinha completar com a receita de verdade.
 */
export function folhaDoBuffet(prato: Pick<BuffetDish, "name" | "unit" | "notes">, linhas = LINHAS_PADRAO): FolhaDados {
  return {
    ...base(linhas),
    prato: prato.name,
    categoria: "Buffet",
    unidadeDoRendimento: prato.unit,
    observacoes: prato.notes ? `Leva, segundo quem lançou o desperdício: ${prato.notes}` : ""
  };
}

/** Ficha do sistema impressa: tudo preenchido, mais algumas linhas em branco para anotar mudanças. */
export function folhaDoPrato(detalhe: DishDetail, linhas = LINHAS_PADRAO): FolhaDados {
  const ingredientes = detalhe.items.map<IngredienteDaFolha>((item) => ({
    nome: item.componentDishId ? `${item.productName} (ficha de produção)` : item.productName,
    codigo: item.productCode ?? "",
    quantidade: formatarQuantidade(item.quantity),
    unidade: item.unit,
    perda: item.wasteFactor > 0 ? `${Math.round(item.wasteFactor * 10_000) / 100}` : "",
    observacao: item.notes ?? ""
  }));

  return {
    ...folhaDoNome(detalhe, linhas),
    preco: detalhe.fichaDeProducao || detalhe.salePriceDefault == null ? "" : detalhe.salePriceDefault.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    modoDePreparo: detalhe.notes ?? "",
    ingredientes,
    // Nunca menos linhas do que ingredientes: a ficha inteira tem que caber na folha.
    linhas: Math.max(normalizarLinhas(linhas), ingredientes.length + SOBRA_EM_FOLHA_PREENCHIDA)
  };
}

/** As linhas da tabela: os ingredientes preenchidos e o resto em branco, até completar `linhas`. */
export function linhasDaTabela(folha: FolhaDados): IngredienteDaFolha[] {
  const vazias = Math.max(folha.linhas - folha.ingredientes.length, 0);
  return [...folha.ingredientes, ...Array.from({ length: vazias }, () => BRANCO)];
}

/** N cópias da mesma folha (ficha em branco para a equipe levar). */
export function copiasDaFolha(folha: FolhaDados, copias: number): FolhaDados[] {
  const n = Math.min(Math.max(Math.round(copias) || 1, 1), MAXIMO_DE_COPIAS);
  return Array.from({ length: n }, () => folha);
}
