import { describe, expect, test } from "vitest";
import { divergenciasDoApurado, montarSugestao, vtAposSaida, type VtLancado } from "../rescisao-apuracao.js";
import type { Leg } from "../vt-calc.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// Ônibus SP ida e volta: R$ 5,00 por perna, grátis no domingo.
const ONIBUS: Leg[] = [
  { direction: "IDA", sortOrder: 0, fare: { id: "o", name: "Ônibus SP", amount: 5, sundayAmount: 0 } },
  { direction: "VOLTA", sortOrder: 0, fare: { id: "o", name: "Ônibus SP", amount: 5, sundayAmount: 0 } },
];
const quinzena = (label: string, inicio: string, dias: number[], pago = true): VtLancado =>
  ({ periodLabel: label, periodStart: d(inicio), details: { diasPagos: dias }, pago });

describe("VT pago para depois da saída", () => {
  test("desconta a partir do dia seguinte à saída, não o próprio dia", () => {
    // Setembro/2026: 14 é segunda, 15 terça, 16 quarta.
    const r = vtAposSaida([quinzena("VT 1ª quinzena", "2026-09-01", [12, 14, 15, 16])], d("2026-09-14"), ONIBUS);
    expect(r.dias.map((x) => x.data)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(r.total).toBe(20);
  });

  test("domingo de ônibus grátis não entra no desconto", () => {
    const r = vtAposSaida([quinzena("VT 2ª quinzena", "2026-09-01", [19, 20, 21])], d("2026-09-18"), ONIBUS);
    // 20/09/2026 é domingo.
    expect(r.dias.map((x) => x.data)).toEqual(["2026-09-19", "2026-09-21"]);
    expect(r.total).toBe(20);
  });

  test("lançamento sem a lista de dias fica para conferência manual", () => {
    const r = vtAposSaida([{ periodLabel: "VT antigo", periodStart: d("2026-09-01"), details: null, pago: true }], d("2026-09-10"), ONIBUS);
    expect(r.total).toBe(0);
    expect(r.semDetalhe).toEqual(["VT antigo"]);
  });

  test("o mesmo dia em dois lançamentos desconta uma vez só", () => {
    const r = vtAposSaida([
      quinzena("VT 2ª quinzena", "2026-09-01", [16, 17]),
      quinzena("VT 2ª quinzena (refeito)", "2026-09-01", [17]),
    ], d("2026-09-15"), ONIBUS);
    expect(r.total).toBe(20);
  });

  test("atravessa o mês: quinzena de outubro já paga entra toda", () => {
    const r = vtAposSaida([quinzena("VT out 1ª", "2026-10-01", [1, 2])], d("2026-09-30"), ONIBUS);
    expect(r.dias.map((x) => x.data)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("sugestão para a tela de rescisão", () => {
  const base = {
    saida: "2026-09-14",
    vt: { total: 42.4, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [{ codigo: "VALE-2026-00003", data: "2026-09-05", tipo: "ADIANTAMENTO", descricao: null, valor: 100 }], descontos: 100, creditos: 0, liquido: 100, entraNaRescisao: true },
    gorjeta: { periodo: "Setembro 2026", status: "OPEN" as const, pontos: 3.5, valorPonto: 147.51, gorjeta: 516.29, pendente: false, diasSalario: 20, salarioProporcional: 1466.67 },
    gorjetaObservacao: null,
    jaPagoNaLista: null,
    adiantamento: null,
  };

  test("sem registro: salário, gorjeta e vales vêm separados; o bruto é a soma", () => {
    const s = montarSugestao({ ...base, semRegistro: true });
    expect(s).toMatchObject({ salario: 1466.67, gorjeta: 516.29, vales: 100, vtDesconto: 42.4, bruto: 1982.96 });
    expect(s.valesRotulo).toContain("VALE-2026-00003");
  });

  test("CLT: bruto e gorjeta vêm da contabilidade e os vales já saíram da gorjeta; só o VT", () => {
    const s = montarSugestao({ ...base, semRegistro: false, vales: { ...base.vales, entraNaRescisao: false } });
    expect(s).toMatchObject({ salario: null, gorjeta: null, vales: 0, vtDesconto: 42.4, bruto: null });
  });

  test("gorjeta pendente: traz o salário, mas não inventa gorjeta nem bruto", () => {
    const s = montarSugestao({ ...base, semRegistro: true, gorjeta: { ...base.gorjeta, pendente: true } });
    expect(s.salario).toBe(1466.67);
    expect(s.gorjeta).toBeNull();
    expect(s.bruto).toBeNull();
  });

  test("crédito da aba Vales soma ao bruto em vez de sumir", () => {
    const s = montarSugestao({ ...base, semRegistro: true, vales: { ...base.vales, itens: [], descontos: 0, creditos: 50, liquido: -50 } });
    expect(s.vales).toBe(0);
    expect(s.bruto).toBe(2032.96);
  });
});

describe("ajuste manual contra o apurado", () => {
  const sugestao = { salario: 1466.67, gorjeta: 516.29, creditos: 0, vales: 100, valesRotulo: null, adiantamento: 0, vtDesconto: 42.4, bruto: 1982.96 };

  test("igual ao apurado: nada a justificar", () => {
    expect(divergenciasDoApurado(sugestao, { salario: 1466.67, gorjeta: 516.29, vales: 100, vtDesconto: 42.4 })).toEqual([]);
  });

  test("aponta cada parte mudada: gorjeta e vales, com apurado, lançado e diferença", () => {
    const d = divergenciasDoApurado(sugestao, { salario: 1466.67, gorjeta: 400, vales: 0, vtDesconto: 42.4 });
    expect(d.map((x) => x.campo)).toEqual(["gorjeta", "vales"]);
    expect(d[0]).toMatchObject({ apurado: 516.29, lancado: 400, diferenca: -116.29 });
  });

  test("CLT: só o VT conta; bruto e gorjeta são da contabilidade", () => {
    const clt = { ...sugestao, salario: null, gorjeta: null, vales: 0, bruto: null };
    expect(divergenciasDoApurado(clt, { salario: null, gorjeta: null, vales: 0, vtDesconto: 42.4 })).toEqual([]);
    expect(divergenciasDoApurado(clt, { salario: null, gorjeta: null, vales: 0, vtDesconto: 0 }).map((x) => x.campo)).toEqual(["vtDesconto"]);
  });

  test("sem apuração (sem data de saída) não cobra justificativa", () => {
    expect(divergenciasDoApurado(null, { salario: 1, gorjeta: 1, vales: 0, vtDesconto: 0 })).toEqual([]);
  });
});
