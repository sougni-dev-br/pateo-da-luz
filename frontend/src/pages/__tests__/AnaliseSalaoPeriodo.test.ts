import { describe, expect, test } from "vitest";
import { isoLocal, periodoDoPreset, periodoValido, pontos } from "../analise-salao/periodo";

const hoje = new Date(2026, 9, 13, 10, 0, 0); // 13/10/2026, horário local

describe("periodoDoPreset", () => {
  test("últimos 30 dias conta o dia de hoje como o 30º", () => {
    expect(periodoDoPreset("ultimos30", hoje)).toEqual({ inicio: "2026-09-14", fim: "2026-10-13" });
  });

  test("últimos 90 dias", () => {
    expect(periodoDoPreset("ultimos90", hoje)).toEqual({ inicio: "2026-07-16", fim: "2026-10-13" });
  });

  test("mês atual vai do dia 1 até hoje", () => {
    expect(periodoDoPreset("mesAtual", hoje)).toEqual({ inicio: "2026-10-01", fim: "2026-10-13" });
  });

  test("mês anterior vai do dia 1 ao último dia", () => {
    expect(periodoDoPreset("mesAnterior", hoje)).toEqual({ inicio: "2026-09-01", fim: "2026-09-30" });
  });

  test("mês anterior em janeiro volta para dezembro do ano passado", () => {
    expect(periodoDoPreset("mesAnterior", new Date(2026, 0, 15))).toEqual({ inicio: "2025-12-01", fim: "2025-12-31" });
  });

  test("mês anterior respeita fevereiro de ano não bissexto", () => {
    expect(periodoDoPreset("mesAnterior", new Date(2026, 2, 10))).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
  });
});

describe("isoLocal", () => {
  test("usa o dia do usuário, não o UTC: 23h30 ainda é o mesmo dia", () => {
    expect(isoLocal(new Date(2026, 9, 13, 23, 30, 0))).toBe("2026-10-13");
  });

  test("completa mês e dia com zero", () => {
    expect(isoLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("periodoValido", () => {
  test("aceita um dia só e o intervalo de até 366 dias", () => {
    expect(periodoValido({ inicio: "2026-10-13", fim: "2026-10-13" })).toBe(true);
    expect(periodoValido({ inicio: "2025-10-13", fim: "2026-10-13" })).toBe(true);
  });

  test.each([
    ["fim antes do início", { inicio: "2026-10-14", fim: "2026-10-13" }],
    ["mais de 366 dias", { inicio: "2025-01-01", fim: "2026-10-13" }],
    ["data vazia (campo apagado)", { inicio: "", fim: "2026-10-13" }],
    ["formato errado", { inicio: "13/10/2026", fim: "2026-10-13" }],
    ["dia inexistente", { inicio: "2026-02-30", fim: "2026-03-05" }]
  ])("recusa %s", (_nome, periodo) => {
    expect(periodoValido(periodo)).toBe(false);
  });
});

test("pontos converte razão em pontos percentuais para o Percent", () => {
  expect(pontos(0.069)).toBeCloseTo(6.9, 10);
});
