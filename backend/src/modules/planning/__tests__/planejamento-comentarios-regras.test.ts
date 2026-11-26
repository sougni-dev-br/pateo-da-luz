import { describe, expect, it } from "vitest";
import { mesesEncerradosAte, montarComparativo, type MesDoSalao } from "../planejamento-comparativo.js";
import { PRAZO_DO_AUTOR_MS, PRAZO_DO_DESFAZER_MS, numeroDoPonto, podeApagar, podeRestaurar } from "../planejamento-comentarios-regras.js";

// Números fictícios e redondos (o repositório é público).
const mes = (ano: number, m: number, vendas: number, clientes: number): MesDoSalao => ({
  ano, mes: m, vendasAlmoco: vendas / 2, vendasJantar: vendas / 2, clientesAlmoco: clientes / 2, clientesJantar: clientes / 2, servico: 0, fonte: "HISTORICO"
});
const comparativo = montarComparativo(
  [mes(2025, 1, 100000, 1000), mes(2026, 1, 80000, 1000), mes(2025, 2, 50000, 500), mes(2026, 2, 60000, 400)],
  2025, 2026, mesesEncerradosAte("2026-11-26", [2025, 2026]), "2026-11"
);

describe("numeroDoPonto", () => {
  it("mês comparável: base, comparado e variação como razão", () => {
    expect(numeroDoPonto(comparativo, { mes: 1, metrica: "VENDAS", turno: "TOTAL" })).toEqual({ valorBase: 100000, valorComparado: 80000, variacao: -0.2 });
    expect(numeroDoPonto(comparativo, { mes: 2, metrica: "CLIENTES", turno: "ALMOCO" })).toEqual({ valorBase: 250, valorComparado: 200, variacao: -0.2 });
  });

  it("ano inteiro usa o acumulado", () => {
    expect(numeroDoPonto(comparativo, { mes: null, metrica: "VENDAS", turno: "TOTAL" })).toEqual({ valorBase: 150000, valorComparado: 140000, variacao: -0.066667 });
  });

  it("mês sem dado ou não comparável grava nulo", () => {
    expect(numeroDoPonto(comparativo, { mes: 3, metrica: "VENDAS", turno: "TOTAL" })).toEqual({ valorBase: null, valorComparado: null, variacao: null });
    const vazio = montarComparativo([], 2025, 2026, new Set(), "2026-11");
    expect(numeroDoPonto(vazio, { mes: null, metrica: "TICKET", turno: "TOTAL" })).toEqual({ valorBase: null, valorComparado: null, variacao: null });
  });
});

describe("prazos", () => {
  const criadoEm = new Date("2026-11-20T12:00:00.000Z");
  const agora = (ms: number) => new Date(criadoEm.getTime() + ms);

  it("autor apaga até 24 horas depois de criar; administrador sempre", () => {
    const c = { autorId: "u1", createdAt: criadoEm };
    expect(podeApagar(c, "u1", false, agora(PRAZO_DO_AUTOR_MS))).toBe(true);
    expect(podeApagar(c, "u1", false, agora(PRAZO_DO_AUTOR_MS + 1))).toBe(false);
    expect(podeApagar(c, "u1", true, agora(PRAZO_DO_AUTOR_MS * 30))).toBe(true);
    expect(podeApagar(c, "u2", false, agora(0))).toBe(false);
    expect(podeApagar(c, "u2", true, agora(0))).toBe(true);
  });

  it("quem apagou restaura até 10 minutos depois; administrador sempre", () => {
    const apagadoEm = new Date("2026-11-21T12:00:00.000Z");
    const c = { apagadoEm, apagadoPorId: "u1" };
    const depois = (ms: number) => new Date(apagadoEm.getTime() + ms);
    expect(podeRestaurar(c, "u1", false, depois(PRAZO_DO_DESFAZER_MS))).toBe(true);
    expect(podeRestaurar(c, "u1", false, depois(PRAZO_DO_DESFAZER_MS + 1))).toBe(false);
    expect(podeRestaurar(c, "u2", false, depois(0))).toBe(false);
    expect(podeRestaurar(c, "u2", true, depois(PRAZO_DO_DESFAZER_MS * 100))).toBe(true);
    expect(podeRestaurar({ apagadoEm: null, apagadoPorId: null }, "u1", true, depois(0))).toBe(false);
  });
});
