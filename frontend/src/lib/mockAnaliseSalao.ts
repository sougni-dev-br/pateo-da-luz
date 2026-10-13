import type { AnaliseCancelamentos, AnaliseDescontos, AnaliseItensCancelados, AnaliseVendasPorPessoa } from "../api/client";

// Dados de demonstração da tela "Análise do Salão" (modo ?mock-user=1, só em dev local).
// Tudo fictício: nomes, valores e proporções inventados para exercitar a interface.

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
    cobertura: { vendasComDetalhe: 1312, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: { vendas: 1410, canceladas: 98, taxaCancelamento: 0.0695, valorCancelado: 11840.9, valorFaturado: 186420.35, semMotivo: 98 },
    porPessoa: [
      { pessoa: "Ana Fictícia", canceladas: 34, valor: 4310.2, participacao: 0.364 },
      { pessoa: "Bruno Fictício", canceladas: 22, valor: 2985.5, participacao: 0.252 },
      { pessoa: "Carla Fictícia", canceladas: 17, valor: 1930.0, participacao: 0.163 },
      { pessoa: "Diego Fictício", canceladas: 12, valor: 1450.7, participacao: 0.123 },
      { pessoa: "Elisa Fictícia", canceladas: 8, valor: 780.5, participacao: 0.066 },
      { pessoa: "Fábio Fictício", canceladas: 5, valor: 384.0, participacao: 0.032 }
    ],
    porTurno: [
      { turno: "Almoço", vendas: 820, canceladas: 51, taxa: 0.0622, valor: 6020.4 },
      { turno: "Jantar", vendas: 590, canceladas: 47, taxa: 0.0797, valor: 5820.5 }
    ],
    porHora: [
      { hora: "11", vendas: 40, canceladas: 2, taxa: 0.05, valor: 210 },
      { hora: "12", vendas: 310, canceladas: 17, taxa: 0.0548, valor: 1980.3 },
      { hora: "13", vendas: 330, canceladas: 22, taxa: 0.0667, valor: 2610.1 },
      { hora: "14", vendas: 140, canceladas: 10, taxa: 0.0714, valor: 1220.0 },
      { hora: "19", vendas: 120, canceladas: 9, taxa: 0.075, valor: 980.5 },
      { hora: "20", vendas: 260, canceladas: 24, taxa: 0.0923, valor: 3140.0 },
      { hora: "21", vendas: 180, canceladas: 14, taxa: 0.0778, valor: 1700.0 },
      { hora: "—", vendas: 30, canceladas: 0, taxa: 0, valor: 0 }
    ],
    porDia: [],
    maiores: [
      { saleId: "9101", data: periodo.fim, hora: "20:42", turno: "Jantar", pessoa: "Ana Fictícia", pessoas: 8, valor: 1290.5, motivo: null },
      { saleId: "9087", data: periodo.fim, hora: "13:15", turno: "Almoço", pessoa: "Bruno Fictício", pessoas: 6, valor: 845.9, motivo: null },
      { saleId: "9033", data: periodo.inicio, hora: "21:05", turno: "Jantar", pessoa: "Ana Fictícia", pessoas: 4, valor: 612.0, motivo: null }
    ]
  };
}

