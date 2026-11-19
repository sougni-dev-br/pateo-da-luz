import { describe, expect, test } from "vitest";
import {
  DESCRICAO_COMBINADO_E_GORJETA, diferencaDaGorjeta, gorjetaIntegralDoCombinado, informadasDaTabela, informadasDasFerias, lerMediaValor13, mediaDeclaradaMensal, variaveisDaDiferencaDaGorjeta,
} from "../decimo-terceiro-gorjeta-combinado.js";
import { lerTextoExtrato } from "../rh-extract.service.js";

// Valores FICTÍCIOS (repo público). O extrato do 13º da contabilidade traz a gorjeta DECLARADA dentro da rubrica
// "MEDIA VALOR 13o ADIANTADO" (valor da 1ª parcela e avos); a diferença para a gorjeta integral é o que se soma.
describe("lerMediaValor13", () => {
  test("lê o valor e os avos da rubrica", () => {
    expect(lerMediaValor13("13 13 SALARIO ADIANTADO P\t1.500,00\t12,00\n834 MEDIA VALOR 13o ADIANTADO P\t609,20\t12,00\nND: 1")).toEqual({ valor: 609.2, avos: 12 });
  });
  test("avos quebrados e valor com milhar", () => {
    expect(lerMediaValor13("834 MEDIA VALOR 13o ADIANTADO P 1.049,46 2,00")).toEqual({ valor: 1049.46, avos: 2 });
  });
  test("sem a rubrica: null (não confunde com MEDIA HORAS)", () => {
    expect(lerMediaValor13("833 MEDIA HORAS 13o ADIANTADO P\t100,00\t12,00")).toBeNull();
  });
});

describe("mediaDeclaradaMensal", () => {
  test("1ª parcela = média ÷ 12 × avos ÷ 2 → média mensal = valor × 24 ÷ avos", () => {
    expect(mediaDeclaradaMensal({ valor: 600, avos: 12 })).toBe(1200);
    expect(mediaDeclaradaMensal({ valor: 100, avos: 2 })).toBe(1200);
  });
  test("avos zero ou inválidos: zero", () => {
    expect(mediaDeclaradaMensal({ valor: 100, avos: 0 })).toBe(0);
  });
});

describe("variaveisDaDiferencaDaGorjeta", () => {
  test("cada mês apurado = gorjeta integral − declarada; mês apurado sem gorjeta conta como zero", () => {
    const r = variaveisDaDiferencaDaGorjeta(new Map([[8, 2000], [9, 1500]]), 1200, new Set([8, 9, 10]));
    expect([...r]).toEqual([[8, 800], [9, 300], [10, -1200]]);
  });
  test("mês fora dos apurados não entra", () => {
    expect(variaveisDaDiferencaDaGorjeta(new Map([[1, 999]]), 100, new Set([8])).has(1)).toBe(false);
  });
  test("a descrição do que é somado cita a gorjeta integral", () => {
    expect(DESCRICAO_COMBINADO_E_GORJETA).toContain("gorjeta integral");
  });
});

describe("extrato do 13º lido pelo parser", () => {
  const texto = [
    "Página: 1/1", "Emissão: 12/11/2026", "EXTRATO MENSAL", "11/2026", "Cálculo: 13o Adiantamento", "00.000.000/0001-00", "EMPRESA EXEMPLO COMERCIO LTDA",
    "20 ANA CLARA EXEMPLO\tEmpr.: 01/03/2020\tAdm:\t000.000.001-91\tTrabalhando CPF:\tSituação:",
    "13 13 SALARIO ADIANTADO P\t1.500,00\t12,00", "834 MEDIA VALOR 13o ADIANTADO P\t600,00\t12,00",
    "ND: 1 Proventos: 2.100,00 Líquido:\tDescontos: 0,00 Informativa: 1 Informativa Dedutora: 0 2.100,00",
    "NF: 1 Base INSS: 0,00",
    "21 BRUNO EXEMPLO\tEmpr.: 01/03/2020\tAdm:\t000.000.002-72\tTrabalhando CPF:\tSituação:",
    "13 13 SALARIO ADIANTADO P\t900,00\t12,00",
    "ND: 1 Proventos: 900,00 Líquido:\tDescontos: 0,00 Informativa: 1 Informativa Dedutora: 0 900,00",
    "NF: 1 Base INSS: 0,00",
  ].join("\n");

  test("a média de valores da pessoa vem junto, e fica null para quem não tem", () => {
    const r = lerTextoExtrato(texto);
    expect(r.funcionarios.map((f) => [f.cpfNorm, f.liquido, f.mediaValor13 ?? null])).toEqual([
      ["00000000191", 2100, { valor: 600, avos: 12 }],
      ["00000000272", 900, null],
    ]);
  });

  test("a folha mensal não ganha o campo (comportamento antigo intacto)", () => {
    const mensal = texto.replace("Cálculo: 13o Adiantamento", "Cálculo: Folha Mensal");
    expect(lerTextoExtrato(mensal).funcionarios.every((f) => !("mediaValor13" in f))).toBe(true);
  });
});

