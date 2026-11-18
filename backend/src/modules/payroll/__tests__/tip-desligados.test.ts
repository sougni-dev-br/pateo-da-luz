import { describe, expect, test } from "vitest";
import { desligadosParaLimpar, motivoDaLimpeza, podeLimparParticipa, type PeriodoDeGorjeta } from "../tip-desligados.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const per = (ini: string, fim: string, status: "OPEN" | "CLOSED"): PeriodoDeGorjeta => ({ periodStart: d(ini), periodEnd: d(fim), status });

const SETEMBRO = per("2026-08-26", "2026-09-25", "CLOSED");
const OUTUBRO = per("2026-09-26", "2026-10-25", "CLOSED");
const NOVEMBRO = per("2026-10-26", "2026-11-25", "OPEN");

describe("podeLimparParticipa", () => {
  test("saiu em ciclo já fechado: pode limpar", () => {
    expect(podeLimparParticipa(d("2026-09-17"), [SETEMBRO, OUTUBRO, NOVEMBRO])).toBe(true);
  });
  test("saiu em ciclo ainda aberto: não limpa (o ciclo ainda precisa dele)", () => {
    expect(podeLimparParticipa(d("2026-11-03"), [SETEMBRO, OUTUBRO, NOVEMBRO])).toBe(false);
  });
  test("o limite do ciclo vale nos dois extremos", () => {
    expect(podeLimparParticipa(d("2026-10-26"), [OUTUBRO, NOVEMBRO])).toBe(false);
    expect(podeLimparParticipa(d("2026-10-25"), [OUTUBRO, NOVEMBRO])).toBe(true);
  });
  test("saída de antes do primeiro ciclo do sistema: pode limpar", () => {
    expect(podeLimparParticipa(d("2025-01-10"), [SETEMBRO])).toBe(true);
  });
  test("saída depois do último ciclo existente (ciclo ainda não criado): não limpa", () => {
    expect(podeLimparParticipa(d("2026-11-26"), [SETEMBRO, OUTUBRO, NOVEMBRO])).toBe(false);
    expect(podeLimparParticipa(d("2026-12-30"), [SETEMBRO, OUTUBRO, NOVEMBRO])).toBe(false);
  });
  test("saída em buraco entre ciclos (sem período cobrindo) depois do primeiro: não limpa", () => {
    expect(podeLimparParticipa(d("2026-09-27"), [SETEMBRO, per("2026-10-26", "2026-11-25", "CLOSED")])).toBe(false);
  });
  test("sem nenhum ciclo no sistema: pode limpar", () => {
    expect(podeLimparParticipa(d("2026-09-17"), [])).toBe(true);
  });
  test("ciclo da saída reaberto: não limpa até fechar de novo", () => {
    expect(podeLimparParticipa(d("2026-09-17"), [per("2026-08-26", "2026-09-25", "OPEN")])).toBe(false);
  });
});

describe("desligadosParaLimpar", () => {
  test("separa os que podem dos que o ciclo aberto ainda precisa", () => {
    const r = desligadosParaLimpar([
      { employeeId: "a", nome: "Analia", terminationDate: d("2026-09-17") },
      { employeeId: "b", nome: "Recente", terminationDate: d("2026-11-03") },
    ], [SETEMBRO, OUTUBRO, NOVEMBRO]);
    expect(r.map((x) => x.employeeId)).toEqual(["a"]);
  });
  test("motivo do histórico traz a data da saída", () => {
    expect(motivoDaLimpeza(d("2026-09-17"))).toContain("17/09/2026");
  });
});
