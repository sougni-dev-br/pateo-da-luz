import { describe, expect, test } from "vitest";
import {
  gerarInsights, IMPACTO_MINIMO_DIA_OCIOSO, LIMITE_PERDA_ALTA, MAX_INSIGHTS
} from "../agile-analise-insights.js";
import { montarDemanda } from "../agile-analise-demanda.report.js";
import { calcularIndicadores, type Indicadores, type VendaVisao } from "../agile-analise-visao.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-30" }; // 30 dias
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaVisao> = {}): VendaVisao => ({
  saleId: String(Math.random()), movementDate: dia("2026-10-05"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: 2, totalAmount: 200,
  subtotalAmount: null, discountAmount: null, cancelledBy: null, cancelReason: null, ...over
});

// Indicadores "limpos": nada dispara por padrao, cada teste muda so o que quer exercitar.
const base = (over: Partial<Indicadores> = {}): Indicadores => ({
  ...calcularIndicadores([], 0),
  diasComMovimento: 20, faturamento: 100000, comandas: 500, pessoas: 1000, ticketPessoa: 100, ticketComanda: 200, pessoasPorDia: 50, faturamentoPorDia: 5000,
  ...over
});
const demandaVazia = montarDemanda([], periodo);
const gerar = (atual: Indicadores, anterior: Indicadores | null = null, demanda = demandaVazia, confiavel = true) =>
  gerarInsights({ periodo, atual, anterior, anteriorConfiavel: confiavel, demanda });
const ids = (i: ReturnType<typeof gerar>) => i.map((x) => x.id);

describe("gerarInsights — comparacao com o periodo anterior", () => {
  test("queda de pessoas por dia de 20%: alerta com impacto mensal positivo", () => {
    const r = gerar(base({ pessoasPorDia: 40 }), base({ pessoasPorDia: 50 }));
    const i = r.find((x) => x.id === "pessoas-variacao");
    expect(i).toMatchObject({ tom: "alerta", secao: "resumo", hipotese: false });
    expect(i?.titulo).toContain("caiu 20%");
    // 10 pessoas/dia x R$100 x 20 dias ABERTOS no mes (20 de 30 dias do periodo tiveram movimento)
    expect(i?.impactoMes).toBe(Math.round(10 * 100 * 20));
  });

  test("salao aberto todos os dias: o impacto usa 30 dias; fechando metade, usa metade", () => {
    const todos = gerar(base({ pessoasPorDia: 40, diasComMovimento: 30 }), base({ pessoasPorDia: 50 })).find((x) => x.id === "pessoas-variacao");
    expect(todos?.impactoMes).toBe(10 * 100 * 30);
    const metade = gerar(base({ pessoasPorDia: 40, diasComMovimento: 15 }), base({ pessoasPorDia: 50 })).find((x) => x.id === "pessoas-variacao");
    expect(metade?.impactoMes).toBe(10 * 100 * 15);
  });

  test("alta de pessoas: informativo, sem impacto", () => {
    const i = gerar(base({ pessoasPorDia: 60 }), base({ pessoasPorDia: 50 })).find((x) => x.id === "pessoas-variacao");
    expect(i).toMatchObject({ tom: "info", impactoMes: null });
  });

  test("variacao abaixo de 10% nao gera aviso", () => {
    expect(ids(gerar(base({ pessoasPorDia: 46 }), base({ pessoasPorDia: 50 })))).not.toContain("pessoas-variacao");
  });

  test("queda de ticket de 10%: alerta; impacto = diferenca x pessoas/dia x 30", () => {
    const i = gerar(base({ ticketPessoa: 90 }), base({ ticketPessoa: 100 })).find((x) => x.id === "ticket-variacao");
    expect(i).toMatchObject({ tom: "alerta" });
    expect(i?.impactoMes).toBe(Math.round(10 * 50 * 20));
  });

  test("ticket variando menos de 5% nao gera aviso", () => {
    expect(ids(gerar(base({ ticketPessoa: 98 }), base({ ticketPessoa: 100 })))).not.toContain("ticket-variacao");
  });

  test.each([
    ["sem periodo anterior", null, true],
    ["anterior nao confiavel", base({ pessoasPorDia: 100 }), false]
  ])("%s: nenhuma comparacao", (_n, anterior, confiavel) => {
    const r = gerar(base({ pessoasPorDia: 10, ticketPessoa: 10 }), anterior, demandaVazia, confiavel);
    expect(ids(r)).not.toContain("pessoas-variacao");
    expect(ids(r)).not.toContain("ticket-variacao");
  });

  test("periodo atual com menos de 14 dias de movimento (duas semanas) nao compara; com 14 compara", () => {
    expect(ids(gerar(base({ diasComMovimento: 13, pessoasPorDia: 10 }), base()))).not.toContain("pessoas-variacao");
    expect(ids(gerar(base({ diasComMovimento: 14, pessoasPorDia: 10 }), base()))).toContain("pessoas-variacao");
  });
});

describe("gerarInsights — perdas", () => {
  test("perda a partir de 3% do faturamento: alerta com impacto proporcional a 30 dias", () => {
    const i = gerar(base({ perdaPct: LIMITE_PERDA_ALTA, perdaValor: 3000, perdaTetoValor: 3400, canceladoValor: 2000, refeitoValor: 0, itensCanceladosValor: 500, descontoValor: 500 })).find((x) => x.id === "perda-alta");
    expect(i).toMatchObject({ tom: "alerta", secao: "perdas", impactoMes: 3000 }); // periodo de 30 dias
    expect(i?.detalhe).toMatch(/até R\$\s?3\.400 se nenhuma refação for real/);
    expect(i?.acao).toMatch(/É uma estimativa/);
  });
  test("perda abaixo de 3% nao alerta", () => {
    expect(ids(gerar(base({ perdaPct: 0.029 })))).not.toContain("perda-alta");
  });

  test("cancelamentos grandes viram aviso informativo", () => {
    const i = gerar(base({ grandesVendas: 2, grandesValor: 9000 })).find((x) => x.id === "cancelamentos-grandes");
    expect(i).toMatchObject({ tom: "info", impactoMes: null });
    expect(i?.titulo).toContain("2 cancelamentos");
  });
  test("singular quando e so um", () => {
    expect(gerar(base({ grandesVendas: 1, grandesValor: 1200 })).find((x) => x.id === "cancelamentos-grandes")?.titulo).toBe("1 cancelamento de valor muito alto");
  });

  test("refacao so avisa com 5+ casos e 25%+ do valor", () => {
    const comRefacao = (n: number, valor: number) => base({ canceladoValor: 1000, canceladoVendas: 20, refeitoVendas: n, refeitoValor: valor });
    expect(ids(gerar(comRefacao(5, 250)))).toContain("refacao");
    expect(ids(gerar(comRefacao(4, 400)))).not.toContain("refacao");
    expect(ids(gerar(comRefacao(10, 249)))).not.toContain("refacao");
  });

  test("o aviso de refacao nao afirma certeza: diz 'pode nao ser perda' e admite coincidencia", () => {
    const i = gerar(base({ canceladoValor: 1000, canceladoVendas: 20, refeitoVendas: 6, refeitoValor: 400 })).find((x) => x.id === "refacao");
    expect(i?.detalhe).toMatch(/Pode não ser perda de venda/);
    expect(i?.detalhe).toMatch(/coincidência/);
    expect(i?.detalhe).not.toMatch(/Não é perda de venda/);
  });

  test("sem motivo: so quando TODOS os cancelamentos estao sem motivo e sao 5+", () => {
    expect(ids(gerar(base({ canceladoVendas: 5, semMotivo: 5 })))).toContain("cancelamento-sem-motivo");
    expect(ids(gerar(base({ canceladoVendas: 5, semMotivo: 4 })))).not.toContain("cancelamento-sem-motivo");
    expect(ids(gerar(base({ canceladoVendas: 4, semMotivo: 4 })))).not.toContain("cancelamento-sem-motivo");
  });

  test("comandas sem numero de pessoas a partir de 5%", () => {
    expect(ids(gerar(base({ comandas: 100, vendasSemPessoas: 5 })))).toContain("sem-numero-de-pessoas");
    expect(ids(gerar(base({ comandas: 100, vendasSemPessoas: 4 })))).not.toContain("sem-numero-de-pessoas");
  });
});

describe("gerarInsights — dia ocioso", () => {
  const quinta = ["2026-10-01", "2026-10-08", "2026-10-15"].map((d) => venda({ movementDate: dia(d), people: 100, totalAmount: 10000 }));
  const segunda = ["2026-10-05", "2026-10-12", "2026-10-19"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));

  test("dia fraco vira oportunidade marcada como HIPOTESE, com o impacto da folga", () => {
    const demanda = montarDemanda([...quinta, ...segunda], periodo);
    const i = gerar(base(), null, demanda).find((x) => x.id === "dia-ocioso-almoco");
    expect(i).toMatchObject({ tom: "oportunidade", hipotese: true, secao: "demanda" });
    expect(i?.titulo).toBe("Segunda no almoço roda a 30% do melhor dia");
    expect(i?.impactoMes).toBe(demanda.capacidade.turnos[0].folgas[0].faturamentoMesPotencial);
  });

  test("folga com potencial abaixo do minimo nao aparece", () => {
    const pequena = ["2026-10-05", "2026-10-12", "2026-10-19"].map((d) => venda({ movementDate: dia(d), people: 3, totalAmount: 30 }));
    const quintaPequena = ["2026-10-01", "2026-10-08", "2026-10-15"].map((d) => venda({ movementDate: dia(d), people: 5, totalAmount: 50 }));
    const demanda = montarDemanda([...quintaPequena, ...pequena], periodo);
    expect(demanda.capacidade.turnos[0].folgas[0].faturamentoMesPotencial).toBeLessThan(IMPACTO_MINIMO_DIA_OCIOSO);
    expect(ids(gerar(base(), null, demanda))).not.toContain("dia-ocioso-almoco");
  });
});

