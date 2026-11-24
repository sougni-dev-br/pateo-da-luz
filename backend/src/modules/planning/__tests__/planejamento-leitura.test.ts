import { describe, expect, it } from "vitest";
import { caixaPadrao } from "../planejamento-caixa.js";
import { lerCaixa, lerLinha, lerPremissas } from "../planejamento-leitura.js";
import { premissasNeutras } from "../planejamento-projecao.js";

describe("lerPremissas", () => {
  it("premissas válidas voltam ordenadas e sem reparo", () => {
    const r = lerPremissas([...premissasNeutras()].reverse());
    expect(r.reparado).toBe(false);
    expect(r.valor.map((p) => p.mes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("JSON inválido vira o padrão e é sinalizado", () => {
    expect(lerPremissas({ lixo: true })).toEqual({ valor: premissasNeutras(), reparado: true });
    expect(lerPremissas(premissasNeutras().slice(0, 5)).reparado).toBe(true);
  });
});

describe("lerCaixa", () => {
  it("válido passa; nulo usa o padrão sem acusar reparo", () => {
    expect(lerCaixa(caixaPadrao()).reparado).toBe(false);
    expect(lerCaixa(null)).toEqual({ valor: caixaPadrao(), reparado: false });
  });

  it("inválido (mix que não fecha) vira o padrão e é sinalizado", () => {
    const quebrado = { ...caixaPadrao(), formas: caixaPadrao().formas.map((f) => ({ ...f, mix: 1 })) };
    expect(lerCaixa(quebrado)).toEqual({ valor: caixaPadrao(), reparado: true });
    expect(lerCaixa("texto").reparado).toBe(true);
  });
});

describe("lerLinha", () => {
  const valida = { grupo: "OCUPACAO", nome: "Aluguel", modo: "FIXO", valores: Array(12).fill(1000), pagoNoMes: 0.5 };

  it("linha válida não é reparada", () => {
    const r = lerLinha(valida);
    expect(r.reparado).toBe(false);
    expect(r.valor.pagoNoMes).toBe(0.5);
  });

  it("percentual acima de 100% vira 0, não 100%, e avisa", () => {
    const r = lerLinha({ ...valida, modo: "PERCENTUAL", valores: [0.1, 5, ...Array(10).fill(0.2)] });
    expect(r.reparado).toBe(true);
    expect(r.valor.valores[0]).toBe(0.1);
    expect(r.valor.valores[1]).toBe(0);
  });

  it("valores faltando, negativos ou não numéricos viram 0; grupo desconhecido vira OUTROS", () => {
    const r = lerLinha({ ...valida, grupo: "XYZ", valores: [10, -5, "a"] });
    expect(r.reparado).toBe(true);
    expect(r.valor.grupo).toBe("OUTROS");
    expect(r.valor.valores).toHaveLength(12);
    expect(r.valor.valores.slice(0, 4)).toEqual([10, 0, 0, 0]);
  });

  it("valor fixo acima do teto é limitado e avisa", () => {
    const r = lerLinha({ ...valida, valores: [5e12, ...Array(11).fill(1)] });
    expect(r.reparado).toBe(true);
    expect(r.valor.valores[0]).toBe(1_000_000_000);
  });
});
