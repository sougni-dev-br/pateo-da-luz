// Montagem das parcelas de uma compra: quantidade efetiva, rateio do valor e
// vencimentos. Extraído de Purchases.tsx em 2026-09-15 — lá isso vivia dentro de
// dois métodos que também mexiam no estado do React, e por isso nunca teve teste.
//
// Tudo aqui é puro: nada de Date.now() nem de estado. Quem chama resolve a data
// de compra antes (ver dataCompra) e decide o que fazer com o resultado.

import { dividirValor, FormaPagamento, formaPermiteParcelamento, somarDias } from "./formas-pagamento";

/** Uma linha da grade de parcelas. `amount` é string porque o campo é um <input type="number"> controlado. */
export type ParcelaMontada = {
  installment: number;
  dueDate: string;
  amount: string;
};

/**
 * Primeiro vencimento em `diasAteAPrimeira`, os seguintes de 30 em 30.
 * `datasExistentes` são os vencimentos já na tela: uma data ajustada à mão
 * não pode ser sobrescrita só porque o valor da compra mudou.
 */
export type EscadaDeTrintaDias = {
  modo: "escada";
  diasAteAPrimeira: number;
  datasExistentes?: ReadonlyArray<string | undefined>;
};

/**
 * Vencimentos nos dias combinados com o fornecedor (o "30/60/90" do cadastro).
 * Se pedirem mais parcelas do que há dias na lista, as extras continuam
 * de 30 em 30 a partir do último dia informado.
 */
export type DiasDoFornecedor = {
  modo: "dias";
  dias: readonly number[];
};

export type RegraDeVencimento = EscadaDeTrintaDias | DiasDoFornecedor;

export type MontarParcelasParams = {
  forma: FormaPagamento | null | undefined;
  total: number;
  /** O que o usuário pediu; formas à vista ignoram e caem para 1. */
  parcelasPedidas: number;
  /** "aaaa-mm-dd" já resolvida — passe `dataDaCompra || hoje`, esta função não conhece "hoje". */
  dataCompra: string;
  vencimento: RegraDeVencimento;
};

/** PIX e dinheiro não parcelam: o backend recusa, então a tela nem oferece. */
export function quantidadeEfetivaDeParcelas(forma: FormaPagamento | null | undefined, parcelasPedidas: number): number {
  if (!formaPermiteParcelamento(forma)) return 1;
  return Math.max(1, parcelasPedidas || 1);
}

function vencimentoDaParcela(indice: number, dataCompra: string, regra: RegraDeVencimento): string {
  if (regra.modo === "dias") {
    const ultimoDia = regra.dias[regra.dias.length - 1] ?? 30;
    const dia = regra.dias[indice] ?? ultimoDia + (indice - regra.dias.length + 1) * 30;
    return somarDias(dataCompra, dia);
  }

  const jaEscolhida = regra.datasExistentes?.[indice];
  if (jaEscolhida) return jaEscolhida;

  const primeiroVencimento = somarDias(dataCompra, regra.diasAteAPrimeira);
  return somarDias(primeiroVencimento, indice * 30);
}

/** Monta a grade inteira. A soma das parcelas fecha exatamente com o total. */
export function montarParcelas({ forma, total, parcelasPedidas, dataCompra, vencimento }: MontarParcelasParams): ParcelaMontada[] {
  const quantidade = quantidadeEfetivaDeParcelas(forma, parcelasPedidas);
  return dividirValor(total, quantidade).map((valor, indice) => ({
    installment: indice + 1,
    dueDate: vencimentoDaParcela(indice, dataCompra, vencimento),
    amount: valor.toFixed(2)
  }));
}
