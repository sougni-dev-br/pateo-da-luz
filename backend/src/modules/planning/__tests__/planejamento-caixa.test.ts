import { describe, expect, it } from "vitest";
import { caixaPadrao, distribuicaoPorPrazo, montarCaixa, type CaixaPremissas } from "../planejamento-caixa.js";
import { montarResultado, type LinhaDeGasto } from "../planejamento-gastos.js";
import type { MesProjetado, Projecao, Turnos } from "../planejamento-projecao.js";

const turnos = (total: number): Turnos => ({ almoco: total, jantar: 0, total });

/** Projeção com os meses informados; os outros ficam sem base. */
function projecaoCom(meses: { mes: number; vendas: number; cmv: number | null }[]): Projecao {
  const lista: MesProjetado[] = Array.from({ length: 12 }, (_, i) => {
    const d = meses.find((m) => m.mes === i + 1);
    if (!d) return { mes: i + 1, motivoSemBase: "SEM_DADO", base: null, projetado: null, cmvPercentual: null, cmvValor: null, margemBruta: null };
    const g = { clientes: turnos(100), ticket: turnos(100), vendas: turnos(d.vendas) };
    const cmvValor = d.cmv === null ? null : d.vendas * d.cmv;
    return { mes: i + 1, motivoSemBase: null, base: g, projetado: g, cmvPercentual: d.cmv, cmvValor, margemBruta: cmvValor === null ? null : d.vendas - cmvValor };
  });
  return { anoBase: 2026, meses: lista, total: {} as Projecao["total"] };
}

const fixa = (grupo: LinhaDeGasto["grupo"], nome: string, valor: number, pagoNoMes = 1): LinhaDeGasto => ({ grupo, nome, modo: "FIXO", valores: Array(12).fill(valor), pagoNoMes });

/** Tudo recebido e pago no mesmo mês: o caixa tem de coincidir com a competência. */
const aVista = (): CaixaPremissas => ({
  ...caixaPadrao(),
  formas: caixaPadrao().formas.map((f) => ({ ...f, prazoDias: 0, taxa: 0 })),
  comprasPrazoDias: 0
});
const soPix = (prazoDias: number, taxa = 0): CaixaPremissas => ({
  ...caixaPadrao(),
  formas: caixaPadrao().formas.map((f) => ({ ...f, mix: f.forma === "PIX" ? 1 : 0, prazoDias: f.forma === "PIX" ? prazoDias : 0, taxa: f.forma === "PIX" ? taxa : 0 })),
  comprasPrazoDias: 0
});

const caixa = (p: Projecao, linhas: LinhaDeGasto[], premissas: CaixaPremissas, servico: number | null = null) => montarCaixa(p, montarResultado(p, linhas, servico), linhas, premissas);

