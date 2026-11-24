import { describe, expect, it } from "vitest";
import type { PlanejamentoCaixaPremissas, PlanejamentoLinhaDeGasto } from "../../../api/client";
import { distribuicaoPorPrazo, entradasDosMesesSeguintes, lerPrazos, pagoNoMesMedio, parteForaDoMes } from "../regua";

const caixa = (formas: PlanejamentoCaixaPremissas["formas"]): PlanejamentoCaixaPremissas => ({ saldoInicial: 0, formas, comprasPrazoDias: 30, herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] } });

describe("régua de prazo", () => {
  it("parte que fica para o mês seguinte cresce com o prazo e para em 100% a partir de 30 dias", () => {
    expect(parteForaDoMes(0)).toBe(0);
    expect(parteForaDoMes(15)).toBe(0.5);
    expect(parteForaDoMes(30)).toBe(1);
    expect(parteForaDoMes(60)).toBe(1);
  });

  it("pondera prazo, imediato, mês seguinte e taxa pelo mix", () => {
    const leitura = lerPrazos(caixa([
      { forma: "PIX", mix: 0.2, prazoDias: 0, taxa: 0 },
      { forma: "DEBITO", mix: 0.2, prazoDias: 1, taxa: 0.01 },
      { forma: "CREDITO", mix: 0.6, prazoDias: 30, taxa: 0.03 }
    ]));
    expect(leitura.prazoMedio).toBeCloseTo(18.2, 6);
    expect(leitura.imediato).toBeCloseTo(0.4, 6);
    expect(leitura.foraDoMes).toBeCloseTo(0.2 / 30 + 0.6, 6);
    expect(leitura.taxaMedia).toBeCloseTo(0.002 + 0.018, 6);
    expect(leitura.escala).toBe(30);
  });

  it("a régua se estende quando algum prazo passa de 30 dias, e o mix zerado não divide por zero", () => {
    expect(lerPrazos(caixa([{ forma: "CREDITO", mix: 1, prazoDias: 40, taxa: 0 }])).escala).toBe(45);
    expect(lerPrazos(caixa([{ forma: "CREDITO", mix: 0, prazoDias: 30, taxa: 0 }])).prazoMedio).toBe(0);
  });
});

describe("régua: prazos acima de 30 dias", () => {
  it("a distribuição é a mesma do servidor: 45 dias = metade no mês seguinte, metade dois meses depois", () => {
    expect(distribuicaoPorPrazo(45)).toEqual([0, 0.5, 0.5, 0, 0]);
    expect(distribuicaoPorPrazo(15)).toEqual([0.5, 0.5, 0, 0, 0]);
    expect(distribuicaoPorPrazo(90)).toEqual([0, 0, 0, 1, 0]);
  });

  it("com Crédito em 45 dias, separa o que entra no mês seguinte do que só entra dois meses depois", () => {
    const leitura = lerPrazos(caixa([
      { forma: "PIX", mix: 0.2, prazoDias: 0, taxa: 0 },
      { forma: "CREDITO", mix: 0.8, prazoDias: 45, taxa: 0 }
    ]));
    expect(leitura.porMes[0]).toBeCloseTo(0.2, 6);
    expect(leitura.porMes[1]).toBeCloseTo(0.4, 6);
    expect(leitura.porMes[2]).toBeCloseTo(0.4, 6);
    expect(leitura.foraDoMes).toBeCloseTo(0.8, 6);
    expect(leitura.alemDoSeguinte).toBeCloseTo(0.4, 6);
    expect(entradasDosMesesSeguintes(leitura.porMes)).toEqual([
      { reais: 40, quando: "no mês seguinte" },
      { reais: 40, quando: "dois meses depois" }
    ]);
  });

  it("até 30 dias nada passa do mês seguinte", () => {
    const leitura = lerPrazos(caixa([{ forma: "CREDITO", mix: 1, prazoDias: 30, taxa: 0 }]));
    expect(leitura.alemDoSeguinte).toBe(0);
    expect(entradasDosMesesSeguintes(leitura.porMes)).toEqual([{ reais: 100, quando: "no mês seguinte" }]);
  });

  it("a escala também cobre o prazo das compras", () => {
    expect(lerPrazos({ ...caixa([{ forma: "PIX", mix: 1, prazoDias: 0, taxa: 0 }]), comprasPrazoDias: 60 }).escala).toBe(60);
  });
});

describe("pagoNoMesMedio", () => {
  const gasto = (modo: "FIXO" | "PERCENTUAL", valor: number, pagoNoMes: number): PlanejamentoLinhaDeGasto => ({ grupo: "OUTROS", nome: "x", modo, valores: Array(12).fill(valor) as number[], pagoNoMes });
  it("pondera as linhas fixas pelo valor do ano; linhas em % não pesam", () => {
    expect(pagoNoMesMedio([gasto("FIXO", 3000, 1), gasto("FIXO", 1000, 0), gasto("PERCENTUAL", 0.05, 0)])).toBeCloseTo(0.75, 6);
  });
  it("sem valor fixo usa a média simples; sem linhas, null", () => {
    expect(pagoNoMesMedio([gasto("PERCENTUAL", 0.05, 0.5), gasto("FIXO", 0, 1)])).toBeCloseTo(0.75, 6);
    expect(pagoNoMesMedio([])).toBeNull();
  });
});
