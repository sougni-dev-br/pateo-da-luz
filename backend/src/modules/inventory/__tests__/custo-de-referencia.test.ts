import { describe, expect, it } from "vitest";
import { custoDaFichaPelaReferencia, decidirCustoDeReferencia } from "../custo-de-referencia.js";
import type { CandidatosDoCusto } from "../custo-inventario.js";

const SEM_CANDIDATOS: CandidatosDoCusto = { periodo: null, ultimaCompra: null, base: null, informado: null };
const candidatos = (c: Partial<CandidatosDoCusto>): CandidatosDoCusto => ({ ...SEM_CANDIDATOS, ...c });

describe("decidirCustoDeReferencia", () => {
  it("compras na unidade de contagem mandam quando ficam perto do custo do estoque", () => {
    const r = decidirCustoDeReferencia({ controlsStock: true, averageCost: 12, candidatos: candidatos({ periodo: 8.18 }) });
    expect(r).toMatchObject({ valor: 8.18, fonte: "COMPRAS_DO_PERIODO", revisar: null });
  });

  it("diferenca de dezenas de vezes (caixa contada como 1 UN a R$ 490,72) nao e aplicada sozinha: vai para revisao", () => {
    const r = decidirCustoDeReferencia({ controlsStock: true, averageCost: 490.72, candidatos: candidatos({ periodo: 8.18 }) });
    expect(r).toMatchObject({ valor: 490.72, fonte: "ESTOQUE" });
    expect(r?.revisar).toMatch(/compras do período/);
  });

  it("ultima compra 34x acima do estoque (barril lancado como litro) tambem vai para revisao", () => {
    const r = decidirCustoDeReferencia({ controlsStock: true, averageCost: 19.7, candidatos: candidatos({ ultimaCompra: { valor: 675.57, data: new Date("2026-09-01") } }) });
    expect(r).toMatchObject({ valor: 19.7, fonte: "ESTOQUE" });
    expect(r?.revisar).toMatch(/últimas compras/);
  });

  it("sem compra no periodo usa a ultima compra, depois a base", () => {
    const ultima = decidirCustoDeReferencia({
      controlsStock: true, averageCost: 10,
      candidatos: candidatos({ ultimaCompra: { valor: 9, data: new Date("2026-09-01") }, base: { valor: 8, ano: 2026, mes: 8 } })
    });
    expect(ultima).toMatchObject({ valor: 9, fonte: "ULTIMA_COMPRA" });
    const base = decidirCustoDeReferencia({ controlsStock: true, averageCost: 10, candidatos: candidatos({ base: { valor: 8, ano: 2026, mes: 8 } }) });
    expect(base).toMatchObject({ valor: 8, fonte: "BASE_ANTERIOR" });
  });

  it("nao usa o custo informado na conferencia (so vale dentro do inventario)", () => {
    const r = decidirCustoDeReferencia({
      controlsStock: true, averageCost: 5,
      candidatos: candidatos({ informado: { valor: 99, por: "operador", em: new Date() } })
    });
    expect(r).toMatchObject({ valor: 5, fonte: "ESTOQUE" });
  });

  it("despesa (nao controla estoque) mantem o custo medio, mesmo com compra", () => {
    const r = decidirCustoDeReferencia({ controlsStock: false, averageCost: 54.66, candidatos: candidatos({ periodo: 159.24 }) });
    expect(r).toMatchObject({ valor: 54.66, fonte: "ESTOQUE", revisar: null });
  });

  it("base que difere mais de 3x do estoque (barril como litro) e descartada e marcada para revisao", () => {
    const r = decidirCustoDeReferencia({ controlsStock: true, averageCost: 19.7, candidatos: candidatos({ base: { valor: 675.57, ano: 2026, mes: 8 } }) });
    expect(r).toMatchObject({ valor: 19.7, fonte: "ESTOQUE" });
    expect(r?.revisar).toMatch(/base oficial/);
    expect(r?.revisar).toMatch(/34\.29x/);
  });

  it("base que difere menos de 3x vale", () => {
    const r = decidirCustoDeReferencia({ controlsStock: true, averageCost: 10, candidatos: candidatos({ base: { valor: 25, ano: 2026, mes: 8 } }) });
    expect(r).toMatchObject({ valor: 25, fonte: "BASE_ANTERIOR", revisar: null });
  });

  it("sem candidato devolve o custo do estoque; sem nenhum custo devolve null", () => {
    expect(decidirCustoDeReferencia({ controlsStock: true, averageCost: 7, candidatos: SEM_CANDIDATOS })).toMatchObject({ valor: 7, fonte: "ESTOQUE" });
    expect(decidirCustoDeReferencia({ controlsStock: true, averageCost: null, candidatos: SEM_CANDIDATOS })).toBeNull();
    expect(decidirCustoDeReferencia({ controlsStock: true, averageCost: 0, candidatos: SEM_CANDIDATOS })).toBeNull();
  });
});

describe("custoDaFichaPelaReferencia", () => {
  it("so liga com CUSTO_FICHA_FONTE=referencia", () => {
    expect(custoDaFichaPelaReferencia({ CUSTO_FICHA_FONTE: "referencia" } as NodeJS.ProcessEnv)).toBe(true);
    expect(custoDaFichaPelaReferencia({ CUSTO_FICHA_FONTE: "estoque" } as NodeJS.ProcessEnv)).toBe(false);
    expect(custoDaFichaPelaReferencia({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
