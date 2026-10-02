import { describe, expect, test } from "vitest";
import { calcularParticipante, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";

// Afastamento não remunerado (pedido da própria pessoa): nos dias afastada ela não recebe
// salário. Na gorjeta segue a regra "descontar afastamento" do período ou da pessoa (padrão:
// desconta, como as férias), convertida na proporção dos dias-padrão do ciclo:
//   descontados = round(dias padrão × dias de afastamento no ciclo ÷ dias corridos do ciclo)
// No salário de quem não tem registro descontam sempre, como faltas, no mês civil do salário.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Gorjeta de setembro/2026: ciclo 26/08 → 25/09 (31 dias), salário do mês civil de setembro.
const REGRAS: RegrasPeriodo = {
  start: d("2026-08-26"), end: d("2026-09-25"),
  diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, descontaAfastamento: true,
  proporcionalEntrada: true, pointsTotal: 100, deductionPercent: 20, netPool: 22235,
  mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") },
  adiantamentoPercent: 40, adiantamentoDia: 20,
};
const VALOR_PONTO = 222.35;

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 4, ajuste: 0, fixedAmount: null,
    admissao: d("2025-03-10"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    vales: [],
    ...over,
  };
}

describe("afastamento não remunerado na gorjeta", () => {
  test("26/08–20/09 (26 dias) no ciclo de 31: desconta 22 de 26, 4 pontos viram 0,62 e a gorjeta 137,86", () => {
    const r = calcularParticipante(REGRAS, pessoa({ afastamento: 26 }), VALOR_PONTO);
    expect(r.diasReferencia).toBe(26);
    expect(r.diasComputados).toBe(4);
    expect(r.pontosApurados).toBe(0.62);
    expect(r.pontosFinais).toBe(0.62);
    expect(r.rateio).toBe(137.86);
  });

  test("regra própria: independe das de falta, atestado, férias e outros", () => {
    const semDesconto = { descontaFalta: false, descontaAtestado: false, descontaFerias: false, descontaOutros: false, proporcionalEntrada: null };
    const r = calcularParticipante(REGRAS, pessoa({ afastamento: 26, regras: semDesconto }), VALOR_PONTO);
    expect(r.diasComputados).toBe(4);
    expect(r.rateio).toBe(137.86);
  });

  test("gorjeta integral quando o fechamento decide não descontar o afastamento (no período ou na pessoa)", () => {
    const integralNoPeriodo = calcularParticipante({ ...REGRAS, descontaAfastamento: false }, pessoa({ afastamento: 26 }), VALOR_PONTO);
    expect(integralNoPeriodo.diasComputados).toBe(26);
    expect(integralNoPeriodo.pontosFinais).toBe(4);
    expect(integralNoPeriodo.rateio).toBe(889.4);

    const regrasPessoa = (descontaAfastamento: boolean | null) =>
      ({ descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null, descontaAfastamento });
    const integralNaPessoa = calcularParticipante(REGRAS, pessoa({ afastamento: 26, regras: regrasPessoa(false) }), VALOR_PONTO);
    expect(integralNaPessoa.rateio).toBe(889.4);
    // A pessoa pode descontar mesmo com o período sem desconto.
    const descontaNaPessoa = calcularParticipante({ ...REGRAS, descontaAfastamento: false }, pessoa({ afastamento: 26, regras: regrasPessoa(true) }), VALOR_PONTO);
    expect(descontaNaPessoa.rateio).toBe(137.86);
  });

  test("padrão igual ao das férias: sem regra gravada, desconta", () => {
    const semRegra: RegrasPeriodo = { ...REGRAS, descontaAfastamento: undefined };
    const r = calcularParticipante(semRegra, pessoa({ afastamento: 26 }), VALOR_PONTO);
    expect(r.diasComputados).toBe(4);
  });

  test("sem afastamento nada muda (ausente ou zero)", () => {
    const base = calcularParticipante(REGRAS, pessoa(), VALOR_PONTO);
    expect(base.diasComputados).toBe(26);
    expect(calcularParticipante(REGRAS, pessoa({ afastamento: 0 }), VALOR_PONTO)).toEqual(base);
  });

  test("soma com as faltas: 2 faltas + 5 dias afastada (round(26×5/31) = 4) = 6 descontados", () => {
    const r = calcularParticipante(REGRAS, pessoa({ faltas: 2, afastamento: 5 }), VALOR_PONTO);
    expect(r.diasComputados).toBe(20);
  });
});

describe("afastamento não remunerado no salário de quem não tem registro", () => {
  const semReg = (over: Partial<ParticipanteEntrada> = {}) =>
    pessoa({ basePoints: 0, semRegistro: true, salarioBase: 2600, pagamentoQuinzenal: false, recebeAdiantamento: false, ...over });

  test("salário 2.600, afastada de 01 a 20/09: paga 10 dias = 866,70", () => {
    const r = calcularParticipante(REGRAS, semReg({ afastamento: 20, afastamentoSalario: 20 }), VALOR_PONTO);
    expect(r.diasSalario).toBe(10);
    expect(r.salarioProporcional).toBe(866.7);
    expect(r.totalAPagar).toBe(866.7);
  });

  test("gorjeta integral não devolve o salário: os dias continuam descontando", () => {
    const r = calcularParticipante({ ...REGRAS, descontaAfastamento: false }, semReg({ afastamento: 20, afastamentoSalario: 20 }), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(866.7);
  });

  test("faltas e afastamento descontam juntos", () => {
    const r = calcularParticipante(REGRAS, semReg({ faltasSalario: 2, afastamentoSalario: 20 }), VALOR_PONTO);
    expect(r.diasSalario).toBe(8);
  });

  test("rescisão: saiu em 25/09 depois de 20 dias afastada — salário proporcional de 5 dias", () => {
    const r = calcularParticipante(REGRAS, semReg({ desligamento: d("2026-09-25"), afastamento: 20, afastamentoSalario: 20, rescisaoServicoBruto: 20000 }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("RESCISAO");
    expect(r.diasSalario).toBe(5);
    expect(r.salarioProporcional).toBe(433.35);
  });

  test("sem o dado do mês civil, usa o afastamento do ciclo (como as faltas)", () => {
    const r = calcularParticipante(REGRAS, semReg({ afastamento: 20 }), VALOR_PONTO);
    expect(r.diasSalario).toBe(10);
  });
});
