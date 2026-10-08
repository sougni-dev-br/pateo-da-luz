import { normalizeText } from "../../shared/utils/normalize-text.js";
import { EMPLOYEE_SUPPLIER_CATEGORY } from "../suppliers/employee-supplier.js";

// Regras do reembolso a funcionario sem banco, para poderem ser testadas sozinhas.

export const REIMBURSEMENT_SOURCE = "REIMBURSEMENT";
export const REIMBURSEMENT_PAYMENT_TYPE = "REIMBURSEMENT";

export type ReimbursementStatus = "OPEN" | "CLOSED" | "PAID" | "CANCELLED";

export class ReimbursementError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

/** So fornecedor da categoria Funcionario pode ser "quem pagou". */
export function ehCategoriaFuncionario(mainCategory: string | null | undefined): boolean {
  return normalizeText(mainCategory) === normalizeText(EMPLOYEE_SUPPLIER_CATEGORY);
}

const cents = (value: number) => Math.round(value * 100);
const dia = (date: Date) => date.toISOString().slice(0, 10);

export type ItemAtual = {
  reportStatus: string;
  payeeId: string;
  amount: number;
  purchaseDate: Date;
};

export type ProximoEstado = {
  payeeId: string | null;
  amount: number;
  purchaseDate: Date;
};

export type Sincronizacao = "NADA" | "ADICIONAR" | "ATUALIZAR" | "MOVER" | "REMOVER" | "BLOQUEADO";

/**
 * O que fazer com o item do reembolso quando a compra e criada ou editada.
 *
 * Reembolso fechado ou pago congela as compras dele: mudar valor, data ou quem pagou
 * mudaria um titulo ja gerado. Editar outros campos da compra (NF, observacao) segue
 * livre, porque nao toca no item.
 */
export function decidirSincronizacao(atual: ItemAtual | null, proximo: ProximoEstado): Sincronizacao {
  if (!atual) return proximo.payeeId ? "ADICIONAR" : "NADA";

  const mudouAlgo = atual.payeeId !== proximo.payeeId
    || cents(atual.amount) !== cents(proximo.amount)
    || dia(atual.purchaseDate) !== dia(proximo.purchaseDate);

  if (atual.reportStatus !== "OPEN") return mudouAlgo ? "BLOQUEADO" : "NADA";
  if (!proximo.payeeId) return "REMOVER";
  if (atual.payeeId !== proximo.payeeId) return "MOVER";
  return mudouAlgo ? "ATUALIZAR" : "NADA";
}

export function mensagemDeBloqueio(reportStatus: string): string {
  return reportStatus === "PAID"
    ? "Esta compra esta num reembolso ja pago. Estorne o pagamento e reabra o reembolso antes de alterar valor, data ou quem pagou."
    : "Esta compra esta num reembolso ja fechado. Reabra o reembolso antes de alterar valor, data ou quem pagou.";
}

export type DadosDoFechamento = {
  status: string;
  itens: Array<{ checked: boolean }>;
  total: number;
  tipoDaFormaDePagamento: string | null;
  vencimento: Date | null;
};

/** Devolve o motivo de nao poder fechar, ou null quando pode. */
export function motivoParaNaoFechar(dados: DadosDoFechamento): string | null {
  if (dados.status !== "OPEN") return "So e possivel fechar um reembolso aberto.";
  if (dados.itens.length === 0) return "Reembolso sem compras. Lance as compras em Compras com a forma de pagamento de reembolso.";
  const naoConferidos = dados.itens.filter((item) => !item.checked).length;
  if (naoConferidos > 0) return `${naoConferidos} compra(s) ainda nao conferida(s) com o comprovante.`;
  if (cents(dados.total) <= 0) return "Reembolso sem valor.";
  if (!dados.tipoDaFormaDePagamento) return "Informe como a pessoa vai receber (PIX, transferencia...).";
  if (dados.tipoDaFormaDePagamento === "CREDIT_CARD" || dados.tipoDaFormaDePagamento === REIMBURSEMENT_PAYMENT_TYPE) {
    return "Escolha como a pessoa vai receber: PIX, transferencia ou dinheiro.";
  }
  if (!dados.vencimento || Number.isNaN(dados.vencimento.getTime())) return "Informe a data de vencimento do reembolso.";
  return null;
}
