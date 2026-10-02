import { describe, expect, test } from "vitest";
import { valoresAdicionais } from "../hora-extra.js";
import {
  DIA_PRIMEIRA_QUINZENA, adiantamentoDoFechado, calcularParticipante, primeiraQuinzenaSemRegistro,
  type ParticipanteEntrada, type RegrasPeriodo,
} from "../tip-rateio.js";

// Pagamento por quinzena de quem não tem registro: metade do salário base no dia 15 (1ª
// quinzena) e o acerto no dia 30, que é a lista de pagamento — ela desconta a 1ª quinzena.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const round = (v: number) => Math.round(v * 100) / 100;

// Gorjeta de setembro/2026 (26/08 → 25/09); o salário é do mês civil de setembro.
const REGRAS: RegrasPeriodo = {
  start: d("2026-08-26"), end: d("2026-09-25"),
  diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false,
  proporcionalEntrada: true, pointsTotal: 100, deductionPercent: 20, netPool: 18632.99,
  mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") },
  adiantamentoPercent: 40, adiantamentoDia: 20,
};
const VALOR_PONTO = 186.3299;

// Rafa: sem registro, salário de R$ 2.000, recebe por quinzena (dias 15 e 30).
function rafa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 0, ajuste: 0, fixedAmount: null,
    admissao: d("2026-01-10"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: true, salarioBase: 2000, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    pagamentoQuinzenal: true,
    vales: [],
    ...over,
  };
}

