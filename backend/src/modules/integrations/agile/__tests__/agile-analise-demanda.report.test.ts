import { describe, expect, test } from "vitest";
import { META_RELATIVA_AO_MELHOR_DIA, MIN_FREQUENCIA_DO_DIA, montarDemanda, SEMANAS_POR_MES, turnoDe } from "../agile-analise-demanda.report.js";
import type { VendaVisao } from "../agile-analise-visao.report.js";

// 2026-10-05 e segunda; 06 terca; 08 quinta; 12 segunda; 15 quinta.
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaVisao> = {}): VendaVisao => ({
  saleId: String(Math.random()), movementDate: dia("2026-10-05"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "12:30", people: 2, totalAmount: 200,
  subtotalAmount: null, discountAmount: null, cancelledBy: null, cancelReason: null, ...over
});
const periodo = { inicio: "2026-10-01", fim: "2026-10-31" };

describe("turnoDe", () => {
  test.each([["Almoço", "ALMOCO"], ["ALMOCO", "ALMOCO"], ["almoço ", "ALMOCO"], ["Jantar", "JANTAR"], ["JANTAR", "JANTAR"], ["Madrugada", "OUTRO"], ["", "OUTRO"]])("%j -> %s", (entrada, esperado) => {
    expect(turnoDe(entrada)).toBe(esperado);
  });
});

describe("montarDemanda — media por dia observado", () => {
  test("duas segundas com 10 e 20 pessoas: 15 por dia, nao 30", () => {
    const d = montarDemanda(
      [venda({ movementDate: dia("2026-10-05"), people: 10, totalAmount: 1000 }), venda({ movementDate: dia("2026-10-12"), people: 20, totalAmount: 2000 })],
      periodo
    );
    const segunda = d.diasDaSemana[1];
    expect(segunda).toMatchObject({ rotulo: "Segunda", diasObservados: 2, pessoasPorDia: 15, faturamentoPorDia: 1500, ticketPessoa: 100 });
  });

  test("dia da semana sem venda aparece zerado e sem divisao por zero", () => {
    const d = montarDemanda([venda()], periodo);
    expect(d.diasDaSemana[3]).toMatchObject({ rotulo: "Quarta", diasObservados: 0, pessoasPorDia: 0, faturamentoPorDia: 0, ticketPessoa: 0 });
    expect(d.diasDaSemana).toHaveLength(7);
  });

  test("so vendas RECEBIDAS entram", () => {
    const d = montarDemanda([venda({ people: 4 }), venda({ saleStatus: "CANCELADA", people: 50 }), venda({ saleStatus: "EM ABERTO", people: 50 })], periodo);
    expect(d.diasDaSemana[1].pessoasPorDia).toBe(4);
    expect(d.cobertura.vendas).toBe(1);
  });

  test("turno por dia usa os dias em que AQUELE turno abriu (jantar fechado nao dilui a media)", () => {
    const d = montarDemanda(
      [
        venda({ movementDate: dia("2026-10-05"), shift: "Jantar", people: 20 }),
        venda({ movementDate: dia("2026-10-12"), shift: "Almoço", people: 30 }) // segunda sem jantar
      ],
      periodo
    );
    const jantar = d.diasDaSemana[1].turnos.find((t) => t.turno === "JANTAR");
    expect(jantar).toMatchObject({ diasObservados: 1, pessoasPorDia: 20 });
    expect(d.diasDaSemana[1].diasObservados).toBe(2);
  });
});

describe("montarDemanda — mapa de calor", () => {
  test("celula = pessoas daquela hora / dias observados daquele dia da semana", () => {
    const d = montarDemanda(
      [
        venda({ movementDate: dia("2026-10-05"), saleHour: "12:10", people: 6, totalAmount: 600 }),
        venda({ movementDate: dia("2026-10-05"), saleHour: "12:50", people: 4, totalAmount: 400 }),
        venda({ movementDate: dia("2026-10-12"), saleHour: "13:00", people: 10, totalAmount: 1000 })
      ],
      periodo
    );
    expect(d.mapa.horas).toEqual(["12", "13"]);
    const c12 = d.mapa.celulas.find((c) => c.dow === 1 && c.hora === "12");
    const c13 = d.mapa.celulas.find((c) => c.dow === 1 && c.hora === "13");
    expect(c12).toMatchObject({ pessoasPorDia: 5, faturamentoPorDia: 500, vendas: 2 }); // 10 pessoas / 2 segundas
    expect(c13).toMatchObject({ pessoasPorDia: 5, faturamentoPorDia: 500, vendas: 1 });
  });

  test("hora com um digito e normalizada e venda sem hora fica fora do mapa, mas e contada", () => {
    const d = montarDemanda([venda({ saleHour: "9:15" }), venda({ saleHour: null }), venda({ saleHour: "lixo" })], periodo);
    expect(d.mapa.horas).toEqual(["09"]);
    expect(d.cobertura.vendasSemHora).toBe(2);
    expect(d.diasDaSemana[1].pessoasPorDia).toBe(6); // as tres vendas contam no dia
  });
});

describe("montarDemanda — turnos e horas", () => {
  test("participacao soma 1 e ticket do turno so usa vendas com pessoas", () => {
    const d = montarDemanda(
      [venda({ shift: "Almoço", totalAmount: 800, people: 8 }), venda({ shift: "Jantar", totalAmount: 200, people: 2 }), venda({ shift: "Jantar", totalAmount: 1000, people: 0 })],
      periodo
    );
    const almoco = d.turnos.find((t) => t.turno === "ALMOCO");
    const jantar = d.turnos.find((t) => t.turno === "JANTAR");
    expect(almoco).toMatchObject({ pessoas: 8, faturamento: 800, ticketPessoa: 100, participacao: 0.4 });
    expect(jantar).toMatchObject({ pessoas: 2, faturamento: 1200, ticketPessoa: 100, participacao: 0.6 });
  });
  test("turno que nao existe nos dados nao aparece", () => {
    expect(montarDemanda([venda({ shift: "Almoço" })], periodo).turnos.map((t) => t.turno)).toEqual(["ALMOCO"]);
  });
  test("por hora: faturamento e participacao", () => {
    const d = montarDemanda([venda({ saleHour: "12:00", totalAmount: 300 }), venda({ saleHour: "20:00", totalAmount: 100 })], periodo);
    expect(d.porHora).toEqual([
      { hora: "12", pessoas: 2, faturamento: 300, participacao: 0.75 },
      { hora: "20", pessoas: 2, faturamento: 100, participacao: 0.25 }
    ]);
  });
});

describe("montarDemanda — folga de capacidade", () => {
  // quinta forte (100 pessoas/dia) e segunda fraca (30), 3 dias de cada no almoco.
  const quintas = ["2026-10-01", "2026-10-08", "2026-10-15"].map((d) => venda({ movementDate: dia(d), people: 100, totalAmount: 10000 }));
  const segundas = ["2026-10-05", "2026-10-12", "2026-10-19"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));

  test("a referencia e o melhor dia do turno e a meta e 70% dele", () => {
    const almoco = montarDemanda([...quintas, ...segundas], periodo).capacidade.turnos.find((t) => t.turno === "ALMOCO");
    expect(almoco?.referencia).toEqual({ dow: 4, rotulo: "Quinta", pessoasPorDia: 100, meta: 100 * META_RELATIVA_AO_MELHOR_DIA });
  });

  test("a folga de segunda: faltam 40 pessoas/dia e o potencial usa o ticket da propria segunda", () => {
    const folga = montarDemanda([...quintas, ...segundas], periodo).capacidade.turnos.find((t) => t.turno === "ALMOCO")?.folgas[0];
    expect(folga).toMatchObject({ dow: 1, rotulo: "Segunda", pessoasPorDia: 30, pctDoMelhor: 0.3, pessoasAMais: 40 });
    // A segunda abriu 3 das 4 segundas de outubro: o potencial conta 75% das semanas.
    expect(folga?.faturamentoMesPotencial).toBeCloseTo(40 * 100 * SEMANAS_POR_MES * 0.75, 1);
  });

  test("dia acima da meta nao tem folga", () => {
    const quartas = ["2026-10-07", "2026-10-14", "2026-10-21"].map((d) => venda({ movementDate: dia(d), people: 80, totalAmount: 8000 }));
    const folgas = montarDemanda([...quintas, ...quartas], periodo).capacidade.turnos.find((t) => t.turno === "ALMOCO")?.folgas;
    expect(folgas).toEqual([]);
  });

  test("amostra pequena (menos de 3 dias) fica de fora da comparacao", () => {
    const poucas = [venda({ movementDate: dia("2026-10-05"), people: 5, totalAmount: 500 }), venda({ movementDate: dia("2026-10-12"), people: 5, totalAmount: 500 })];
    const almoco = montarDemanda([...quintas, ...poucas], periodo).capacidade.turnos.find((t) => t.turno === "ALMOCO");
    expect(almoco?.referencia).toBeNull(); // so a quinta tem amostra: nada com que comparar
    expect(almoco?.folgas).toEqual([]);
  });

  test("folgas ordenadas pelo maior potencial e rotuladas como hipotese", () => {
    const terca = ["2026-10-06", "2026-10-13", "2026-10-20"].map((d) => venda({ movementDate: dia(d), people: 10, totalAmount: 1500 }));
    const cap = montarDemanda([...quintas, ...segundas, ...terca], periodo).capacidade;
    const folgas = cap.turnos.find((t) => t.turno === "ALMOCO")?.folgas ?? [];
    expect(folgas.map((f) => f.rotulo)).toEqual(["Terça", "Segunda"]);
    expect(cap.hipotese).toBe(true);
  });

  test("dia que abriu em menos da metade das ocorrencias do periodo nao e dia fraco: fica fora da comparacao", () => {
    // Periodo de 90 dias: 13 segundas; a casa abriu em 5 (38%): feriados e eventos, nao um dia ocioso.
    const longo = { inicio: "2026-08-01", fim: "2026-10-29" };
    const cinco = ["2026-08-03", "2026-08-10", "2026-09-07", "2026-09-14", "2026-10-05"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));
    const quintasTodas = Array.from({ length: 13 }, (_, i) => dia(new Date(Date.UTC(2026, 7, 6 + i * 7)).toISOString().slice(0, 10))).map((d) => venda({ movementDate: d, people: 100, totalAmount: 10000 }));
    const almoco = montarDemanda([...quintasTodas, ...cinco], longo).capacidade.turnos.find((t) => t.turno === "ALMOCO");
    expect(almoco?.folgas).toEqual([]);
  });

  test("o limite de frequencia e 50%", () => {
    expect(MIN_FREQUENCIA_DO_DIA).toBe(0.5);
  });

  test("2 de 4 segundas (50%) ainda fica de fora, mas pelo minimo ABSOLUTO de 3 dias, nao pela frequencia", () => {
    const duas = ["2026-10-05", "2026-10-12"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));
    const almoco = montarDemanda([...quintas, ...duas], periodo).capacidade.turnos.find((t) => t.turno === "ALMOCO");
    expect(almoco?.folgas).toEqual([]);
  });

  test("frequencia de exatamente 50% (3 de 6 segundas) ja entra, com metade do potencial", () => {
    const seis = { inicio: "2026-09-01", fim: "2026-10-12" }; // 6 segundas e 6 quintas
    const quintasTodas = ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"].map((d) => venda({ movementDate: dia(d), people: 100, totalAmount: 10000 }));
    const tres = ["2026-09-07", "2026-09-21", "2026-10-05"].map((d) => venda({ movementDate: dia(d), people: 30, totalAmount: 3000 }));
    const folga = montarDemanda([...quintasTodas, ...tres], seis).capacidade.turnos.find((t) => t.turno === "ALMOCO")?.folgas[0];
    expect(folga).toMatchObject({ dow: 1 });
    expect(folga?.faturamentoMesPotencial).toBeCloseTo(40 * 100 * SEMANAS_POR_MES * 0.5, 1);
  });

  test("sem vendas: demanda vazia e sem erro", () => {
    const d = montarDemanda([], periodo);
    expect(d.cobertura).toEqual({ vendas: 0, vendasSemHora: 0, diasComMovimento: 0 });
    expect(d.capacidade.turnos.every((t) => t.referencia === null)).toBe(true);
  });
});
