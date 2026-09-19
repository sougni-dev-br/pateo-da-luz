// Contas do resumo da Keeta, separadas do banco para poderem ser testadas.
//
// A Keeta é a primeira plataforma de delivery do ERP SEM integração: não há
// `KeetaSale`, não há `DeliveryStore`, não há repasse importado. O faturamento
// dela vive inteiro em `RevenueEntry` (`sourcePlatform = 'Keeta'`), importado do
// portal — ver a memória `keeta-importada-abr-set`.
//
// Por isso este módulo não se parece com o da 99: lá o resumo é montado a partir
// de venda por venda; aqui a linha diária JÁ É o dado, e o que resta é somar e
// comparar. A consequência prática está em `KeetaResumo.detalhamento`: a Keeta
// não sabe dizer quanto da dedução foi taxa, quanto foi entrega e quanto foi
// promoção — o import gravou só o total em `platformFees`.

import { participacao, round2, ticketMedio, variacao, type Variacao } from "../noventa-nove/painel-dono-calculo.js";

export type KeetaDia = {
  date: string;
  orders: number;
  grossAmount: number;
  netAmount: number;
};

export type KeetaTotais = {
  orders: number;
  grossAmount: number;
  /** bruto − líquido: comissão e taxas retidas pela Keeta. */
  deductionAmount: number;
  netAmount: number;
  ticketAverage: number;
  deductionPercent: number;
  netPercent: number;
};

export type KeetaResumo = {
  period: { year: number; month: number };
  totals: KeetaTotais;
  daily: KeetaDia[];
  previousMonth: {
    year: number;
    month: number;
    totals: KeetaTotais;
    deltaGross: Variacao;
    deltaNet: Variacao;
    deltaOrders: Variacao;
  };
  /** `true` quando o mês não tem nenhuma linha — a tela avisa em vez de mostrar zeros mudos. */
  semDados: boolean;
};

export function somarTotais(dias: KeetaDia[]): KeetaTotais {
  const orders = dias.reduce((s, d) => s + d.orders, 0);
  const grossAmount = round2(dias.reduce((s, d) => s + d.grossAmount, 0));
  const netAmount = round2(dias.reduce((s, d) => s + d.netAmount, 0));
  const deductionAmount = round2(grossAmount - netAmount);
  return {
    orders,
    grossAmount,
    netAmount,
    deductionAmount,
    ticketAverage: ticketMedio(grossAmount, orders),
    deductionPercent: participacao(deductionAmount, grossAmount),
    netPercent: participacao(netAmount, grossAmount)
  };
}

export function mesAnterior(year: number, month: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) - 1;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function montarResumo(input: {
  year: number;
  month: number;
  dias: KeetaDia[];
  diasAnteriores: KeetaDia[];
}): KeetaResumo {
  const totals = somarTotais(input.dias);
  const anteriores = somarTotais(input.diasAnteriores);
  const ref = mesAnterior(input.year, input.month);
  return {
    period: { year: input.year, month: input.month },
    totals,
    daily: [...input.dias].sort((a, b) => a.date.localeCompare(b.date)),
    previousMonth: {
      year: ref.year,
      month: ref.month,
      totals: anteriores,
      deltaGross: variacao(totals.grossAmount, anteriores.grossAmount),
      deltaNet: variacao(totals.netAmount, anteriores.netAmount),
      deltaOrders: variacao(totals.orders, anteriores.orders)
    },
    semDados: input.dias.length === 0
  };
}
