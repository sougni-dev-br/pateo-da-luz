import { describe, expect, it } from "vitest";
import type { PlanejamentoProjecao, PlanejamentoResultado } from "../../../api/client";
import type { PlanejamentoCaixaPremissas } from "../../../api/client";
import { ehValorDePartida } from "../caixa";
import { listaDeMeses, mesesSemCmv, pendenciaDoCenario, textoDaPendencia } from "../incompleto";

// Valores fictícios: só importam os campos que a regra lê.
const projecao = (cmvPorMes: (number | null)[]): PlanejamentoProjecao =>
  ({ meses: cmvPorMes.map((cmvPercentual, i) => ({ mes: i + 1, projetado: true, cmvPercentual })) }) as unknown as PlanejamentoProjecao;
const resultado = (gastosTotal: number): PlanejamentoResultado => ({ total: { gastosTotal } }) as unknown as PlanejamentoResultado;

describe("pendência do cenário", () => {
  it("lista os meses projetados sem CMV, ignorando os não projetados", () => {
    const p = projecao([0.3, null, null]);
    p.meses.push({ mes: 4, projetado: false, cmvPercentual: null } as never);
    expect(mesesSemCmv(p)).toEqual([2, 3]);
  });
  it("CMV faltando vem antes dos gastos", () => {
    expect(pendenciaDoCenario(projecao([0.3, null]), resultado(0))).toEqual({ tipo: "cmv", meses: [2] });
  });
  it("sem gastos lançados, com CMV completo, é pendência de gastos", () => {
    expect(pendenciaDoCenario(projecao([0.3, 0.3]), resultado(0))).toEqual({ tipo: "gastos" });
  });
  it("cenário completo não tem pendência", () => {
    expect(pendenciaDoCenario(projecao([0.3, 0.3]), resultado(1000))).toBeNull();
    expect(pendenciaDoCenario(projecao([0.3]), null)).toBeNull();
  });
  it("escreve os meses e o motivo", () => {
    expect(listaDeMeses([1, 2, 3])).toBe("Jan, Fev e Mar");
    expect(listaDeMeses([5])).toBe("Mai");
    expect(textoDaPendencia({ tipo: "cmv", meses: [1] })).toBe("falta o CMV de 1 mês");
    expect(textoDaPendencia({ tipo: "cmv", meses: [1, 2] })).toBe("falta o CMV de 2 meses");
    expect(textoDaPendencia({ tipo: "gastos" })).toBe("sem gastos lançados");
  });
});

describe("valores de partida do caixa", () => {
  const partida = (): PlanejamentoCaixaPremissas => ({
    saldoInicial: 0,
    formas: [
      { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
      { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
      { forma: "DEBITO", mix: 0.25, prazoDias: 1, taxa: 0 },
      { forma: "CREDITO", mix: 0.3, prazoDias: 30, taxa: 0 },
      { forma: "VOUCHER", mix: 0.05, prazoDias: 30, taxa: 0 }
    ],
    comprasPrazoDias: 30,
    herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] }
  });
  it("reconhece o ponto de partida e deixa de reconhecer depois de qualquer edição", () => {
    expect(ehValorDePartida(partida())).toBe(true);
    const base = partida();
    expect(ehValorDePartida({ ...base, formas: base.formas.map((f) => (f.forma === "CREDITO" ? { ...f, mix: 0.7 } : f)) })).toBe(false);
    expect(ehValorDePartida({ ...base, saldoInicial: 1000 })).toBe(false);
    expect(ehValorDePartida({ ...base, comprasPrazoDias: 28 })).toBe(false);
    expect(ehValorDePartida({ ...base, herdado: { entradas: [0, 5, 0], saidas: [0, 0, 0] } })).toBe(false);
  });
});