// Gorjeta informada à mão no modal "Complementar pelo combinado" (férias) também compõe o 13º. Valores FICTÍCIOS.
const feriasComInformadas = (...meses: Array<[string, number]>) => ({
  feriasCombinado: { meses: meses.map(([chave, valor]) => ({ chave, valor, origem: "INFORMADA" })) },
});

describe("informadasDasFerias", () => {
  test("pega só os meses 1 a 11 do ano-base; outros anos e dezembro ficam de fora", () => {
    const r = informadasDasFerias([feriasComInformadas(["2025-12", 900], ["2026-03", 1800], ["2026-12", 700], ["2027-01", 5])], 2026);
    expect([...r]).toEqual([[3, 1800]]);
  });
  test("mês apurado nas férias (não informado) não entra", () => {
    const d = { feriasCombinado: { meses: [{ chave: "2026-04", valor: 1000, origem: "APURACAO" }] } };
    expect(informadasDasFerias([d], 2026).size).toBe(0);
  });
  test("vários títulos: o último da lista prevalece no mesmo mês", () => {
    const r = informadasDasFerias([feriasComInformadas(["2026-05", 1000]), feriasComInformadas(["2026-05", 1100], ["2026-06", 1200])], 2026);
    expect([...r]).toEqual([[5, 1100], [6, 1200]]);
  });
  test("detalhes sem a marca ou inválidos: vazio", () => {
    expect(informadasDasFerias([null, {}, "x", { feriasCombinado: { meses: 3 } }], 2026).size).toBe(0);
  });
});

describe("gorjetaIntegralDoCombinado", () => {
  const apuracao = new Map([[8, 2000], [9, 1500]]);
  test("sem informadas: igual à apuração", () => {
    const r = gorjetaIntegralDoCombinado({ apuracao, apurados: new Set([8, 9]), doDecimo: new Map(), dasFerias: new Map() });
    expect([...r.integralPorMes]).toEqual([[8, 2000], [9, 1500]]);
    expect([...r.mesesApurados].sort()).toEqual([8, 9]);
    expect(r.mesesDasFerias).toEqual([]);
  });
  test("informada nas férias preenche mês sem apuração e passa a contar na média", () => {
    const r = gorjetaIntegralDoCombinado({ apuracao, apurados: new Set([8, 9]), doDecimo: new Map(), dasFerias: new Map([[3, 1800]]) });
    expect(r.integralPorMes.get(3)).toBe(1800);
    expect(r.mesesApurados.has(3)).toBe(true);
    expect(r.mesesDasFerias).toEqual([3]);
  });
  test("mês apurado com gorjeta > 0: a apuração prevalece sobre a informada das férias", () => {
    const r = gorjetaIntegralDoCombinado({ apuracao, apurados: new Set([8, 9]), doDecimo: new Map(), dasFerias: new Map([[8, 100]]) });
    expect(r.integralPorMes.get(8)).toBe(2000);
    expect(r.mesesDasFerias).toEqual([]);
  });
  test("mês apurado com gorjeta ZERO (ou sem a pessoa na apuração): aceita a informada", () => {
    const r = gorjetaIntegralDoCombinado({ apuracao: new Map([[7, 0], [8, 2000]]), apurados: new Set([6, 7, 8]), doDecimo: new Map(), dasFerias: new Map([[6, 500], [7, 1392.45]]) });
    expect(r.integralPorMes.get(7)).toBe(1392.45);
    expect(r.integralPorMes.get(6)).toBe(500);
    expect(r.integralPorMes.get(8)).toBe(2000);
    expect(r.mesesDasFerias).toEqual([6, 7]);
    expect(r.mesesApurados.has(7)).toBe(true);
  });
  test("valor informado na tela do 13º vale mais que tudo", () => {
    const r = gorjetaIntegralDoCombinado({ apuracao, apurados: new Set([8, 9]), doDecimo: new Map([[8, 2500], [3, 1000]]), dasFerias: new Map([[3, 1800]]) });
    expect(r.integralPorMes.get(8)).toBe(2500);
    expect(r.integralPorMes.get(3)).toBe(1000);
    expect(r.mesesDasFerias).toEqual([]);
    expect([...r.mesesApurados].sort((a, b) => a - b)).toEqual([3, 8, 9]);
  });
  test("não muda os mapas recebidos", () => {
    const ap = new Map([[8, 2000]]);
    gorjetaIntegralDoCombinado({ apuracao: ap, apurados: new Set([8]), doDecimo: new Map(), dasFerias: new Map([[3, 1]]) });
    expect([...ap]).toEqual([[8, 2000]]);
  });
});

