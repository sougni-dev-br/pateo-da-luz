import { describe, expect, it } from "vitest";
import { coberturaDoPrazo, mesesMadurosParaPrazo, montarMix, montarPagoNoMes, prazoMedioDasCompras } from "../planejamento-realizado-caixa.js";

describe("montarMix", () => {
  it("vira fração e soma exatamente 100% (o resto do arredondamento vai para a maior parcela)", () => {
    const m = montarMix({ DINHEIRO: 1, PIX: 1, DEBITO: 1, CREDITO: 1, VOUCHER: 0 });
    expect(m).not.toBeNull();
    const soma = Object.values(m!.formas).reduce((s, v) => s + v, 0);
    expect(Math.abs(soma - 1)).toBeLessThan(1e-9);
    expect(m!.formas.VOUCHER).toBe(0);
    expect(m!.base).toBe(4);
  });

  it("terço em três formas: o resto de 0,0001 vai para a maior parcela e a soma fecha em 1", () => {
    const m = montarMix({ DINHEIRO: 1, PIX: 1, DEBITO: 1, CREDITO: 0, VOUCHER: 0 });
    const f = m!.formas;
    expect(f.DINHEIRO).toBe(0.3334);
    expect(f.PIX).toBe(0.3333);
    expect(f.DEBITO).toBe(0.3333);
    expect(Math.round((f.DINHEIRO + f.PIX + f.DEBITO + f.CREDITO + f.VOUCHER) * 10000)).toBe(10000);
  });

  it("empate de maior parcela: o resto fica com a primeira forma da lista", () => {
    const m = montarMix({ DINHEIRO: 0, PIX: 1, DEBITO: 0, CREDITO: 1, VOUCHER: 1 });
    expect(m!.formas.PIX).toBe(0.3334);
    expect(m!.formas.CREDITO).toBe(0.3333);
    expect(m!.formas.VOUCHER).toBe(0.3333);
  });

  it("mix de valores reais mantém as proporções", () => {
    const m = montarMix({ DINHEIRO: 10000, PIX: 30000, DEBITO: 25000, CREDITO: 30000, VOUCHER: 5000 });
    expect(m!.formas.PIX).toBe(0.3);
    expect(m!.formas.DINHEIRO).toBe(0.1);
    expect(m!.base).toBe(100000);
  });

  it("sem venda paga não há mix; valor negativo (estorno) não vira parcela negativa", () => {
    expect(montarMix({ DINHEIRO: 0, PIX: 0, DEBITO: 0, CREDITO: 0, VOUCHER: 0 })).toBeNull();
    const m = montarMix({ DINHEIRO: -50, PIX: 100, DEBITO: 0, CREDITO: 0, VOUCHER: 0 });
    expect(m!.formas.DINHEIRO).toBe(0);
    expect(m!.formas.PIX).toBe(1);
  });
});

describe("montarPagoNoMes", () => {
  it("mede a parte paga no mês, no seguinte e depois, por grupo", () => {
    const r = montarPagoNoMes([
      { grupo: "OCUPACAO", defasagem: 1, total: 50000 },
      { grupo: "FOLHA", defasagem: 0, total: 40000 },
      { grupo: "FOLHA", defasagem: 1, total: 50000 },
      { grupo: "FOLHA", defasagem: 2, total: 10000 }
    ]);
    const folha = r.find((g) => g.grupo === "FOLHA")!;
    expect(folha.pagoNoMes).toBe(0.4);
    expect(folha.mesSeguinte).toBe(0.5);
    expect(folha.depois).toBe(0.1);
    expect(folha.base).toBe(100000);
    expect(r.find((g) => g.grupo === "OCUPACAO")?.pagoNoMes).toBe(0);
  });

  it("pagamento adiantado (defasagem negativa) conta como pago no mês", () => {
    const r = montarPagoNoMes([{ grupo: "OUTROS", defasagem: -1, total: 100 }, { grupo: "OUTROS", defasagem: 0, total: 100 }]);
    expect(r[0].pagoNoMes).toBe(1);
  });

  it("agrupa linhas do mesmo grupo vindas de fontes diferentes e ignora total zero", () => {
    const r = montarPagoNoMes([{ grupo: "OUTROS", defasagem: 0, total: 30 }, { grupo: "OUTROS", defasagem: 1, total: 70 }, { grupo: "SEGUROS", defasagem: 0, total: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].pagoNoMes).toBe(0.3);
  });
});

describe("prazoMedioDasCompras e meses maduros", () => {
  it("média ponderada em dias, dentro de 0 a 90", () => {
    expect(prazoMedioDasCompras(30 * 100 + 10 * 100, 200)).toBe(20);
    expect(prazoMedioDasCompras(500 * 100, 100)).toBe(90);
    expect(prazoMedioDasCompras(0, 0)).toBeNull();
  });

  it("ano corrente só conta meses até dois antes do atual; ano passado todos", () => {
    expect(mesesMadurosParaPrazo(2026, "2026-11-23")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(mesesMadurosParaPrazo(2026, "2026-02-10")).toEqual([]);
    expect(mesesMadurosParaPrazo(2025, "2026-11-23")).toHaveLength(12);
    expect(mesesMadurosParaPrazo(2027, "2026-11-23")).toEqual([]);
  });

  it("na virada do ano, só dezembro do ano anterior ainda não está maduro", () => {
    expect(mesesMadurosParaPrazo(2026, "2027-01-15")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(mesesMadurosParaPrazo(2026, "2027-02-01")).toHaveLength(12);
  });

  it("cobertura do prazo: valor medido ÷ valor das compras, no máximo 100%", () => {
    expect(coberturaDoPrazo(60, 100)).toBe(0.6);
    expect(coberturaDoPrazo(120, 100)).toBe(1);
    expect(coberturaDoPrazo(10, 0)).toBeNull();
  });
});
