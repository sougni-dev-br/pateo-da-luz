import type {
  AnaliseCancelamentos, AnaliseDemanda, AnaliseDescontos, AnaliseIndicadores, AnaliseItensCancelados, AnalisePerdas, AnaliseResumo,
  AnaliseCardapio, AnaliseMargem, AnaliseMargemAFazer, AnaliseMargemBebidas, AnaliseMargemBebidasAFazer, AnaliseMargemBebidasLinha, AnaliseMargemBuffet, AnaliseBuffetMes, AnaliseMargemLinha, AnaliseIndicadorDeMeta, AnaliseItemDeAtencao, AnaliseMetaIndicador, AnaliseMetas, AnaliseSituacaoDaMeta, AnaliseProdutoAbc, AnaliseSerieDia, AnaliseTaxaDoItem, AnaliseVariacao, AnaliseVendasPorPessoa
} from "../api/client";

// Dados de demonstração da tela "Análise do Salão" (modo ?mock-user=1, só em dev local).
// Tudo fictício: nomes, valores e proporções inventados (redondos de propósito, nada derivado de dado
// real da operação) para exercitar a interface. O repositório é público.

function periodoDaUrl(url: string) {
  const parsed = new URL(url, "http://localhost");
  return {
    inicio: parsed.searchParams.get("inicio") ?? "2026-09-14",
    fim: parsed.searchParams.get("fim") ?? "2026-10-13"
  };
}

