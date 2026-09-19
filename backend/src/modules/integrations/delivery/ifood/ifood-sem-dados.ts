import type { IfoodPeriodSummary } from "./ifood.types.js";

// Sem venda sincronizada, a resposta e ZERO — nunca numero inventado.
//
// Ate 18/09/2026 `summaryForStore` caia em `buildMockSummary` quando nao achava
// venda, e o consolidado somava isso. Com TODAS as tabelas do iFood vazias
// (zero credencial, zero venda, zero repasse, 4 lojas ainda em PENDENTE-*), a
// tela de setembro mostrava R$ 425.119 e 6.138 pedidos — cem por cento ficcao,
// com o aviso em letra pequena ao lado dos cartoes. Quem batia o olho concluia
// que o iFood ia bem.
//
// O mock continua existindo para desenvolvimento, mas fora do caminho que o
// usuario ve.

const round2 = (valor: number) => Math.round(valor * 100) / 100;

export function resumoSemDados(
  storeId: string | null,
  storeLabel: string,
  year: number,
  month: number
): IfoodPeriodSummary {
  return {
    period: { year, month },
    storeId,
    storeLabel,
    totals: { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 },
    daily: [],
    fees: [],
    settlements: [],
    // `isMock` aqui significa "nao ha dado real deste periodo" — e o que faz a
    // tela mostrar o aviso. A diferenca e que agora os numeros sao zero.
    isMock: true
  };
}

/**
 * Soma os resumos das lojas. Resumo sem dados nao entra na conta quando existe
 * ao menos uma loja com venda real — mesma regra da 99 Food.
 */
export function somarResumos(resumos: IfoodPeriodSummary[], year: number, month: number): IfoodPeriodSummary {
  const comDados = resumos.filter((resumo) => !resumo.isMock);
  const consideradas = comDados.length > 0 ? comDados : [];

  if (consideradas.length === 0) return resumoSemDados(null, "Consolidado", year, month);

  const totals = { orders: 0, grossAmount: 0, ifoodFeeAmount: 0, promotionAmount: 0, deliveryFeeAmount: 0, netAmount: 0, otherFees: 0 };
  const daily: IfoodPeriodSummary["daily"] = [];
  const fees: IfoodPeriodSummary["fees"] = [];
  const settlements: IfoodPeriodSummary["settlements"] = [];

  for (const resumo of consideradas) {
    totals.orders += resumo.totals.orders;
    totals.grossAmount += resumo.totals.grossAmount;
    totals.ifoodFeeAmount += resumo.totals.ifoodFeeAmount;
    totals.promotionAmount += resumo.totals.promotionAmount;
    totals.deliveryFeeAmount += resumo.totals.deliveryFeeAmount;
    totals.netAmount += resumo.totals.netAmount;
    totals.otherFees += resumo.totals.otherFees;
    daily.push(...resumo.daily);
    fees.push(...resumo.fees);
    settlements.push(...resumo.settlements);
  }

  const porDia = new Map<string, IfoodPeriodSummary["daily"][number]>();
  for (const linha of daily) {
    const anterior = porDia.get(linha.date);
    if (!anterior) {
      porDia.set(linha.date, { ...linha });
      continue;
    }
    porDia.set(linha.date, {
      date: linha.date,
      orders: anterior.orders + linha.orders,
      grossAmount: round2(anterior.grossAmount + linha.grossAmount),
      ifoodFeeAmount: round2(anterior.ifoodFeeAmount + linha.ifoodFeeAmount),
      promotionAmount: round2(anterior.promotionAmount + linha.promotionAmount),
      deliveryFeeAmount: round2(anterior.deliveryFeeAmount + linha.deliveryFeeAmount),
      netAmount: round2(anterior.netAmount + linha.netAmount)
    });
  }

  return {
    period: { year, month },
    storeId: null,
    storeLabel: "Consolidado",
    totals: {
      orders: totals.orders,
      grossAmount: round2(totals.grossAmount),
      ifoodFeeAmount: round2(totals.ifoodFeeAmount),
      promotionAmount: round2(totals.promotionAmount),
      deliveryFeeAmount: round2(totals.deliveryFeeAmount),
      netAmount: round2(totals.netAmount),
      otherFees: round2(totals.otherFees)
    },
    daily: Array.from(porDia.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
    fees,
    settlements,
    isMock: false
  };
}
