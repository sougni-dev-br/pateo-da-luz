import { describe, expect, it } from "vitest";
import type { PlanejamentoCaixaPremissas, PlanejamentoLinhaDeGasto, PlanejamentoRealizadoDeCaixa } from "../../../api/client";
import { aplicarRealizadoDeCaixa, type BlocosDoCaixa } from "../realizado-caixa";

const caixa = (): PlanejamentoCaixaPremissas => ({
  saldoInicial: 1000,
  formas: [
    { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
    { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
    { forma: "DEBITO", mix: 0.25, prazoDias: 1, taxa: 0.01 },
    { forma: "CREDITO", mix: 0.3, prazoDias: 30, taxa: 0.03 },
    { forma: "VOUCHER", mix: 0.05, prazoDias: 30, taxa: 0 }
  ],
  comprasPrazoDias: 30,
  herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] }
});
const linha = (grupo: PlanejamentoLinhaDeGasto["grupo"], nome: string, pagoNoMes = 1): PlanejamentoLinhaDeGasto => ({ grupo, nome, modo: "FIXO", valores: Array(12).fill(10), pagoNoMes });
const dados = (): PlanejamentoRealizadoDeCaixa => ({
  ano: 2026,
  mesesParaPrazo: [1, 2, 3],
  mix: { formas: { DINHEIRO: 0.05, PIX: 0.4, DEBITO: 0.2, CREDITO: 0.3, VOUCHER: 0.05 }, base: 1000 },
  comprasPrazoDias: 21,
  comprasCobertura: 0.9,
  pagoNoMes: [
    { grupo: "FOLHA", pagoNoMes: 0.55, mesSeguinte: 0.45, depois: 0, base: 1000 },
    { grupo: "OCUPACAO", pagoNoMes: 0, mesSeguinte: 1, depois: 0, base: 500 },
    { grupo: "SEGUROS", pagoNoMes: null, mesSeguinte: null, depois: null, base: 0 }
  ],
  herdado: { entradas: [100, 50, 0], saidas: [200, 0, 10] },
  avisos: []
});
const tudo = (extra: Partial<BlocosDoCaixa> = {}): BlocosDoCaixa => ({ mix: true, compras: true, pagoNoMes: new Set(["FOLHA", "OCUPACAO", "SEGUROS"] as const), herdado: true, ...extra });

describe("aplicarRealizadoDeCaixa", () => {
  it("aplica mix e prazo das compras sem tocar em prazo e taxa das formas", () => {
    const r = aplicarRealizadoDeCaixa(caixa(), [], dados(), tudo());
    expect(r.caixa.formas.map((f) => f.mix)).toEqual([0.05, 0.4, 0.2, 0.3, 0.05]);
    expect(r.caixa.formas.find((f) => f.forma === "CREDITO")).toMatchObject({ prazoDias: 30, taxa: 0.03 });
    expect(r.caixa.comprasPrazoDias).toBe(21);
    expect(r.caixa.saldoInicial).toBe(1000);
  });

  it("% pago no mês vale para todas as linhas do grupo e só para os grupos marcados", () => {
    const gastos = [linha("FOLHA", "Folha"), linha("FOLHA", "13º"), linha("OCUPACAO", "Ocupação", 1)];
    const r = aplicarRealizadoDeCaixa(caixa(), gastos, dados(), tudo({ pagoNoMes: new Set(["FOLHA"] as const) }));
    expect(r.gastos.filter((g) => g.grupo === "FOLHA").map((g) => g.pagoNoMes)).toEqual([0.55, 0.55]);
    expect(r.gastos.find((g) => g.grupo === "OCUPACAO")?.pagoNoMes).toBe(1);
  });

  it("grupo sem linha ou sem medida não cria nada", () => {
    const r = aplicarRealizadoDeCaixa(caixa(), [linha("FOLHA", "Folha")], dados(), tudo());
    expect(r.gastos).toHaveLength(1);
    expect(r.blocosAplicados).not.toContain("pago:SEGUROS");
    expect(r.blocosAplicados).not.toContain("pago:OCUPACAO");
  });

  it("herdado só entra quando marcado e vem do realizado", () => {
    const com = aplicarRealizadoDeCaixa(caixa(), [], dados(), tudo());
    expect(com.caixa.herdado).toEqual({ entradas: [100, 50, 0], saidas: [200, 0, 10] });
    const sem = aplicarRealizadoDeCaixa(caixa(), [], dados(), tudo({ herdado: false }));
    expect(sem.caixa.herdado.entradas).toEqual([0, 0, 0]);
  });

  it("herdado: se só um lado tem valor no ERP, o outro mantém o que foi digitado", () => {
    const base = caixa();
    base.herdado.entradas = [5, 6, 7];
    const d = { ...dados(), herdado: { entradas: [0, 0, 0], saidas: [200, 0, 10] } };
    const r = aplicarRealizadoDeCaixa(base, [], d, tudo());
    expect(r.caixa.herdado.entradas).toEqual([5, 6, 7]);
    expect(r.caixa.herdado.saidas).toEqual([200, 0, 10]);
  });

  it("sem mix medido ou sem prazo medido, mantém o que o cenário já tinha; não muda as entradas", () => {
    const d = { ...dados(), mix: null, comprasPrazoDias: null };
    const original = caixa();
    const r = aplicarRealizadoDeCaixa(original, [], d, tudo());
    expect(r.caixa.formas).toEqual(original.formas);
    expect(r.caixa.comprasPrazoDias).toBe(30);
    expect(original.formas[0].mix).toBe(0.1);
  });
});
