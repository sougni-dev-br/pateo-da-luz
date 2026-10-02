import { describe, expect, test } from "vitest";
import { fmtHoras, minutosValidos, normalizarHorasDigitadas, parseHoras, valoresAdicionais } from "../hora-extra.js";
import { adiantamentoDoFechado, calcularParticipante, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";
import { composicaoSemRegistro, montarFolhaLiquidos, type PessoaApurada } from "../tip-conferencia.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("parseHoras (mesmas regras da tela)", () => {
  test("h:mm, 7h30 e horas decimais com vírgula ou ponto", () => {
    expect(parseHoras("7:30")).toBe(450);
    expect(parseHoras("7h30")).toBe(450);
    expect(parseHoras("7H05")).toBe(425);
    expect(parseHoras("7,5")).toBe(450);
    expect(parseHoras("7.25")).toBe(435);
    expect(parseHoras("10")).toBe(600);
    expect(parseHoras(" 0:45 ")).toBe(45);
  });
  test("vazio ou ilegível = null", () => {
    expect(parseHoras(null)).toBeNull();
    expect(parseHoras("")).toBeNull();
    expect(parseHoras("abc")).toBeNull();
    expect(parseHoras("7:")).toBeNull();
  });
  test("fmtHoras e minutos válidos (negativo e ilegível contam zero)", () => {
    expect(fmtHoras(450)).toBe("7:30");
    expect(fmtHoras(5)).toBe("0:05");
    expect(minutosValidos("-2")).toBe(0);
    expect(minutosValidos("xx")).toBe(0);
    expect(minutosValidos("1:15")).toBe(75);
  });
  test("gravação: normaliza para h:mm, mantém texto ilegível e barra negativo e absurdo", () => {
    expect(normalizarHorasDigitadas("7,5", "Hora extra")).toEqual({ texto: "7:30" });
    expect(normalizarHorasDigitadas("", "Hora extra")).toEqual({ texto: null });
    expect(normalizarHorasDigitadas(null, "Hora extra")).toEqual({ texto: null });
    expect(normalizarHorasDigitadas("ver planilha", "Hora extra")).toEqual({ texto: "ver planilha" });
    expect(normalizarHorasDigitadas("-3", "Hora extra")).toHaveProperty("erro");
    expect(normalizarHorasDigitadas("750", "Adicional noturno")).toEqual({ erro: expect.stringContaining("300 horas") });
  });
});

describe("valores da hora extra e do adicional noturno", () => {
  test("base R$ 2.200: hora R$ 10; 10h de HE = R$ 150; 7h de noturno = R$ 16", () => {
    expect(valoresAdicionais(2200, 600, 420)).toEqual({ valorHoraExtra: 150, valorAdicionalNoturno: 16 });
  });
  test("minutos quebrados arredondam no centavo; sem salário não paga", () => {
    // 7:30 de HE = 7,5 × 10 × 1,5 = 112,50; 0:45 de noturno = 0,75 × 10 × 0,2 × 60/52,5 = 1,71
    expect(valoresAdicionais(2200, 450, 45)).toEqual({ valorHoraExtra: 112.5, valorAdicionalNoturno: 1.71 });
    expect(valoresAdicionais(null, 600, 420)).toEqual({ valorHoraExtra: 0, valorAdicionalNoturno: 0 });
  });
});

const SETEMBRO: RegrasPeriodo = {
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

describe("total a pagar de quem não tem registro", () => {
  test("sem horas: salário + gorjeta, como antes", () => {
    const r = calcularParticipante(SETEMBRO, pessoa(), 160);
    expect(r.valorHoraExtra).toBe(0);
    expect(r.valorAdicionalNoturno).toBe(0);
    expect(r.totalAPagar).toBe(2200 + 320);
  });
  test("com 10h de HE e 7h de noturno: soma R$ 166 + DSR de R$ 33,20 ao total", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ horaExtraMin: 600, adicionalNoturnoMin: 420 }), 160);
    expect(r.valorHoraExtra).toBe(150);
    expect(r.valorAdicionalNoturno).toBe(16);
    expect(r.valorDsr).toBe(33.2);
    expect(r.totalAPagar).toBe(2200 + 320 + 166 + 33.2);
  });
  test("CLT: as horas são só informativas, não entram no total", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({ semRegistro: false, horaExtraMin: 600, adicionalNoturnoMin: 420 }), 160);
    expect(r.valorHoraExtra).toBe(0);
    expect(r.valorAdicionalNoturno).toBe(0);
    expect(r.totalAPagar).toBe(320);
  });
  test("pago na rescisão: total zero (a hora extra vai para a rescisão), mas o valor fica", () => {
    const r = calcularParticipante(SETEMBRO, pessoa({
      desligamento: d("2026-09-20"), rescisaoLancada: true, rescisaoServicoBruto: 10000, horaExtraMin: 600,
    }), 160);
    expect(r.pagoNaRescisao).toBe(true);
    expect(r.totalAPagar).toBe(0);
    expect(r.valorHoraExtra).toBe(150);
  });
  test("fechado: o adiantamento descontado da conta já considera a hora extra gravada", () => {
    // salário 2200 − adiantamento 880 + gorjeta 320 + HE 166 = 1806
    expect(adiantamentoDoFechado({ semRegistro: true, pagoNaRescisao: false, salarioProporcional: 2200, comissaoLiquida: 320, totalAPagar: 1806, adicionais: 166 })).toBe(880);
    // Sem o valor da hora extra, a conta inventaria um adiantamento menor.
    expect(adiantamentoDoFechado({ semRegistro: true, pagoNaRescisao: false, salarioProporcional: 2200, comissaoLiquida: 320, totalAPagar: 1806 })).toBe(714);
  });
});

describe("folha de líquidos: composição do sem registro", () => {
  const base: PessoaApurada = {
    employeeId: "e1", nome: "Ana", semRegistro: true, noPeriodo: true, pagoNaRescisao: false,
    gorjetaLiquida: 320, totalAPagar: 1806, adiantamentoSalarial: 880, cnpjEmpresa: null, pix: null,
  };
  test("mostra a hora extra quando há", () => {
    expect(composicaoSemRegistro({ ...base, comHoraExtra: true })).toBe("salário − adiantamento + gorjeta − vales + hora extra/noturno");
    expect(composicaoSemRegistro({ ...base, adiantamentoSalarial: 0, comHoraExtra: true })).toBe("salário + gorjeta − vales + hora extra/noturno");
  });
  test("sem horas: igual a antes", () => {
    expect(composicaoSemRegistro(base)).toBe("salário − adiantamento + gorjeta − vales");
    const [linha] = montarFolhaLiquidos([{ ...base, comHoraExtra: true }], []);
    expect(linha).toMatchObject({ origem: "SEM_REGISTRO", valor: 1806, composicao: expect.stringContaining("hora extra") });
  });
});