describe("informadasDaTabela", () => {
  test("só jan–nov do ano-base; dezembro, outro ano e competência inválida ficam de fora", () => {
    const r = informadasDaTabela([
      { competencia: "2026-01", valor: 10 }, { competencia: "2026-11", valor: 20 }, { competencia: "2026-12", valor: 30 },
      { competencia: "2025-06", valor: 40 }, { competencia: "2026-6", valor: 50 }, { competencia: "x", valor: 60 },
    ], 2026);
    expect([...r]).toEqual([[1, 10], [11, 20]]);
  });
});

// A gorjeta tem os avos do ANO TODO (desde a admissão), não os do combinado: o extrato da contabilidade divide a gorjeta declarada
// por todos os meses até outubro e paga 12 avos, então a diferença precisa da mesma base para não pagar a mais nem a menos.
describe("diferencaDaGorjeta", () => {
  const D = (a: string) => new Date(`${a}T00:00:00Z`);
  const declarada = 1000;
  // jan e fev = o que a contabilidade usou (declarada, diferença zero); mar a out = gorjeta integral. Soma 12.500 ÷ 10 = 1.250.
  const integral = new Map([[1, 800], [2, 800], [3, 1200], [4, 1500], [5, 1100], [6, 1300], [7, 1000], [8, 1600], [9, 1800], [10, 1400]]);
  const apurados = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  test("ano todo: média real 1.250 − declarada 1.000 = 250 → 1ª = 250 ÷ 12 × 12 ÷ 2", () => {
    const r = diferencaDaGorjeta({ ano: 2026, inicio: D("2025-03-01"), integralPorMes: integral, declaradaMensal: declarada, mesesApurados: apurados })!;
    expect(r).toMatchObject({ avos: 12, avosParcela1: 12, mediaParcela1: 250, mediaFinal: 250 });
    expect(r.parcela1).toBe(125);
    expect(r.total).toBe(250);
  });

  test("meses sem valor ficam de fora da média: quem não informa jan/fev paga a mais (por isso se informa o da contabilidade)", () => {
    const so = new Set([3, 4, 5, 6, 7, 8, 9, 10]);
    const r = diferencaDaGorjeta({ ano: 2026, inicio: D("2025-03-01"), integralPorMes: integral, declaradaMensal: declarada, mesesApurados: so })!;
    expect(r.mediaParcela1).toBe(362.5); // 10.900 ÷ 8 − 1.000
    expect(r.parcela1).toBe(181.25);
  });

  test("média abaixo da declarada: zero, nunca desconta do que o extrato pagou", () => {
    const r = diferencaDaGorjeta({ ano: 2026, inicio: D("2025-03-01"), integralPorMes: new Map([[8, 100], [9, 100], [10, 100]]), declaradaMensal: declarada, mesesApurados: new Set([8, 9, 10]) })!;
    expect(r.mediaParcela1).toBe(0);
    expect(r.parcela1).toBe(0);
    expect(r.total).toBe(0);
  });

  test("quem entrou em agosto: avos de agosto a dezembro (5), 4 na 1ª", () => {
    const r = diferencaDaGorjeta({ ano: 2026, inicio: D("2026-08-01"), integralPorMes: new Map([[8, 1600], [9, 1800], [10, 1400]]), declaradaMensal: declarada, mesesApurados: new Set([8, 9, 10]) })!;
    expect(r).toMatchObject({ avos: 5, avosParcela1: 4, mediaParcela1: 600 });
    expect(r.parcela1).toBe(100); // 600 ÷ 12 × 4 ÷ 2
    expect(r.total).toBe(250); // 600 ÷ 12 × 5
  });

  test("sem início: null", () => {
    expect(diferencaDaGorjeta({ ano: 2026, inicio: null, integralPorMes: integral, declaradaMensal: declarada, mesesApurados: apurados })).toBeNull();
  });

  test("não muda o que recebe", () => {
    const m = new Map(integral);
    diferencaDaGorjeta({ ano: 2026, inicio: D("2025-03-01"), integralPorMes: m, declaradaMensal: declarada, mesesApurados: apurados });
    expect([...m]).toEqual([...integral]);
  });
});