describe("distribuicaoPorPrazo", () => {
  it("à vista fica no mês; 30 dias cai inteiro no seguinte; 15 e 45 dias dividem", () => {
    expect(distribuicaoPorPrazo(0).slice(0, 3)).toEqual([1, 0, 0]);
    expect(distribuicaoPorPrazo(30).slice(0, 3)).toEqual([0, 1, 0]);
    expect(distribuicaoPorPrazo(15).slice(0, 3)).toEqual([0.5, 0.5, 0]);
    expect(distribuicaoPorPrazo(45).slice(0, 3)).toEqual([0, 0.5, 0.5]);
  });

  it("sempre soma 100% até 90 dias", () => {
    for (const dias of [0, 1, 7, 29, 30, 31, 59, 60, 90]) {
      expect(distribuicaoPorPrazo(dias).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    }
  });
});

describe("montarCaixa", () => {
  it("sem prazo nenhum o resultado de caixa é o lucro em competência, mês a mês", () => {
    const p = projecaoCom([1, 2, 3].map((mes) => ({ mes, vendas: 100000, cmv: 0.4 })));
    const linhas = [fixa("OCUPACAO", "Ocupação", 20000), fixa("FOLHA", "Folha", 30000)];
    const resultado = montarResultado(p, linhas, 0.1);
    const c = montarCaixa(p, resultado, linhas, aVista());
    for (const mes of [1, 2, 3]) {
      expect(c.meses[mes - 1]?.resultado).toBeCloseTo(resultado.meses[mes - 1]!.lucro!, 1);
      expect(c.meses[mes - 1]?.diferencaParaCompetencia).toBeCloseTo(0, 1);
    }
  });

  it("recebimento a 30 dias empurra a entrada para o mês seguinte", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }, { mes: 2, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [], soPix(30));
    expect(c.meses[0]?.entradas).toBe(0);
    expect(c.meses[1]?.entradas).toBe(100000);
  });

  it("a taxa da forma reduz o que entra", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }]);
    expect(caixa(p, [], soPix(0, 0.02)).meses[0]?.entradas).toBe(98000);
  });

  it("gasto com 0% pago no mês sai só no mês seguinte; o de janeiro sai em fevereiro", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }, { mes: 2, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [fixa("TRIBUTOS", "Tributos", 10000, 0)], aVista());
    expect(c.meses[0]?.saidasGastos).toBe(0);
    expect(c.meses[1]?.saidasGastos).toBe(10000);
  });

  it("40% no mês e 60% no seguinte: o mês seguinte paga os dois pedaços", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }, { mes: 2, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [fixa("FOLHA", "Folha", 50000, 0.4)], aVista());
    expect(c.meses[0]?.saidasGastos).toBe(20000);
    expect(c.meses[1]?.saidasGastos).toBe(20000 + 30000);
  });

  it("o CMV vira compras pagas com o prazo dos fornecedores", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }, { mes: 2, vendas: 100000, cmv: 0.4 }]);
    const c = caixa(p, [], { ...aVista(), comprasPrazoDias: 30 });
    expect(c.meses[0]?.saidasCompras).toBe(0);
    expect(c.meses[1]?.saidasCompras).toBe(40000);
  });

  it("o serviço abate só a folha, também no caixa", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }]);
    const linhas = [fixa("FOLHA", "Folha", 30000), fixa("OCUPACAO", "Ocupação", 10000)];
    // Serviço de 10% sobre 100 mil = 10 mil abatem a folha: folha líquida 20 mil + ocupação 10 mil.
    expect(caixa(p, linhas, aVista(), 0.1).meses[0]?.saidasGastos).toBe(30000);
  });

  it("recebíveis e contas a pagar herdados entram nos primeiros meses e no saldo", () => {
    const p = projecaoCom([{ mes: 1, vendas: 0, cmv: 0 }, { mes: 2, vendas: 0, cmv: 0 }]);
    const premissas: CaixaPremissas = { ...aVista(), saldoInicial: 5000, herdado: { entradas: [8000, 2000, 0], saidas: [3000, 0, 0] } };
    const c = caixa(p, [], premissas);
    expect(c.meses[0]?.entradas).toBe(8000);
    expect(c.meses[0]?.saidasGastos).toBe(3000);
    expect(c.meses[0]?.saldo).toBe(10000);
    expect(c.meses[1]?.saldo).toBe(12000);
  });

  it("saldo acumulado, menor saldo e necessidade de capital de giro", () => {
    const p = projecaoCom([{ mes: 1, vendas: 10000, cmv: 0 }, { mes: 2, vendas: 10000, cmv: 0 }, { mes: 3, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [fixa("OCUPACAO", "Ocupação", 30000)], { ...aVista(), saldoInicial: 5000 });
    expect(c.meses.slice(0, 3).map((m) => m?.saldo)).toEqual([-15000, -35000, 35000]);
    expect(c.total.menorSaldo).toEqual({ mes: 2, valor: -35000 });
    expect(c.total.necessidadeDeCapital).toBe(35000);
    expect(c.total.saldoFinal).toBe(35000);
  });

  it("caixa que nunca fica negativo não pede capital de giro", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }]);
    expect(caixa(p, [], aVista()).total.necessidadeDeCapital).toBe(0);
  });

  it("mês sem base interrompe a conta: os seguintes ficam em branco, sem inventar", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }, { mes: 2, vendas: 100000, cmv: 0 }, { mes: 4, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [], aVista());
    expect(c.mesesCalculados).toEqual([1, 2]);
    expect(c.meses[2]).toBeNull();
    expect(c.meses[3]).toBeNull();
  });

  it("sem CMV nas compras que vencem num mês, esse mês e o saldo adiante ficam em branco", () => {
    // Prazo de 30 dias: março paga o CMV de fevereiro, que não foi definido.
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0.4 }, { mes: 2, vendas: 100000, cmv: null }, { mes: 3, vendas: 100000, cmv: 0.4 }]);
    const c = caixa(p, [], { ...aVista(), comprasPrazoDias: 30 });
    expect(c.meses[1]?.saldo).not.toBeNull();
    expect(c.meses[2]).toBeNull();
    expect(c.total.saldoFinal).toBeNull();
    expect(c.total.menorSaldo).toBeNull();
    expect(c.total.necessidadeDeCapital).toBeNull();
    // Um mês no meio ficou de fora: a soma teria buraco, então não é apresentada como total.
    expect(c.total.resultado).toBeNull();
    expect(c.total.entradas).toBeNull();
  });

  it("meses finais sem base não anulam o total dos calculados (jan–out é o caso comum)", () => {
    const p = projecaoCom([{ mes: 1, vendas: 100000, cmv: 0 }, { mes: 2, vendas: 100000, cmv: 0 }]);
    const c = caixa(p, [], aVista());
    expect(c.mesesCalculados).toEqual([1, 2]);
    expect(c.total.resultado).toBe(200000);
    expect(c.total.saldoFinal).toBe(200000);
  });

  it("padrão: cinco formas somando 100%", () => {
    const padrao = caixaPadrao();
    expect(padrao.formas).toHaveLength(5);
    expect(padrao.formas.reduce((s, f) => s + f.mix, 0)).toBeCloseTo(1, 9);
  });
});
