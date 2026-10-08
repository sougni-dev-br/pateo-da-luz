// A folha de papel da ficha técnica: o que vai impresso em cada cenário (em branco, só com o prato
// escolhido, ou já preenchida com a ficha do sistema). Funções puras — a tela só desenha o resultado.

import type { DishDetail, DishListItem, DishMenu } from "../api/client";
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
  prato: string;
  codigo: string;
  /** Marca o cardápio com um X; null deixa os dois quadradinhos vazios. */
  menu: DishMenu | null;
  categoria: string;
  subcategoria: string;
  rendimento: string;
  unidadeDoRendimento: string;
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

/** Altura da linha por quantidade de linhas, para a tabela sempre caber numa A4. */
export function alturaDaLinha(linhas: number): string {
  if (linhas <= 12) return "9.2mm";
  if (linhas <= 16) return "7.6mm";
  if (linhas <= 20) return "6.5mm";
  return "5.6mm";
}

const BRANCO: IngredienteDaFolha = { nome: "", codigo: "", quantidade: "", unidade: "", perda: "", observacao: "" };

function normalizarLinhas(linhas: number): number {
  return Number.isFinite(linhas) && linhas > 0 ? Math.min(Math.round(linhas), 40) : LINHAS_PADRAO;
}

const base = (linhas: number): FolhaDados => ({
  prato: "", codigo: "", menu: null, categoria: "", subcategoria: "", rendimento: "", unidadeDoRendimento: "", preco: "",
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
export function folhaDoNome(prato: Pick<DishListItem, "name" | "code" | "menu" | "category" | "yieldQty" | "yieldUnit">, linhas = LINHAS_PADRAO): FolhaDados {
  return {
    ...base(linhas),
    prato: prato.name,
    codigo: prato.code ?? "",
    menu: prato.menu,
    categoria: prato.category?.parentName ?? prato.category?.name ?? "",
    subcategoria: prato.category?.parentName ? prato.category.name : "",
    rendimento: formatarQuantidade(prato.yieldQty),
    unidadeDoRendimento: prato.yieldUnit
  };
}

/** Ficha do sistema impressa: tudo preenchido, mais algumas linhas em branco para anotar mudanças. */
export function folhaDoPrato(detalhe: DishDetail, linhas = LINHAS_PADRAO): FolhaDados {
  const ingredientes = detalhe.items.map<IngredienteDaFolha>((item) => ({
    nome: item.productName,
    codigo: item.productCode ?? "",
    quantidade: formatarQuantidade(item.quantity),
    unidade: item.unit,
    perda: item.wasteFactor > 0 ? `${Math.round(item.wasteFactor * 10_000) / 100}` : "",
    observacao: item.notes ?? ""
  }));

  return {
    ...folhaDoNome(detalhe, linhas),
    preco: detalhe.salePriceDefault == null ? "" : detalhe.salePriceDefault.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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
