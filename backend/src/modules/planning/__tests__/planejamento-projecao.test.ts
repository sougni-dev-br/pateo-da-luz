import { describe, expect, it } from "vitest";
import type { MesDoSalao } from "../planejamento-comparativo.js";
import { montarProjecao, premissasNeutras, type PremissasDoMes } from "../planejamento-projecao.js";

const mes = (m: number, sobre: Partial<MesDoSalao> = {}): MesDoSalao => ({
  ano: 2026,
  mes: m,
  vendasAlmoco: 20000,
  vendasJantar: 40000,
  clientesAlmoco: 200,
  clientesJantar: 400,
  servico: 0,
  fonte: "ERP",
  ...sobre
});

const com = (m: number, p: Partial<PremissasDoMes>): PremissasDoMes[] => premissasNeutras().map((x) => (x.mes === m ? { ...x, ...p } : x));
const NENHUM = new Set<number>();

describe("montarProjecao", () => {
  it("reproduz a conta da planilha: jan/27 com +10% de clientes e +5% de ticket no almoço", () => {
    // Base fictícia: almoço 200 clientes a 100; jantar 400 clientes a 100.
    const base = mes(1, { vendasAlmoco: 200 * 100, vendasJantar: 400 * 100 });
    const r = montarProjecao(2026, [base], com(1, { clientesAlmoco: 0.1, ticketAlmoco: 0.05, clientesJantar: 0.1, ticketJantar: 0.05 }), NENHUM);
    const jan = r.meses[0];
    expect(jan.projetado?.clientes.almoco).toBe(220);
    expect(jan.projetado?.ticket.almoco).toBeCloseTo(105, 2);
    expect(jan.projetado?.vendas.almoco).toBeCloseTo(23100, 1);
    expect(jan.projetado?.vendas.jantar).toBeCloseTo(46200, 1);
    expect(jan.projetado?.vendas.total).toBeCloseTo(69300, 1);
  });

  it("premissas neutras devolvem o próprio ano-base", () => {
    const r = montarProjecao(2026, [mes(3)], premissasNeutras(), NENHUM);
    expect(r.meses[2].projetado?.vendas.total).toBeCloseTo(r.meses[2].base!.vendas.total, 1);
    expect(r.total.variacaoVendas).toBe(0);
  });

  it("CMV aplicado sobre as vendas do mês e margem bruta = vendas − CMV", () => {
    const r = montarProjecao(2026, [mes(4, { vendasAlmoco: 1000, vendasJantar: 500, clientesAlmoco: 10, clientesJantar: 5 })], com(4, { cmv: 0.4 }), NENHUM);
    expect(r.meses[3].cmvValor).toBe(600);
    expect(r.meses[3].margemBruta).toBe(900);
    expect(r.total.cmvPercentual).toBe(0.4);
    expect(r.total.margemBruta).toBe(900);
  });

  it("sem % de CMV não inventa margem", () => {
    const r = montarProjecao(2026, [mes(4)], premissasNeutras(), NENHUM);
    expect(r.meses[3].cmvValor).toBeNull();
    expect(r.meses[3].margemBruta).toBeNull();
    expect(r.total.margemBruta).toBeNull();
  });

  it("margem do ano fica em branco se algum mês somado não tem CMV", () => {
    const premissas = com(1, { cmv: 0.4 });
    const r = montarProjecao(2026, [mes(1), mes(2)], premissas, NENHUM);
    expect(r.total.cmvValor).not.toBeNull();
    expect(r.total.margemBruta).toBeNull();
  });

  it("mês sem dado, em andamento ou com clientes incompletos não é projetado nem somado", () => {
    const r = montarProjecao(2026, [mes(1), mes(2), mes(3, { clientesIncompletos: true }), mes(4, { clientesJantar: 0 })], premissasNeutras(), new Set([2]));
    expect(r.meses[0].motivoSemBase).toBeNull();
    expect(r.meses[1].motivoSemBase).toBe("EM_ANDAMENTO");
    expect(r.meses[2].motivoSemBase).toBe("CLIENTES_INCOMPLETOS");
    expect(r.meses[3].motivoSemBase).toBe("TURNO_SEM_CLIENTES");
    expect(r.meses[4].motivoSemBase).toBe("SEM_DADO");
    expect(r.total.meses).toEqual([1]);
  });

  it("mês parcial do ERP (sem histórico que o substitua) não serve de base", () => {
    const r = montarProjecao(2026, [mes(1, { parcial: true }), mes(2)], premissasNeutras(), NENHUM);
    expect(r.meses[0].motivoSemBase).toBe("MES_PARCIAL");
    expect(r.meses[0].projetado).toBeNull();
    expect(r.total.meses).toEqual([2]);
  });

  it("o mês corrente continua EM_ANDAMENTO mesmo sendo parcial", () => {
    const r = montarProjecao(2026, [mes(1, { parcial: true })], premissasNeutras(), new Set([1]));
    expect(r.meses[0].motivoSemBase).toBe("EM_ANDAMENTO");
  });

  it("ignora meses de outro ano", () => {
    const r = montarProjecao(2026, [mes(1, { ano: 2025 })], premissasNeutras(), NENHUM);
    expect(r.meses[0].motivoSemBase).toBe("SEM_DADO");
  });

  it("ticket total é vendas ÷ clientes e variação do ano compara só os meses somados", () => {
    const r = montarProjecao(2026, [mes(1), mes(2)], premissasNeutras().map((p) => ({ ...p, clientesAlmoco: 0.1 })), NENHUM);
    const t = r.total;
    expect(t.projetado.ticket.total).toBeCloseTo(t.projetado.vendas.total / t.projetado.clientes.total, 1);
    expect(t.variacaoClientes).toBeGreaterThan(0);
    expect(t.variacaoVendas).toBeGreaterThan(0);
    expect(t.variacaoTicket).not.toBeNull();
  });

  it("mês sem premissa cadastrada usa crescimento zero", () => {
    const r = montarProjecao(2026, [mes(5)], [], NENHUM);
    expect(r.meses[4].projetado?.vendas.total).toBeCloseTo(r.meses[4].base!.vendas.total, 1);
  });

  it("sem nenhum mês com base, o total fica vazio e sem variação", () => {
    const r = montarProjecao(2026, [], premissasNeutras(), NENHUM);
    expect(r.total.meses).toEqual([]);
    expect(r.total.variacaoVendas).toBeNull();
    expect(r.total.cmvValor).toBeNull();
  });
});
