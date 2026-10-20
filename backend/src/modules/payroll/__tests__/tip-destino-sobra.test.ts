import { describe, expect, test } from "vitest";
import { calcularRateio, destinoSobraValido, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// 100 pontos de referência, líquido de 1.000; a equipe usa só 8 + 2 pontos.
const REGRAS: RegrasPeriodo = {
  start: d("2026-09-26"), end: d("2026-10-25"), diasPadrao: 26,
  descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
  pointsTotal: 100, deductionPercent: 20, netPool: 1000,
};

function pessoa(basePoints: number): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints, ajuste: 0, fixedAmount: null,
    admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    vales: [],
  };
}

describe("destino dos pontos não distribuídos", () => {
  const equipe = [pessoa(8), pessoa(2)];

  test("FUNDO e LIVRE mantêm o ponto da referência e deixam a sobra como saldo", () => {
    for (const destinoSobra of ["FUNDO", "LIVRE"] as const) {
      const r = calcularRateio({ ...REGRAS, destinoSobra }, equipe);
      expect(r.valorPonto).toBe(10);
      expect(r.distribuido).toBe(100);
      expect(r.saldo).toBe(900);
    }
  });

  test("REDISTRIBUIR divide o líquido só entre os pontos de quem participa", () => {
    const r = calcularRateio({ ...REGRAS, destinoSobra: "REDISTRIBUIR" }, equipe);
    expect(r.valorPonto).toBe(100);
    expect(r.distribuido).toBe(1000);
    expect(r.saldo).toBe(0);
  });

  test("REDISTRIBUIR conta os pontos da reserva da casa no divisor", () => {
    const r = calcularRateio({ ...REGRAS, destinoSobra: "REDISTRIBUIR", reservaPontos: 10 }, equipe);
    expect(r.valorPonto).toBe(50);
    expect(r.distribuido + 10 * r.valorPontoBruto).toBe(1000);
  });

  test("REDISTRIBUIR sem ninguém com ponto volta à conta normal", () => {
    const r = calcularRateio({ ...REGRAS, destinoSobra: "REDISTRIBUIR" }, []);
    expect(r.valorPonto).toBe(10);
    expect(r.saldo).toBe(1000);
  });

  test("valor desconhecido vira FUNDO", () => {
    expect(destinoSobraValido("xpto")).toBe("FUNDO");
    expect(destinoSobraValido(undefined)).toBe("FUNDO");
    expect(destinoSobraValido("LIVRE")).toBe("LIVRE");
    expect(destinoSobraValido("REDISTRIBUIR")).toBe("REDISTRIBUIR");
  });
});
