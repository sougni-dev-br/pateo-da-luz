// Resumo do iFood montado a partir da RECEITA importada do portal (`RevenueEntry`).
//
// Enquanto a integração oficial não existe (`IfoodSale` vazio), o faturamento do
// iFood vive em `RevenueEntry` (sourcePlatform = 'iFood'), uma linha MENSAL por
// loja importada do portal — mesmo caminho da Keeta (ver keeta-resumo.ts). Sem
// este resumo, as telas de Delivery mostravam o iFood zerado ao lado de um DRE e
// de um Faturamento que já o contavam.
//
// O portal só dá número mensal, então `daily` tem uma linha por loja (a data da
// linha é o último dia do mês, ou do dia da coleta em mês em curso).

import type { IfoodPeriodSummary, IfoodSettlementRow } from "./ifood.types.js";

export type LinhaReceitaIfood = {
  date: Date;
  description: string | null;
  tickets: number;
  grossAmount: number;
  platformFees: number;
  netAmount: number;
};

const round2 = (valor: number) => Math.round(valor * 100) / 100;

/** Chave de comparação de nome de loja: sem acento, sem "&", sem pontuação, sem espaço. */
export function chaveDaLoja(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Extrai o nome da loja de "Delivery iFood - <loja> (consolidado do mes)".
 * Devolve `null` para linha que não é a consolidada do portal (ex.: linha diária antiga).
 */
export function lojaDaDescricao(descricao: string | null): string | null {
  if (!descricao) return null;
  const m = descricao.match(/^Delivery iFood - (.+) \(consolidado do mes\)$/);
  return m ? m[1]! : null;
}

/**
 * `null` quando a loja não tem linha consolidada no mês — o chamador decide o
 * que mostrar. Comparação por nome INTEIRO normalizado: "Pateo da Luz" nunca casa
 * com "Pateo da Luz Pizzaria" (nome que é prefixo de outro não serve de chave).
 */
export function resumoDeReceita(input: {
  storeId: string;
  storeLabel: string;
  year: number;
  month: number;
  linhas: LinhaReceitaIfood[];
  settlements: IfoodSettlementRow[];
}): IfoodPeriodSummary | null {
  const alvo = chaveDaLoja(input.storeLabel);
  const doMes = input.linhas.filter((linha) => {
    const loja = lojaDaDescricao(linha.description);
    return loja !== null && chaveDaLoja(loja) === alvo;
  });
  if (doMes.length === 0) return null;

  const orders = doMes.reduce((s, l) => s + l.tickets, 0);
  const grossAmount = round2(doMes.reduce((s, l) => s + l.grossAmount, 0));
  const netAmount = round2(doMes.reduce((s, l) => s + l.netAmount, 0));

  return {
    period: { year: input.year, month: input.month },
    storeId: input.storeId,
    storeLabel: input.storeLabel,
    totals: {
      orders,
      grossAmount,
      // Tudo que o portal retém (comissão, taxas, anúncios, mensalidade): um número só.
      ifoodFeeAmount: round2(grossAmount - netAmount),
      // A promoção da loja já foi descontada do bruto na importação.
      promotionAmount: 0,
      deliveryFeeAmount: 0,
      netAmount,
      otherFees: 0
    },
    daily: doMes
      .map((l) => ({
        date: l.date.toISOString().slice(0, 10),
        orders: l.tickets,
        grossAmount: round2(l.grossAmount),
        ifoodFeeAmount: round2(l.grossAmount - l.netAmount),
        promotionAmount: 0,
        deliveryFeeAmount: 0,
        netAmount: round2(l.netAmount)
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    fees: [],
    settlements: input.settlements,
    isMock: false
  };
}
