import { describe, expect, it } from "vitest";
import { linhasPadrao, montarResultado, type LinhaDeGasto } from "../planejamento-gastos.js";
import type { MesProjetado, Projecao, Turnos } from "../planejamento-projecao.js";

const turnos = (total: number): Turnos => ({ almoco: total, jantar: 0, total });

/** Projeção com só alguns meses; os outros ficam sem base. */
function projecaoCom(meses: { mes: number; vendas: number; cmv: number | null; ticket?: number }[]): Projecao {
  const lista: MesProjetado[] = Array.from({ length: 12 }, (_, i) => {
    const dado = meses.find((m) => m.mes === i + 1);
    if (!dado) return { mes: i + 1, motivoSemBase: "SEM_DADO", base: null, projetado: null, cmvPercentual: null, cmvValor: null, margemBruta: null };
    const cmvValor = dado.cmv === null ? null : dado.vendas * dado.cmv;
    const grandezas = { clientes: turnos(100), ticket: turnos(dado.ticket ?? 100), vendas: turnos(dado.vendas) };
    return { mes: i + 1, motivoSemBase: null, base: grandezas, projetado: grandezas, cmvPercentual: dado.cmv, cmvValor, margemBruta: cmvValor === null ? null : dado.vendas - cmvValor };
  });
  return { anoBase: 2026, meses: lista, total: {} as Projecao["total"] };
}

const fixa = (grupo: LinhaDeGasto["grupo"], nome: string, valor: number): LinhaDeGasto => ({ grupo, nome, modo: "FIXO", valores: Array(12).fill(valor) });

