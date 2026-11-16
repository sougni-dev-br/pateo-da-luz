// Importar ficha de registro: regras da tela, sem React. O que vem marcado, quantos itens
// estão marcados e o que é enviado ao servidor (só ids por funcionário; nunca valores).
import type { FichaItemImportacao, FichaPessoaPrevista, FichaTipoItem } from "../../api/client";

/** Marcados por pessoa (chave da pessoa → ids dos itens). */
export type Selecao = Record<string, string[]>;

export const ROTULO_TIPO: Record<FichaTipoItem, string> = {
  PREENCHE: "Preencher campo vazio",
  DIVERGE: "Trocar pelo valor da ficha",
  SALARIO: "Salário",
  CARGO: "Cargo",
  EMPRESA: "Empresa",
  LISTAS: "Férias, carteira e dependentes",
};

/** Ordem em que os grupos aparecem: do mais seguro ao que mexe em folha. */
export const ORDEM_TIPOS: readonly FichaTipoItem[] = ["PREENCHE", "LISTAS", "CARGO", "EMPRESA", "SALARIO", "DIVERGE"];

export const podeMarcar = (item: FichaItemImportacao) => item.bloqueio === null;

/** Já vem marcado só o que é seguro: preencher vazio (e as listas, na primeira importação). */
export function selecaoInicial(pessoas: readonly FichaPessoaPrevista[]): Selecao {
  const out: Selecao = {};
  for (const p of pessoas) {
    const ids = p.itens.filter((i) => i.padrao && podeMarcar(i)).map((i) => i.id);
    if (ids.length > 0) out[p.chave] = ids;
  }
  return out;
}

export function alternar(selecao: Selecao, chave: string, id: string): Selecao {
  const atuais = selecao[chave] ?? [];
  const novos = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
  return { ...selecao, [chave]: novos };
}

/** "Marcar tudo" não inclui as trocas de dados pessoais (DIVERGE): essas se marcam uma a uma. */
export function marcarTodos(selecao: Selecao, pessoa: FichaPessoaPrevista, marcar: boolean): Selecao {
  return { ...selecao, [pessoa.chave]: marcar ? pessoa.itens.filter((i) => podeMarcar(i) && i.tipo !== "DIVERGE").map((i) => i.id) : [] };
}

export function totais(selecao: Selecao): { itens: number; pessoas: number } {
  const listas = Object.values(selecao).filter((ids) => ids.length > 0);
  return { itens: listas.reduce((n, ids) => n + ids.length, 0), pessoas: listas.length };
}

/** O que vai ao servidor: por funcionário, só quem tem cadastro e item marcado. */
export function selecoesParaEnvio(selecao: Selecao, pessoas: readonly FichaPessoaPrevista[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of pessoas) {
    const ids = selecao[p.chave] ?? [];
    if (p.employeeId && ids.length > 0) out[p.employeeId] = ids;
  }
  return out;
}

export const temSalario = (selecao: Selecao) => Object.values(selecao).some((ids) => ids.includes("salario"));

/** Itens do grupo, na ordem de apresentação. */
export function itensPorTipo(itens: readonly FichaItemImportacao[]): Array<{ tipo: FichaTipoItem; itens: FichaItemImportacao[] }> {
  return ORDEM_TIPOS
    .map((tipo) => ({ tipo, itens: itens.filter((i) => i.tipo === tipo) }))
    .filter((g) => g.itens.length > 0);
}

export const ROTULO_SITUACAO = {
  COM_ITENS: "Tem o que revisar",
  EM_DIA: "Em dia",
  SEM_CADASTRO: "Sem cadastro no ERP",
  CPF_DUPLICADO: "CPF em mais de um cadastro",
  NOME_DIFERENTE: "Nome não confere com o CPF",
} as const;
