import { describe, expect, it } from "vitest";
import { avaliarHabitualidade } from "../extras-calc.js";

const LIMITES = { porSemana: 3, em30Dias: 8, semanasSeguidas: 4 };

describe("avaliarHabitualidade", () => {
  it("poucas diárias espalhadas não acendem nada", () => {
    const r = avaliarHabitualidade(["2026-09-05", "2026-09-19"], "2026-09-30", LIMITES);
    // A semana passada ficou sem diária: a sequência atual é zero.
    expect(r).toMatchObject({ diasUltimos30: 2, maiorSemana: 1, semanasSeguidas: 0, emRisco: false, motivos: [] });
  });

  it("3 dias na mesma semana (seg–dom) acende", () => {
    // 21/09/2026 é segunda; 25 sex, 26 sáb, 27 dom
    const r = avaliarHabitualidade(["2026-09-25", "2026-09-26", "2026-09-27"], "2026-09-30", LIMITES);
    expect(r.maiorSemana).toBe(3);
    expect(r.semanaDaMaior).toBe("2026-09-21");
    expect(r.emRisco).toBe(true);
    expect(r.motivos).toEqual(["3 dias na semana de 21/09"]);
  });

  it("domingo e a segunda seguinte são semanas diferentes", () => {
    const r = avaliarHabitualidade(["2026-09-26", "2026-09-27", "2026-09-28"], "2026-09-30", LIMITES);
    expect(r.maiorSemana).toBe(2);
  });

  it("8 dias em 30 acende, mesmo sem semana cheia", () => {
    const dias = ["2026-09-02", "2026-09-05", "2026-09-09", "2026-09-12", "2026-09-16", "2026-09-19", "2026-09-23", "2026-09-26"];
    const r = avaliarHabitualidade(dias, "2026-09-30", LIMITES);
    expect(r.diasUltimos30).toBe(8);
    expect(r.motivos).toContain("8 dias em 30 dias");
    expect(r.emRisco).toBe(true);
  });

  it("dia fora da janela de 30 não conta", () => {
    expect(avaliarHabitualidade(["2026-08-31", "2026-09-30"], "2026-09-30", LIMITES).diasUltimos30).toBe(1);
  });

  it("4 semanas seguidas com diária acende (regularidade)", () => {
    const r = avaliarHabitualidade(["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"], "2026-09-30", LIMITES);
    expect(r.semanasSeguidas).toBe(4);
    expect(r.motivos).toEqual(["4 semanas seguidas"]);
  });

  it("semana vazia no meio quebra a sequência", () => {
    expect(avaliarHabitualidade(["2026-09-05", "2026-09-19", "2026-09-26"], "2026-09-30", LIMITES).semanasSeguidas).toBe(2);
  });

  it("diária prevista no futuro entra: avisa antes de acontecer", () => {
    const r = avaliarHabitualidade(["2026-09-29", "2026-10-02", "2026-10-03"], "2026-09-30", LIMITES);
    expect(r.maiorSemana).toBe(3);
    expect(r.emRisco).toBe(true);
  });

  it("sem diárias", () => {
    expect(avaliarHabitualidade([], "2026-09-30", LIMITES)).toMatchObject({ diasUltimos30: 0, maiorSemana: 0, semanasSeguidas: 0, emRisco: false });
  });

  it("datas repetidas contam uma vez", () => {
    expect(avaliarHabitualidade(["2026-09-25", "2026-09-25"], "2026-09-30", LIMITES).diasUltimos30).toBe(1);
  });

  it("prevista distante não apaga o aviso de hoje", () => {
    const setembro = ["2026-09-02", "2026-09-05", "2026-09-09", "2026-09-12", "2026-09-16", "2026-09-19", "2026-09-23", "2026-09-26"];
    const r = avaliarHabitualidade([...setembro, "2026-12-15"], "2026-09-30", LIMITES);
    expect(r.emRisco).toBe(true);
    expect(r.diasUltimos30).toBe(8);
  });

  it("dia pedido no passado também é olhado (simulação)", () => {
    const r = avaliarHabitualidade(["2026-08-03", "2026-08-04", "2026-08-05"], "2026-09-30", LIMITES, ["2026-08-05"]);
    expect(r.motivos).toContain("3 dias na semana de 03/08");
  });

  it("empate entre semanas cita a mais recente", () => {
    const r = avaliarHabitualidade(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"], "2026-09-30", { ...LIMITES, porSemana: 2 });
    expect(r.semanaDaMaior).toBe("2026-09-28");
    expect(r.motivos).toContain("2 dias na semana de 28/09");
  });
});
