// Contas do Painel do dono, separadas do banco para poderem ser testadas.
//
// O painel nasceu no iFood em cima de mock, e duas contas passaram despercebidas
// porque numero inventado nunca tem buraco. Na 99, com dado real, elas aparecem:
//
//   1. A "projecao" do iFood devolvia o proprio total do mes corrente. Com mock
//      de mes inteiro isso parecia certo; com dado real, no dia 18, projetar o
//      que ja acontecerau subestima o mes pela metade.
//   2. `delta(atual, 0)` devolve 100%. A 99 so tem dados desde abril/2026, entao
//      comparar setembro com setembro do ano passado mostraria "+100%" — um
//      crescimento que ninguem teve, contra uma base que nao existe.

export const round2 = (valor: number) => Math.round(valor * 100) / 100;

export type Variacao = {
  percentual: number;
  /** `false` quando nao ha base de comparacao — a tela deve escrever "sem base", nao "+100%". */
  comparavel: boolean;
};

/** Variacao percentual entre dois periodos, dizendo quando a comparacao nao existe. */
export function variacao(atual: number, anterior: number): Variacao {
  if (anterior === 0) return { percentual: 0, comparavel: false };
  return { percentual: round2(((atual - anterior) / anterior) * 100), comparavel: true };
}

export type Projecao = {
  grossAmount: number;
  netAmount: number;
  diasDecorridos: number;
  diasRestantes: number;
  ehProjecao: boolean;
  nota: string;
};

/**
 * Projeta o fechamento do mes pela media diaria do que ja foi realizado.
 *
 * Mes fechado nao se projeta: devolve o proprio total, e `ehProjecao: false`
 * para a tela nao chamar de projecao o que e fato consumado.
 */
export function projetarMes(input: {
  grossAteAgora: number;
  netAteAgora: number;
  diasComVenda: number;
  diaDeHoje: number;
  diasNoMes: number;
  mesEmCurso: boolean;
}): Projecao {
  const { grossAteAgora, netAteAgora, diaDeHoje, diasNoMes, mesEmCurso } = input;

  if (!mesEmCurso) {
    return {
      grossAmount: round2(grossAteAgora),
      netAmount: round2(netAteAgora),
      diasDecorridos: diasNoMes,
      diasRestantes: 0,
      ehProjecao: false,
      nota: "Mês fechado — o valor é o realizado, não uma projeção."
    };
  }

  // Divide pelos dias CORRIDOS do mes, nao pelos dias que tiveram venda: dia
  // sem venda e dia fraco de verdade, e tirar ele da conta inflaria a media.
  const base = Math.max(1, diaDeHoje);
  const mediaGross = grossAteAgora / base;
  const mediaNet = netAteAgora / base;

  return {
    grossAmount: round2(mediaGross * diasNoMes),
    netAmount: round2(mediaNet * diasNoMes),
    diasDecorridos: diaDeHoje,
    diasRestantes: diasNoMes - diaDeHoje,
    ehProjecao: true,
    nota: `Projeção pela média de ${diaDeHoje} dia(s) corridos, aplicada aos ${diasNoMes} do mês.`
  };
}

/** Ticket medio, sem estourar quando nao houve pedido. */
export function ticketMedio(bruto: number, pedidos: number): number {
  if (pedidos <= 0) return 0;
  return round2(bruto / pedidos);
}

/** Participacao de uma parte no total, em %. */
export function participacao(parte: number, total: number): number {
  if (total === 0) return 0;
  return round2((parte / total) * 100);
}
