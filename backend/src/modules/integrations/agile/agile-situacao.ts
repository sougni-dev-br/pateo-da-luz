// Situação de uma venda (e de um item) do Agile PDV. Fonte ÚNICA: o sync, as consultas ao banco e
// os relatórios comparam com estas constantes, para a mesma venda não ser contada de um jeito na
// tela e de outro no filtro.
//
// O PDV grava "RECEBIDA" (venda paga) e "CANCELADA". Comanda ainda aberta aparece como
// "EM ABERTO"/"CONSUMINDO" no nível do item; nem é venda nem é cancelamento. A comparação é por
// IGUALDADE EXATA de propósito: é a mesma que o Prisma faz nos `where: { saleStatus: ... }`, então
// um predicado em memória nunca discorda da consulta.
export const SITUACAO_RECEBIDA = "RECEBIDA";
export const SITUACAO_CANCELADA = "CANCELADA";

export type FamiliaDaSituacao = typeof SITUACAO_RECEBIDA | typeof SITUACAO_CANCELADA | "OUTRA";

export const ehRecebida = (situacao: string | null | undefined): boolean => situacao === SITUACAO_RECEBIDA;
export const ehCancelada = (situacao: string | null | undefined): boolean => situacao === SITUACAO_CANCELADA;

export function classificarSituacao(situacao: string | null | undefined): FamiliaDaSituacao {
  if (ehRecebida(situacao)) return SITUACAO_RECEBIDA;
  if (ehCancelada(situacao)) return SITUACAO_CANCELADA;
  return "OUTRA";
}
