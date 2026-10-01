// Rescisão "quitada no termo": CLT cujo termo (TRCT) da contabilidade fecha com líquido
// zero (faltas e descontos consumiram tudo). Não há o que pagar, mas a rescisão precisa
// constar como resolvida. Fica registrada como um lançamento RESCISAO de R$ 0,00 já pago
// na data do termo, marcado com details.quitadaNoTermo — e fora do Contas a Pagar.
//
// Regras puras: casar o termo com a pessoa e dizer se dá para quitar. O CPF do termo só
// serve para casar; nunca entra em mensagem nem é gravado.
import type { ReciboRescisao } from "./tip-trct.service.js";

export type PessoaDoTermo = {
  firstName: string; lastName: string; cpf: string | null; modality: string; terminationDate: Date | null;
};
export type AvaliacaoTermo = {
  casadoPor: "CPF" | "NOME" | null;
  /** Avisos: não impedem quitar, mas a pessoa deve conferir. */
  divergencias: string[];
  /** Motivo que impede marcar como quitada (null = pode). */
  recusa: string | null;
};

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const digitos = (t: string | null) => (t ?? "").replace(/\D/g, "");
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
export const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export function ehQuitadaNoTermo(details: unknown): boolean {
  return details != null && typeof details === "object" && (details as { quitadaNoTermo?: unknown }).quitadaNoTermo === true;
}

// Rescisão "quitada sem valor": calculada aqui (sem termo), com líquido zero ou negativo
// (regra do Eli, 01/10/2026: o saldo devedor é perdoado). Também é um R$ 0,00 já pago e
// fora do Contas a Pagar, mas — ao contrário da do termo — grava a gorjeta na apuração,
// então excluir continua desfazendo a gorjeta. Por isso a marca é outra.
export function ehQuitadaSemValor(details: unknown): boolean {
  return details != null && typeof details === "object" && (details as { quitadaSemValor?: unknown }).quitadaSemValor === true;
}

/** Quitada de qualquer jeito (no termo ou sem valor): nada a pagar nem a estornar. */
export function ehRescisaoQuitada(details: unknown): boolean {
  return ehQuitadaNoTermo(details) || ehQuitadaSemValor(details);
}

function casar(recibo: ReciboRescisao, pessoa: PessoaDoTermo): AvaliacaoTermo["casadoPor"] {
  if (recibo.cpfDigitos && digitos(pessoa.cpf) === recibo.cpfDigitos) return "CPF";
  if (recibo.nome && semAcento(recibo.nome) === semAcento(`${pessoa.firstName} ${pessoa.lastName}`)) return "NOME";
  return null;
}

export function avaliarTermoSemValor(recibo: ReciboRescisao, pessoa: PessoaDoTermo, ctx: { rescisaoViva: boolean }): AvaliacaoTermo {
  const nome = `${pessoa.firstName} ${pessoa.lastName}`.trim();
  const casadoPor = casar(recibo, pessoa);
  if (!casadoPor) {
    return { casadoPor, divergencias: [], recusa: `Este termo é de ${recibo.nome ?? "outra pessoa (nome não lido)"}, não de ${nome}. Escolha o PDF certo.` };
  }

  const divergencias: string[] = [];
  if (casadoPor === "NOME") {
    divergencias.push("O CPF do termo é diferente do CPF no cadastro (ou não foi lido): reconhecido pelo nome completo. Confira o cadastro.");
  }
  const saida = pessoa.terminationDate ? isoDia(pessoa.terminationDate) : null;
  if (saida && recibo.afastamento && saida !== recibo.afastamento) {
    divergencias.push(`Saída no cadastro: ${dataBr(saida)} × afastamento no termo: ${dataBr(recibo.afastamento)}. Confira a data de saída.`);
  }
  if (recibo.gorjeta != null && recibo.gorjeta > 0) {
    divergencias.push(`O termo traz gorjeta de ${reais(recibo.gorjeta)}: se a pessoa está na apuração de gorjeta do mês, importe o termo lá também.`);
  }

  const recusa = (() => {
    if (pessoa.modality === "NAO_CLT") return "Sem registro não tem termo da contabilidade: a rescisão é apurada e lançada aqui.";
    if (!saida) return "Registre a data de saída antes (passo 1).";
    if (ctx.rescisaoViva) return "Rescisão já lançada para este funcionário.";
    if (recibo.liquido == null) return "Não consegui ler o líquido do termo: sem ele não dá para marcar como quitada.";
    if (Math.abs(recibo.liquido) >= 0.005) {
      return `O termo tem líquido de ${reais(recibo.liquido)}: há o que pagar. Lance a rescisão normal no passo 4.`;
    }
    return null;
  })();

  return { casadoPor, divergencias, recusa };
}
