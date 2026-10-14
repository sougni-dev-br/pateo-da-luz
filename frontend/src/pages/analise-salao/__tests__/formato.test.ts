import { describe, expect, test } from "vitest";
import {
  dataCurta, decimal1, diaDaSemana, direcao, intervalo, inteiro, mascararReais, ORDEM_SEMANA, percentual, reaisCompacto, reaisInteiro, sentido, textoVariacao
} from "../formato";

const v = (pct: number | null) => ({ atual: 1, anterior: 1, diferenca: 0, pct });

describe("reaisCompacto", () => {
  test.each([
    [0, "R$ 0"],
    [9983.4, "R$ 9.983"],
    [9999, "R$ 9.999"],
    [10000, "R$ 10,0 mil"],
    [26390.87, "R$ 26,4 mil"],
    [227620.15, "R$ 227,6 mil"],
    [1_250_000, "R$ 1,3 mi"],
    [999_960, "R$ 1,0 mi"],
    [999_940, "R$ 999,9 mil"],
    [-26390, "−R$ 26,4 mil"],
    [-500, "−R$ 500"]
  ])("%s -> %s", (entrada, esperado) => {
    expect(reaisCompacto(entrada)).toBe(esperado);
  });
});

describe("numeros e percentuais", () => {
  test("inteiro e decimal usam virgula e ponto de milhar", () => {
    expect(inteiro(1234.6)).toBe("1.235");
    expect(decimal1(76.34)).toBe("76,3");
  });
  test("percentual recebe razao", () => {
    expect(percentual(0.238)).toBe("23,8%");
    expect(percentual(0.0896, 2)).toBe("8,96%");
    expect(percentual(0)).toBe("0,0%");
  });
  test("reaisInteiro", () => {
    expect(reaisInteiro(1500)).toBe("R$ 1.500");
    expect(reaisInteiro(-30)).toBe("−R$ 30");
  });
});

describe("datas", () => {
  test("dataCurta", () => {
    expect(dataCurta("2026-09-14")).toBe("14/09");
    expect(dataCurta(null)).toBe("—");
    expect(dataCurta("lixo")).toBe("—");
  });
  test("intervalo", () => {
    expect(intervalo({ inicio: "2026-09-14", fim: "2026-10-13" })).toBe("14/09 a 13/10");
  });
  test("intervalo que atravessa o ano mostra o ano (senao 14/10 a 13/10 confunde)", () => {
    expect(intervalo({ inicio: "2025-10-14", fim: "2026-10-13" })).toBe("14/10/2025 a 13/10/2026");
  });
  test("diaDaSemana nao depende do fuso do navegador", () => {
    expect(diaDaSemana("2026-10-05")).toBe(1); // segunda
    expect(diaDaSemana("2026-10-11")).toBe(0); // domingo
  });
  test("a semana comeca na segunda e termina no domingo", () => {
    expect([...ORDEM_SEMANA]).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("variacao", () => {
  test("direcao: sobe, desce, estavel e sem base", () => {
    expect(direcao(v(0.1))).toBe("up");
    expect(direcao(v(-0.1))).toBe("down");
    expect(direcao(v(0.004))).toBe("flat");
    expect(direcao(v(0.02))).toBe("up"); // 2% ja e subida
    expect(direcao(v(-0.03))).toBe("down");
    expect(direcao(v(null))).toBe("flat");
    expect(direcao(null)).toBe("flat");
  });
  test("texto da variacao usa sinal de menos tipografico", () => {
    expect(textoVariacao(v(0.238))).toBe("+23,8%");
    expect(textoVariacao(v(-0.238))).toBe("−23,8%");
    expect(textoVariacao(v(0.001))).toBe("0,1%");
    expect(textoVariacao(v(0.02))).toBe("+2,0%");
    expect(textoVariacao(v(null))).toBe("sem base de comparação");
    expect(textoVariacao(null)).toBe("sem base de comparação");
  });
  test("sentido: subir e bom para faturamento e ruim para perda", () => {
    expect(sentido(v(0.1), true)).toBe("bom");
    expect(sentido(v(0.1), false)).toBe("ruim");
    expect(sentido(v(-0.1), true)).toBe("ruim");
    expect(sentido(v(-0.1), false)).toBe("bom");
    expect(sentido(v(0), true)).toBe("neutro");
    expect(sentido(null, false)).toBe("neutro");
  });
});

describe("mascararReais", () => {
  test.each([
    ["R$ 11.000 no período", "R$ •••• no período"],
    ["Somam R$ 6.697,35 e R$ 26,4 mil", "Somam R$ •••• e R$ ••••"],
    ["até R$ 1,2 mi em jogo", "até R$ •••• em jogo"],
    ["R$9.983 sem espaço", "R$ •••• sem espaço"],
    ["50 pessoas por dia, 25% do melhor", "50 pessoas por dia, 25% do melhor"],
    ["sem refação R$ 500, itens cancelados", "sem refação R$ ••••, itens cancelados"],
    ["Somam R$ 6.697,35. Valores altos", "Somam R$ ••••. Valores altos"],
    ["descontos R$ 1.234.", "descontos R$ ••••."],
    ["custa R$ 5 minutos", "custa R$ •••• minutos"],
    ["R$ 26,4 mil por mês", "R$ •••• por mês"],
    // "R$ 0" é o fato (nada lançado), não um valor a esconder; mas "R$ 0,50", "R$ 05" e "R$ 0.5 mil" continuam valores.
    ["1 produto vendido a R$ 0", "1 produto vendido a R$ 0"],
    ["vendidos a R$ 0.", "vendidos a R$ 0."],
    ["vendidos a R$ 0, como", "vendidos a R$ 0, como"],
    ["custa R$ 0,50 e R$ 0 depois", "custa R$ •••• e R$ 0 depois"],
    ["R$ 0.5 mil", "R$ ••••"],
    ["R$ 10 e R$ 0", "R$ •••• e R$ 0"],
    ["R$ 100", "R$ ••••"]
  ])("%s", (entrada, esperado) => {
    expect(mascararReais(entrada)).toBe(esperado);
  });
});
