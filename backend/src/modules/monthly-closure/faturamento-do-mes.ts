// Como o Fechamento Mensal soma o faturamento do mes.
//
// Existe separado do service para poder ser testado sem banco — a regra aqui e
// aritmetica, e foi exatamente a aritmetica que estava errada.
//
// O defeito (auditoria de 18/09/2026): `getRevenueSummary` montava `salon` com
// um SELECT sobre TODO o RevenueEntry, sem filtrar origem — ou seja, ja trazia
// 99 Food, iFood e Keeta dentro. Em seguida o painel e o `lockMonthlyClosure`
// faziam `salon + ifood + noventaNove`, somando o delivery de novo:
//
//   junho/2026: tela mostrava R$ 362.383,72 contra R$ 299.030,58 do razao
//   abril a setembro: R$ 398.262,10 contados duas vezes
//
// A correcao nao e mexer na soma, e parar de precisar dela: o razao
// (`RevenueEntry`) ja e a fonte unica e ja contem tudo. As partes existem para
// serem MOSTRADAS, nao somadas.

export type ParcelaDeFaturamento = {
  rotulo: string;
  grossAmount: number;
  netAmount: number;
  tickets: number;
};

export type FaturamentoDoMes = {
  /** Total do mes. Vem do razao inteiro, nunca da soma das parcelas. */
  total: { grossAmount: number; netAmount: number };
  /** Apenas para exibicao, uma linha por origem. */
  parcelas: ParcelaDeFaturamento[];
};

const round2 = (valor: number) => Math.round(valor * 100) / 100;

/**
 * `total` e lido do razao; `parcelas` sao as origens daquele mesmo razao.
 *
 * Invariante que o teste cobre: a soma das parcelas tem de bater com o total.
 * Se um dia deixar de bater, e porque alguma origem ficou de fora da consulta —
 * e e melhor descobrir por um numero que nao fecha do que por um total inflado.
 */
export function montarFaturamento(
  totalDoRazao: { grossAmount: number; netAmount: number },
  parcelas: ParcelaDeFaturamento[]
): FaturamentoDoMes {
  return {
    total: { grossAmount: round2(totalDoRazao.grossAmount), netAmount: round2(totalDoRazao.netAmount) },
    parcelas: parcelas.map((parcela) => ({
      rotulo: parcela.rotulo,
      grossAmount: round2(parcela.grossAmount),
      netAmount: round2(parcela.netAmount),
      tickets: parcela.tickets
    }))
  };
}

/** Quanto as parcelas deixam de explicar do total. Zero e o esperado. */
export function sobraNaoExplicada(faturamento: FaturamentoDoMes): number {
  const somaDasParcelas = faturamento.parcelas.reduce((total, parcela) => total + parcela.grossAmount, 0);
  return round2(faturamento.total.grossAmount - somaDasParcelas);
}
