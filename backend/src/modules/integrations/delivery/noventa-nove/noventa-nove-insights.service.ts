// Painel do dono da 99 Food.
//
// Mesma ideia do painel do iFood, mas sobre dado REAL: a 99 tem faturamento
// conciliado de abril a setembro de 2026. Por isso duas contas foram refeitas em
// vez de copiadas — ver painel-dono-calculo.ts:
//
//   - a projecao projeta de verdade, em vez de repetir o total do mes corrente;
//   - a comparacao com o ano passado diz "sem base" quando nao ha ano passado,
//     em vez de anunciar +100%.

import { listStores, lerResumoDaLoja } from "./noventa-nove.service.js";
import { participacao, projetarMes, round2, ticketMedio, variacao, type Projecao, type Variacao } from "./painel-dono-calculo.js";
import type { NoventaNovePeriodSummary } from "./noventa-nove.types.js";

// Limites de alerta. Ficam aqui, visiveis, em vez de espalhados em ifs.
const LIMITES = {
  /** Deducao real (bruto − liquido) sobre o bruto. */
  DEDUCAO_PERCENT: 25,
  /** Queda do liquido de uma loja contra o mes anterior. */
  QUEDA_PERCENT: -15
};

const DIAS_DA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type PainelDonoNoventaNove = {
  period: { year: number; month: number; diaDeHoje: number; diasNoMes: number; mesEmCurso: boolean };
  current: { orders: number; grossAmount: number; netAmount: number; ticketAverage: number };
  previousMonth: {
    orders: number; grossAmount: number; netAmount: number; ticketAverage: number;
    deltaGross: Variacao; deltaNet: Variacao;
  };
  lastYear: {
    orders: number; grossAmount: number; netAmount: number; ticketAverage: number;
    deltaGross: Variacao; deltaNet: Variacao;
  };
  projection: Projecao;
  ranking: Array<{
    storeId: string; storeLabel: string;
    grossAmount: number; netAmount: number; orders: number;
    sharePercent: number; deltaVsPreviousMonth: Variacao;
  }>;
  breakdown: {
    /** (bruto − líquido) / bruto. Verdade aritmética: é o que a plataforma reteve. */
    deducaoPercent: number;
    /** líquido / bruto. */
    liquidoPercent: number;
    deducaoValor: number;
    /**
     * Valores que a plataforma informa por pedido. NÃO são fatias da dedução e
     * NÃO somam com ela — por isso vêm em reais, sem percentual do bruto.
     *
     * `promocao` é calculada sobre o PREÇO DE TABELA, enquanto o bruto já é a
     * receita líquida de desconto: a razão entre as duas passa de 100% e não
     * significa nada. Em jul/ago/set dava 71%, 76% e 78,6% — um alerta de
     * "promoção alta" disparava todo mês dizendo bobagem.
     */
    informadoPelaPlataforma: {
      taxa: number; promocao: number; entrega: number; outrasTaxas: number;
      /** `false` em abr–jun/2026: vieram do relatório do portal, que não traz esses campos. */
      disponivel: boolean;
    };
  };
  weekday: Array<{ dow: number; label: string; avgNet: number; avgOrders: number; dias: number }>;
  ticketByStore: Array<{ storeId: string; storeLabel: string; ticket: number; delta: Variacao }>;
  alerts: Array<{ severity: "info" | "warn" | "danger"; title: string; message: string; storeId: string | null }>;
  /** `true` quando nenhuma loja tem venda no mes — a tela avisa em vez de mostrar zeros mudos. */
  semDados: boolean;
};

