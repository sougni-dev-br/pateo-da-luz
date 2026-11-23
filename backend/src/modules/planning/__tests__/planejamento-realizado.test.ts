import { describe, expect, it } from "vitest";
import { GRUPO_DO_DRE, mesesEncerradosDoAno, montarRealizado, type MesDoDre } from "../planejamento-realizado.js";

const mes = (m: number, gastos: Record<string, number>, receitaBruta = 200000): MesDoDre => ({ mes: m, gastosPorGrupo: gastos, receitaBruta });
const grupo = (r: ReturnType<typeof montarRealizado>, g: string) => r.grupos.find((x) => x.grupo === g)!;

describe("mesesEncerradosDoAno", () => {
  it("ano passado fecha os 12; ano corrente só os meses antes do atual; ano futuro nenhum", () => {
    expect(mesesEncerradosDoAno(2025, "2026-11-23")).toHaveLength(12);
    expect(mesesEncerradosDoAno(2026, "2026-11-23")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(mesesEncerradosDoAno(2026, "2026-01-15")).toEqual([]);
    expect(mesesEncerradosDoAno(2027, "2026-11-23")).toEqual([]);
  });
});

describe("montarRealizado", () => {
  it("reagrupa os grupos do DRE: pessoal + vale-transporte viram folha; o resto de despesas vira outros", () => {
    const r = montarRealizado(2026, [mes(1, { PESSOAL: 70000, VALE_TRANSPORTE: 5000, LOCACAO: 50000, DESPESAS_GERAIS: 8000, PLANEJAMENTO: 2000, DESPESAS_OPERACIONAIS: 1000 })], [1], false);
    expect(grupo(r, "FOLHA").valoresPorMes[0]).toBe(75000);
    expect(grupo(r, "OCUPACAO").valoresPorMes[0]).toBe(50000);
    expect(grupo(r, "OUTROS").valoresPorMes[0]).toBe(11000);
  });

  it("CMV e deduções não entram em nenhum grupo de gasto", () => {
    expect(GRUPO_DO_DRE.CMV_COMPRAS).toBeNull();
    const r = montarRealizado(2026, [mes(1, { CMV_COMPRAS: 90000, DEDUCOES: 30000, LOCACAO: 100 })], [1], false);
    const soma = r.grupos.reduce((s, g) => s + (g.valoresPorMes[0] ?? 0), 0);
    expect(soma).toBe(100);
  });

  it("mês não encerrado fica em branco e fora da média", () => {
    const r = montarRealizado(2026, [mes(1, { LOCACAO: 1000 }), mes(2, { LOCACAO: 3000 })], [1], false);
    expect(grupo(r, "OCUPACAO").valoresPorMes[1]).toBeNull();
    expect(grupo(r, "OCUPACAO").media).toBe(1000);
    expect(grupo(r, "OCUPACAO").mesesConsiderados).toEqual([1]);
  });

  it("mês sem lançamento (zero) é apontado e, por padrão, fica fora da média (lacuna de ocupação)", () => {
    const meses = [mes(5, { LOCACAO: 54000 }), mes(6, { LOCACAO: 0 }), mes(7, { LOCACAO: 0 })];
    const ignorando = montarRealizado(2026, meses, [5, 6, 7], true);
    expect(grupo(ignorando, "OCUPACAO").mesesSemLancamento).toEqual([6, 7]);
    expect(grupo(ignorando, "OCUPACAO").media).toBe(54000);
    const incluindo = montarRealizado(2026, meses, [5, 6, 7], false);
    expect(grupo(incluindo, "OCUPACAO").media).toBe(18000);
  });

  it("grupo sem correspondente no DRE (dívida, contratos, seguros) não tem origem nem média", () => {
    const r = montarRealizado(2026, [mes(1, { LOCACAO: 1000 })], [1], true);
    for (const g of ["DIVIDA", "CONTRATOS", "SEGUROS"]) {
      expect(grupo(r, g).origemNoDre).toBe(false);
      expect(grupo(r, g).media).toBeNull();
      expect(grupo(r, g).mesesSemLancamento).toEqual([]);
    }
  });

  it("percentual da receita = soma dos meses considerados ÷ receita bruta deles", () => {
    const r = montarRealizado(2026, [mes(1, { IMPOSTOS: 15000 }, 250000), mes(2, { IMPOSTOS: 25000 }, 250000)], [1, 2], false);
    expect(grupo(r, "TRIBUTOS").percentualDaReceita).toBe(0.08);
    expect(grupo(r, "TRIBUTOS").media).toBe(20000);
  });

  it("sem receita no período não inventa percentual", () => {
    const r = montarRealizado(2026, [mes(1, { IMPOSTOS: 15000 }, 0)], [1], false);
    expect(grupo(r, "TRIBUTOS").percentualDaReceita).toBeNull();
  });

  it("sem nenhum mês encerrado nada é sugerido", () => {
    const r = montarRealizado(2027, [], [], true);
    expect(r.grupos.every((g) => g.media === null && g.valoresPorMes.every((v) => v === null))).toBe(true);
    expect(r.grupos).toHaveLength(9);
  });
});