function cancelamentos(periodo: { inicio: string; fim: string }): AnaliseCancelamentos {
  return {
    periodo,
    cobertura: { vendasComDetalhe: 1200, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: { vendas: 1200, canceladas: 60, taxaCancelamento: 0.05, valorCancelado: 7500, valorFaturado: 150000, semMotivo: 60 },
    porPessoa: [
      { pessoa: "Ana Fictícia", canceladas: 24, valor: 3000, participacao: 0.4 },
      { pessoa: "Bruno Fictício", canceladas: 14, valor: 1800, participacao: 0.24 },
      { pessoa: "Carla Fictícia", canceladas: 10, valor: 1250, participacao: 0.167 },
      { pessoa: "Diego Fictício", canceladas: 6, valor: 800, participacao: 0.107 },
      { pessoa: "Elisa Fictícia", canceladas: 4, valor: 450, participacao: 0.06 },
      { pessoa: "Fábio Fictício", canceladas: 2, valor: 200, participacao: 0.027 }
    ],
    porTurno: [
      { turno: "Almoço", vendas: 700, canceladas: 30, taxa: 0.0429, valor: 3600 },
      { turno: "Jantar", vendas: 500, canceladas: 30, taxa: 0.06, valor: 3900 }
    ],
    porHora: [
      { hora: "11", vendas: 50, canceladas: 2, taxa: 0.04, valor: 200 },
      { hora: "12", vendas: 300, canceladas: 10, taxa: 0.0333, valor: 1200 },
      { hora: "13", vendas: 320, canceladas: 14, taxa: 0.0438, valor: 1700 },
      { hora: "14", vendas: 30, canceladas: 4, taxa: 0.1333, valor: 500 },
      { hora: "19", vendas: 100, canceladas: 5, taxa: 0.05, valor: 600 },
      { hora: "20", vendas: 240, canceladas: 15, taxa: 0.0625, valor: 2000 },
      { hora: "21", vendas: 140, canceladas: 10, taxa: 0.0714, valor: 1300 },
      { hora: "—", vendas: 20, canceladas: 0, taxa: 0, valor: 0 }
    ],
    porDia: [],
    maiores: [
      { saleId: "1001", data: periodo.fim, hora: "20:40", turno: "Jantar", pessoa: "Ana Fictícia", pessoas: 8, valor: 1200, motivo: null },
      { saleId: "1002", data: periodo.fim, hora: "13:15", turno: "Almoço", pessoa: "Bruno Fictício", pessoas: 6, valor: 800, motivo: null },
      { saleId: "1003", data: periodo.inicio, hora: "21:00", turno: "Jantar", pessoa: "Ana Fictícia", pessoas: 4, valor: 600, motivo: null }
    ]
  };
}

function itensCancelados(periodo: { inicio: string; fim: string }): AnaliseItensCancelados {
  const pessoa = (nome: string, itens: number, vendas: number, valor: number) => ({ pessoa: nome, itens, vendas, valor, participacao: valor / 50000 });
  return {
    periodo,
    cobertura: { itensCancelados: 1000, itensSemVenda: 0, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: {
      itens: 1000, vendasAfetadas: 700, valorCancelado: 50000, valorItensRecebidos: 1500000, taxaValor: 0.0333,
      semQuemCancelou: 0, semMotivo: 1000, mesmaPessoa: 600, comOsDoisNomes: 1000
    },
    porQuemLancou: [
      pessoa("Carla Fictícia", 300, 200, 15000), pessoa("Diego Fictício", 250, 170, 12500), pessoa("Elisa Fictícia", 200, 140, 10000),
      pessoa("Fábio Fictício", 120, 90, 6000), pessoa("Ana Fictícia", 80, 60, 4000), pessoa("Bruno Fictício", 50, 40, 2500)
    ],
    porQuemCancelou: [
      pessoa("Carla Fictícia", 400, 280, 20000), pessoa("Diego Fictício", 300, 210, 15000), pessoa("Gustavo Fictício", 200, 140, 10000),
      pessoa("Elisa Fictícia", 100, 70, 5000)
    ],
    porProduto: [
      { produto: "PRATO PROMOCIONAL A", grupo: "Buffet por quilo", linhas: 200, quantidade: 600, valor: 12000 },
      { produto: "PRATO PROMOCIONAL B", grupo: "Buffet por quilo", linhas: 140, quantidade: 400, valor: 8000 },
      { produto: "REFRIGERANTE", grupo: "Bebidas", linhas: 180, quantidade: 250, valor: 2000 },
      { produto: "SOBREMESA DO DIA", grupo: "Sobremesas", linhas: 90, quantidade: 120, valor: 1500 }
    ],
    porHora: [
      { hora: "12", itens: 250, valor: 12500 }, { hora: "13", itens: 350, valor: 17500 }, { hora: "14", itens: 100, valor: 5000 },
      { hora: "20", itens: 200, valor: 10000 }, { hora: "21", itens: 100, valor: 5000 }
    ],
    maiores: [
      { saleId: "2001", data: periodo.fim, hora: "13:10", produto: "PRATO PROMOCIONAL A", quantidade: 14, valor: 1200, quemLancou: "Carla Fictícia", quemCancelou: "Carla Fictícia", motivo: null },
      { saleId: "2002", data: periodo.fim, hora: "13:30", produto: "PRATO PROMOCIONAL B", quantidade: 10, valor: 800, quemLancou: "Diego Fictício", quemCancelou: "Gustavo Fictício", motivo: null }
    ]
  };
}

function descontos(periodo: { inicio: string; fim: string }): AnaliseDescontos {
  return {
    periodo,
    cobertura: { vendasComDado: 10000, vendasSemDado: 0, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: {
      vendasRecebidas: 10000, vendasComDesconto: 500, taxaVendas: 0.05, valorDescontos: 30000, valorSubtotal: 1500000,
      percentualSobreSubtotal: 0.02, descontoMedio: 60, acimaDe50: 40, semPessoa: 0, semTipo: 0
    },
    porTipo: [
      { tipo: "POR VALOR", vendas: 220, valor: 12000, participacao: 0.4, percentualMedio: 0.3 },
      { tipo: "DESCONTO PROMOCIONAL APP", vendas: 200, valor: 11000, participacao: 0.367, percentualMedio: 0.4 },
      { tipo: "DESCONTO 30%", vendas: 40, valor: 3600, participacao: 0.12, percentualMedio: 0.3 },
      { tipo: "DESCONTO 10%", vendas: 20, valor: 1500, participacao: 0.05, percentualMedio: 0.1 },
      { tipo: "DESCONTO 50%", vendas: 20, valor: 1900, participacao: 0.063, percentualMedio: 0.5 }
    ],
    porPessoa: [
      { pessoa: "Gustavo Fictício", vendas: 200, valor: 12000, participacao: 0.4, percentualMedio: 0.3 },
      { pessoa: "Helena Fictícia", vendas: 150, valor: 9000, participacao: 0.3, percentualMedio: 0.3 },
      { pessoa: "Igor Fictício", vendas: 100, valor: 6000, participacao: 0.2, percentualMedio: 0.3 },
      { pessoa: "Júlia Fictícia", vendas: 50, valor: 3000, participacao: 0.1, percentualMedio: 0.4 }
    ],
    porTurno: [
      { turno: "Almoço", vendas: 6000, vendasComDesconto: 300, taxa: 0.05, valor: 18000 },
      { turno: "Jantar", vendas: 4000, vendasComDesconto: 200, taxa: 0.05, valor: 12000 }
    ],
    maiores: [
      { saleId: "3001", data: periodo.fim, hora: "20:15", turno: "Jantar", pessoas: 6, subtotal: 1200, desconto: 1180, percentual: 0.983, tipo: "POR VALOR", pessoa: "Helena Fictícia" },
      { saleId: "3002", data: periodo.inicio, hora: "13:40", turno: "Almoço", pessoas: 4, subtotal: 600, desconto: 300, percentual: 0.5, tipo: "DESCONTO 50%", pessoa: "Gustavo Fictício" }
    ]
  };
}

function vendasPorPessoa(periodo: { inicio: string; fim: string }): AnaliseVendasPorPessoa {
  const pessoa = (nome: string, valor: number, vendas: number, itens: number, mix: Array<[string, number]>) => ({
    pessoa: nome,
    valor,
    participacao: valor / 175000,
    itens,
    vendas,
    ticketMedio: Math.round((valor / vendas) * 100) / 100,
    itensPorVenda: Math.round((itens / vendas) * 100) / 100,
    mix: mix.map(([grupo, parte]) => ({ grupo, valor: Math.round(valor * parte * 100) / 100, participacao: parte }))
  });
  return {
    periodo,
    hojeFicouDeFora: true,
    cobertura: { itensComPessoa: 5300, itensSemPessoa: 120 },
    resumo: { pessoas: 6, valorTotal: 170000, valorSemPessoa: 5000, itensSemPessoa: 120 },
    pessoas: [
      pessoa("Carla Fictícia", 50000, 400, 1500, [["Buffet por quilo", 0.52], ["Bebidas", 0.31], ["Sobremesas", 0.09]]),
      pessoa("Diego Fictício", 40000, 320, 1200, [["Buffet por quilo", 0.49], ["Bebidas", 0.34], ["Sobremesas", 0.1]]),
      pessoa("Elisa Fictícia", 30000, 260, 950, [["Buffet por quilo", 0.55], ["Bebidas", 0.28], ["Sobremesas", 0.11]]),
      pessoa("Fábio Fictício", 25000, 220, 800, [["Buffet por quilo", 0.5], ["Bebidas", 0.33], ["Sobremesas", 0.08]]),
      pessoa("Ana Fictícia", 15000, 140, 500, [["Bebidas", 0.45], ["Buffet por quilo", 0.4], ["Sobremesas", 0.07]]),
      pessoa("Bruno Fictício", 10000, 80, 350, [["Bebidas", 0.5], ["Buffet por quilo", 0.38], ["Sobremesas", 0.06]])
    ]
  };
}


// ---------------------------------------------------------------------------
// Visão de decisão: resumo, demanda e perdas. Tudo inventado a partir de padrões redondos
// (pessoas por dia da semana, ticket fixo) para exercitar a interface com números legíveis.
// ---------------------------------------------------------------------------

type Periodo = { inicio: string; fim: string };
const UM_DIA = 86_400_000;
const TICKET = 100;
// Pessoas por dia da semana, de domingo a sábado, no almoço e no jantar (inventados).
const ALMOCO_POR_DOW = [40, 30, 25, 40, 100, 90, 80];
const JANTAR_POR_DOW = [20, 10, 10, 20, 30, 25, 35];
const HORAS_ALMOCO = { "11": 0.05, "12": 0.4, "13": 0.35, "14": 0.15, "15": 0.05 };
const HORAS_JANTAR = { "18": 0.2, "19": 0.35, "20": 0.35, "21": 0.1 };
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const diasEntre = (p: Periodo) => Math.round((Date.parse(`${p.fim}T00:00:00Z`) - Date.parse(`${p.inicio}T00:00:00Z`)) / UM_DIA) + 1;
const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * UM_DIA).toISOString().slice(0, 10);
const dowDe = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function serieDe(p: Periodo, fator: number): AnaliseSerieDia[] {
  return Array.from({ length: diasEntre(p) }, (_, i) => {
    const data = somarDias(p.inicio, i);
    const dow = dowDe(data);
    const pessoas = Math.round((ALMOCO_POR_DOW[dow] + JANTAR_POR_DOW[dow]) * fator);
    return { data, faturamento: pessoas * TICKET, pessoas, comandas: Math.round(pessoas / 2), temMovimento: true };
  });
}

function indicadores(serie: AnaliseSerieDia[], perdaPct: number): AnaliseIndicadores {
  const faturamento = serie.reduce((s, d) => s + d.faturamento, 0);
  const pessoas = serie.reduce((s, d) => s + d.pessoas, 0);
  const comandas = serie.reduce((s, d) => s + d.comandas, 0);
  const perdaValor = Math.round(faturamento * perdaPct);
  return {
    diasComMovimento: serie.length, faturamento, comandas, pessoas, vendasSemPessoas: 0,
    ticketPessoa: TICKET, ticketComanda: Math.round(faturamento / comandas), pessoasPorDia: Math.round((pessoas / serie.length) * 10) / 10,
    faturamentoPorDia: Math.round(faturamento / serie.length),
    canceladoVendas: 40, canceladoValor: Math.round(perdaValor * 0.5), refeitoVendas: 12, refeitoValor: Math.round(perdaValor * 0.1),
    grandesVendas: 2, grandesValor: 6000, semMotivo: 40, itensCanceladosValor: Math.round(perdaValor * 0.3), descontoValor: Math.round(perdaValor * 0.2),
    descontoPct: 0.02, descontoSemDado: 0, perdaValor, perdaPct, perdaTetoValor: Math.round(perdaValor * 1.05)
  };
}

const variacao = (atual: number, anterior: number): AnaliseVariacao => ({
  atual, anterior, diferenca: Math.round((atual - anterior) * 100) / 100, pct: anterior === 0 ? null : Math.round(((atual - anterior) / anterior) * 10000) / 10000
});

function resumo(periodo: Periodo): AnaliseResumo {
  const dias = diasEntre(periodo);
  const anteriorPeriodo = { inicio: somarDias(periodo.inicio, -dias), fim: somarDias(periodo.inicio, -1) };
  const serie = serieDe(periodo, 1);
  const atual = indicadores(serie, 0.06);
  const anterior = indicadores(serieDe(anteriorPeriodo, 1.1), 0.04);
  return {
    periodo, periodoAnterior: anteriorPeriodo,
    cobertura: { diasNoPeriodo: dias, diasComMovimento: dias, primeiroDia: periodo.inicio, ultimoDia: periodo.fim, vendasComDetalhe: atual.comandas },
    atual, anterior, anteriorConfiavel: true, motivoSemComparacao: null, hojeFicouDeFora: true,
    comparacao: {
      faturamentoPorDia: variacao(atual.faturamentoPorDia, anterior.faturamentoPorDia),
      pessoasPorDia: variacao(atual.pessoasPorDia, anterior.pessoasPorDia),
      ticketPessoa: variacao(atual.ticketPessoa, anterior.ticketPessoa),
      ticketComanda: variacao(atual.ticketComanda, anterior.ticketComanda),
      faturamento: variacao(atual.faturamento, anterior.faturamento),
      pessoas: variacao(atual.pessoas, anterior.pessoas),
      perdaPct: variacao(atual.perdaPct, anterior.perdaPct)
    },
    serie,
    insights: [
      {
        id: "pessoas-variacao", tom: "alerta", secao: "resumo", hipotese: false, impactoMes: Math.round((anterior.pessoasPorDia - atual.pessoasPorDia) * atual.ticketPessoa * 30),
        titulo: `Movimento caiu ${Math.round(Math.abs(variacao(atual.pessoasPorDia, anterior.pessoasPorDia).pct ?? 0) * 100)}% contra o período anterior`,
        detalhe: `${String(atual.pessoasPorDia).replace(".", ",")} pessoas por dia agora, ${String(anterior.pessoasPorDia).replace(".", ",")} antes.`,
        acao: "Veja em Quando vendemos em quais dias e horários a queda se concentra."
      },
      {
        id: "dia-ocioso-almoco", tom: "oportunidade", secao: "demanda", hipotese: true, impactoMes: 12000,
        titulo: "Terça no almoço roda a 25% do melhor dia",
        detalhe: "Média de 25 pessoas por dia, contra 100 na quinta. Chegar a 70% do melhor dia seria 45 pessoas a mais por dia.",
        acao: "Teste uma ação para a terça (combo, parceria com empresas próximas, divulgação) e acompanhe as pessoas por dia aqui."
      },
      {
        id: "perda-alta", tom: "alerta", secao: "perdas", hipotese: false, impactoMes: Math.round((atual.perdaValor / dias) * 30),
        titulo: `Perdas potenciais somam ${Math.round(atual.perdaPct * 100)}% do faturamento`,
        detalhe: `R$ ${atual.perdaValor.toLocaleString("pt-BR")} no período (até R$ ${atual.perdaTetoValor.toLocaleString("pt-BR")} se nenhuma refação for real): cancelamentos sem refação, itens cancelados e descontos.`,
        acao: "É uma estimativa: nem todo cancelamento é dinheiro perdido. Abra Perdas para separar refação, valores muito altos e quem concentra."
      },
      {
        id: "cancelamento-sem-motivo", tom: "info", secao: "perdas", hipotese: false, impactoMes: null,
        titulo: "Nenhum cancelamento tem motivo registrado",
        detalhe: "40 cancelamentos, todos sem motivo no PDV.",
        acao: "Peça para informar o motivo ao cancelar: sem ele a análise mostra quem e quanto, mas não por quê."
      }
    ]
  };
}

function demanda(periodo: Periodo): AnaliseDemanda {
  const horas = ["11", "12", "13", "14", "15", "18", "19", "20", "21"];
  const celulas = [0, 1, 2, 3, 4, 5, 6].flatMap((dow) =>
    horas.map((hora) => {
      const peso = (HORAS_ALMOCO as Record<string, number>)[hora] ?? (HORAS_JANTAR as Record<string, number>)[hora] ?? 0;
      const base = hora < "17" ? ALMOCO_POR_DOW[dow] : JANTAR_POR_DOW[dow];
      const pessoasPorDia = Math.round(base * peso * 10) / 10;
      return { dow, hora, pessoasPorDia, faturamentoPorDia: pessoasPorDia * TICKET, vendas: Math.max(1, Math.round(pessoasPorDia / 2) * 4) };
    })
  );
  const diasDaSemana = DIAS.map((rotulo, dow) => ({
    dow, rotulo, diasObservados: 4,
    pessoasPorDia: ALMOCO_POR_DOW[dow] + JANTAR_POR_DOW[dow], faturamentoPorDia: (ALMOCO_POR_DOW[dow] + JANTAR_POR_DOW[dow]) * TICKET, ticketPessoa: TICKET,
    turnos: [
      { turno: "ALMOCO" as const, rotulo: "Almoço", diasObservados: 4, pessoasPorDia: ALMOCO_POR_DOW[dow], faturamentoPorDia: ALMOCO_POR_DOW[dow] * TICKET, ticketPessoa: 110 },
      { turno: "JANTAR" as const, rotulo: "Jantar", diasObservados: 4, pessoasPorDia: JANTAR_POR_DOW[dow], faturamentoPorDia: JANTAR_POR_DOW[dow] * TICKET, ticketPessoa: 80 }
    ]
  }));
  const pessoasAlmoco = ALMOCO_POR_DOW.reduce((a, b) => a + b, 0) * 4;
  const pessoasJantar = JANTAR_POR_DOW.reduce((a, b) => a + b, 0) * 4;
  const fat = (pessoasAlmoco + pessoasJantar) * TICKET;
  return {
    periodo, hojeFicouDeFora: true, cobertura: { vendas: 1200, vendasSemHora: 0, diasComMovimento: 28 },
    diasDaSemana,
    mapa: { horas, celulas },
    turnos: [
      { turno: "ALMOCO", rotulo: "Almoço", pessoas: pessoasAlmoco, faturamento: pessoasAlmoco * 110, ticketPessoa: 110, participacao: (pessoasAlmoco * 110) / fat },
      { turno: "JANTAR", rotulo: "Jantar", pessoas: pessoasJantar, faturamento: pessoasJantar * 80, ticketPessoa: 80, participacao: (pessoasJantar * 80) / fat }
    ],
    porHora: [],
    capacidade: {
      metaRelativa: 0.7, hipotese: true,
      turnos: [
        {
          turno: "ALMOCO", rotulo: "Almoço", referencia: { dow: 4, rotulo: "Quinta", pessoasPorDia: 100, meta: 70 },
          folgas: [
            { dow: 2, rotulo: "Terça", pessoasPorDia: 25, pctDoMelhor: 0.25, pessoasAMais: 45, faturamentoMesPotencial: 22000 },
            { dow: 1, rotulo: "Segunda", pessoasPorDia: 30, pctDoMelhor: 0.3, pessoasAMais: 40, faturamentoMesPotencial: 19000 },
            { dow: 3, rotulo: "Quarta", pessoasPorDia: 40, pctDoMelhor: 0.4, pessoasAMais: 30, faturamentoMesPotencial: 14000 }
          ]
        },
        {
          turno: "JANTAR", rotulo: "Jantar", referencia: { dow: 6, rotulo: "Sábado", pessoasPorDia: 35, meta: 24.5 },
          folgas: [{ dow: 1, rotulo: "Segunda", pessoasPorDia: 10, pctDoMelhor: 0.29, pessoasAMais: 14.5, faturamentoMesPotencial: 5000 }]
        }
      ]
    }
  };
}

// Fatores para os valores de itens cancelados ficarem na mesma ordem de grandeza do faturamento do mock.
const escalar = <T,>(dados: T, fator: number): T =>
  JSON.parse(JSON.stringify(dados), (chave, valor) => (["valor", "valorCancelado", "valorItensRecebidos", "valorDescontos", "valorSubtotal", "desconto", "subtotal"].includes(chave) && typeof valor === "number" ? Math.round(valor * fator) : valor));

function perdas(periodo: Periodo): AnalisePerdas {
  const canc = cancelamentos(periodo);
  const itens = escalar(itensCancelados(periodo), 0.04);
  const desc = escalar(descontos(periodo), 0.1);
  const faturado = 150000;
  const refeito = 1500;
  const semRefacao = canc.resumo.valorCancelado - refeito;
  const perdaTotal = semRefacao + itens.resumo.valorCancelado + desc.resumo.valorDescontos;
  return {
    periodo, cobertura: { vendasComDetalhe: canc.cobertura.vendasComDetalhe },
    funil: {
      faturado, cancelado: canc.resumo.valorCancelado, refeito, semRefacao, itensCancelados: itens.resumo.valorCancelado,
      descontos: desc.resumo.valorDescontos, perdaTotal, perdaPct: perdaTotal / faturado, perdaTeto: perdaTotal + refeito, grandes: 6000, grandesVendas: 2
    },
    refacao: { vendas: 6, valor: refeito, pctDoCancelado: refeito / canc.resumo.valorCancelado, janelaMinutos: 10, toleranciaValor: 0.02 },
    limiteGrande: 1000,
    grandes: [
      { saleId: "5001", data: periodo.fim, hora: "15:40", turno: "Jantar", pessoas: 1, valor: 4000, pessoa: "Ana Fictícia", motivo: null, refeita: false },
      { saleId: "5002", data: periodo.inicio, hora: "16:10", turno: "Almoço", pessoas: 1, valor: 2000, pessoa: "Bruno Fictício", motivo: "evento adiado", refeita: false }
    ],
    porPessoa: [
      { pessoa: "Ana Fictícia", canceladas: 24, valorCancelado: 3000, valorRefeito: 600, itens: 20, valorItens: 800, descontos: 30, valorDescontos: 900, perda: 4100 },
      { pessoa: "Bruno Fictício", canceladas: 14, valorCancelado: 1800, valorRefeito: 500, itens: 12, valorItens: 500, descontos: 20, valorDescontos: 600, perda: 2400 },
      { pessoa: "Carla Fictícia", canceladas: 10, valorCancelado: 1250, valorRefeito: 400, itens: 6, valorItens: 400, descontos: 10, valorDescontos: 300, perda: 1550 },
      { pessoa: "(não informado)", canceladas: 4, valorCancelado: 450, valorRefeito: 0, itens: 0, valorItens: 0, descontos: 0, valorDescontos: 0, perda: 450 }
    ],
    cancelamentos: canc, itens, descontos: desc, hojeFicouDeFora: true
  };
}


// ---------------------------------------------------------------------------
// Cardapio: produtos, categorias e taxas inventados (valores redondos, nomes genericos).
// ---------------------------------------------------------------------------

const PRODUTOS_MOCK: Array<[string, string, string, number, number]> = [
  // nome, grupo, categoria, quantidade, receita
  ["BUFFET A", "BUFFETS", "ALIMENTOS", 1000, 50000],
  ["BUFFET B", "BUFFETS", "ALIMENTOS", 150, 7000],
  ["REFRIGERANTE", "BUFFETS", "BEBIDAS", 700, 5000],
  ["AGUA COM GAS", "BUFFETS", "BEBIDAS", 400, 3000],
  ["PRATO DO DIA", "PRATOS", "PRATOS", 90, 5000],
  ["PIZZA MARGHERITA", "PIZZAS", "PIZZAS", 60, 4500],
  ["PIZZA CALABRESA", "PIZZAS", "PIZZAS", 50, 4000],
  ["CAFE EXPRESSO", "BUFFETS", "BEBIDAS", 300, 3500],
  ["SUCO NATURAL", "BUFFETS", "BEBIDAS", 150, 2800],
  ["CERVEJA LONG NECK", "CERVEJAS", "BEBIDAS ALCOOLICAS", 180, 2500],
  ["FILE AO MOLHO", "CARNES", "ALIMENTOS", 30, 2400],
  ["MASSA DA CASA", "MASSAS", "ALIMENTOS", 28, 1800],
  ["VINHO TINTO TACA", "VINHOS", "VINHOS", 60, 1500],
  ["SALADA ESPECIAL", "SALADAS", "ALIMENTOS", 20, 900]
];
for (let i = 1; i <= 26; i += 1) PRODUTOS_MOCK.push([`ITEM ${String(i).padStart(2, "0")}`, "DIVERSOS", i % 3 === 0 ? "BEBIDAS ALCOOLICAS" : "ALIMENTOS", 6, Math.max(8, 520 - i * 20)]);
PRODUTOS_MOCK.push(["BRINDE DO DIA", "DIVERSOS", "ALIMENTOS", 40, 0]);

function abcMock(): AnaliseProdutoAbc[] {
  const ordenados = PRODUTOS_MOCK.map(([produto, grupo, categoria, quantidade, valor]) => ({ produto, grupo, categoria, quantidade, valor })).sort((a, b) => b.valor - a.valor);
  const total = ordenados.reduce((acc, p) => acc + p.valor, 0);
  let antes = 0;
  return ordenados.map((p, i) => {
    const classe: "A" | "B" | "C" = antes < 0.8 * total ? "A" : antes < 0.95 * total ? "B" : "C";
    antes += p.valor;
    return { posicao: i + 1, ...p, participacao: p.valor / total, acumulada: antes / total, classe };
  });
}

const taxa = (pct: number, pp: number, preco: number, anterior: number | null): AnaliseTaxaDoItem => ({
  pctComandas: pct, porPessoa: pct * 1.1, receitaPorPessoa: Math.round(pct * 1.1 * preco * 100) / 100, precoMedio: preco, quantidade: pct * 1000, valor: pct * 1000 * preco,
  pctComandasAnterior: anterior, variacaoPontos: anterior === null ? null : Math.round((pct - anterior) * 10000) / 10000
});

function cardapio(periodo: Periodo): AnaliseCardapio {
  const itens = abcMock();
  const total = itens.reduce((acc, i) => acc + i.valor, 0);
  const cauda = itens.filter((i) => i.valor > 0 && i.valor / total < 0.001);
  const semPreco = itens.filter((i) => i.valor === 0);
  const bloco = (almoco: boolean) => ({
    comandas: almoco ? 700 : 300, pessoas: almoco ? 1400 : 600, comandasAnterior: almoco ? 720 : 310,
    itens: {
      bebida: taxa(almoco ? 0.82 : 0.94, 0, almoco ? 12 : 16, almoco ? 0.8 : 0.95),
      alcool: taxa(almoco ? 0.05 : 0.44, 0, 24, almoco ? 0.05 : 0.46),
      cafe: taxa(almoco ? 0.2 : 0.05, 0, 11, almoco ? 0.19 : 0.05),
      sobremesa: taxa(almoco ? 0.004 : 0.03, 0, 22, almoco ? 0.004 : 0.025)
    } as Record<AnaliseItemDeAtencao, AnaliseTaxaDoItem>
  });
  const almoco = bloco(true);
  const jantar = bloco(false);
  const geral = {
    comandas: 1000, pessoas: 2000, comandasAnterior: 1030,
    itens: {
      bebida: taxa(0.86, 0, 14, 0.84), alcool: taxa(0.17, 0, 24, 0.18), cafe: taxa(0.15, 0, 11, 0.14), sobremesa: taxa(0.011, 0, 22, 0.01)
    } as Record<AnaliseItemDeAtencao, AnaliseTaxaDoItem>
  };
  const categoria = (nome: string, valor: number, anterior: number) => ({
    nome, valor, participacao: valor / total, produtos: 5, quantidade: 100, precoMedio: Math.round((valor / 100) * 100) / 100,
    participacaoAnterior: anterior, variacaoPontos: Math.round((valor / total - anterior) * 10000) / 10000
  });
  return {
    periodo, hojeFicouDeFora: true,
    cobertura: { produtosVendidos: itens.length, comandas: 1000, pessoas: 2000 },
    resumo: {
      faturamentoItens: total, produtosVendidos: itens.length, produtosClasseA: itens.filter((i) => i.classe === "A").length,
      produtosCaudaLonga: cauda.length, participacaoCauda: cauda.reduce((acc, i) => acc + i.valor, 0) / total,
      maiorProduto: { produto: itens[0].produto, participacao: itens[0].participacao }, semPrecoProdutos: semPreco.length, semPrecoUnidades: semPreco.reduce((acc, i) => acc + i.quantidade, 0)
    },
    categorias: [categoria("ALIMENTOS", total * 0.7, 0.72), categoria("BEBIDAS", total * 0.14, 0.13), categoria("PIZZAS", total * 0.07, 0.065), categoria("PRATOS", total * 0.05, 0.05), categoria("BEBIDAS ALCOOLICAS", total * 0.03, 0.03), categoria("VINHOS", total * 0.01, 0.01)],
    grupos: [],
    abc: {
      classes: (["A", "B", "C"] as const).map((classe) => {
        const doGrupo = itens.filter((i) => i.classe === classe);
        const valor = doGrupo.reduce((acc, i) => acc + i.valor, 0);
        return { classe, produtos: doGrupo.length, valor, participacao: valor / total };
      }),
      limiteA: 0.8, limiteB: 0.95, itens: itens.slice(0, 30)
    },
    cauda: { limite: 0.001, produtos: cauda.length, valor: cauda.reduce((acc, i) => acc + i.valor, 0), participacao: cauda.reduce((acc, i) => acc + i.valor, 0) / total, exemplos: cauda.slice(0, 12) },
    semPreco: semPreco.map((i) => ({ produto: i.produto, categoria: i.categoria, unidades: i.quantidade })),
    attach: { turnos: [{ turno: "ALMOCO", rotulo: "Almoço", ...almoco }, { turno: "JANTAR", rotulo: "Jantar", ...jantar }], geral },
    simulacoes: [
      { item: "bebida", rotulo: "Bebida", ponto: 0.01, precoMedio: 14, comandasPorMes: 1000, valorMes: 140 },
      { item: "alcool", rotulo: "Álcool", ponto: 0.01, precoMedio: 24, comandasPorMes: 1000, valorMes: 240 },
      { item: "cafe", rotulo: "Café", ponto: 0.01, precoMedio: 11, comandasPorMes: 1000, valorMes: 110 },
      { item: "sobremesa", rotulo: "Sobremesa", ponto: 0.01, precoMedio: 22, comandasPorMes: 1000, valorMes: 220 }
    ],
    insights: [
      { id: "vendido-a-zero", tom: "alerta", secao: "cardapio", hipotese: false, impactoMes: null, titulo: "1 produto vendido a R$ 0", detalhe: "40 unidades sem valor lançado, como BRINDE DO DIA.", acao: "Confira se é cortesia ou promoção de propósito, ou se o preço não está cadastrado no PDV." },
      { id: "sobremesa-baixa", tom: "oportunidade", secao: "cardapio", hipotese: true, impactoMes: 220, titulo: "Sobremesa em só 1,1% das comandas", detalhe: "Cada ponto percentual a mais de comandas com sobremesa valeria cerca de R$ 220 por mês, ao preço médio de R$ 22.", acao: "Confirme com a equipe se toda sobremesa é lançada no PDV. Se for, vale oferecer na hora da conta; se não, o número não mostra a venda real." },
      { id: "dependencia", tom: "info", secao: "cardapio", hipotese: false, impactoMes: null, titulo: `${itens[0].produto} é ${Math.round(itens[0].participacao * 100)}% da receita`, detalhe: "O faturamento depende de um produto só: qualquer mudança nele mexe no resultado inteiro.", acao: "Acompanhe o preço e o volume desse produto de perto antes de qualquer promoção ou reajuste." }
    ]
  };
}

// Metas: os números do mês são fixos e inventados; só a meta em si muda (fica na memória da aba),
// para o cadastro, a edição e a remoção poderem ser exercitados no modo de demonstração.
const metasDoMock = new Map<string, number>();
const DIAS_RESTANTES_DO_MOCK = 15;

const BASE_DAS_METAS: Record<AnaliseIndicadorDeMeta, { rotulo: string; realizado: number; projecao: number | null; porDia: number | null; referencia: { media3: number; melhor: number } | null }> = {
  faturamento: { rotulo: "Faturamento do mês", realizado: 150000, projecao: 280000, porDia: 10000, referencia: { media3: 260000, melhor: 310000 } },
  pessoas: { rotulo: "Pessoas atendidas", realizado: 1500, projecao: 2800, porDia: 100, referencia: { media3: 2600, melhor: 3100 } },
  ticketPessoa: { rotulo: "Ticket por pessoa", realizado: 100, projecao: null, porDia: null, referencia: { media3: 98, melhor: 104 } },
  perdaPct: { rotulo: "Perda sobre o faturamento", realizado: 0.012, projecao: null, porDia: null, referencia: null }
};

function metas(ano: number, mes: number): AnaliseMetas {
  const indicadores = (Object.keys(BASE_DAS_METAS) as AnaliseIndicadorDeMeta[]).map((indicador): AnaliseMetaIndicador => {
    const b = BASE_DAS_METAS[indicador];
    const meta = metasDoMock.get(`${ano}-${mes}-${indicador}`) ?? null;
    const soma = b.projecao !== null;
    const menorEMelhor = indicador === "perdaPct";
    let situacao: AnaliseSituacaoDaMeta = "sem-meta";
    if (meta !== null) {
      if (soma) situacao = b.realizado >= meta ? "atingida" : (b.projecao as number) >= meta ? "no-ritmo" : "abaixo";
      else situacao = (menorEMelhor ? b.realizado <= meta : b.realizado >= meta) ? "no-ritmo" : "abaixo";
    }
    const faltam = soma && meta !== null ? Math.max(0, meta - b.realizado) : null;
    return {
      indicador, rotulo: b.rotulo, menorEMelhor, meta, realizado: b.realizado, projecao: b.projecao,
      progresso: soma && meta !== null ? Math.round((b.realizado / meta) * 10000) / 10000 : null,
      faltam,
      porDiaAtual: b.porDia,
      porDiaNecessario: faltam !== null && faltam > 0 ? Math.round((faltam / DIAS_RESTANTES_DO_MOCK) * 100) / 100 : null,
      situacao,
      referencia: b.referencia ? { ...b.referencia, mesesNaMedia: 3 } : null
    };
  });
  const fim = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  // O mês corrente é o único "em andamento": os anteriores estão encerrados e os seguintes ainda por vir.
  const agora = new Date();
  const indice = ano * 12 + mes;
  const indiceHoje = agora.getFullYear() * 12 + agora.getMonth() + 1;
  return {
    mes: { ano, mes, inicio: `${ano}-${String(mes).padStart(2, "0")}-01`, fim: `${ano}-${String(mes).padStart(2, "0")}-${fim}`, diasNoMes: fim, encerrado: indice < indiceHoje, futuro: indice > indiceHoje },
    cobertura: { diasComMovimento: 14, diasRestantes: DIAS_RESTANTES_DO_MOCK, diasNoRitmo: 48, podeProjetar: true },
    indicadores
  };
}

function metasDoCorpo(url: string, method: string, corpo: unknown): AnaliseMetas {
  const parametros = new URL(url, "http://localhost").searchParams;
  let ano = Number(parametros.get("ano") ?? 2026);
  let mes = Number(parametros.get("mes") ?? 10);
  if (method.toUpperCase() === "PUT" && typeof corpo === "string") {
    try {
      const dados = JSON.parse(corpo) as { ano: number; mes: number; indicador: AnaliseIndicadorDeMeta; valor: number | null };
      ({ ano, mes } = dados);
      const chave = `${ano}-${mes}-${dados.indicador}`;
      if (dados.valor === null) metasDoMock.delete(chave);
      else metasDoMock.set(chave, dados.valor);
    } catch {
      // Corpo inválido na demonstração: devolve as metas como estão.
    }
  }
  return metas(ano, mes);
}

// Margem: produtos, pratos e custos inventados; só os vínculos mudam (memória da aba) para exercitar
// vincular e desfazer no modo de demonstração.
const PRODUTOS_MARGEM = [
  { codigo: "A1", nome: "PRATO ALFA", quantidade: 100, valor: 6000 },
  { codigo: "B1", nome: "PRATO BETA", quantidade: 50, valor: 2000 },
  { codigo: "G1", nome: "PRATO GAMA COM ARROZ", quantidade: 80, valor: 4000 },
  { codigo: "D1", nome: "PRATO DELTA", quantidade: 30, valor: 1500 }
];
const PRATOS_MARGEM = [
  { id: "p-alfa", nome: "Prato Alfa", custo: 20, itens: 3 },
  { id: "p-beta", nome: "Prato Beta", custo: 45, itens: 3 },
  { id: "p-gama", nome: "Prato Gama", custo: 18, itens: 2 },
  { id: "p-delta", nome: "Prato Delta", custo: null as number | null, itens: 0 }
];
const vinculosDoMock = new Map<string, string>([["A1", "p-alfa"], ["B1", "p-beta"], ["D1", "p-delta"]]);

function margem(periodo: { inicio: string; fim: string }): AnaliseMargem {
  const receitaPratos = PRODUTOS_MARGEM.reduce((t, p) => t + p.valor, 0);
  const porPrato = new Map<string, typeof PRODUTOS_MARGEM>();
  const aFazer: AnaliseMargemAFazer[] = [];
  for (const produto of PRODUTOS_MARGEM) {
    const prato = PRATOS_MARGEM.find((x) => x.id === vinculosDoMock.get(produto.codigo));
    const base = { codigo: produto.codigo, nome: produto.nome, categoria: "PRATOS", quantidade: produto.quantidade, receita: produto.valor, pctReceita: Math.round((produto.valor / receitaPratos) * 10000) / 10000 };
    if (!prato) aFazer.push({ ...base, situacao: "sem-vinculo", pratoId: null, prato: null, sugestoes: produto.codigo === "G1" ? [{ pratoId: "p-gama", nome: "Prato Gama", similaridade: 0.75 }] : [] });
    else if (prato.custo === null) aFazer.push({ ...base, situacao: "sem-ficha", pratoId: prato.id, prato: prato.nome, sugestoes: [] });
    else porPrato.set(prato.id, [...(porPrato.get(prato.id) ?? []), produto]);
  }
  const linhas: AnaliseMargemLinha[] = [...porPrato.entries()].map(([id, lista]) => {
    const prato = PRATOS_MARGEM.find((x) => x.id === id) as (typeof PRATOS_MARGEM)[number];
    const quantidade = lista.reduce((t, p) => t + p.quantidade, 0);
    const receita = lista.reduce((t, p) => t + p.valor, 0);
    const precoMedio = receita / quantidade;
    const custo = prato.custo as number;
    return {
      pratoId: id, prato: prato.nome, produtosPdv: lista.map((p) => ({ codigo: p.codigo, nome: p.nome })), quantidade, quantidadeSemCobranca: 0, receita,
      precoMedio, precoFicha: null, custoPorcao: custo, margemUnitaria: precoMedio - custo,
      margemPct: Math.round(((precoMedio - custo) / precoMedio) * 10000) / 10000, cmvPct: Math.round((custo / precoMedio) * 10000) / 10000,
      margemTotal: (precoMedio - custo) * quantidade
    };
  }).sort((a, b) => b.margemTotal - a.margemTotal);
  const receitaComMargem = linhas.reduce((t, l) => t + l.receita, 0);
  const receitaSemFicha = aFazer.filter((x) => x.situacao === "sem-ficha").reduce((t, x) => t + x.receita, 0);
  const receitaSemVinculo = aFazer.filter((x) => x.situacao === "sem-vinculo").reduce((t, x) => t + x.receita, 0);
  const receitaTotal = receitaPratos + 60000 + 20000;
  return {
    periodo, hojeFicouDeFora: false,
    cobertura: {
      receitaTotal, receitaBuffet: 60000, receitaBebidas: 20000, receitaPratos, receitaComMargem, receitaSemFicha, receitaCustoIncompleto: 0, receitaSemVinculo, receitaPratoIndisponivel: 0,
      pctComMargem: Math.round((receitaComMargem / receitaPratos) * 10000) / 10000, pctVinculadoSemCusto: Math.round((receitaSemFicha / receitaPratos) * 10000) / 10000,
      pctSemVinculo: Math.round((receitaSemVinculo / receitaPratos) * 10000) / 10000, pctDaReceitaTotalComMargem: Math.round((receitaComMargem / receitaTotal) * 10000) / 10000, pratosComMargem: linhas.length
    },
    linhas,
    aFazer: aFazer.sort((a, b) => b.receita - a.receita),
    pratosParaVincular: PRATOS_MARGEM.map((p) => ({ id: p.id, nome: p.nome })),
    // O aviso só existe enquanto o Prato Beta tem vínculo (some se a demonstração o desfizer).
    insights: vinculosDoMock.get("B1") !== "p-beta" ? [] : [
      { id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null, titulo: "Prato Beta vende abaixo do custo", detalhe: "Preço médio de R$ 40 contra custo de R$ 45 por porção: cada prato vendido perde R$ 5 só nos ingredientes.", acao: "Confira a ficha (quantidades e custo dos insumos) e o preço no PDV antes de reajustar ou tirar do cardápio." }
    ]
  };
}

function margemDoCorpo(url: string, method: string, corpo: unknown): unknown {
  if (method.toUpperCase() === "PUT") {
    try {
      const dados = JSON.parse(String(corpo)) as { codigo: string; pratoId: string | null };
      if (dados.pratoId === null) vinculosDoMock.delete(dados.codigo);
      else vinculosDoMock.set(dados.codigo, dados.pratoId);
    } catch {
      // Corpo inválido na demonstração: nada muda.
    }
    return { ok: true };
  }
  return margem(periodoDaUrl(url));
}

// Bebidas (revenda): bebidas e insumos inventados; só os vínculos mudam (memória da aba).
const BEBIDAS_MOCK = [
  { codigo: "R1", nome: "REFRIGERANTE LATA", quantidade: 200, valor: 2400 },
  { codigo: "T1", nome: "TACA DA CASA", quantidade: 80, valor: 1920 },
  { codigo: "S1", nome: "SUCO DA CASA", quantidade: 60, valor: 1080 },
  { codigo: "P1", nome: "DOSE PROMOCIONAL", quantidade: 100, valor: 500 }
];
const INSUMOS_MOCK = [
  { id: "i-lata", nome: "REFRIGERANTE LATA 350ML", unidade: "UN", custo: 3.5 },
  { id: "i-vinho", nome: "VINHO DA CASA 750ML", unidade: "UN", custo: 30 },
  { id: "i-polpa", nome: "POLPA DE FRUTA 1KG", unidade: "UN", custo: 12 },
  { id: "i-destilado", nome: "DESTILADO 700ML", unidade: "UN", custo: 70 }
];
const vinculosBebidasMock = new Map<string, { insumoId: string; quantidade: number; unidade: string }>([
  ["R1", { insumoId: "i-lata", quantidade: 1, unidade: "UN" }],
  ["T1", { insumoId: "i-vinho", quantidade: 150, unidade: "ML" }],
  ["P1", { insumoId: "i-destilado", quantidade: 100, unidade: "ML" }]
]);

function margemBebidas(periodo: { inicio: string; fim: string }): AnaliseMargemBebidas {
  const receitaBebidas = BEBIDAS_MOCK.reduce((t, b) => t + b.valor, 0);
  const linhas: AnaliseMargemBebidasLinha[] = [];
  const aFazer: AnaliseMargemBebidasAFazer[] = [];
  for (const b of BEBIDAS_MOCK) {
    const v = vinculosBebidasMock.get(b.codigo);
    const insumo = INSUMOS_MOCK.find((i) => i.id === v?.insumoId);
    const base = { codigo: b.codigo, nome: b.nome, categoria: "BEBIDAS", quantidade: b.quantidade, receita: b.valor, pctReceita: Math.round((b.valor / receitaBebidas) * 10000) / 10000 };
    if (!v || !insumo) {
      aFazer.push({ ...base, situacao: "sem-vinculo", insumo: null, problema: null, sugestoes: b.codigo === "S1" ? [{ insumoId: "i-polpa", nome: "POLPA DE FRUTA 1KG", similaridade: 0.5 }] : [] });
      continue;
    }
    // Garrafa/pacote: 750 ML, 700 ML ou 1 KG; o resto é 1 UN por venda.
    const embalagem = insumo.id === "i-vinho" ? 750 : insumo.id === "i-destilado" ? 700 : insumo.id === "i-polpa" ? 1000 : 1;
    // L e KG valem 1.000 ML e 1.000 G: o consumo é levado à unidade da embalagem antes de dividir.
    const consumoBase = v.unidade === "L" || v.unidade === "KG" ? v.quantidade * 1000 : v.quantidade;
    const custoPorVenda = v.unidade === "UN" ? insumo.custo * v.quantidade : (insumo.custo * consumoBase) / embalagem;
    const precoMedio = b.valor / b.quantidade;
    linhas.push({
      codigo: b.codigo, nome: b.nome, categoria: "BEBIDAS", quantidade: b.quantidade, quantidadeSemCobranca: 0, receita: b.valor, precoMedio, insumo: insumo.nome,
      consumo: `${v.quantidade} ${v.unidade} de ${insumo.nome}`, custoPorVenda, margemUnitaria: precoMedio - custoPorVenda,
      margemPct: Math.round(((precoMedio - custoPorVenda) / precoMedio) * 10000) / 10000, cmvPct: Math.round((custoPorVenda / precoMedio) * 10000) / 10000,
      margemTotal: (precoMedio - custoPorVenda) * b.quantidade
    });
  }
  linhas.sort((a, b) => b.margemTotal - a.margemTotal);
  const receitaComMargem = linhas.reduce((t, l) => t + l.receita, 0);
  const receitaSemVinculo = aFazer.reduce((t, x) => t + x.receita, 0);
  return {
    periodo, hojeFicouDeFora: false,
    cobertura: {
      receitaBebidas, receitaComMargem, receitaSemVinculo, receitaCustoIncompleto: 0,
      pctComMargem: Math.round((receitaComMargem / receitaBebidas) * 10000) / 10000, pctSemVinculo: Math.round((receitaSemVinculo / receitaBebidas) * 10000) / 10000,
      pctCustoIncompleto: 0, bebidasComMargem: linhas.length
    },
    linhas, aFazer: aFazer.sort((a, b) => b.receita - a.receita),
    insumosParaVincular: aFazer.length === 0 ? [] : INSUMOS_MOCK.map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade })),
    insumosTruncados: false,
    insights: vinculosBebidasMock.has("P1")
      ? [{ id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null, titulo: "DOSE PROMOCIONAL vende abaixo do custo de compra", detalhe: "Preço médio de R$ 5,00 contra custo de R$ 10,00 por venda (100 ML de DESTILADO 700ML): cada venda perde R$ 5,00.", acao: "Confira o vínculo (quantidade e unidade consumidas) e o preço no PDV antes de reajustar ou tirar do cardápio." }]
      : []
  };
}

