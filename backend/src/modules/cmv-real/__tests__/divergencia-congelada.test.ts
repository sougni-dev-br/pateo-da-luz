import { describe, expect, test } from "vitest";
import {
  compararTotaisCongelados,
  mensagemDeDivergencia,
  type TotaisDoPeriodo
} from "../divergencia-congelada.js";

/** CMV-2026-0001 como o CmvPeriod o congelou no fechamento de 11/09/2026. */
const ABRIL_CONGELADO: TotaisDoPeriodo = {
  estoqueInicialTotal: 130462.37,
  comprasTotal: 171254.31,
  estoqueFinalTotal: 73682.14,
  cmvReal: 228034.54,
  faturamentoTotal: 378943.14
};

/** O que a base de producao devolve para a mesma janela (03/04 a 30/04). */
const ABRIL_HOJE: TotaisDoPeriodo = {
  estoqueInicialTotal: 112083.07,
  comprasTotal: 171254.31,
  estoqueFinalTotal: 47425.99,
  cmvReal: 235911.39,
  faturamentoTotal: 377400.74
};

describe("compararTotaisCongelados", () => {
  test("periodo que ainda bate com a base nao produz divergencia nenhuma", () => {
    expect(compararTotaisCongelados(ABRIL_CONGELADO, { ...ABRIL_CONGELADO })).toEqual([]);
  });

  test("o caso de abril: acusa os 4 campos que se moveram e poupa o que bate", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, ABRIL_HOJE);

    expect(divergentes.map((d) => d.campo)).toEqual([
      "estoqueInicialTotal",
      "estoqueFinalTotal",
      "cmvReal",
      "faturamentoTotal"
    ]);
    // As compras batem ao centavo — nao podem virar alarme.
    expect(divergentes.find((d) => d.campo === "comprasTotal")).toBeUndefined();
  });

  test("a diferenca e' recalculado menos congelado, com sinal", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, ABRIL_HOJE);
    const estoqueInicial = divergentes.find((d) => d.campo === "estoqueInicialTotal")!;
    const cmv = divergentes.find((d) => d.campo === "cmvReal")!;

    // A base de hoje vale MENOS de estoque...
    expect(estoqueInicial.diferenca).toBeCloseTo(-18379.3, 2);
    // ...e por isso o CMV recalculado sobe.
    expect(cmv.diferenca).toBeCloseTo(7876.85, 2);
  });

  test("um centavo e' arredondamento de Decimal, nao divergencia", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, {
      ...ABRIL_CONGELADO,
      comprasTotal: 171254.32
    });
    expect(divergentes).toEqual([]);
  });

  test("dois centavos ja sao sinal", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, {
      ...ABRIL_CONGELADO,
      comprasTotal: 171254.33
    });
    expect(divergentes.map((d) => d.campo)).toEqual(["comprasTotal"]);
  });

  test("soma de ponto flutuante nao inventa divergencia", () => {
    // 0.1 + 0.2 === 0.30000000000000004; comparar em centavos mata o falso positivo.
    const congelado = { ...ABRIL_CONGELADO, comprasTotal: 0.3 };
    const recalculado = { ...ABRIL_CONGELADO, comprasTotal: 0.1 + 0.2 };
    expect(compararTotaisCongelados(congelado, recalculado)).toEqual([]);
  });

  test("campo que o recalculo nao conseguiu produzir e' ignorado, nao acusado", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, {
      ...ABRIL_HOJE,
      estoqueInicialTotal: Number.NaN
    });
    expect(divergentes.find((d) => d.campo === "estoqueInicialTotal")).toBeUndefined();
    expect(divergentes.map((d) => d.campo)).toEqual([
      "estoqueFinalTotal",
      "cmvReal",
      "faturamentoTotal"
    ]);
  });

  test("zero congelado contra valor real e' divergencia, nao caso trivial", () => {
    // snapshotValue devolvendo zero ja passou 4 meses despercebido neste ERP.
    const divergentes = compararTotaisCongelados(
      { ...ABRIL_CONGELADO, estoqueInicialTotal: 0 },
      ABRIL_CONGELADO
    );
    expect(divergentes.map((d) => d.campo)).toEqual(["estoqueInicialTotal"]);
    expect(divergentes[0].diferenca).toBeCloseTo(130462.37, 2);
  });
});

describe("mensagemDeDivergencia", () => {
  test("sem divergencia nao ha mensagem", () => {
    expect(mensagemDeDivergencia([], new Date("2026-09-11T23:44:14Z"))).toBeNull();
  });

  test("traz os valores em reais, a data do fechamento e de onde veio a composicao", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, ABRIL_HOJE);
    const mensagem = mensagemDeDivergencia(divergentes, new Date("2026-09-11T23:44:14Z"))!;

    expect(mensagem).toContain("11/09/2026");
    expect(mensagem).toContain("4 deles nao batem");
    expect(mensagem).toContain("estoque inicial");
    expect(mensagem).toMatch(/130\.462,37/);
    expect(mensagem).toMatch(/112\.083,07/);
    // O ponto que evita a proxima contradicao silenciosa na tela:
    expect(mensagem).toContain("base de hoje");
  });

  test("uma so divergencia nao vira plural", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, {
      ...ABRIL_CONGELADO,
      faturamentoTotal: 377400.74
    });
    const mensagem = mensagemDeDivergencia(divergentes, null)!;

    expect(mensagem).toContain("1 deles nao bate mais");
    expect(mensagem).not.toContain("em null");
  });

  test("data de fechamento invalida nao vaza para o texto", () => {
    const divergentes = compararTotaisCongelados(ABRIL_CONGELADO, ABRIL_HOJE);
    const mensagem = mensagemDeDivergencia(divergentes, "nao e uma data")!;

    expect(mensagem).not.toContain("Invalid Date");
    expect(mensagem).toContain("congelados no fechamento.");
  });
});
