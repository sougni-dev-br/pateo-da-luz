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
  proporcionalEntrada: true,
  pointsTotal: 100,
  deductionPercent: 20,
  netPool: 18632.99, // 23.291,24 − 20%
};

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 4, ajuste: 0, fixedAmount: null,
    admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
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

  test("admitido 04/09 e desligado 23/09: proporcional à entrada, até a saída (Lucas)", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      basePoints: 3.5, admissao: d("2026-09-04"), desligamento: d("2026-09-23"), faltas: 1, atestados: 2,
    }), VALOR_PONTO);
    expect(r.diasElegiveis).toBe(20);
    expect(r.diasPrevistos).toBe(17);
    expect(r.diasComputados).toBe(14);
    expect(r.diasReferencia).toBe(24); // 26/08 a 23/09 = 29 dias → 26 × 29 ÷ 31
    expect(r.pontosApurados).toBe(2.04); // 3,5 × 14 ÷ 24
  });

  test("sem proporcional de entrada, volta à regra da planilha (2,88)", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      basePoints: 3.5, admissao: d("2026-09-04"), desligamento: d("2026-09-23"), faltas: 1, atestados: 2,
      regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: false },
    }), VALOR_PONTO);
    expect(r.pontosApurados).toBe(2.88);
  });

  test("admitido no meio do mês sem faltas recebe proporcional aos dias", () => {
    // entrou 11/09: 15 dias de 31 → 13 previstos de 26
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 4, admissao: d("2026-09-11") }), VALOR_PONTO);
    expect(r.diasPrevistos).toBe(13);
    expect(r.diasReferencia).toBe(26);
    expect(r.pontosApurados).toBe(2);
  });

  test("quem fecha pode não descontar a falta de uma pessoa", () => {
    const base = { basePoints: 4, faltas: 3 };
    const padrao = calcularParticipante(SETEMBRO, pessoa(base), VALOR_PONTO);
    const perdoado = calcularParticipante(SETEMBRO, pessoa({
      ...base, regras: { descontaFalta: false, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    }), VALOR_PONTO);
    expect(padrao.pontosApurados).toBe(3.54); // 4 × 23 ÷ 26
    expect(perdoado.pontosApurados).toBe(4);
  });

  test("e pode descontar 'outros dias' de uma pessoa mesmo com o período não descontando", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      basePoints: 4, outrosDias: 13,
      regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: true, proporcionalEntrada: null },
    }), VALOR_PONTO);
    expect(r.pontosApurados).toBe(2);
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
    expect(r.salarioProporcional).toBe(996.71); // diária 76,67 × 13 (a diária é arredondada antes)
  });

  test("diária arredondada × dias, como o RH faz: Luiz Felipe, 02/09 a 12/09 com 2 faltas", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      semRegistro: true, salarioBase: 2200, admissao: d("2026-09-02"), desligamento: d("2026-09-12"), faltas: 2, atestados: 1,
    }), VALOR_PONTO);
    expect(r.diasSalario).toBe(9); // 11 dias − 2 faltas; atestado é pago
    expect(r.salarioProporcional).toBe(659.97); // 73,33 × 9
  });

  test("registrado não recebe salário na lista da gorjeta", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ salarioBase: 3000 }), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(0);
  });
});

