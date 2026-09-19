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

/**
 * Percentual para TEXTO em pt-BR: "52,4%" e nao "52.4%".
 *
 * As mensagens de alerta saiam com ponto decimal no meio de frases em portugues
 * que ja escreviam "R$ 26.951,17" — duas convencoes na mesma linha.
 */
export function pct(valor: number, casas = 1): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Valor em reais para TEXTO em pt-BR, sem o prefixo "R$". */
export function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Participacao de uma parte no total, em %. */
export function participacao(parte: number, total: number): number {
  if (total === 0) return 0;
  return round2((parte / total) * 100);
}

export type PrecoDeTabela = {
  /** `false` em abr–jun/2026: vieram do relatorio do portal, que nao traz o preco de tabela. */
  disponivel: boolean;
  tabela: number;
  bruto: number;
  liquido: number;
  descontoTotal: number;
  descontoPercent: number;
  bancadoPelaLoja: number;
  bancadoPelaPlataforma: number;
  /** Quanto do preco ANUNCIADO vira receita. */
  brutoSobreTabelaPercent: number;
  /** Quanto do preco ANUNCIADO chega ao caixa. */
  liquidoSobreTabelaPercent: number;
  /** Quantos pedidos do mes tinham preco de tabela, de quantos. */
  cobertura: { comTabela: number; total: number };
};

/**
 * O delivery e vendido com desconto, e a conta que interessa ao dono nao e
 * sobre o bruto — e sobre o PRECO ANUNCIADO.
 *
 * O painel mostrava "ficou com a loja: 89,4%", verdade sobre o bruto. So que o
 * bruto ja e a receita DEPOIS do desconto: sobre o preco de tabela ficam 42,5%.
 * Medido em set/2026 sobre os pedidos faturados: tabela R$ 72.089,81, liquido no
 * caixa R$ 30.663,70. E a serie piora — 46,7% (jul), 46,0% (ago), 42,5% (set).
 *
 * `bancadoPelaLoja` e o `shopActivityOutcome` da 99: a parte do desconto que sai
 * do bolso da loja (~70% do total). O resto e promocao da plataforma.
 */
export function precoDeTabela(input: {
  tabela: number;
  bruto: number;
  liquido: number;
  bancadoPelaLoja: number;
  pedidosComTabela: number;
  pedidosTotal: number;
}): PrecoDeTabela {
  const { tabela, bruto, liquido, bancadoPelaLoja, pedidosComTabela, pedidosTotal } = input;
  if (tabela <= 0) {
    return {
      disponivel: false,
      tabela: 0, bruto: 0, liquido: 0,
      descontoTotal: 0, descontoPercent: 0,
      bancadoPelaLoja: 0, bancadoPelaPlataforma: 0,
      brutoSobreTabelaPercent: 0, liquidoSobreTabelaPercent: 0,
      cobertura: { comTabela: 0, total: pedidosTotal }
    };
  }
  const descontoTotal = round2(tabela - bruto);
  return {
    disponivel: true,
    tabela: round2(tabela),
    bruto: round2(bruto),
    liquido: round2(liquido),
    descontoTotal,
    descontoPercent: participacao(descontoTotal, tabela),
    bancadoPelaLoja: round2(bancadoPelaLoja),
    // O que sobra do desconto depois da parte da loja e promocao da plataforma.
    bancadoPelaPlataforma: round2(descontoTotal - bancadoPelaLoja),
    brutoSobreTabelaPercent: participacao(bruto, tabela),
    liquidoSobreTabelaPercent: participacao(liquido, tabela),
    cobertura: { comTabela: pedidosComTabela, total: pedidosTotal }
  };
}
