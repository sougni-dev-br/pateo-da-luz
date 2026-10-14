import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import type {
  AnaliseCardapio, AnaliseCancelamentos, AnaliseDemanda, AnaliseDescontos, AnaliseIndicadores, AnaliseItensCancelados, AnalisePerdas, AnaliseResumo, AnaliseVariacao
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";

// Dados 100% fictícios (repositório público): nomes inventados e valores redondos.
export const PERIODO = { inicio: "2026-09-14", fim: "2026-10-13" };
const ANTERIOR = { inicio: "2026-08-15", fim: "2026-09-13" };

export function sessao(hideSensitiveValues = false) {
  return {
    user: null, setUser: () => undefined, hideSensitiveValues, toggleSensitiveValues: () => undefined,
    canAccessSection: () => true, hasPermission: () => true
  } as unknown as SessionContextValue;
}

export function renderComSessao(ui: ReactElement, { ocultar = false } = {}) {
  return render(
    <SessionContext.Provider value={sessao(ocultar)}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>
  );
}

export const variacao = (atual: number, anterior: number): AnaliseVariacao => ({
  atual, anterior, diferenca: atual - anterior, pct: anterior === 0 ? null : (atual - anterior) / anterior
});

export function indicadores(over: Partial<AnaliseIndicadores> = {}): AnaliseIndicadores {
  return {
    diasComMovimento: 30, faturamento: 150000, comandas: 800, pessoas: 1500, vendasSemPessoas: 0, ticketPessoa: 100, ticketComanda: 187.5,
    pessoasPorDia: 50, faturamentoPorDia: 5000, canceladoVendas: 40, canceladoValor: 7500, refeitoVendas: 10, refeitoValor: 1500,
    grandesVendas: 2, grandesValor: 6000, semMotivo: 40, itensCanceladosValor: 2000, descontoValor: 3000, descontoPct: 0.02, descontoSemDado: 0,
    perdaValor: 11000, perdaPct: 11000 / 150000, perdaTetoValor: 12500, ...over
  };
}

export function resumo(over: Partial<AnaliseResumo> = {}): AnaliseResumo {
  const atual = indicadores();
  const anterior = indicadores({ pessoasPorDia: 60, faturamentoPorDia: 6000, ticketPessoa: 100, perdaPct: 0.04 });
  return {
    periodo: PERIODO, periodoAnterior: ANTERIOR,
    cobertura: { diasNoPeriodo: 30, diasComMovimento: 30, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13", vendasComDetalhe: 840 },
    atual, anterior, anteriorConfiavel: true, hojeFicouDeFora: false,
    comparacao: {
      faturamentoPorDia: variacao(5000, 6000), pessoasPorDia: variacao(50, 60), ticketPessoa: variacao(100, 100), ticketComanda: variacao(187.5, 200),
      faturamento: variacao(150000, 180000), pessoas: variacao(1500, 1800), perdaPct: variacao(atual.perdaPct, 0.04)
    },
    serie: Array.from({ length: 30 }, (_, i) => ({
      data: new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10), faturamento: 5000, pessoas: 50, comandas: 27, temMovimento: true
    })),
    insights: [
      { id: "pessoas-variacao", tom: "alerta", titulo: "Movimento caiu 17% contra o período anterior", detalhe: "50 pessoas por dia agora, 60 antes.", acao: "Veja em Quando vendemos em quais dias a queda se concentra.", impactoMes: 30000, hipotese: false, secao: "resumo" },
      { id: "dia-ocioso-almoco", tom: "oportunidade", titulo: "Terça no almoço roda a 25% do melhor dia", detalhe: "25 pessoas por dia, contra 100 na quinta.", acao: "Teste uma ação para a terça.", impactoMes: 12000, hipotese: true, secao: "demanda" },
      { id: "perda-alta", tom: "alerta", titulo: "Perdas potenciais somam 7% do faturamento", detalhe: "R$ 11.000 no período.", acao: "Abra Perdas.", impactoMes: 11000, hipotese: false, secao: "perdas" }
    ],
    ...over
  };
}

export function demanda(over: Partial<AnaliseDemanda> = {}): AnaliseDemanda {
  const horas = ["12", "13", "19"];
  const turnosDoDia = (almoco: number, jantar: number) => [
    { turno: "ALMOCO" as const, rotulo: "Almoço", diasObservados: 4, pessoasPorDia: almoco, faturamentoPorDia: almoco * 100, ticketPessoa: 100 },
    { turno: "JANTAR" as const, rotulo: "Jantar", diasObservados: 4, pessoasPorDia: jantar, faturamentoPorDia: jantar * 100, ticketPessoa: 80 }
  ];
  const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const almoco = [40, 30, 25, 40, 100, 90, 80];
  const jantar = [20, 10, 10, 20, 30, 25, 35];
  return {
    periodo: PERIODO, hojeFicouDeFora: false, cobertura: { vendas: 800, vendasSemHora: 0, diasComMovimento: 28 },
    diasDaSemana: nomes.map((rotulo, dow) => ({
      dow, rotulo, diasObservados: 4, pessoasPorDia: almoco[dow] + jantar[dow], faturamentoPorDia: (almoco[dow] + jantar[dow]) * 100, ticketPessoa: 100,
      turnos: turnosDoDia(almoco[dow], jantar[dow])
    })),
    mapa: {
      horas,
      celulas: [0, 1, 2, 3, 4, 5, 6].flatMap((dow) => [
        { dow, hora: "12", pessoasPorDia: almoco[dow] * 0.5, faturamentoPorDia: almoco[dow] * 50, vendas: 8 },
        { dow, hora: "13", pessoasPorDia: almoco[dow] * 0.5, faturamentoPorDia: almoco[dow] * 50, vendas: 8 },
        { dow, hora: "19", pessoasPorDia: jantar[dow], faturamentoPorDia: jantar[dow] * 80, vendas: 4 }
      ])
    },
    turnos: [
      { turno: "ALMOCO", rotulo: "Almoço", pessoas: 1620, faturamento: 162000, ticketPessoa: 100, participacao: 0.8 },
      { turno: "JANTAR", rotulo: "Jantar", pessoas: 600, faturamento: 48000, ticketPessoa: 80, participacao: 0.2 }
    ],
    porHora: [],
    capacidade: {
      metaRelativa: 0.7, hipotese: true,
      turnos: [
        { turno: "ALMOCO", rotulo: "Almoço", referencia: { dow: 4, rotulo: "Quinta", pessoasPorDia: 100, meta: 70 },
          folgas: [{ dow: 2, rotulo: "Terça", pessoasPorDia: 25, pctDoMelhor: 0.25, pessoasAMais: 45, faturamentoMesPotencial: 22000 }] },
        { turno: "JANTAR", rotulo: "Jantar", referencia: null, folgas: [] }
      ]
    },
    ...over
  };
}

export function cancelamentos(): AnaliseCancelamentos {
  return {
    periodo: PERIODO, cobertura: { vendasComDetalhe: 800, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: { vendas: 800, canceladas: 40, taxaCancelamento: 0.05, valorCancelado: 7500, valorFaturado: 150000, semMotivo: 40 },
    porPessoa: [{ pessoa: "Ana Fictícia", canceladas: 24, valor: 4500, participacao: 0.6 }, { pessoa: "Bruno Fictício", canceladas: 16, valor: 3000, participacao: 0.4 }],
    porTurno: [{ turno: "Almoço", vendas: 500, canceladas: 20, taxa: 0.04, valor: 3500 }],
    porHora: [{ hora: "13", vendas: 200, canceladas: 10, taxa: 0.05, valor: 2000 }],
    porDia: [], maiores: [{ saleId: "1", data: "2026-10-02", hora: "13:10", turno: "Almoço", pessoa: "Ana Fictícia", pessoas: 4, valor: 450, motivo: null }]
  };
}

export function itensCancelados(): AnaliseItensCancelados {
  return {
    periodo: PERIODO, cobertura: { itensCancelados: 12, itensSemVenda: 0, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: { itens: 12, vendasAfetadas: 9, valorCancelado: 2000, valorItensRecebidos: 60000, taxaValor: 0.033, semQuemCancelou: 0, semMotivo: 12, mesmaPessoa: 5, comOsDoisNomes: 12 },
    porQuemLancou: [{ pessoa: "Helena Fictícia", itens: 12, vendas: 9, valor: 2000, participacao: 1 }],
    porQuemCancelou: [{ pessoa: "Júlia Fictícia", itens: 12, vendas: 9, valor: 2000, participacao: 1 }],
    porProduto: [{ produto: "PRATO PROMOCIONAL A", grupo: "Buffet", linhas: 3, quantidade: 14, valor: 1000 }],
    porHora: [{ hora: "13", itens: 7, valor: 1000 }],
    maiores: [{ saleId: "1", data: "2026-10-02", hora: "13:11", produto: "PRATO PROMOCIONAL A", quantidade: 14, valor: 1000, quemLancou: "Helena Fictícia", quemCancelou: "Júlia Fictícia", motivo: null }]
  };
}

export function descontos(): AnaliseDescontos {
  return {
    periodo: PERIODO, cobertura: { vendasComDado: 800, vendasSemDado: 0, primeiroDia: "2026-09-14", ultimoDia: "2026-10-13" },
    resumo: { vendasRecebidas: 800, vendasComDesconto: 40, taxaVendas: 0.05, valorDescontos: 3000, valorSubtotal: 150000, percentualSobreSubtotal: 0.02, descontoMedio: 75, acimaDe50: 2, semPessoa: 0, semTipo: 0 },
    porTipo: [{ tipo: "DESCONTO 10%", vendas: 40, valor: 3000, participacao: 1, percentualMedio: 0.1 }],
    porPessoa: [{ pessoa: "Kátia Fictícia", vendas: 40, valor: 3000, participacao: 1, percentualMedio: 0.1 }],
    porTurno: [{ turno: "Almoço", vendas: 500, vendasComDesconto: 25, taxa: 0.05, valor: 2000 }],
    maiores: [{ saleId: "1", data: "2026-10-02", hora: "13:30", turno: "Almoço", pessoas: 2, subtotal: 200, desconto: 100, percentual: 0.5, tipo: "DESCONTO 10%", pessoa: "Kátia Fictícia" }]
  };
}

export function perdas(over: Partial<AnalisePerdas> = {}): AnalisePerdas {
  return {
    periodo: PERIODO, cobertura: { vendasComDetalhe: 800 },
    funil: { faturado: 150000, cancelado: 7500, refeito: 1500, semRefacao: 6000, itensCancelados: 2000, descontos: 3000, perdaTotal: 11000, perdaPct: 11000 / 150000, perdaTeto: 12500, grandes: 6000, grandesVendas: 2 },
    refacao: { vendas: 10, valor: 1500, pctDoCancelado: 0.2, janelaMinutos: 10, toleranciaValor: 0.02 },
    limiteGrande: 1000,
    grandes: [
      { saleId: "5001", data: "2026-10-13", hora: "15:40", turno: "Jantar", pessoas: 1, valor: 4000, pessoa: "Ana Fictícia", motivo: null, refeita: false },
      { saleId: "5002", data: "2026-09-20", hora: null, turno: "Almoço", pessoas: 1, valor: 2000, pessoa: "Bruno Fictício", motivo: "evento adiado", refeita: true }
    ],
    porPessoa: [
      { pessoa: "Ana Fictícia", canceladas: 24, valorCancelado: 4500, valorRefeito: 900, itens: 8, valorItens: 1200, descontos: 20, valorDescontos: 1800, perda: 6600 },
      { pessoa: "(não informado)", canceladas: 4, valorCancelado: 450, valorRefeito: 0, itens: 0, valorItens: 0, descontos: 0, valorDescontos: 0, perda: 450 }
    ],
    cancelamentos: cancelamentos(), itens: itensCancelados(), descontos: descontos(), hojeFicouDeFora: false,
    ...over
  };
}

const produtoAbc = (posicao: number, produto: string, valor: number, acumulada: number, classe: "A" | "B" | "C", over = {}) => ({
  posicao, produto, grupo: "G", categoria: "ALIMENTOS", quantidade: 10, valor, participacao: valor / 10000, acumulada, classe, ...over
});

const taxa = (pct: number, ant: number | null, preco = 20) => ({
  pctComandas: pct, porPessoa: pct, receitaPorPessoa: pct * preco, precoMedio: preco, quantidade: pct * 1000, valor: pct * 1000 * preco,
  pctComandasAnterior: ant, variacaoPontos: ant === null ? null : pct - ant
});

export function cardapio(over: Partial<AnaliseCardapio> = {}): AnaliseCardapio {
  const bloco = (comandas: number, pessoas: number, bebida: number) => ({
    comandas, pessoas, comandasAnterior: comandas,
    itens: { bebida: taxa(bebida, bebida - 0.02), alcool: taxa(0.1, 0.1), cafe: taxa(0.2, 0.2), sobremesa: taxa(0.01, 0.01) }
  });
  return {
    periodo: PERIODO, hojeFicouDeFora: false,
    cobertura: { produtosVendidos: 41, comandas: 1000, pessoas: 2000 },
    resumo: { faturamentoItens: 100408, produtosVendidos: 41, produtosClasseA: 8, produtosCaudaLonga: 6, participacaoCauda: 0.003, maiorProduto: { produto: "PRODUTO ALFA", participacao: 0.5 }, semPrecoProdutos: 1, semPrecoUnidades: 40 },
    categorias: [
      { nome: "ALIMENTOS", valor: 70000, participacao: 0.7, produtos: 5, quantidade: 100, precoMedio: 700, participacaoAnterior: 0.72, variacaoPontos: -0.02 },
      { nome: "BEBIDAS", valor: 14000, participacao: 0.14, produtos: 3, quantidade: 100, precoMedio: 140, participacaoAnterior: 0.13, variacaoPontos: 0.01 }
    ],
    grupos: [],
    abc: {
      classes: [{ classe: "A", produtos: 8, valor: 80000, participacao: 0.8 }, { classe: "B", produtos: 10, valor: 15000, participacao: 0.15 }, { classe: "C", produtos: 23, valor: 5000, participacao: 0.05 }],
      limiteA: 0.8, limiteB: 0.95,
      itens: [produtoAbc(1, "PRODUTO ALFA", 5000, 0.5, "A"), produtoAbc(2, "PRODUTO BETA", 3000, 0.8, "A"), produtoAbc(3, "PRODUTO GAMA", 1500, 0.95, "B"), produtoAbc(4, "PRODUTO DELTA", 500, 1, "C")]
    },
    cauda: { limite: 0.001, produtos: 6, valor: 300, participacao: 0.003, exemplos: [produtoAbc(40, "ITEM RARO", 20, 1, "C")] },
    semPreco: [{ produto: "BRINDE DO DIA", categoria: "ALIMENTOS", unidades: 40 }],
    attach: { turnos: [{ turno: "ALMOCO", rotulo: "Almoço", ...bloco(700, 1400, 0.8) }, { turno: "JANTAR", rotulo: "Jantar", ...bloco(300, 600, 0.95) }], geral: bloco(1000, 2000, 0.85) },
    simulacoes: [
      { item: "bebida", rotulo: "Bebida", ponto: 0.01, precoMedio: 14, comandasPorMes: 1000, valorMes: 140 },
      { item: "alcool", rotulo: "Álcool", ponto: 0.01, precoMedio: 24, comandasPorMes: 1000, valorMes: 240 },
      { item: "cafe", rotulo: "Café", ponto: 0.01, precoMedio: 11, comandasPorMes: 1000, valorMes: null },
      { item: "sobremesa", rotulo: "Sobremesa", ponto: 0.01, precoMedio: 22, comandasPorMes: 1000, valorMes: 220 }
    ],
    insights: [
      { id: "vendido-a-zero", tom: "alerta", titulo: "1 produto vendido a R$ 0", detalhe: "40 unidades sem valor lançado.", acao: "Confira o preço cadastrado.", impactoMes: null, hipotese: false, secao: "cardapio" },
      { id: "sobremesa-baixa", tom: "oportunidade", titulo: "Sobremesa em só 1% das comandas", detalhe: "Cada ponto valeria R$ 220 por mês.", acao: "Confirme se toda sobremesa é lançada.", impactoMes: 220, hipotese: true, secao: "cardapio" }
    ],
    ...over
  };
}
