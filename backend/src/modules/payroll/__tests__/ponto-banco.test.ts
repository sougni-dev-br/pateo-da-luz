import { describe, expect, test } from "vitest";
import { fecharBanco, resumirFechamento } from "../ponto-banco.js";
import { apurarPeriodo } from "../ponto-calc.js";

describe("fecharBanco — extra abate o atraso antes de ser paga", () => {
  test("extra maior que a dívida: abate tudo e paga o resto", () => {
    const r = fecharBanco({ saldoInicialMin: 0, atrasoMin: 60, debitoFolgaMin: 0, extraMin: 150 });
    expect(r.abatidoMin).toBe(60);
    expect(r.extraAPagarMin).toBe(90);
    expect(r.saldoFinalMin).toBe(0);
    expect(r.devendo).toBe(false);
  });

  test("extra menor que a dívida: não paga nada e o resto continua devendo", () => {
    const r = fecharBanco({ saldoInicialMin: 0, atrasoMin: 120, debitoFolgaMin: 0, extraMin: 45 });
    expect(r.abatidoMin).toBe(45);
    expect(r.extraAPagarMin).toBe(0);
    expect(r.saldoFinalMin).toBe(-75);
    expect(r.devendo).toBe(true);
  });

  test("sem atraso: paga a extra inteira", () => {
    const r = fecharBanco({ saldoInicialMin: 0, atrasoMin: 0, debitoFolgaMin: 0, extraMin: 90 });
    expect(r.extraAPagarMin).toBe(90);
    expect(r.saldoFinalMin).toBe(0);
  });

  test("dívida que vem do mês anterior também é abatida", () => {
    const r = fecharBanco({ saldoInicialMin: -100, atrasoMin: 20, debitoFolgaMin: 0, extraMin: 60 });
    expect(r.abatidoMin).toBe(60);
    expect(r.extraAPagarMin).toBe(0);
    expect(r.saldoFinalMin).toBe(-60);
  });

  test("folga tirada contra o banco entra como débito", () => {
    const r = fecharBanco({ saldoInicialMin: 0, atrasoMin: 0, debitoFolgaMin: 480, extraMin: 100 });
    expect(r.abatidoMin).toBe(100);
    expect(r.saldoFinalMin).toBe(-380);
  });

  test("com crédito antigo, o atraso do mês desconta do crédito e a extra do mês é paga inteira (regra a confirmar com o dono)", () => {
    const r = fecharBanco({ saldoInicialMin: 200, atrasoMin: 30, debitoFolgaMin: 0, extraMin: 60 });
    expect(r.abatidoMin).toBe(0);
    expect(r.extraAPagarMin).toBe(60);
    expect(r.saldoFinalMin).toBe(170);
  });
});

describe("resumirFechamento", () => {
  const dia = (data: string, marcacoes: string[], previstoMin = 480) => ({ data, marcacoes, previstoMin });

  test("junta falta, noturno, descanso e banco num resumo por pessoa", () => {
    const periodo = apurarPeriodo([
      dia("2026-10-05", ["08:00", "12:00", "13:00", "18:00"]), // +60 extra
      dia("2026-10-06", ["09:00", "12:00", "13:00", "17:00"]), // 60 atraso
      dia("2026-10-07", []), // falta
      dia("2026-10-08", ["20:00", "02:00"], 360), // 240 noturno
      dia("2026-10-04", ["10:00", "14:00"], 0), // domingo, 240 descanso
    ]);
    const r = resumirFechamento(periodo, { saldoInicialMin: 0, debitoFolgaMin: 0 });
    expect(r.faltas).toBe(1);
    expect(r.noturnoMin).toBe(240);
    expect(r.extraDescansoMin).toBe(0);
    expect(r.atrasoMin).toBe(60);
    expect(r.abatidoMin).toBe(60); // o domingo (240) agora é extra comum: abate os 60 de atraso
    expect(r.extraAPagarMin).toBe(240);
    expect(r.saldoBancoFinalMin).toBe(0);
    expect(r.devendo).toBe(false);
  });

  test("conta os dias com aviso para conferência", () => {
    const periodo = apurarPeriodo([dia("2026-10-05", ["08:00", "12:00", "13:00"]), dia("2026-10-06", ["08:00", "12:00"])]);
    expect(resumirFechamento(periodo, { saldoInicialMin: 0, debitoFolgaMin: 0 }).diasComAviso).toBe(1);
  });
});
