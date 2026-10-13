import type { AnaliseCancelamentos, AnaliseDescontos, AnaliseItensCancelados, AnaliseVendasPorPessoa } from "../api/client";

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

export function mockAnaliseSalao(url: string): unknown | undefined {
  const path = new URL(url, "http://localhost").pathname;
  if (path.endsWith("/integrations/agile/analise/cancelamentos")) return cancelamentos(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/itens-cancelados")) return itensCancelados(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/descontos")) return descontos(periodoDaUrl(url));
  if (path.endsWith("/integrations/agile/analise/vendas-por-pessoa")) return vendasPorPessoa(periodoDaUrl(url));
  return undefined;
}