describe("rescisões abatidas da apuração", () => {
  test("o que a rescisão levou sai do líquido e os pontos dela saem dos 100", () => {
    // Analia: 3,11 pts × R$ 80 (serviço de 10.000 até a saída) = 248,80
    const res = calcularRateio(SETEMBRO, [
      pessoa({ basePoints: 3.5, desligamento: d("2026-09-16"), faltas: 2, rescisaoServicoBruto: 10000 }),
      pessoa({ basePoints: 10 }),
    ]);
    expect(res.rescisoes).toEqual({ valor: 248.8, pontos: 3.11 });
    expect(res.pontosDisponiveis).toBe(96.89);
    // (18.632,99 − 248,80) ÷ 96,89
    expect(res.valorPontoBruto).toBeCloseTo(189.7429, 3);
    expect(res.linhas[1].rateio).toBe(1897.43);
  });

  // Gorjeta paga (digitada ou do termo): vira pontos pelo valor do ponto do mês.
  const QUITADA = { desligamento: d("2026-09-25"), admissao: d("2025-01-01") };

  test("gorjeta paga abaixo do direito: consome só os pontos que ela vale; o resto volta à apuração", () => {
    const res = calcularRateio(SETEMBRO, [
      pessoa({ ...QUITADA, basePoints: 4, rescisaoValorFixo: 372.66 }), // 2 pts × 186,33
      pessoa({ basePoints: 10 }),
    ]);
    const q = res.linhas[0];
    expect(q.tipoCalculo).toBe("RESCISAO_QUITADA");
    expect(q.rateio).toBe(372.66);
    expect(q.pontosDireito).toBe(4);
    expect(q.pontosFinais).toBe(2);
    expect(q.pontosDevolvidos).toBe(2);
    expect(q.extraRescisao).toBe(0);
    expect(q.justificativaExtra).toBeNull();
    expect(res.rescisoes).toEqual({ valor: 372.66, pontos: 2 });
  });

  test("gorjeta paga acima do direito: a diferença vira extra com justificativa automática", () => {
    const res = calcularRateio(SETEMBRO, [
      pessoa({ ...QUITADA, basePoints: 2, rescisaoValorFixo: 745.32 }), // 4 pts × 186,33
      pessoa({ basePoints: 10 }),
    ]);
    const q = res.linhas[0];
    expect(q.pontosDireito).toBe(2);
    expect(q.pontosFinais).toBe(4);
    expect(q.extraRescisao).toBe(2);
    expect(q.pontosDevolvidos).toBe(0);
    expect(q.justificativaExtra).toBe("Gorjeta paga na rescisão (R$ 745,32) equivale a 4 pts; o direito era 2 pts: +2 pts de extra.");
  });

  test("CLT com gorjeta paga: já recebeu na rescisão, nada a pagar na lista", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ ...QUITADA, rescisaoValorFixo: 370.93, salarioBase: 2200 }), VALOR_PONTO);
    expect(r.pagoNaRescisao).toBe(true);
    expect(r.totalAPagar).toBe(0);
  });

  test("sem registro com gorjeta digitada: não tem rescisão da contabilidade, recebe salário + gorjeta na lista", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      ...QUITADA, desligamento: d("2026-09-14"), semRegistro: true, salarioBase: 2200, faltas: 2, rescisaoValorFixo: 300,
    }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("RESCISAO_QUITADA");
    expect(r.pagoNaRescisao).toBe(false);
    expect(r.diasSalario).toBe(18); // 26/08 a 14/09 = 20 dias corridos (com folgas) − 2 faltas
    expect(r.salarioProporcional).toBe(1319.94); // 73,33 × 18
    expect(r.totalAPagar).toBe(1619.94); // 1.319,94 + 300
  });

  test("sem registro com a rescisão já lançada em Contas a Pagar: já recebeu, sai da lista", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      desligamento: d("2026-09-18"), semRegistro: true, salarioBase: 2200, rescisaoServicoBruto: 10000, rescisaoLancada: true,
    }), VALOR_PONTO);
    expect(r.tipoCalculo).toBe("RESCISAO");
    expect(r.rateio).toBeGreaterThan(0); // a gorjeta continua medida: consome os pontos dela
    expect(r.pagoNaRescisao).toBe(true);
    expect(r.totalAPagar).toBe(0);
  });

  test("sem registro com gorjeta digitada e rescisão lançada: também fora da lista", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      ...QUITADA, desligamento: d("2026-09-22"), semRegistro: true, salarioBase: 2200, rescisaoValorFixo: 300, rescisaoLancada: true,
    }), VALOR_PONTO);
    expect(r.pagoNaRescisao).toBe(true);
    expect(r.totalAPagar).toBe(0);
  });

  test("rescisão lançada não vale para quem continua na casa", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ semRegistro: true, salarioBase: 2200, rescisaoLancada: true }), VALOR_PONTO);
    expect(r.pagoNaRescisao).toBe(false);
    expect(r.totalAPagar).toBeGreaterThan(0);
  });

  test("a gorjeta paga não muda o valor do ponto de quem fica", () => {
    const sem = calcularRateio(SETEMBRO, [pessoa({ basePoints: 10 })]);
    const com = calcularRateio(SETEMBRO, [pessoa({ ...QUITADA, basePoints: 4, rescisaoValorFixo: 900 }), pessoa({ basePoints: 10 })]);
    expect(com.valorPonto).toBe(sem.valorPonto);
    expect(com.linhas[1].rateio).toBe(sem.linhas[0].rateio);
  });

  test("com rescisão calculada no mês, a quitada é medida pelo ponto que sobrou", () => {
    const res = calcularRateio(SETEMBRO, [
      pessoa({ basePoints: 3.5, desligamento: d("2026-09-16"), faltas: 2, rescisaoServicoBruto: 10000 }),
      pessoa({ ...QUITADA, basePoints: 4, rescisaoValorFixo: 379.49 }),
      pessoa({ basePoints: 10 }),
    ]);
    // (18.632,99 − 248,80) ÷ 96,89 = 189,7429 → 379,49 ÷ 189,7429 = 2 pts
    expect(res.valorPontoBruto).toBeCloseTo(189.7429, 3);
    expect(res.linhas[1].pontosFinais).toBe(2);
    expect(res.linhas[2].rateio).toBe(1897.43);
  });

  test("sem rescisões, o valor do ponto é líquido ÷ 100 como na planilha", () => {
    const res = calcularRateio(SETEMBRO, [pessoa({ basePoints: 4 })]);
    expect(res.valorPonto).toBe(186.33);
    expect(res.pontosDisponiveis).toBe(100);
  });

  test("rescisão pendente (sem serviço) não abate valor, mas já tira os pontos", () => {
    const res = calcularRateio(SETEMBRO, [
      pessoa({ basePoints: 3.5, desligamento: d("2026-09-16"), faltas: 2 }),
      pessoa({ basePoints: 4 }),
    ]);
    expect(res.rescisoes).toEqual({ valor: 0, pontos: 3.11 });
    expect(res.linhas[0].rescisaoPendente).toBe(true);
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

describe("gorjeta paga na rescisão medida pelo ponto da saída (regra A)", () => {
  // Saída em 12/09 com o serviço até lá: valor do ponto da rescisão = 17.432,36 × 80% ÷ 100 = 139,46.
  const saida = { desligamento: d("2026-09-12"), admissao: d("2026-09-02"), basePoints: 3.5, faltas: 2, atestados: 1, rescisaoServicoBruto: 17432.36 };
  const equipe = [pessoa({ basePoints: 10 }), pessoa({ basePoints: 20 })];

  test("pagou menos que o direito: quem fica não muda e a diferença em dinheiro volta ao saldo", () => {
    const calculada = calcularRateio(SETEMBRO, [pessoa(saida), ...equipe]);
    const direito = calculada.linhas[0].rateio;
    const paga = calcularRateio(SETEMBRO, [pessoa({ ...saida, rescisaoValorFixo: 186.8 }), ...equipe]);
    expect(paga.valorPonto).toBe(calculada.valorPonto);
    expect(paga.linhas[1].rateio).toBe(calculada.linhas[1].rateio);
    expect(paga.linhas[0].rateio).toBe(186.8);
    expect(paga.saldo).toBeCloseTo(calculada.saldo + (direito - 186.8), 2);
    expect(paga.linhas[0].pontosDevolvidos).toBeGreaterThan(0);
    expect(paga.linhas[0].valorPonto).toBe(139.46);
  });

  test("pagou mais que o direito: a diferença sai do saldo e vira extra", () => {
    const calculada = calcularRateio(SETEMBRO, [pessoa(saida), ...equipe]);
    const direito = calculada.linhas[0].rateio;
    const paga = calcularRateio(SETEMBRO, [pessoa({ ...saida, rescisaoValorFixo: 250 }), ...equipe]);
    expect(paga.valorPonto).toBe(calculada.valorPonto);
    expect(paga.saldo).toBeCloseTo(calculada.saldo - (250 - direito), 2);
    expect(paga.linhas[0].extraRescisao).toBeGreaterThan(0);
  });
});

describe("salário de sem registro na competência do mês civil", () => {
  // Gorjeta de setembro: ciclo 26/08–25/09. Salário de setembro: 01/09–30/09 (agosto já foi pago até 31/08).
  const SET_COM_MES: RegrasPeriodo = { ...SETEMBRO, mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") } };

  test("admitido em agosto e desligado em setembro: salário só de 01/09 até a saída", () => {
    const r = calcularParticipante(SET_COM_MES, pessoa({
      semRegistro: true, salarioBase: 2200, admissao: d("2026-08-10"), desligamento: d("2026-09-12"), faltasSalario: 2,
    }), VALOR_PONTO);
    expect(r.diasSalario).toBe(10); // 01/09 a 12/09 = 12 dias − 2 faltas
    expect(r.salarioProporcional).toBe(733.3); // 73,33 × 10
  });

  test("faltas de 26 a 31/08 são do salário de agosto: não descontam o de setembro", () => {
    const r = calcularParticipante(SET_COM_MES, pessoa({
      semRegistro: true, salarioBase: 2200, faltas: 3, faltasSalario: 0,
    }), VALOR_PONTO);
    expect(r.diasSalario).toBe(30);
    expect(r.salarioProporcional).toBe(2200);
  });

  test("mês civil inteiro no vínculo paga o salário cheio", () => {
    const r = calcularParticipante(SET_COM_MES, pessoa({ semRegistro: true, salarioBase: 2200, admissao: d("2026-01-01") }), VALOR_PONTO);
    expect(r.salarioProporcional).toBe(2200);
  });
});

describe("gorjeta real digitada no lugar da calculada", () => {
  const equipe = () => [pessoa({ basePoints: 10 }), pessoa({ basePoints: 20 }), pessoa({ basePoints: 4 })];

  test("recebeu menos: os outros não mudam e a diferença vai para o livre para distribuir", () => {
    const antes = calcularRateio(SETEMBRO, equipe());
    const calculada = antes.linhas[2].rateio;
    const depois = calcularRateio(SETEMBRO, [pessoa({ basePoints: 10 }), pessoa({ basePoints: 20 }), pessoa({ basePoints: 4, gorjetaReal: 500 })]);
    expect(depois.valorPonto).toBe(antes.valorPonto);
    expect(depois.linhas[0].rateio).toBe(antes.linhas[0].rateio);
    expect(depois.linhas[2].rateio).toBe(500);
    expect(depois.saldo).toBeCloseTo(antes.saldo + (calculada - 500), 2);
    expect(depois.linhas[2].gorjetaCalculada).toBe(calculada);
  });

  test("recebeu mais: a diferença sai do livre para distribuir", () => {
    const antes = calcularRateio(SETEMBRO, equipe());
    const calculada = antes.linhas[2].rateio;
    const depois = calcularRateio(SETEMBRO, [pessoa({ basePoints: 10 }), pessoa({ basePoints: 20 }), pessoa({ basePoints: 4, gorjetaReal: 900 })]);
    expect(depois.linhas[1].rateio).toBe(antes.linhas[1].rateio);
    expect(depois.saldo).toBeCloseTo(antes.saldo - (900 - calculada), 2);
  });

  test("o líquido (gorjeta − vales) sai da gorjeta real", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 4, gorjetaReal: 500, vales: [{ type: "ADIANTAMENTO", amount: 50 }] }), VALOR_PONTO);
    expect(r.rateio).toBe(500);
    expect(r.comissaoLiquida).toBe(450);
  });

  test("sem valor real, nada muda", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ basePoints: 4 }), VALOR_PONTO);
    expect(r.gorjetaCalculada).toBe(r.rateio);
  });
});