function margemBebidasDoCorpo(url: string, method: string, corpo: unknown): unknown {
  if (method.toUpperCase() === "PUT") {
    try {
      const dados = JSON.parse(String(corpo)) as { codigo: string; insumoId: string | null; quantidade?: number; unidade?: string };
      if (dados.insumoId === null) vinculosBebidasMock.delete(dados.codigo);
      else vinculosBebidasMock.set(dados.codigo, { insumoId: dados.insumoId, quantidade: dados.quantidade ?? 1, unidade: dados.unidade ?? "UN" });
    } catch {
      // Corpo inválido na demonstração: nada muda.
    }
    return { ok: true };
  }
  return margemBebidas(periodoDaUrl(url));
}

// Custo informado por mês na demonstração (mês "AAAA-M" -> valor). Começa vazio: a pessoa informa e vê a margem aparecer.
const custosBuffetMock = new Map<string, number>();

function margemBuffet(periodo: { inicio: string; fim: string }): AnaliseMargemBuffet {
  const base = [
    { ano: 2026, mes: 9, comandas: 400, pessoas: 800, receita: 40000 },
    { ano: 2026, mes: 10, comandas: 200, pessoas: 400, receita: 22000 }
  ];
  const meses: AnaliseBuffetMes[] = base.map((m) => {
    const custo = custosBuffetMock.get(`${m.ano}-${m.mes}`) ?? null;
    const ticket = m.receita / m.pessoas;
    return {
      ...m, receitaPorPessoa: ticket, custoPorPessoa: custo, margemPorPessoa: custo === null ? null : ticket - custo,
      margemTotal: custo === null ? null : m.receita - custo * m.pessoas, margemPct: custo === null ? null : (ticket - custo) / ticket,
      status: custo === null ? "sem-custo" : "com-custo"
    };
  });
  const comCusto = meses.filter((m) => m.custoPorPessoa !== null);
  const pessoasComCusto = comCusto.reduce((t, m) => t + m.pessoas, 0);
  const receitaComCusto = comCusto.reduce((t, m) => t + m.receita, 0);
  const custoTotal = comCusto.reduce((t, m) => t + (m.custoPorPessoa ?? 0) * m.pessoas, 0);
  const pessoas = 1200;
  const ultimo = [...custosBuffetMock.entries()].sort().pop();
  return {
    periodo, hojeFicouDeFora: false,
    buffet: { comandas: 600, pessoas, receita: 62000, receitaPorPessoa: Math.round((62000 / pessoas) * 100) / 100, pctDaReceita: 0.62 },
    faixas: [
      { produto: "BUFFET PROMO 20", comandas: 400, pessoas: 800, receita: 40000, receitaPorPessoa: 50, pctReceita: 0.645 },
      { produto: "BUFFET PROMO 15", comandas: 200, pessoas: 400, receita: 22000, receitaPorPessoa: 55, pctReceita: 0.355 }
    ],
    meses,
    margem: comCusto.length === 0 ? null : {
      pessoas: pessoasComCusto, receita: receitaComCusto, custo: custoTotal, margem: receitaComCusto - custoTotal,
      custoPorPessoa: custoTotal / pessoasComCusto, margemPorPessoa: (receitaComCusto - custoTotal) / pessoasComCusto, margemPct: (receitaComCusto - custoTotal) / receitaComCusto
    },
    cobertura: { pessoasComCusto, pessoasTotal: pessoas, pctComCusto: pessoasComCusto / pessoas, mesesSemCusto: meses.length - comCusto.length },
    referencia: ultimo ? { ano: Number(ultimo[0].split("-")[0]), mes: Number(ultimo[0].split("-")[1]), valor: ultimo[1] } : null,
    insights: comCusto.length === 0
      ? [{ id: "sem-custo-informado", tom: "info", secao: "margem", hipotese: false, impactoMes: null, titulo: "Sem custo de comida por pessoa informado neste período", detalhe: "O sistema não sabe o custo do buffet: ele não existe por prato nem por refeição. Sem o custo informado só dá para ver o lado da receita.", acao: "Informe o custo médio de comida por pessoa de cada mês na tabela abaixo." }]
      : []
  };
}