function itensCancelados(periodo: { inicio: string; fim: string }): AnaliseItensCancelados {
  const pessoa = (nome: string, itens: number, vendas: number, valor: number) => ({ pessoa: nome, itens, vendas, valor, participacao: valor / 75634.95 });
  return {
    periodo,
    cobertura: { itensCancelados: 1357, itensSemVenda: 0, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: {
      itens: 1357, vendasAfetadas: 872, valorCancelado: 75634.95, valorItensRecebidos: 2022634.98, taxaValor: 0.036,
      semQuemCancelou: 0, semMotivo: 1357, mesmaPessoa: 904, comOsDoisNomes: 1357
    },
    porQuemLancou: [
      pessoa("Carla Fictícia", 410, 280, 24120.5), pessoa("Diego Fictício", 330, 220, 18890.0), pessoa("Elisa Fictícia", 250, 160, 13310.45),
      pessoa("Fábio Fictício", 190, 120, 10104.0), pessoa("Ana Fictícia", 120, 80, 6310.0), pessoa("Bruno Fictício", 57, 40, 2900.0)
    ],
    porQuemCancelou: [
      pessoa("Carla Fictícia", 520, 340, 28950.0), pessoa("Diego Fictício", 380, 250, 21070.95), pessoa("Gustavo Fictício", 300, 200, 17114.0),
      pessoa("Elisa Fictícia", 157, 110, 8500.0)
    ],
    porProduto: [
      { produto: "BUFFET PROMO 15", grupo: "Buffet por quilo", linhas: 210, quantidade: 640, valor: 14210.0 },
      { produto: "BUFFET PROMO 20", grupo: "Buffet por quilo", linhas: 140, quantidade: 410, valor: 9980.5 },
      { produto: "AGUA COM GAS", grupo: "Bebidas", linhas: 180, quantidade: 260, valor: 2080.0 },
      { produto: "SOBREMESA DO DIA", grupo: "Sobremesas", linhas: 95, quantidade: 120, valor: 1990.0 }
    ],
    porHora: [
      { hora: "12", itens: 330, valor: 18200.0 }, { hora: "13", itens: 420, valor: 23400.0 }, { hora: "14", itens: 150, valor: 7800.0 },
      { hora: "20", itens: 300, valor: 17100.0 }, { hora: "21", itens: 157, valor: 9134.95 }
    ],
    maiores: [
      { saleId: "7001", data: periodo.fim, hora: "13:11", produto: "BUFFET PROMO 15", quantidade: 14, valor: 1216.6, quemLancou: "Carla Fictícia", quemCancelou: "Carla Fictícia", motivo: null },
      { saleId: "7002", data: periodo.fim, hora: "13:28", produto: "BUFFET PROMO 20", quantidade: 10, valor: 849.0, quemLancou: "Diego Fictício", quemCancelou: "Gustavo Fictício", motivo: null }
    ]
  };
}

function descontos(periodo: { inicio: string; fim: string }): AnaliseDescontos {
  return {
    periodo,
    cobertura: { vendasComDado: 10490, vendasSemDado: 0, primeiroDia: periodo.inicio, ultimoDia: periodo.fim },
    resumo: {
      vendasRecebidas: 10490, vendasComDesconto: 590, taxaVendas: 0.0562, valorDescontos: 36840.5, valorSubtotal: 1980400,
      percentualSobreSubtotal: 0.0186, descontoMedio: 62.44, acimaDe50: 41, semPessoa: 0, semTipo: 0
    },
    porTipo: [
      { tipo: "POR VALOR", vendas: 262, valor: 15210.0, participacao: 0.413, percentualMedio: 0.31 },
      { tipo: "DESCONTO PRATO DUO APP", vendas: 238, valor: 13900.5, participacao: 0.377, percentualMedio: 0.43 },
      { tipo: "DESCONTO 30%", vendas: 48, valor: 4310.0, participacao: 0.117, percentualMedio: 0.3 },
      { tipo: "DESCONTO 10%", vendas: 24, valor: 1900.0, participacao: 0.052, percentualMedio: 0.1 },
      { tipo: "DESCONTO 50%", vendas: 18, valor: 1520.0, participacao: 0.041, percentualMedio: 0.5 }
    ],
    porPessoa: [
      { pessoa: "Gustavo Fictício", vendas: 250, valor: 15800.0, participacao: 0.429, percentualMedio: 0.33 },
      { pessoa: "Helena Fictícia", vendas: 180, valor: 11200.5, participacao: 0.304, percentualMedio: 0.31 },
      { pessoa: "Igor Fictício", vendas: 110, valor: 6840.0, participacao: 0.186, percentualMedio: 0.28 },
      { pessoa: "Júlia Fictícia", vendas: 50, valor: 3000.0, participacao: 0.081, percentualMedio: 0.4 }
    ],
    porTurno: [
      { turno: "Almoço", vendas: 6020, vendasComDesconto: 380, taxa: 0.0631, valor: 22100.0 },
      { turno: "Jantar", vendas: 4470, vendasComDesconto: 210, taxa: 0.047, valor: 14740.5 }
    ],
    maiores: [
      { saleId: "8001", data: periodo.fim, hora: "20:15", turno: "Jantar", pessoas: 6, subtotal: 1240.0, desconto: 1220.0, percentual: 0.984, tipo: "POR VALOR", pessoa: "Helena Fictícia" },
      { saleId: "8002", data: periodo.inicio, hora: "13:40", turno: "Almoço", pessoas: 4, subtotal: 640.0, desconto: 320.0, percentual: 0.5, tipo: "DESCONTO 50%", pessoa: "Gustavo Fictício" }
    ]
  };
}

function vendasPorPessoa(periodo: { inicio: string; fim: string }): AnaliseVendasPorPessoa {
  const pessoa = (nome: string, valor: number, vendas: number, itens: number, mix: Array<[string, number]>) => ({
    pessoa: nome,
    valor,
    participacao: valor / 186420.35,
    itens,
    vendas,
    ticketMedio: Math.round((valor / vendas) * 100) / 100,
    itensPorVenda: Math.round((itens / vendas) * 100) / 100,
    mix: mix.map(([grupo, parte]) => ({ grupo, valor: Math.round(valor * parte * 100) / 100, participacao: parte }))
  });
  return {
    periodo,
    cobertura: { itensComPessoa: 5388, itensSemPessoa: 121 },
    resumo: { pessoas: 6, valorTotal: 179904.1, valorSemPessoa: 6516.25, itensSemPessoa: 121 },
    pessoas: [
      pessoa("Carla Fictícia", 52310.4, 410, 1520, [["Buffet por quilo", 0.52], ["Bebidas", 0.31], ["Sobremesas", 0.09]]),
      pessoa("Diego Fictício", 41880.2, 330, 1210, [["Buffet por quilo", 0.49], ["Bebidas", 0.34], ["Sobremesas", 0.1]]),
      pessoa("Elisa Fictícia", 33120.0, 290, 980, [["Buffet por quilo", 0.55], ["Bebidas", 0.28], ["Sobremesas", 0.11]]),
      pessoa("Fábio Fictício", 27410.9, 240, 790, [["Buffet por quilo", 0.5], ["Bebidas", 0.33], ["Sobremesas", 0.08]]),
      pessoa("Ana Fictícia", 17050.3, 160, 520, [["Bebidas", 0.45], ["Buffet por quilo", 0.4], ["Sobremesas", 0.07]]),
      pessoa("Bruno Fictício", 8132.3, 88, 368, [["Bebidas", 0.5], ["Buffet por quilo", 0.38], ["Sobremesas", 0.06]])
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
