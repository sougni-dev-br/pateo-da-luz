import { describe, expect, test } from "vitest";
import type { TipComputation, TipComputedParticipant, TipMesAnterior } from "../../../api/client";
import { linhasCsvConferencia, montarConferencia } from "../conferencia";

// Dados fictícios.
function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa Ficticia", apelido: null, companyId: null, companyName: null, functionName: "Garçom",
    semRegistro: false, foraDaGorjeta: false, kind: "PONTOS", basePoints: 3.5, tipoCalculo: "MES", diasComputados: 26, diasReferencia: 26,
    points: 3.5, rateioAmount: 400, descontos: 0, creditos: 0, netCommission: 400, rescisaoPendente: false, gorjetaReal: null, vales: [],
    ...over,
  } as TipComputedParticipant;
}

const ANTERIOR: TipMesAnterior = {
  year: 2026, month: 10, label: "Outubro/2026", valorPonto: 100,
  porPessoa: { a: { gorjeta: 350, pontosBase: 3.5, pontosApurados: 3.5, diasComputados: 26, diasReferencia: 26, funcao: "Garçom", tipo: "PONTOS", tipoCalculo: "MES" } },
};

function comp(over: Partial<TipComputation> = {}): TipComputation {
  return {
    year: 2026, month: 11, label: "Gorjeta 26/10-25/11", code: "GOR-2026-0010", status: "OPEN", fechamento: null,
    periodStart: "2026-10-26T00:00:00.000Z", periodEnd: "2026-11-25T00:00:00.000Z",
    grossPool: 10000, servicoFaturamento: 10000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, quebraPercent: 0, quebraValor: 0,
    netPool: 8000, fixedTotal: 0, pontosDisponiveis: 80, totalPoints: 80, pointValue: 100, distribuido: 7999.99, saldo: 0.01, reservaTotal: 0, rescisoes: { valor: 0, pontos: 0 },
    totals: { rateio: 7999.99, vales: 50, netCommission: 7949.99 },
    participants: [
      pessoa({ employeeId: "a", employeeName: "Ana Ficticia", apelido: "Aninha", rateioAmount: 400, netCommission: 400, points: 4, basePoints: 4 }),
      pessoa({ employeeId: "b", employeeName: "Bia Ficticia", rateioAmount: 300, descontos: 50, netCommission: 250, diasComputados: 21 }),
      pessoa({ employeeId: "c", employeeName: "Caio Ficticio", foraDaGorjeta: true, rateioAmount: 0 }),
    ],
    pendencias: [], warnings: ["Sem data de admissão: Bia."], anterior: null,
    ...over,
  } as unknown as TipComputation;
}

