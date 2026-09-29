import { describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

import { lerVale } from "../tip-vales.routes.js";

describe("validação do vale", () => {
  test("aceita adiantamento com data e arredonda o valor", () => {
    expect(lerVale({ type: "ADIANTAMENTO", amount: "150.456", date: "2026-09-10", notes: "  quinzena  " })).toEqual({
      dados: { type: "ADIANTAMENTO", amount: 150.46, date: new Date(Date.UTC(2026, 8, 10)), notes: "quinzena" },
    });
  });

  test("recusa tipo desconhecido, valor zero, negativo ou absurdo e data inválida", () => {
    expect(lerVale({ type: "PIX", amount: 10 })).toEqual({ erro: "Escolha o tipo do vale." });
    expect(lerVale({ type: "OUTRO", amount: 0 })).toEqual({ erro: "Valor do vale inválido." });
    expect(lerVale({ type: "OUTRO", amount: -5 })).toEqual({ erro: "Valor do vale inválido." });
    expect(lerVale({ type: "OUTRO", amount: 1e9 })).toEqual({ erro: "Valor do vale inválido." });
    expect(lerVale({ type: "OUTRO", amount: 10, date: "10/09/2026" })).toEqual({ erro: "Data do vale inválida." });
  });

  test("sem data e sem descrição fica nulo", () => {
    expect(lerVale({ type: "CREDITO", amount: 50 })).toEqual({ dados: { type: "CREDITO", amount: 50, date: null, notes: null } });
  });
});
