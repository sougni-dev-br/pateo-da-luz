import { describe, expect, it } from "vitest";
import type { MesDoSalao } from "../planejamento-comparativo.js";
import { montarProjecao, premissasNeutras, type PremissasDoMes } from "../planejamento-projecao.js";

const mes = (m: number, sobre: Partial<MesDoSalao> = {}): MesDoSalao => ({
  ano: 2026,
  mes: m,
  vendasAlmoco: 25839.4,
  vendasJantar: 42235.27,
  clientesAlmoco: 332,
  clientesJantar: 640,
  servico: 0,
  fonte: "ERP",
  ...sobre
});

const com = (m: number, p: Partial<PremissasDoMes>): PremissasDoMes[] => premissasNeutras().map((x) => (x.mes === m ? { ...x, ...p } : x));
const NENHUM = new Set<number>();

describe("montarProjecao", () => {
  it("reproduz a planilha: jan/27 com +10% de clientes e +5% de ticket no almoço", () => {
    // Jan/26 da planilha: almoço 332 clientes, ticket 77,83; jantar 640 clientes, ticket 65,99.
    const base = mes(1, { vendasAlmoco: 332 * 77.82746987951808, vendasJantar: 640 * 65.990109375 });
    const r = montarProjecao(2026, [base], com(1, { clientesAlmoco: 0.1, ticketAlmoco: 0.05, clientesJantar: 0.1, ticketJantar: 0.05 }), NENHUM);
    const jan = r.meses[0];
    expect(jan.projetado?.clientes.almoco).toBe(365.2);
    expect(jan.projetado?.ticket.almoco).toBeCloseTo(81.72, 2);
    expect(jan.projetado?.vendas.almoco).toBeCloseTo(29843.72, 1);
    expect(jan.projetado?.vendas.jantar).toBeCloseTo(48779.89, 1);
    expect(jan.projetado?.vendas.total).toBeCloseTo(78623.61, 1);
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
