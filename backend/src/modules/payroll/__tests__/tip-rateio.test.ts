import { describe, expect, test } from "vitest";
import {
  calcularParticipante, calcularRateio, diasElegiveis, type ParticipanteEntrada, type RegrasPeriodo,
} from "../tip-rateio.js";

// Gabarito: planilha de apuração de 28/09/2026, competência setembro (26/08 → 25/09).
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SETEMBRO: RegrasPeriodo = {
  start: d("2026-08-26"),
  end: d("2026-09-25"),
  diasPadrao: 26,
  descontaFalta: true,
  descontaAtestado: true,
  descontaFerias: true,
  descontaOutros: false,
  pointsTotal: 100,
  deductionPercent: 20,
  netPool: 18632.99, // 23.291,24 − 20%
};

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 4, ajuste: 0, fixedAmount: null,
    admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null,
    vales: [],
    ...over,
  };
}

const VALOR_PONTO = 186.3299;

describe("presença", () => {
  test("mês inteiro no vínculo e sem ocorrência mantém os pontos-base", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 4 }), VALOR_PONTO);
    expect(r.diasPrevistos).toBe(26);
    expect(r.diasComputados).toBe(26);
    expect(r.pontosFinais).toBe(4);
    expect(r.rateio).toBe(745.32); // Janete na planilha
  });

  test("desligada em 16/09 com 2 faltas: 18 previstos, 16 computados, 3,11 pontos (Analia)", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 3.5, desligamento: d("2026-09-16"), faltas: 2 }), VALOR_PONTO);
    expect(r.diasElegiveis).toBe(22);
    expect(r.diasPrevistos).toBe(18);
    expect(r.diasComputados).toBe(16);
    expect(r.pontosApurados).toBe(3.11);
  });

  test("admitido 04/09 e desligado 23/09 com 1 falta e 2 atestados: 2,88 pontos (Lucas)", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      basePoints: 3.5, admissao: d("2026-09-04"), desligamento: d("2026-09-23"), faltas: 1, atestados: 2,
    }), VALOR_PONTO);
    expect(r.diasElegiveis).toBe(20);
    expect(r.diasPrevistos).toBe(17);
    expect(r.diasComputados).toBe(14);
    expect(r.pontosApurados).toBe(2.88);
  });

  test("ocorrência que não desconta não reduz os dias", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ outrosDias: 5 }), VALOR_PONTO);
    expect(r.diasComputados).toBe(26);
  });

  test("override de dias previstos prevalece sobre o cálculo", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ diasPrevistosOverride: 20, faltas: 2 }), VALOR_PONTO);
    expect(r.diasPrevistos).toBe(20);
    expect(r.fatorPresenca).toBeCloseTo(0.9, 5);
  });

  test("desligado antes do período fica fora e não recebe", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ desligamento: d("2026-08-20") }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("FORA_DO_PERIODO");
    expect(r.rateio).toBe(0);
    expect(diasElegiveis(SETEMBRO, null, d("2026-08-20"))).toBe(0);
  });
});

describe("ajuste de pontos", () => {
  test("acréscimo soma aos pontos apurados sem mexer na base", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 4, ajuste: 1.5 }), VALOR_PONTO);
    expect(r.pontosFinais).toBe(5.5);
    expect(r.rateio).toBe(1024.81);
  });

  test("desconto nunca deixa os pontos negativos", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 2, ajuste: -5 }), VALOR_PONTO);
    expect(r.pontosFinais).toBe(0);
    expect(r.rateio).toBe(0);
  });
});

describe("rescisão", () => {
  test("usa o valor do ponto do serviço até o desligamento", () => {
    // 10.000 de serviço até a saída → líquido 8.000 → ponto R$ 80
    const r = calcularParticipante(SETEMBRO, pessoa({
      basePoints: 3.5, desligamento: d("2026-09-16"), faltas: 2, rescisaoServicoBruto: 10000,
    }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("RESCISAO");
    expect(r.valorPonto).toBe(80);
    expect(r.rateio).toBe(248.8); // 3,11 × 80
  });

  test("sem serviço informado fica pendente e zerado", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ desligamento: d("2026-09-16") }), VALOR_PONTO);
    expect(r.rescisaoPendente).toBe(true);
    expect(r.rateio).toBe(0);
  });

  test("valor quitado prevalece e não depende do serviço do mês", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      desligamento: d("2026-09-10"), rescisaoServicoBruto: 999999, rescisaoValorFixo: 512.4,
    }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("RESCISAO_QUITADA");
    expect(r.rateio).toBe(512.4);
  });
});

describe("vales e créditos", () => {
  test("desconto subtrai e crédito soma", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      vales: [{ type: "ADIANTAMENTO", amount: 200 }, { type: "CREDITO", amount: 50 }],
    }), VALOR_PONTO);
    expect(r.descontos).toBe(200);
    expect(r.creditos).toBe(50);
    expect(r.comissaoLiquida).toBe(595.32);
  });
});

describe("sem registro", () => {
  test("mês inteiro: salário cheio mais a gorjeta", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ semRegistro: true, salarioBase: 2200, basePoints: 2 }), VALOR_PONTO);
    expect(r.diasSalario).toBe(30);
    expect(r.salarioProporcional).toBe(2200);
    expect(r.totalAPagar).toBe(2572.66); // Elenice na planilha: 2.200 + 372,66
  });

  test("saída no meio do período paga salário ÷ 30 pelos dias corridos, menos faltas", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      semRegistro: true, salarioBase: 2300, desligamento: d("2026-09-07"), faltas: 0,
    }), VALOR_PONTO);
    expect(r.diasSalario).toBe(13); // 26/08 a 07/09
    expect(r.salarioProporcional).toBe(996.67); // (2300/30)*13, como na aba Folha Líquidos
  });

  test("registrado não recebe salário na lista da gorjeta", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ salarioBase: 3000 }), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(0);
  });
});

describe("rateio do período", () => {
  test("valor do ponto é fixo e a sobra vira saldo", () => {
    const res = calcularRateio(SETEMBRO, [pessoa({ basePoints: 10 }), pessoa({ basePoints: 4, faltas: 13 })]);
    expect(res.valorPonto).toBe(186.33);
    expect(res.pontosUsados).toBe(12);
    expect(res.distribuido).toBe(2235.96);
    expect(res.saldo).toBe(16397.03);
  });

  test("cota fixa sai do líquido antes de dividir por 100", () => {
    const res = calcularRateio(SETEMBRO, [pessoa({ kind: "FIXO", fixedAmount: 632.99 }), pessoa({ basePoints: 10 })]);
    expect(res.valorPonto).toBe(180);
    expect(res.linhas[1].rateio).toBe(1800);
  });
});