describe("1ª quinzena de quem não tem registro", () => {
  test("Rafa, setembro cheio: salário 2.000 − 1ª quinzena 1.000 = 1.000 no dia 30", () => {
    const r = calcularParticipante(REGRAS, rafa(), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(2000);
    expect(r.primeiraQuinzena).toBe(1000);
    expect(r.adiantamentoSalarial).toBe(0);
    expect(r.totalAPagar).toBe(1000);
  });

  test("com gorjeta, vales e hora extra: só a 1ª quinzena a mais sai do total de sempre", () => {
    const r = calcularParticipante(REGRAS, rafa({
      basePoints: 2, horaExtraMin: 120, adicionalNoturnoMin: 60,
      vales: [{ type: "VALE", amount: 100 }, { type: "CREDITO", amount: 30 }],
    }), VALOR_PONTO);
    const he = valoresAdicionais(2000, 120, 60);
    expect(r.comissaoLiquida).toBe(302.66); // 2 × 186,33 − 100 + 30
    expect(r.valorHoraExtra).toBe(he.valorHoraExtra);
    expect(r.primeiraQuinzena).toBe(1000);
    expect(r.valorDsr).toBeGreaterThan(0);
    expect(r.totalAPagar).toBe(round(2000 - 1000 + 302.66 + he.valorHoraExtra + he.valorAdicionalNoturno + r.valorDsr));
  });

  test("quem recebe só no pagamento não tem quinzena (nada muda)", () => {
    const r = calcularParticipante(REGRAS, rafa({ pagamentoQuinzenal: false }), VALOR_PONTO);
    expect(r.primeiraQuinzena).toBe(0);
    expect(r.totalAPagar).toBe(2000);
  });

  test("CLT com a opção marcada não muda (o salário dele é da contabilidade)", () => {
    const r = calcularParticipante(REGRAS, rafa({ semRegistro: false }), VALOR_PONTO);
    expect(r.primeiraQuinzena).toBe(0);
  });

  test("sem salário no cadastro: sem quinzena", () => {
    expect(calcularParticipante(REGRAS, rafa({ salarioBase: null }), VALOR_PONTO).primeiraQuinzena).toBe(0);
  });

  test("admitido depois do dia 15 não recebeu a 1ª quinzena; admitido no dia 15 recebeu", () => {
    const dia16 = calcularParticipante(REGRAS, rafa({ admissao: d("2026-09-16") }), VALOR_PONTO);
    expect(dia16.primeiraQuinzena).toBe(0);
    expect(dia16.totalAPagar).toBe(dia16.salarioProporcional); // 15 dias × 66,67 = 1.000,05
    const dia15 = calcularParticipante(REGRAS, rafa({ admissao: d("2026-09-15") }), VALOR_PONTO);
    expect(dia15.primeiraQuinzena).toBe(1000);
  });

  test("saiu antes do dia 15 não recebeu; saiu no próprio dia 15 recebeu (hora gravada não importa)", () => {
    expect(calcularParticipante(REGRAS, rafa({ desligamento: d("2026-09-14") }), VALOR_PONTO).primeiraQuinzena).toBe(0);
    expect(calcularParticipante(REGRAS, rafa({ desligamento: new Date("2026-09-15T18:00:00.000Z") }), VALOR_PONTO).primeiraQuinzena).toBe(1000);
    const noDia = calcularParticipante(REGRAS, rafa({ desligamento: d("2026-09-15") }), VALOR_PONTO);
    // 15 dias × 66,67 = 1.000,05: a quinzena (1.000) cabe no salário proporcional.
    expect(noDia.salarioProporcional).toBe(1000.05);
    expect(noDia.primeiraQuinzena).toBe(1000);
  });

  test("nunca passa do salário proporcional: desconta até zerar o salário, não a gorjeta", () => {
    // Saiu 20/09 com 12 faltas no mês: 8 dias × 66,67 = 533,36 < 1.000.
    const r = calcularParticipante(REGRAS, rafa({ basePoints: 1, desligamento: d("2026-09-20"), faltasSalario: 12, rescisaoServicoBruto: 15000 }), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(533.36);
    expect(r.primeiraQuinzena).toBe(533.36);
    expect(r.totalAPagar).toBe(round(r.comissaoLiquida));
  });

  test("quinzena e adiantamento marcados juntos: vale a quinzena, sem descontar duas vezes", () => {
    const r = calcularParticipante(REGRAS, rafa({ recebeAdiantamento: true }), VALOR_PONTO);
    expect(r.primeiraQuinzena).toBe(1000);
    expect(r.adiantamentoSalarial).toBe(0);
    expect(r.totalAPagar).toBe(1000);
  });

  test("rescisão lançada em Contas a Pagar: total zero (a quinzena desconta lá), mas o valor fica para a rescisão", () => {
    const r = calcularParticipante(REGRAS, rafa({ desligamento: d("2026-09-22"), rescisaoLancada: true, rescisaoServicoBruto: 10000 }), VALOR_PONTO);
    expect(r.pagoNaRescisao).toBe(true);
    expect(r.totalAPagar).toBe(0);
    expect(r.primeiraQuinzena).toBe(1000);
  });

  test("fora da gorjeta (só salário): a 1ª quinzena também sai", () => {
    const r = calcularParticipante(REGRAS, rafa({ foraDaGorjeta: true, vales: [{ type: "VALE", amount: 50 }] }), VALOR_PONTO);
    expect(r.primeiraQuinzena).toBe(1000);
    expect(r.totalAPagar).toBe(950);
  });

  test("sem o mês do salário, usa o próprio período (dia 15 de setembro está dentro)", () => {
    const { mesSalario: _m, ...semMes } = REGRAS;
    expect(primeiraQuinzenaSemRegistro(rafa(), semMes, 2000)).toBe(1000);
    expect(DIA_PRIMEIRA_QUINZENA).toBe(15);
  });

  test("período fechado: o total gravado com a quinzena não vira adiantamento", () => {
    const base = { semRegistro: true, pagoNaRescisao: false, salarioProporcional: 2000, comissaoLiquida: 0 };
    // Fechado com a 1ª quinzena (o retrato guarda 1.000): adiantamento zero.
    expect(adiantamentoDoFechado({ ...base, totalAPagar: 1000, primeiraQuinzena: 1000 })).toBe(0);
    // Retrato antigo, sem o campo: a diferença continua sendo o adiantamento, como antes.
    expect(adiantamentoDoFechado({ ...base, totalAPagar: 1200 })).toBe(800);
  });
});