describe("montarConferencia", () => {
  test("cabeçalho: competência, ciclo e situação de prévia", () => {
    const c = montarConferencia(comp());
    expect(c).toMatchObject({ competencia: "Novembro/2026", ciclo: "26/10 a 25/11", codigo: "GOR-2026-0010", fechado: false, fechadoEm: null });
  });

  test("fechado informa a data do fechamento", () => {
    const c = montarConferencia(comp({ status: "CLOSED", fechamento: { id: "f", code: "GOR-2026-0010/v1", version: 1, closedAt: "2026-11-26T12:00:00.000Z", closedByName: "Eli" } }));
    expect(c).toMatchObject({ fechado: true, fechadoEm: "26/11" });
  });

  test("como o valor foi formado: retenção calculada do bruto e do líquido, sem ajuste nem quebra quando não há", () => {
    const f = Object.fromEntries(montarConferencia(comp()).formacao);
    expect(f["Retenção de 20%"]).toMatch(/^-R\$\s2\.000,00$/);
    expect(f["Líquido do período"]).toMatch(/8\.000,00/);
    expect(f["Valor do ponto"]).toMatch(/100,00/);
    expect(Object.keys(f).some((k) => k.startsWith("Ajuste") || k.startsWith("Quebra") || k.startsWith("Reserva"))).toBe(false);
  });

  test("ajuste, quebra e reserva entram quando existem; a retenção não inclui a quebra", () => {
    const f = Object.fromEntries(montarConferencia(comp({
      grossPool: 9800, servicoFaturamento: 10000, ajusteServico: -200, ajusteServicoMotivo: "serviço lançado em dobro", quebraPercent: 5, quebraValor: 392, netPool: 7448, reservaTotal: 120,
    })).formacao);
    expect(Object.keys(f).find((k) => k.startsWith("Ajuste do serviço"))).toContain("serviço lançado em dobro");
    expect(f["Quebra (5%)"]).toMatch(/392,00/);
    expect(f["Retenção de 20%"]).toMatch(/1\.960,00/);
    expect(f["Reserva da casa"]).toMatch(/120,00/);
  });

  test("tabela: só quem participa; só salário vai para a lista à parte", () => {
    const c = montarConferencia(comp());
    expect(c.linhas).toHaveLength(2);
    expect(c.linhas[0][0]).toBe("Aninha (Ana Ficticia)");
    expect(c.soSalario).toEqual(["Caio Ficticio"]);
    expect(c.cabecalho).not.toContain("Mês anterior");
  });

  test("presença, vales e líquido por pessoa; total confere com o cálculo", () => {
    const c = montarConferencia(comp());
    const bia = c.linhas.find((l) => l[0] === "Bia Ficticia")!;
    expect(bia[3]).toBe("21/26");
    expect(bia[c.cabecalho.indexOf("Vales")]).toMatch(/50,00/);
    expect(c.total[0]).toBe("Total");
    expect(c.total[c.cabecalho.indexOf("Gorjeta")]).toMatch(/700,00/);
  });

  test("com mês anterior fechado, a tabela ganha as colunas de comparação", () => {
    const c = montarConferencia(comp({ anterior: ANTERIOR }));
    expect(c.cabecalho).toEqual(expect.arrayContaining(["Mês anterior", "Diferença"]));
    const ana = c.linhas[0];
    expect(ana[c.cabecalho.indexOf("Mês anterior")]).toMatch(/350,00/);
    expect(ana[c.cabecalho.indexOf("Diferença")]).toMatch(/^\+R\$\s50,00$/);
    expect(c.linhas[1][c.cabecalho.indexOf("Diferença")]).toBe("novo");
    expect(c.linhas.every((l) => l.length === c.cabecalho.length)).toBe(true);
    expect(c.total).toHaveLength(c.cabecalho.length);
    expect(c.anteriorLabel).toBe("Outubro/2026");
  });

  test("rescisão pendente aparece como pendente, não como zero", () => {
    const c = montarConferencia(comp({ participants: [pessoa({ employeeId: "r", employeeName: "Rui Ficticio", rescisaoPendente: true, tipoCalculo: "RESCISAO", rateioAmount: 0, netCommission: 0 })] }));
    expect(c.linhas[0]).toEqual(expect.arrayContaining(["pendente", "rescisão pendente"]));
  });

  test("não leva salário, PIX nem dados de banco", () => {
    const c = montarConferencia(comp({ participants: [pessoa({ employeeId: "s", baseSalary: 4321.56, pixKey: "chave-secreta", salarioProporcional: 5551.1, totalAPagar: 6662.2 } as Partial<TipComputedParticipant>)] }));
    const tudo = JSON.stringify(c);
    expect(tudo).not.toMatch(/4\.?321|chave-secreta|5\.?551|6\.?662/);
  });
});

