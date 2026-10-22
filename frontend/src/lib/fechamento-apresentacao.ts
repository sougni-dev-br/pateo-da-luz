// Como o Fechamento Mensal APRESENTA as pendências.
//
// O backend devolve cada pendência como uma frase única ("Cartão X (final 1234):
// fatura não conferida…"). Com a lista passando de uma dezena de itens, frase
// inteira com o mesmo peso vira parede de texto: ninguém separa o QUE é do POR QUÊ.
// Aqui a frase é dividida em título e detalhe e as pendências são agrupadas por
// área, na ordem em que a pessoa confere o mês. Só apresentação — a regra de
// quem bloqueia o fechamento continua toda no backend.

import type { PendenciaDoFechamento } from "./fechamento-pendencias";

export const GRUPOS_DO_FECHAMENTO = [
  "Faturamento",
  "Compras",
  "Fornecedores obrigatórios",
  "Cartões de crédito",
  "Pessoal",
  "Impostos",
  "Estoque",
  "Outros"
] as const;

export type GrupoDoFechamento = (typeof GRUPOS_DO_FECHAMENTO)[number];

const GRUPO_POR_CHAVE: Record<string, GrupoDoFechamento> = {
  "block:revenue": "Faturamento",
  "block:eventRevenue": "Faturamento",
  "block:purchasesWithoutItems": "Compras",
  "block:purchaseDateFarFromCompetence": "Compras",
  "block:payrollNotLaunched": "Pessoal",
  "block:payrollWithoutDreCategory": "Pessoal",
  "block:tipsNotClosed": "Pessoal",
  "block:taxes": "Impostos",
  "block:taxesWithoutCompetence": "Impostos",
  "block:finalInventory": "Estoque",
  "block:inventoryItemsWithoutCost": "Estoque"
};

const PREFIXO_POR_GRUPO: Array<[string, GrupoDoFechamento]> = [
  ["delivery:", "Faturamento"],
  ["card:", "Cartões de crédito"],
  ["supplier:", "Fornecedores obrigatórios"]
];

export function grupoDaPendencia(key: string): GrupoDoFechamento {
  const direto = GRUPO_POR_CHAVE[key];
  if (direto) return direto;
  return PREFIXO_POR_GRUPO.find(([prefixo]) => key.startsWith(prefixo))?.[1] ?? "Outros";
}

/** Dois-pontos além deste ponto não é rótulo: é parte da frase. */
const TAMANHO_MAXIMO_DO_TITULO = 70;
const TRAVESSAO = " — ";

const NOME_DA_CHAVE: Record<string, string> = {
  "block:revenue": "Faturamento do salão",
  "block:eventRevenue": "Eventos / empreitada",
  "block:purchasesWithoutItems": "Compras sem itens",
  "block:purchaseDateFarFromCompetence": "Notas com data distante da competência",
  "block:payrollNotLaunched": "Folha do mês",
  "block:payrollWithoutDreCategory": "Folha sem categoria de DRE",
  "block:tipsNotClosed": "Gorjeta do mês",
  "block:taxes": "Impostos",
  "block:taxesWithoutCompetence": "Impostos sem competência",
  "block:finalInventory": "Inventário final",
  "block:inventoryItemsWithoutCost": "Itens do inventário sem custo",
  "delivery:IFOOD": "Delivery iFood",
  "delivery:NOVENTA_NOVE": "Delivery 99 Food",
  "delivery:KEETA": "Delivery Keeta"
};

/**
 * Nome curto do que uma justificativa cobre. Cartão e fornecedor dependem de
 * cadastro (devolve null: quem chama resolve pelo nome); o resto é fixo.
 */
export function nomeDaChave(key: string): string | null {
  const fixo = NOME_DA_CHAVE[key];
  if (fixo) return fixo;
  if (key.startsWith("card:") || key.startsWith("supplier:")) return null;
  return key;
}

export type PendenciaDescrita = {
  grupo: GrupoDoFechamento;
  titulo: string;
  /** Explicação do porquê. Vazio quando a frase é curta o bastante para ser só título. */
  detalhe: string;
};

function partirNoPrimeiro(texto: string, separador: string): [string, string] | null {
  const i = texto.indexOf(separador);
  if (i <= 0 || i > TAMANHO_MAXIMO_DO_TITULO) return null;
  return [texto.slice(0, i).trim(), texto.slice(i + separador.length).trim()];
}

export function descreverPendencia(key: string, label: string): PendenciaDescrita {
  const grupo = grupoDaPendencia(key);
  const iTravessao = label.indexOf(TRAVESSAO);
  const iDoisPontos = label.indexOf(": ");

  // Vale o separador que aparece primeiro: "Fatura aberta — veja: detalhes" é
  // título + detalhe, não "Fatura aberta — veja" + "detalhes".
  const travessaoVemPrimeiro = iTravessao >= 0 && (iDoisPontos < 0 || iTravessao < iDoisPontos);
  const partido = travessaoVemPrimeiro
    ? partirNoPrimeiro(label, TRAVESSAO)
    : partirNoPrimeiro(label, ": ") ?? partirNoPrimeiro(label, TRAVESSAO);

  if (!partido) return { grupo, titulo: label, detalhe: "" };
  return { grupo, titulo: partido[0], detalhe: partido[1] };
}

export type GrupoDePendencias<T extends PendenciaDoFechamento> = {
  grupo: GrupoDoFechamento;
  itens: Array<T & PendenciaDescrita>;
};

/** Agrupa na ordem fixa das áreas; dentro de cada uma, mantém a ordem recebida. */
export function agruparPendencias<T extends PendenciaDoFechamento>(pendencias: T[]): GrupoDePendencias<T>[] {
  const grupos: GrupoDePendencias<T>[] = [];
  for (const grupo of GRUPOS_DO_FECHAMENTO) {
    const itens = pendencias
      .filter((p) => grupoDaPendencia(p.key) === grupo)
      .map((p) => ({ ...p, ...descreverPendencia(p.key, p.label) }));
    if (itens.length > 0) grupos.push({ grupo, itens });
  }
  return grupos;
}
