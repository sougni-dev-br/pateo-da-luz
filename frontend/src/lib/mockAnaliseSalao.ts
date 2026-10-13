import type { AnaliseCancelamentos, AnaliseVendasPorPessoa } from "../api/client";

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
  if (path.endsWith("/integrations/agile/analise/vendas-por-pessoa")) return vendasPorPessoa(periodoDaUrl(url));
  return undefined;
}
