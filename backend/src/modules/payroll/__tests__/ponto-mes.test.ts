import { describe, expect, test } from "vitest";
import { apurarMesPessoa, diasDoMes, type MesPessoaParams } from "../ponto-mes.js";

const jornada = { jornadaInicio: "08:00", jornadaFim: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" };
const dia8h = ["08:00", "12:00", "13:00", "17:00"];

const base = (extra: Partial<MesPessoaParams> = {}): MesPessoaParams => ({
  year: 2026,
  month: 10,
  jornada,
  batidasPorDia: new Map(),
  escalaPorDia: new Map(),
  feriados: new Set(),
  admissao: null,
  desligamento: null,
  saldoInicialMin: 0,
  ...extra,
});

describe("diasDoMes", () => {
  test("outubro tem 31 dias e fevereiro bissexto 29", () => {
    expect(diasDoMes(2026, 10)).toHaveLength(31);
    expect(diasDoMes(2028, 2)).toHaveLength(29);
    expect(diasDoMes(2026, 10)[0]).toBe("2026-10-01");
  });
});

describe("apurarMesPessoa", () => {
  test("fora da escala, o dia lançado como turno sem batida é falta e os dias sem lançamento só avisam", () => {
    const r = apurarMesPessoa(
      base({
        naEscala: false,
        batidasPorDia: new Map([["2026-10-05", dia8h]]),
        escalaPorDia: new Map([
          ["2026-10-05", "TURNO"],
          ["2026-10-06", "TURNO"],
        ]),
      }),
    );
    expect(r.semJornada).toBe(false);
    expect(r.resumo.faltas).toBe(1);
    expect(r.avisosDia.some((a) => a.avisos.includes("Dia sem lançamento na escala."))).toBe(true);
  });

  test("folga na escala com trabalho vira extra", () => {
    const r = apurarMesPessoa(
      base({
        batidasPorDia: new Map([["2026-10-06", ["10:00", "14:00"]]]),
        escalaPorDia: new Map([["2026-10-06", "FOLGA"]]),
      }),
    );
    expect(r.periodo.extraMin).toBe(240);
  });

  test("feriado trabalhado em folga conta como extra comum", () => {
    const r = apurarMesPessoa(
      base({
        batidasPorDia: new Map([["2026-10-12", ["10:00", "14:00"]]]),
        escalaPorDia: new Map([["2026-10-12", "FOLGA"]]),
        feriados: new Set(["10-12"]),
      }),
    );
    expect([r.resumo.extraDescansoMin, r.periodo.extraMin]).toEqual([0, 240]);
  });

  test("não conta dias antes da admissão nem depois do desligamento", () => {
    const r = apurarMesPessoa(
      base({
        admissao: "2026-10-10",
        desligamento: "2026-10-20",
        escalaPorDia: new Map(
          diasDoMes(2026, 10).map((d) => [d, "TURNO"] as const),
        ),
      }),
    );
    expect(r.periodo.dias).toHaveLength(11);
    expect(r.resumo.faltas).toBe(11);
  });

  test("folga contra o banco debita o saldo e a extra do mês abate a dívida", () => {
    const r = apurarMesPessoa(
      base({
        batidasPorDia: new Map([["2026-10-05", ["08:00", "12:00", "13:00", "19:00"]]]),
        escalaPorDia: new Map([
          ["2026-10-05", "TURNO"],
          ["2026-10-06", "FOLGA_BANCO_HORAS"],
        ]),
      }),
    );
    expect(r.debitoFolgaMin).toBe(480);
    expect(r.resumo.abatidoMin).toBe(120);
    expect(r.resumo.saldoBancoFinalMin).toBe(-360);
    expect(r.resumo.devendo).toBe(true);
  });

  test("dias depois de 'ate' não geram falta", () => {
    const r = apurarMesPessoa(
      base({
        ate: "2026-10-10",
        escalaPorDia: new Map(diasDoMes(2026, 10).map((d) => [d, "TURNO"] as const)),
      }),
    );
    expect(r.periodo.dias).toHaveLength(10);
    expect(r.resumo.faltas).toBe(10);
  });

  test("mês montado na Escala: dia sem marca vale como dia trabalhado e sem batida vira falta", () => {
    const r = apurarMesPessoa(
      base({
        ate: "2026-10-09",
        escalaPorDia: new Map([["2026-10-04", "FOLGA"]]),
        batidasPorDia: new Map([["2026-10-05", dia8h]]),
      }),
    );
    expect(r.mesMontado).toBe(true);
    // 01–03 e 06–09 sem marca nem batida = 7 faltas; 04 é folga; 05 trabalhou.
    expect(r.resumo.faltas).toBe(7);
    expect(r.avisosDia).toEqual([]);
  });

  test("sem nenhuma marca no mês, a escala não foi montada: nada vira falta", () => {
    const r = apurarMesPessoa(base({ ate: "2026-10-09" }));
    expect(r.mesMontado).toBe(false);
    expect(r.resumo.faltas).toBe(0);
  });

  test("sem jornada cadastrada devolve semJornada e não apura", () => {
    const r = apurarMesPessoa(base({ jornada: { jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null } }));
    expect(r.semJornada).toBe(true);
    expect(r.periodo.dias).toHaveLength(0);
  });

  test("dia sem lançamento na escala aparece na lista mas não conta como dia para conferir", () => {
    const r = apurarMesPessoa(base({ batidasPorDia: new Map([["2026-10-05", dia8h]]) }));
    expect(r.avisosDia.length).toBeGreaterThan(0);
    expect(r.resumo.diasComAviso).toBe(0);
  });
});
