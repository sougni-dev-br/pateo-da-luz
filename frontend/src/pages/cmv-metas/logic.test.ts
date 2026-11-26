import { describe, expect, test } from "vitest";
import { acumular, pontosDeCmv, rotuloDaComparacao, tetoAcumulado, variacao } from "./logic";

const dias = [
  { dia: 1, faturamento: 1000, compras: 300 },
  { dia: 2, faturamento: 0, compras: 50 },
  { dia: 3, faturamento: 2000, compras: 0 },
];

describe("logic das visões de metas", () => {
  test("acumula dia a dia", () => {
    expect(acumular(dias, "compras").map((p) => p.valor)).toEqual([300, 350, 350]);
  });

  test("teto é o faturamento acumulado vezes a meta", () => {
    expect(tetoAcumulado(dias, 30).map((p) => p.valor)).toEqual([300, 300, 900]);
  });

  test("peso no CMV só existe com faturamento", () => {
    expect(pontosDeCmv(300, 1000)).toBe(30);
    expect(pontosDeCmv(300, 0)).toBeNull();
  });

  test("variação sem base no mês anterior é null (aparece como novo)", () => {
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(150, 0)).toBeNull();
  });

  test("rótulo do trecho comparado", () => {
    expect(rotuloDaComparacao("2026-10", 10, 31)).toMatch(/^1–10 de out/);
    expect(rotuloDaComparacao("2026-10", 31, 31)).toMatch(/^out/);
  });
});
