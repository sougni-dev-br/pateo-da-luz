import { describe, expect, test } from "vitest";
import { diasDoMesDsr, dsrDoMes, valorDsr } from "../hora-extra.js";
import { composicaoSemRegistro, type PessoaApurada } from "../tip-conferencia.js";
import { adiantamentoDoFechado, calcularParticipante, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";

// DSR (descanso semanal remunerado) sobre a hora extra e o noturno de quem não tem
// registro: (HE + noturno) × descansos ÷ úteis do mês civil do salário.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("dias úteis e descansos do mês", () => {
  test("setembro/2026: 25 úteis e 5 descansos (domingos 6, 13, 20, 27 + 07/09)", () => {
    expect(diasDoMesDsr(2026, 9)).toEqual({ uteis: 25, descansos: 5 });
  });
  test("novembro/2026: 15/11 cai no domingo e conta uma vez só; 02/11 e 20/11 são descansos", () => {
    // 5 domingos (1, 8, 15, 22, 29) + Finados (seg) + Consciência Negra (sex) = 7;
    // seg a sáb = 25 − 2 feriados = 23.
    expect(diasDoMesDsr(2026, 11)).toEqual({ uteis: 23, descansos: 7 });
  });
  test("fevereiro/2026: 4 domingos + carnaval (16 e 17/02)", () => {
    expect(diasDoMesDsr(2026, 2)).toEqual({ uteis: 22, descansos: 6 });
  });
});

describe("valor do DSR", () => {
  const SETEMBRO = { uteis: 25, descansos: 5 };
  test("exemplos do dono (setembro/2026)", () => {
    expect(valorDsr(127.34, SETEMBRO)).toBe(25.47);
    expect(valorDsr(248.48, SETEMBRO)).toBe(49.7);
    expect(valorDsr(68.48, SETEMBRO)).toBe(13.7);
  });
  test("sem hora extra nem noturno: zero", () => {
    expect(valorDsr(0, SETEMBRO)).toBe(0);
    expect(dsrDoMes(0, 0, 2026, 9)).toBe(0);
  });
  test("soma a hora extra e o noturno antes de aplicar a proporção", () => {
    expect(dsrDoMes(120, 7.34, 2026, 9)).toBe(25.47);
  });
  test("vale a partir de setembro/2026: agosto dá zero", () => {
    expect(dsrDoMes(127.34, 0, 2026, 8)).toBe(0);
    expect(dsrDoMes(127.34, 0, 2026, 10)).toBeGreaterThan(0);
  });
});

const SETEMBRO_REGRAS: RegrasPeriodo = {
  start: d("2026-08-26"), end: d("2026-09-25"), diasPadrao: 26,
  descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
  pointsTotal: 100, deductionPercent: 20, netPool: 16000,
  mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") },
};

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 2, ajuste: 0, fixedAmount: null, admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: true, salarioBase: 2200, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    vales: [], ...over,
  };
}

describe("DSR no total a pagar do sem registro", () => {
  test("10h de HE (150) + 7h de noturno (16): DSR 33,20 no total", () => {
    const r = calcularParticipante(SETEMBRO_REGRAS, pessoa({ horaExtraMin: 600, adicionalNoturnoMin: 420 }), 160);
    expect(r.valorDsr).toBe(33.2);
    expect(r.totalAPagar).toBe(2200 + 320 + 166 + 33.2);
  });
  test("sem horas: DSR zero e total como antes", () => {
    const r = calcularParticipante(SETEMBRO_REGRAS, pessoa(), 160);
    expect(r.valorDsr).toBe(0);
    expect(r.totalAPagar).toBe(2520);
  });
  test("CLT: zero", () => {
    const r = calcularParticipante(SETEMBRO_REGRAS, pessoa({ semRegistro: false, horaExtraMin: 600 }), 160);
    expect(r.valorDsr).toBe(0);
    expect(r.totalAPagar).toBe(320);
  });
  test("fora da gorjeta (só salário) também recebe o DSR", () => {
    const r = calcularParticipante(SETEMBRO_REGRAS, pessoa({ foraDaGorjeta: true, horaExtraMin: 600 }), 160);
    expect(r.valorDsr).toBe(30);
    expect(r.totalAPagar).toBe(2200 + 150 + 30);
  });
  test("competência antes de setembro/2026: zero", () => {
    const agosto: RegrasPeriodo = { ...SETEMBRO_REGRAS, start: d("2026-07-26"), end: d("2026-08-25"), mesSalario: { start: d("2026-08-01"), end: d("2026-08-31") } };
    const r = calcularParticipante(agosto, pessoa({ horaExtraMin: 600 }), 160);
    expect(r.valorDsr).toBe(0);
    expect(r.totalAPagar).toBe(2200 + 320 + 150);
  });
  test("pago na rescisão: total zero, mas o DSR fica calculado para a rescisão", () => {
    const r = calcularParticipante(SETEMBRO_REGRAS, pessoa({
      desligamento: d("2026-09-20"), rescisaoLancada: true, rescisaoServicoBruto: 10000, horaExtraMin: 600,
    }), 160);
    expect(r.totalAPagar).toBe(0);
    expect(r.valorDsr).toBe(30);
  });
  test("fechado: o adiantamento deduzido da conta considera o DSR gravado junto da hora extra", () => {
    // salário 2200 − adiantamento 880 + gorjeta 320 + HE 166 + DSR 33,20 = 1839,20
    expect(adiantamentoDoFechado({
      semRegistro: true, pagoNaRescisao: false, salarioProporcional: 2200, comissaoLiquida: 320, totalAPagar: 1839.2, adicionais: 199.2,
    })).toBe(880);
  });
});

describe("folha de líquidos: composição com o DSR", () => {
  const base: PessoaApurada = {
    employeeId: "e1", nome: "Pessoa Exemplo", semRegistro: true, noPeriodo: true, pagoNaRescisao: false,
    gorjetaLiquida: 320, totalAPagar: 1839.2, adiantamentoSalarial: 880, cnpjEmpresa: null, pix: null,
  };
  test("com DSR: + hora extra/noturno + DSR", () => {
    expect(composicaoSemRegistro({ ...base, comHoraExtra: true, comDsr: true }))
      .toBe("salário − adiantamento + gorjeta − vales + hora extra/noturno + DSR");
  });
  test("sem DSR (mês antes de setembro/2026): igual a antes", () => {
    expect(composicaoSemRegistro({ ...base, comHoraExtra: true, comDsr: false }))
      .toBe("salário − adiantamento + gorjeta − vales + hora extra/noturno");
  });
});
