import { expect, test } from "vitest";
import { dividirEmParcelas, gerarVencimentosMensais, montarParcelas } from "../parcelamento-calc.js";

// Valores e datas fictícios.

test("divide o total em centavos e o resto vai para a última parcela", () => {
  expect(dividirEmParcelas(100, 3)).toEqual([33.33, 33.33, 33.34]);
});

test("a soma das parcelas é sempre o total", () => {
  const partes = dividirEmParcelas(1234.57, 7);
  expect(Math.round(partes.reduce((s, v) => s + v, 0) * 100)).toBe(123457);
});

test("recusa total zerado, negativo ou número de parcelas inválido", () => {
  expect(() => dividirEmParcelas(0, 3)).toThrow();
  expect(() => dividirEmParcelas(-5, 3)).toThrow();
  expect(() => dividirEmParcelas(100, 0)).toThrow();
  expect(() => dividirEmParcelas(100, 121)).toThrow();
  expect(() => dividirEmParcelas(100, 2.5)).toThrow();
});

test("vencimentos mensais mantêm o dia", () => {
  expect(gerarVencimentosMensais("2026-11-10", 3)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
});

test("dia 31 cai no último dia dos meses curtos sem acumular deslocamento", () => {
  expect(gerarVencimentosMensais("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("recusa data inicial inválida", () => {
  expect(() => gerarVencimentosMensais("31/01/2026", 2)).toThrow();
  expect(() => gerarVencimentosMensais("2026-02-30", 2)).toThrow();
});

test("monta parcelas numeradas com valor e vencimento", () => {
  expect(montarParcelas({ total: 100, quantidade: 2, primeiroVencimento: "2026-11-05" })).toEqual([
    { numero: 1, valor: 50, vencimento: "2026-11-05" },
    { numero: 2, valor: 50, vencimento: "2026-12-05" }
  ]);
});

test("aceita vencimentos e valores informados e confere a soma", () => {
  const parcelas = montarParcelas({
    total: 100, quantidade: 2,
    informadas: [{ valor: 70, vencimento: "2026-11-05" }, { valor: 30, vencimento: "2026-12-20" }]
  });
  expect(parcelas.map((p) => p.vencimento)).toEqual(["2026-11-05", "2026-12-20"]);
  expect(() => montarParcelas({ total: 100, quantidade: 2, informadas: [{ valor: 70, vencimento: "2026-11-05" }, { valor: 20, vencimento: "2026-12-20" }] })).toThrow(/soma/i);
});

test("recusa valores com mais de 2 casas decimais", () => {
  expect(() => dividirEmParcelas(100.005, 3)).toThrow(/casas/);
  expect(() => montarParcelas({ total: 100, quantidade: 2, informadas: [{ valor: 50.004, vencimento: "2026-11-05" }, { valor: 49.996, vencimento: "2026-12-05" }] })).toThrow(/casas/);
});
