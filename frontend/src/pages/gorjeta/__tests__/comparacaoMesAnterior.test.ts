import { describe, expect, test } from "vitest";
import type { TipMesAnterior } from "../../../api/client";
import { compararComAnterior, resumirComparacao, variacaoDoPonto } from "../comparacaoMesAnterior";

const ANTERIOR: TipMesAnterior = {
  year: 2026, month: 10, label: "Outubro/2026", valorPonto: 100,
  porPessoa: {
    a: { gorjeta: 350, pontosBase: 3.5, pontosApurados: 3.5, diasComputados: 26, diasReferencia: 26, funcao: "Garçom", tipo: "PONTOS", tipoCalculo: "MES" },
    b: { gorjeta: 400, pontosBase: 4, pontosApurados: 4, diasComputados: 26, diasReferencia: 26, funcao: "Cumim", tipo: "PONTOS", tipoCalculo: "MES" },
  },
};

const pessoa = (over: Record<string, unknown> = {}) => ({
  employeeId: "a", rateioAmount: 350, basePoints: 3.5, diasComputados: 26, diasReferencia: 26, functionName: "Garçom",
  tipoCalculo: "MES", rescisaoPendente: false, foraDaGorjeta: false, kind: "PONTOS" as const, ...over,
});

describe("compararComAnterior", () => {
  test("sem mês anterior fechado, não há comparação", () => {
    expect(compararComAnterior(pessoa(), 100, null)).toBeNull();
    expect(compararComAnterior(pessoa(), 100, undefined)).toBeNull();
  });

  test("só quem tem gorjeta calculada no mês é comparado", () => {
    expect(compararComAnterior(pessoa({ foraDaGorjeta: true }), 100, ANTERIOR)).toBeNull();
    expect(compararComAnterior(pessoa({ rescisaoPendente: true }), 100, ANTERIOR)).toBeNull();
    expect(compararComAnterior(pessoa({ tipoCalculo: "RESCISAO" }), 100, ANTERIOR)).toBeNull();
    expect(compararComAnterior(pessoa({ kind: "FIXO" }), 100, ANTERIOR)).toBeNull();
  });

  test("mesmo valor: igual, sem explicação de mudança", () => {
    const c = compararComAnterior(pessoa({ rateioAmount: 350.2 }), 100, ANTERIOR)!;
    expect(c.tipo).toBe("igual");
    expect(c.curta).toBe("= mês anterior");
  });

  test("subiu por pontos: mostra a diferença e o que mudou", () => {
    const c = compararComAnterior(pessoa({ rateioAmount: 400, basePoints: 4 }), 100, ANTERIOR)!;
    expect(c).toMatchObject({ tipo: "subiu", delta: 50 });
    expect(c.curta).toContain("▲");
    expect(c.longa).toContain("pontos 3,5 → 4");
    expect(c.longa).toContain("Outubro/2026");
  });

  test("caiu por valor do ponto e por dias", () => {
    const c = compararComAnterior(pessoa({ rateioAmount: 250, diasComputados: 21 }), 80, ANTERIOR)!;
    expect(c.tipo).toBe("caiu");
    expect(c.curta).toContain("▼");
    expect(c.longa).toContain("presença 21/26 dias (antes 26/26)");
    expect(c.longa).toContain("valor do ponto");
    expect(c.longa).toContain("−20%");
  });

  test("mudança de função aparece", () => {
    const c = compararComAnterior(pessoa({ employeeId: "b", rateioAmount: 300, basePoints: 4, functionName: "Garçom" }), 100, ANTERIOR)!;
    expect(c.longa).toContain("função Cumim → Garçom");
  });

  test("diferença sem causa visível admite ajustes, vales ou gorjeta real", () => {
    const c = compararComAnterior(pessoa({ rateioAmount: 420 }), 100, ANTERIOR)!;
    expect(c.longa).toContain("ajuste de pontos, regras do ciclo ou gorjeta real");
  });

  test("ciclo de outra duração, sem faltas, não vira mudança de presença", () => {
    const ant30 = { ...ANTERIOR, porPessoa: { a: { ...ANTERIOR.porPessoa.a, diasComputados: 30, diasReferencia: 30 } } };
    const c = compararComAnterior(pessoa({ rateioAmount: 420, diasComputados: 31, diasReferencia: 31 }), 100, ant30)!;
    expect(c.longa).not.toContain("presença 31/31");
  });

  test("mudança mínima do valor do ponto não é chamada de igual", () => {
    const c = compararComAnterior(pessoa({ rateioAmount: 360 }), 100.9, ANTERIOR)!;
    expect(c.longa).toContain("valor do ponto");
    expect(c.longa).not.toContain("Sem mudança");
  });

  test("quem estava em rescisão ou cota fixa no mês anterior não tem base de comparação", () => {
    const antes = { ...ANTERIOR, porPessoa: { a: { ...ANTERIOR.porPessoa.a, tipoCalculo: "RESCISAO" } } };
    expect(compararComAnterior(pessoa(), 100, antes)).toBeNull();
    const fixo = { ...ANTERIOR, porPessoa: { a: { ...ANTERIOR.porPessoa.a, tipo: "FIXO" } } };
    expect(compararComAnterior(pessoa(), 100, fixo)).toBeNull();
  });

  test("tem rótulo por extenso para leitor de tela", () => {
    expect(compararComAnterior(pessoa({ rateioAmount: 400 }), 100, ANTERIOR)!.rotulo).toMatch(/^subiu .* em relação ao mês anterior$/);
  });

  test("quem não recebeu no mês anterior é novo", () => {
    const c = compararComAnterior(pessoa({ employeeId: "z", rateioAmount: 200 }), 100, ANTERIOR)!;
    expect(c).toMatchObject({ tipo: "novo", curta: "novo" });
    expect(c.longa).toContain("Não recebeu gorjeta em Outubro/2026");
  });
});

describe("variacaoDoPonto", () => {
  test("só calcula com os dois valores válidos", () => {
    expect(variacaoDoPonto(110, 100)).toBeCloseTo(0.1);
    expect(variacaoDoPonto(110, null)).toBeNull();
    expect(variacaoDoPonto(0, 100)).toBeNull();
  });
});

describe("resumirComparacao", () => {
  test("conta quem subiu, caiu e é novo, com o valor do ponto", () => {
    const pessoas = [pessoa({ rateioAmount: 400 }), pessoa({ employeeId: "b", rateioAmount: 300 }), pessoa({ employeeId: "z", rateioAmount: 200 })];
    const r = resumirComparacao({ pointValue: 110, anterior: ANTERIOR }, pessoas)!;
    expect(r).toContain("Comparado com Outubro/2026");
    expect(r).toContain("+10%");
    expect(r).toContain("1 subiu, 1 caiu");
    expect(r).toContain("1 novo");
  });

  test("sem anterior, nada", () => {
    expect(resumirComparacao({ pointValue: 100, anterior: null }, [])).toBeNull();
  });
});