function margemBuffetDoCorpo(url: string, method: string, corpo: unknown): unknown {
  if (method.toUpperCase() === "PUT") {
    try {
      const dados = JSON.parse(String(corpo)) as { ano: number; mes: number; valor: number | null };
      if (dados.valor === null) custosBuffetMock.delete(`${dados.ano}-${dados.mes}`);
      else custosBuffetMock.set(`${dados.ano}-${dados.mes}`, dados.valor);
    } catch {
      // Corpo inválido na demonstração: nada muda.
    }
    return { ok: true };
  }
  return margemBuffet(periodoDaUrl(url));
}

export function mockAnaliseSalao(url: string, method = "GET", corpo?: unknown): unknown | undefined {
  const path = new URL(url, "http://localhost").pathname;
  if (path.endsWith("/integrations/agile/analise/cancelamentos")) return cancelamentos(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/itens-cancelados")) return itensCancelados(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/descontos")) return descontos(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/vendas-por-pessoa")) return vendasPorPessoa(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/resumo")) return resumo(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/demanda")) return demanda(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/perdas")) return perdas(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/cardapio")) return cardapio(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/metas")) return metasDoCorpo(url, method, corpo);
  if (path.endsWith("/integrations/agile/analise/margem-buffet") || path.endsWith("/integrations/agile/analise/margem-buffet/custo")) return margemBuffetDoCorpo(url, method, corpo);
  if (path.endsWith("/integrations/agile/analise/margem-bebidas") || path.endsWith("/integrations/agile/analise/margem-bebidas/vinculo")) return margemBebidasDoCorpo(url, method, corpo);
  if (path.endsWith("/integrations/agile/analise/margem") || path.endsWith("/integrations/agile/analise/margem/vinculo")) return margemDoCorpo(url, method, corpo);
  return undefined;
}