describe("totais e rótulos", () => {
  test("o total é a soma das linhas: reserva da casa e quem só recebe salário (com vale) ficam de fora", () => {
    const c = montarConferencia(comp({
      reservaTotal: 120, totals: { rateio: 8119.99, vales: 90, netCommission: 8029.99 } as TipComputation["totals"],
      participants: [
        pessoa({ employeeId: "a", employeeName: "Ana Ficticia", rateioAmount: 400, netCommission: 400 }),
        pessoa({ employeeId: "b", employeeName: "Bia Ficticia", rateioAmount: 300, descontos: 50, netCommission: 250 }),
        pessoa({ employeeId: "c", employeeName: "Caio Ficticio", foraDaGorjeta: true, rateioAmount: 0, descontos: 40, netCommission: -40 }),
      ],
    }));
    expect(c.total[c.cabecalho.indexOf("Gorjeta")]).toMatch(/700,00/);
    expect(c.total[c.cabecalho.indexOf("Vales")]).toMatch(/50,00/);
    expect(c.total[c.cabecalho.indexOf("Líquido")]).toMatch(/650,00/);
  });

  test("o rótulo da sobra segue o destino, como a tela de Apuração", () => {
    const rotulo = (over: Partial<TipComputation>) => montarConferencia(comp(over)).resumo[2][0];
    expect(rotulo({ saldo: 12, destinoEfetivo: "FUNDO" })).toBe("Sobra (vai ao fundo)");
    expect(rotulo({ saldo: 12, destinoEfetivo: "LIVRE" })).toBe("Livre no período (não vai ao fundo)");
    expect(rotulo({ saldo: 0.01, destinoEfetivo: "REDISTRIBUIR" })).toBe("Arredondamento (pontos redistribuídos)");
    expect(rotulo({ saldo: 0.01, destinoEfetivo: "FUNDO" })).toBe("Arredondamento (vai ao fundo)");
    expect(rotulo({ saldo: 0.01, destinoEfetivo: "LIVRE" })).toBe("Arredondamento (fica livre no período)");
    expect(rotulo({ saldo: 30, destinoEfetivo: "REDISTRIBUIR" })).toBe("Arredondamento (pontos redistribuídos)");
    expect(rotulo({ saldo: -3 })).toBe("Excesso (passa do líquido)");
    expect(rotulo({ saldo: -0.003 })).toBe("Sobra (vai ao fundo)");
  });

  test("rescisões entram na formação do valor, saindo do líquido ou à parte", () => {
    const sai = Object.fromEntries(montarConferencia(comp({ rescisoes: { valor: 500, pontos: 5 } })).formacao);
    expect(sai["Rescisões (saem do líquido antes do ponto)"]).toMatch(/^-R\$\s500,00$/);
    const parte = Object.fromEntries(montarConferencia(comp({ rescisoes: { valor: 500, pontos: 5 }, sobraRescisaoParaSaldo: true })).formacao);
    expect(parte["Rescisões (pagas à parte, não saem do ponto do mês)"]).toMatch(/500,00/);
    expect(Object.keys(Object.fromEntries(montarConferencia(comp({ rescisoes: { valor: 0, pontos: 0 } })).formacao)).some((k) => k.startsWith("Rescisões"))).toBe(false);
  });

  test("retenção e quebra saem sem espaço depois do sinal (o Excel lê como moeda)", () => {
    const f = Object.fromEntries(montarConferencia(comp()).formacao);
    expect(f["Retenção de 20%"]).toMatch(/^-R\$\s2\.000,00$/);
  });
});

describe("linhasCsvConferencia", () => {
  test("planilha com título, resumo, pendências, tabela e total, e todas as linhas da tabela com o mesmo número de colunas", () => {
    const c = montarConferencia(comp({ pendencias: ["A distribuição passa do líquido."] }));
    const csv = linhasCsvConferencia(c);
    const texto = csv.flat().join("\n");
    expect(csv[0][0]).toBe("Conferência da gorjeta");
    expect(texto).toContain("Pendências que impedem o fechamento (1)");
    expect(texto).toContain("A distribuição passa do líquido.");
    expect(texto).toContain("Para conferir (1)");
    const inicio = csv.findIndex((l) => l[0] === "Funcionário");
    const tabela = csv.slice(inicio, inicio + 1 + c.linhas.length + 1);
    expect(new Set(tabela.map((l) => l.length)).size).toBe(1);
  });

  test("texto de cadastro que abre como fórmula do Excel recebe apóstrofo; valores não", () => {
    const c = montarConferencia(comp({
      participants: [pessoa({ employeeId: "a", employeeName: "=HYPERLINK(\"x\")", functionName: "+cmd", descontos: 0, rateioAmount: 400 })],
      pendencias: ["@SUM(A1)"],
    }));
    const csv = linhasCsvConferencia(c);
    const dados = csv.find((l) => l[0]?.includes("HYPERLINK"))!;
    expect(dados[0].startsWith("'=")).toBe(true);
    expect(dados[1]).toBe("'+cmd");
    expect(csv.flat()).toContain("'@SUM(A1)");
    // Valores (moeda com sinal) seguem sem apóstrofo: o Excel os lê como número.
    expect(csv.find((l) => l[0]?.startsWith("Retenção"))![1]).toMatch(/^-R\$/);
  });

  test("sem pendências, diz isso", () => {
    expect(linhasCsvConferencia(montarConferencia(comp())).flat()).toContain("Nenhuma pendência");
  });
});