describe("montarResultado", () => {
  it("lucro com vendas de 300 mil, CMV 42%, folha de 90 mil e serviço de 9%", () => {
    const projecao = projecaoCom([{ mes: 3, vendas: 300000, cmv: 0.42 }]);
    // Sem tarifas públicas e dívida, como a planilha de origem.
    const linhas = [fixa("OCUPACAO", "Ocupação", 52000), fixa("FOLHA", "Folha", 90000), fixa("TRIBUTOS", "Tributos", 15000), fixa("CONTRATOS", "Contratos", 3000), fixa("SEGUROS", "Seguros", 500), fixa("TARIFAS_BANCARIAS", "Tarifas", 200), fixa("OUTROS", "Outros", 2000)];
    const r = montarResultado(projecao, linhas, 0.09);
    expect(r.meses[2]?.abatimentoDoServico).toBeCloseTo(27000, 1);
    expect(r.meses[2]?.lucro).toBeCloseTo(38300, 0);
  });

  it("gasto percentual acompanha as vendas do mês", () => {
    const projecao = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }, { mes: 2, vendas: 200000, cmv: 0.4 }]);
    const tributos: LinhaDeGasto = { grupo: "TRIBUTOS", nome: "Tributos", modo: "PERCENTUAL", valores: Array(12).fill(0.1) };
    const r = montarResultado(projecao, [tributos], null);
    expect(r.meses[0]?.gastosPorGrupo.TRIBUTOS).toBe(10000);
    expect(r.meses[1]?.gastosPorGrupo.TRIBUTOS).toBe(20000);
    expect(r.total.gastosTotal).toBe(30000);
  });

  it("o serviço nunca abate mais do que a folha informada, e sem folha não abate nada", () => {
    const projecao = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }]);
    expect(montarResultado(projecao, [fixa("FOLHA", "Folha", 5000)], 0.1).meses[0]?.abatimentoDoServico).toBe(5000);
    expect(montarResultado(projecao, [fixa("OCUPACAO", "Ocupação", 5000)], 0.1).meses[0]?.abatimentoDoServico).toBe(0);
  });

  it("sem % de CMV não há lucro nem equilíbrio, mas os gastos continuam", () => {
    const r = montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: null }]), [fixa("OCUPACAO", "Ocupação", 5000)], null);
    expect(r.meses[0]?.gastosTotal).toBe(5000);
    expect(r.meses[0]?.lucro).toBeNull();
    expect(r.meses[0]?.equilibrioVendas).toBeNull();
    expect(r.total.lucro).toBeNull();
  });

  it("o lucro do ano só aparece quando todos os meses somados têm CMV", () => {
    const projecao = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }, { mes: 2, vendas: 100000, cmv: null }]);
    expect(montarResultado(projecao, [], null).total.lucro).toBeNull();
    const completo = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }, { mes: 2, vendas: 100000, cmv: 0.5 }]);
    expect(montarResultado(completo, [], null).total.lucro).toBe(110000);
  });

  it("mês sem base não tem resultado e fica fora do total", () => {
    const r = montarResultado(projecaoCom([{ mes: 4, vendas: 100000, cmv: 0.4 }]), [fixa("OCUPACAO", "Ocupação", 1000)], null);
    expect(r.meses[0]).toBeNull();
    expect(r.meses[3]).not.toBeNull();
    expect(r.total.gastosTotal).toBe(1000);
  });

  it("ponto de equilíbrio: vendas em que o lucro zera (com percentual e serviço)", () => {
    const linhas: LinhaDeGasto[] = [fixa("OCUPACAO", "Ocupação", 30000), fixa("FOLHA", "Folha", 60000), { grupo: "TRIBUTOS", nome: "Tributos", modo: "PERCENTUAL", valores: Array(12).fill(0.06) }];
    const base = montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4, ticket: 100 }]), linhas, 0.09);
    const equilibrio = base.meses[0]!.equilibrioVendas!;
    // Refaz a conta com vendas = equilíbrio: o lucro deve zerar.
    const noEquilibrio = montarResultado(projecaoCom([{ mes: 1, vendas: equilibrio, cmv: 0.4, ticket: 100 }]), linhas, 0.09);
    expect(noEquilibrio.meses[0]?.lucro).toBeCloseTo(0, 0);
    expect(base.meses[0]?.equilibrioClientes).toBe(Math.round(equilibrio / 100));
  });

  it("equilíbrio respeita o teto do abatimento: serviço não abate mais que a folha", () => {
    // Folha de 10 mil e serviço de 10%: acima de 100 mil de vendas o serviço já abateu a folha inteira.
    const linhas: LinhaDeGasto[] = [fixa("OCUPACAO", "Ocupação", 290000), fixa("FOLHA", "Folha", 10000)];
    const r = montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.35 }]), linhas, 0.1);
    const equilibrio = r.meses[0]!.equilibrioVendas!;
    expect(equilibrio).toBeCloseTo((300000 - 10000) / 0.65, 0);
    const noEquilibrio = montarResultado(projecaoCom([{ mes: 1, vendas: equilibrio, cmv: 0.35 }]), linhas, 0.1);
    expect(noEquilibrio.meses[0]?.lucro).toBeCloseTo(0, 0);
  });

  it("equilíbrio com folha em % menor que o serviço também zera o lucro", () => {
    const linhas: LinhaDeGasto[] = [fixa("OCUPACAO", "Ocupação", 50000), { grupo: "FOLHA", nome: "Folha", modo: "PERCENTUAL", valores: Array(12).fill(0.05) }];
    const r = montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }]), linhas, 0.1);
    const equilibrio = r.meses[0]!.equilibrioVendas!;
    const noEquilibrio = montarResultado(projecaoCom([{ mes: 1, vendas: equilibrio, cmv: 0.4 }]), linhas, 0.1);
    expect(noEquilibrio.meses[0]?.lucro).toBeCloseTo(0, 0);
  });

  it("sem equilíbrio possível quando custo variável come toda a venda", () => {
    const linhas: LinhaDeGasto[] = [fixa("OCUPACAO", "Ocupação", 1000), { grupo: "TRIBUTOS", nome: "Tributos", modo: "PERCENTUAL", valores: Array(12).fill(0.7) }];
    expect(montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }]), linhas, null).meses[0]?.equilibrioVendas).toBeNull();
  });

  it("sem equilíbrio quando, com o serviço já abatido, o custo variável ainda come toda a venda", () => {
    const pct = (grupo: LinhaDeGasto["grupo"], v: number): LinhaDeGasto => ({ grupo, nome: grupo, modo: "PERCENTUAL", valores: Array(12).fill(v) });
    const linhas = [fixa("OCUPACAO", "Ocupação", 70000), fixa("FOLHA", "Folha fixa", 30000), pct("FOLHA", 0.27), pct("TRIBUTOS", 0.19)];
    const r = montarResultado(projecaoCom([{ mes: 1, vendas: 400000, cmv: 0.56 }]), linhas, 0.015);
    expect(r.meses[0]?.equilibrioVendas).toBeNull();
    expect(r.meses[0]?.equilibrioClientes).toBeNull();
  });

  it("equilíbrio com folha fixa e em % juntas: trecho do teto e trecho acima dele zeram o lucro", () => {
    const folhaPct: LinhaDeGasto = { grupo: "FOLHA", nome: "Folha %", modo: "PERCENTUAL", valores: Array(12).fill(0.1) };
    const vender = (vendas: number, linhas: LinhaDeGasto[]) => montarResultado(projecaoCom([{ mes: 1, vendas, cmv: 0.4 }]), linhas, 0.2).meses[0]!;
    // Folha fixa grande: o serviço não chega ao teto, vale o trecho A.
    const a = [fixa("OCUPACAO", "Ocupação", 20000), fixa("FOLHA", "Folha", 10000), folhaPct];
    const eqA = vender(100000, a).equilibrioVendas!;
    expect(eqA).toBeCloseTo(30000 / 0.7, 0);
    expect(vender(eqA, a).lucro).toBeCloseTo(0, 0);
    // Folha fixa pequena: o teto estoura antes do equilíbrio, vale o trecho B.
    const b = [fixa("OCUPACAO", "Ocupação", 20000), fixa("FOLHA", "Folha", 3000), folhaPct];
    const eqB = vender(100000, b).equilibrioVendas!;
    expect(eqB).toBeCloseTo(20000 / 0.6, 0);
    expect(vender(eqB, b).lucro).toBeCloseTo(0, 0);
  });

  it("equilíbrio exatamente no teto do abatimento", () => {
    // Serviço de 10% sobre 100 mil = folha de 10 mil: os dois trechos dão o mesmo ponto.
    const linhas = [fixa("OCUPACAO", "Ocupação", 65000), fixa("FOLHA", "Folha", 10000)];
    const r = montarResultado(projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.35 }]), linhas, 0.1);
    expect(r.meses[0]?.equilibrioVendas).toBeCloseTo(100000, 0);
  });
});

describe("linhasPadrao", () => {
  it("traz uma linha zerada por grupo, com tributos em percentual", () => {
    const linhas = linhasPadrao();
    expect(linhas).toHaveLength(9);
    expect(linhas.every((l) => l.valores.length === 12 && l.valores.every((v) => v === 0))).toBe(true);
    expect(linhas.find((l) => l.grupo === "TRIBUTOS")?.modo).toBe("PERCENTUAL");
    expect(new Set(linhas.map((l) => l.nome)).size).toBe(9);
  });
});
