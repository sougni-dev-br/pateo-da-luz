import { describe, expect, test } from "vitest";
import { explicarPontos } from "../explicacaoPontos";

const base = {
  kind: "PONTOS" as const, basePoints: 3.5, pontosApurados: 3.5, pointsAdjustment: 0,
  diasElegiveis: 31, diasPrevistos: 26, diasReferencia: 26, diasComputados: 26,
};

describe("explicarPontos", () => {
  test("mês cheio, sem ocorrência: nada a explicar", () => {
    expect(explicarPontos(base, 31)).toBeNull();
  });

  test("entrou no meio do ciclo (Bruno, novembro/2026): mostra a conta com os dias de referência", () => {
    const r = explicarPontos({ ...base, pontosApurados: 2.83, diasElegiveis: 25, diasPrevistos: 21, diasComputados: 21 }, 31);
    expect(r?.curta).toBe("21/26 dias");
    expect(r?.longa).toContain("3,5 × 21/26 dias = 2,83");
    expect(r?.longa).toContain("25 dias corridos de 31 no vínculo, 21 dos 26 dias de trabalho");
    expect(r?.longa).not.toContain("descontado");
  });

  test("mês cheio com faltas: só o desconto das ocorrências", () => {
    const r = explicarPontos({ ...base, pontosApurados: 3.23, diasComputados: 24 }, 31);
    expect(r?.curta).toBe("24/26 dias");
    expect(r?.longa).toContain("2 dia(s) descontado(s)");
    expect(r?.longa).not.toContain("entrou ou saiu");
  });

  test("entrada no meio e faltas juntas", () => {
    const r = explicarPontos({ ...base, pontosApurados: 2.5, diasElegiveis: 25, diasPrevistos: 21, diasComputados: 19 }, 31);
    expect(r?.longa).toContain("entrou ou saiu dentro do ciclo");
    expect(r?.longa).toContain("2 dia(s) descontado(s)");
  });

  test("o ajuste do mês entra na conta, com o sinal", () => {
    const mais = explicarPontos({ ...base, pontosApurados: 3, diasComputados: 22, pointsAdjustment: 1 }, 31);
    expect(mais?.longa).toContain("+ 1 de ajuste");
    const menos = explicarPontos({ ...base, pontosApurados: 3, diasComputados: 22, pointsAdjustment: -0.5 }, 31);
    expect(menos?.longa).toContain("− 0,5 de ajuste");
  });

  test("cota fixa não tem conta de dias", () => {
    expect(explicarPontos({ ...base, kind: "FIXO", diasComputados: 10 }, 31)).toBeNull();
  });

  test("sem os dias do ciclo, a frase continua correta", () => {
    const r = explicarPontos({ ...base, pontosApurados: 2.83, diasElegiveis: 25, diasPrevistos: 21, diasComputados: 21 }, null);
    expect(r?.longa).toContain("25 dias corridos no vínculo");
  });
});