describe("gerarInsights — ordenacao e limite", () => {
  test("alertas vem antes de oportunidades e informativos; empate pelo maior impacto", () => {
    const r = gerar(
      base({ pessoasPorDia: 40, perdaPct: 0.05, perdaValor: 5000, grandesVendas: 1, grandesValor: 2000, comandas: 100, vendasSemPessoas: 10 }),
      base({ pessoasPorDia: 50 })
    );
    const tons = r.map((x) => x.tom);
    expect(tons).toEqual([...tons].sort((a, b) => ["alerta", "oportunidade", "info"].indexOf(a) - ["alerta", "oportunidade", "info"].indexOf(b)));
    const alertas = r.filter((x) => x.tom === "alerta");
    expect(Math.abs(alertas[0].impactoMes ?? 0)).toBeGreaterThanOrEqual(Math.abs(alertas[alertas.length - 1].impactoMes ?? 0));
  });

  test("com os tres tons na mesma lista: alerta, depois oportunidade, depois informativo", () => {
    const quinta = ["2026-10-01", "2026-10-08", "2026-10-15"].map((d) => venda({ movementDate: dia(d), people: 100, totalAmount: 10000 }));
    const segunda = ["2026-10-05", "2026-10-12", "2026-10-19"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));
    const r = gerar(
      base({ pessoasPorDia: 40, grandesVendas: 1, grandesValor: 2000 }),
      base({ pessoasPorDia: 50 }),
      montarDemanda([...quinta, ...segunda], periodo)
    );
    expect(r.map((i) => i.tom)).toEqual(["alerta", "oportunidade", "info"]);
  });

  test("devolve no maximo 6 avisos", () => {
    const r = gerar(
      base({
        pessoasPorDia: 40, ticketPessoa: 80, perdaPct: 0.05, perdaValor: 5000, grandesVendas: 2, grandesValor: 5000, canceladoValor: 1000, canceladoVendas: 10, semMotivo: 10,
        refeitoVendas: 6, refeitoValor: 400, comandas: 100, vendasSemPessoas: 20
      }),
      base()
    );
    expect(r.length).toBe(MAX_INSIGHTS);
  });

  test("tudo normal: nenhum aviso", () => {
    expect(gerar(base(), base())).toEqual([]);
  });

  test("todo aviso traz titulo, detalhe e acao preenchidos", () => {
    const r = gerar(base({ pessoasPorDia: 40, perdaPct: 0.05, perdaValor: 5000, grandesVendas: 1, grandesValor: 2000 }), base());
    for (const i of r) {
      expect(i.titulo.length).toBeGreaterThan(5);
      expect(i.detalhe.length).toBeGreaterThan(5);
      expect(i.acao.length).toBeGreaterThan(5);
    }
  });
});