function deslocarMes(year: number, month: number, passos: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + passos;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

type Totais = { orders: number; grossAmount: number; noventaNoveFeeAmount: number; promotionAmount: number; deliveryFeeAmount: number; netAmount: number; otherFees: number };

function somar(resumos: NoventaNovePeriodSummary[]): Totais {
  return resumos.reduce<Totais>(
    (acc, r) => ({
      orders: acc.orders + r.totals.orders,
      grossAmount: acc.grossAmount + r.totals.grossAmount,
      noventaNoveFeeAmount: acc.noventaNoveFeeAmount + r.totals.noventaNoveFeeAmount,
      promotionAmount: acc.promotionAmount + r.totals.promotionAmount,
      deliveryFeeAmount: acc.deliveryFeeAmount + r.totals.deliveryFeeAmount,
      netAmount: acc.netAmount + r.totals.netAmount,
      otherFees: acc.otherFees + r.totals.otherFees
    }),
    { orders: 0, grossAmount: 0, noventaNoveFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 }
  );
}

export async function getPainelDono(params: { year: number; month: number }): Promise<PainelDonoNoventaNove> {
  const lojas = (await listStores()).filter((loja) => loja.active);

  // Loja sem venda vira resumo zerado — nunca mock. Guardamos o `storeId` para
  // casar os meses por LOJA, e nao por posicao no array: o painel do iFood usava
  // `prevPerStore[idx]`, que troca as lojas de lugar se alguma entrar ou sair.
  const lerMes = async (year: number, month: number) => {
    const mapa = new Map<string, NoventaNovePeriodSummary>();
    for (const loja of lojas) {
      const real = await lerResumoDaLoja(loja, year, month);
      if (real) mapa.set(loja.id, real);
    }
    return mapa;
  };

  const atual = await lerMes(params.year, params.month);
  const anteriorRef = deslocarMes(params.year, params.month, -1);
  const anterior = await lerMes(anteriorRef.year, anteriorRef.month);
  const anoPassadoRef = deslocarMes(params.year, params.month, -12);
  const anoPassado = await lerMes(anoPassadoRef.year, anoPassadoRef.month);

  const cur = somar([...atual.values()]);
  const prev = somar([...anterior.values()]);
  const ano = somar([...anoPassado.values()]);

  const agora = new Date();
  const mesEmCurso = agora.getUTCFullYear() === params.year && agora.getUTCMonth() + 1 === params.month;
  const diasNoMes = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate();
  const diaDeHoje = mesEmCurso ? agora.getUTCDate() : diasNoMes;

  const diasComVenda = new Set<string>();
  for (const resumo of atual.values()) for (const linha of resumo.daily) diasComVenda.add(linha.date);

  const projection = projetarMes({
    grossAteAgora: cur.grossAmount,
    netAteAgora: cur.netAmount,
    diasComVenda: diasComVenda.size,
    diaDeHoje,
    diasNoMes,
    mesEmCurso
  });

  const ranking = lojas
    .map((loja) => {
      const r = atual.get(loja.id);
      const p = anterior.get(loja.id);
      return {
        storeId: loja.id,
        storeLabel: loja.nickname,
        grossAmount: round2(r?.totals.grossAmount ?? 0),
        netAmount: round2(r?.totals.netAmount ?? 0),
        orders: r?.totals.orders ?? 0,
        sharePercent: participacao(r?.totals.grossAmount ?? 0, cur.grossAmount),
        deltaVsPreviousMonth: variacao(r?.totals.netAmount ?? 0, p?.totals.netAmount ?? 0)
      };
    })
    .filter((linha) => linha.grossAmount !== 0 || linha.orders !== 0)
    .sort((a, b) => b.grossAmount - a.grossAmount);

  const deducao = cur.grossAmount - cur.netAmount;
  const informados = cur.noventaNoveFeeAmount + cur.promotionAmount + cur.deliveryFeeAmount + cur.otherFees;
  const breakdown = {
    deducaoPercent: participacao(deducao, cur.grossAmount),
    liquidoPercent: participacao(cur.netAmount, cur.grossAmount),
    deducaoValor: round2(deducao),
    informadoPelaPlataforma: {
      taxa: round2(cur.noventaNoveFeeAmount),
      promocao: round2(cur.promotionAmount),
      entrega: round2(cur.deliveryFeeAmount),
      outrasTaxas: round2(cur.otherFees),
      disponivel: informados !== 0
    }
  };

  // Media por dia da semana: soma o dia de todas as lojas primeiro, depois tira
  // a media entre as datas. Somar loja a loja faria a media cair conforme o
  // numero de lojas, nao conforme o movimento.
  const porData = new Map<string, { net: number; orders: number }>();
  for (const resumo of atual.values()) {
    for (const linha of resumo.daily) {
      const anteriorDia = porData.get(linha.date) ?? { net: 0, orders: 0 };
      porData.set(linha.date, { net: anteriorDia.net + linha.netAmount, orders: anteriorDia.orders + linha.orders });
    }
  }
  const porDiaDaSemana = new Map<number, { net: number; orders: number; dias: number }>();
  for (const [data, valores] of porData) {
    const dow = new Date(data + "T12:00:00.000Z").getUTCDay();
    const acc = porDiaDaSemana.get(dow) ?? { net: 0, orders: 0, dias: 0 };
    porDiaDaSemana.set(dow, { net: acc.net + valores.net, orders: acc.orders + valores.orders, dias: acc.dias + 1 });
  }
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const b = porDiaDaSemana.get(dow);
    return {
      dow,
      label: DIAS_DA_SEMANA[dow],
      avgNet: b && b.dias > 0 ? round2(b.net / b.dias) : 0,
      avgOrders: b && b.dias > 0 ? Math.round(b.orders / b.dias) : 0,
      dias: b?.dias ?? 0
    };
  });

  const ticketByStore = ranking.map((linha) => {
    const p = anterior.get(linha.storeId);
    const ticketAtual = ticketMedio(linha.grossAmount, linha.orders);
    const ticketAnterior = ticketMedio(p?.totals.grossAmount ?? 0, p?.totals.orders ?? 0);
    return {
      storeId: linha.storeId,
      storeLabel: linha.storeLabel,
      ticket: ticketAtual,
      delta: variacao(ticketAtual, ticketAnterior)
    };
  });

  // Só alertamos sobre o que é aritmeticamente sólido: a dedução real
  // (bruto − líquido) e a queda de uma loja contra o mês anterior.
  //
  // Ficaram de fora, de propósito, os alertas de "taxa alta" e "promoção alta"
  // que o painel do iFood tinha: os dois comparam um valor informado pela
  // plataforma com o bruto, e esses números não são comparáveis. O de promoção
  // disparava em 100% dos meses com dado de API (71%, 76%, 78,6%) dizendo que a
  // loja bancava três quartos do faturamento em desconto — o que não aconteceu.
  const alerts: PainelDonoNoventaNove["alerts"] = [];
  if (cur.grossAmount > 0) {
    if (breakdown.deducaoPercent > LIMITES.DEDUCAO_PERCENT) {
      alerts.push({ severity: "danger", title: "Dedução total alta",
        message: `A plataforma reteve ${breakdown.deducaoPercent.toFixed(1)}% do bruto (limite ${LIMITES.DEDUCAO_PERCENT}%). Restou ${breakdown.liquidoPercent.toFixed(1)}%.`, storeId: null });
    }
    for (const loja of ranking) {
      if (loja.deltaVsPreviousMonth.comparavel && loja.deltaVsPreviousMonth.percentual < LIMITES.QUEDA_PERCENT) {
        alerts.push({ severity: "danger", title: `${loja.storeLabel} caiu`,
          message: `Líquido ${Math.abs(loja.deltaVsPreviousMonth.percentual).toFixed(1)}% abaixo do mês anterior.`, storeId: loja.storeId });
      }
    }
  }

  return {
    period: { year: params.year, month: params.month, diaDeHoje, diasNoMes, mesEmCurso },
    current: {
      orders: cur.orders,
      grossAmount: round2(cur.grossAmount),
      netAmount: round2(cur.netAmount),
      ticketAverage: ticketMedio(cur.grossAmount, cur.orders)
    },
    previousMonth: {
      orders: prev.orders,
      grossAmount: round2(prev.grossAmount),
      netAmount: round2(prev.netAmount),
      ticketAverage: ticketMedio(prev.grossAmount, prev.orders),
      deltaGross: variacao(cur.grossAmount, prev.grossAmount),
      deltaNet: variacao(cur.netAmount, prev.netAmount)
    },
    lastYear: {
      orders: ano.orders,
      grossAmount: round2(ano.grossAmount),
      netAmount: round2(ano.netAmount),
      ticketAverage: ticketMedio(ano.grossAmount, ano.orders),
      deltaGross: variacao(cur.grossAmount, ano.grossAmount),
      deltaNet: variacao(cur.netAmount, ano.netAmount)
    },
    projection,
    ranking,
    breakdown,
    weekday,
    ticketByStore,
    alerts,
    semDados: atual.size === 0
  };
}
