// Editar a compra apagava as parcelas e recriava todas como OPEN: a baixa (data,
// valor, conta bancária, estorno) sumia e a conta voltava para "em aberto". Aqui se
// decide o que fazer com as parcelas quando alguma já está paga.

export type ParcelaExistente = {
  dueDate: Date | string | null;
  amount: number | string;
  status: string;
  paidDate: Date | string | null;
};

export type ParcelaEnviada = {
  dueDate: Date | null;
  amount: number | string | { toString(): string };
  status?: string | null;
  paidDate?: Date | null;
};

export type DecisaoParcelas = "RECRIAR" | "MANTER" | "BLOQUEAR";

export class EdicaoComParcelaPagaError extends Error {
  constructor() {
    super("EDICAO_COM_PARCELA_PAGA");
  }
}

const estaPaga = (p: { status?: string | null; paidDate?: Date | string | null }) =>
  Boolean(p.paidDate) || p.status === "PAID" || p.status === "PAID_LATE";

const diaDoVencimento = (value: Date | string | null) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const centavos = (value: { toString(): string } | number | string) => Math.round(Number(value.toString()) * 100);
const chave = (p: { dueDate: Date | string | null; amount: { toString(): string } | number | string }) =>
  `${diaDoVencimento(p.dueDate)}|${centavos(p.amount)}`;

/**
 * RECRIAR: nenhuma parcela paga, ou a própria edição traz a baixa com outra data/valor — fluxo antigo.
 * MANTER: há parcela paga e a edição não mexe na cobrança — não tocar nas parcelas.
 * BLOQUEAR: há parcela paga e a edição mexe em vencimento, valor ou quantidade.
 * Parcela CANCELLED não conta, de nenhum dos lados (a tela reenvia as canceladas na edição).
 */
export function decidirParcelasNaEdicao(existentes: ParcelaExistente[], enviadas: ParcelaEnviada[]): DecisaoParcelas {
  if (!existentes.some(estaPaga)) return "RECRIAR";

  const atuais = existentes.filter((p) => p.status !== "CANCELLED").map(chave).sort();
  const novas = enviadas.filter((p) => p.status !== "CANCELLED").map(chave).sort();
  const iguais = atuais.length === novas.length && atuais.every((c, i) => c === novas[i]);

  if (enviadas.some(estaPaga)) return iguais ? "MANTER" : "RECRIAR";
  return iguais ? "MANTER" : "BLOQUEAR";
}

export const MENSAGEM_PARCELA_PAGA =
  "Esta compra tem parcela ja baixada e a edicao muda vencimento, valor ou quantidade de parcelas. Estorne o pagamento em Contas a Pagar, edite a compra e baixe de novo.";
