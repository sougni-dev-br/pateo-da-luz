import { describe, expect, test } from "vitest";
import type { PayrollComputedItem } from "../../../api/client";
import { adiantamentosSrAGerar, quinzenasSrAGerar } from "../semRegistro";

// Botões da Folha para os sem registro: o adiantamento do dia 20 e a 1ª quinzena do dia 15 são
// títulos distintos (ambos ADIANTAMENTO). Dados fictícios.
const item = (over: Partial<PayrollComputedItem>): PayrollComputedItem => ({
  employeeId: "e", employeeName: "Pessoa", employeeDisplayName: null, sector: null, type: "ADIANTAMENTO", periodLabel: "Adiantamento",
  periodStart: null, periodEnd: null, dueDate: "2026-10-20T00:00:00.000Z", amount: 800, workedDays: null, freeDays: null, quinzena: null,
  dreCategoryName: null, details: null, exists: false, ...over,
});

const QUINZENA = { semRegistro: true, primeiraQuinzena: true };

describe("contagens dos botões dos sem registro", () => {
  test("1ª quinzena: as novas e as lançadas sem baixa com valor desatualizado", () => {
    const itens = [
      item({ employeeId: "a", periodLabel: "1ª quinzena", details: QUINZENA }),
      item({ employeeId: "b", periodLabel: "1ª quinzena", details: QUINZENA, exists: true, desatualizado: true }),
      item({ employeeId: "c", periodLabel: "1ª quinzena", details: QUINZENA, exists: true }),
      item({ employeeId: "d", details: { semRegistro: true } }),
    ];
    expect(quinzenasSrAGerar(itens)).toEqual({ novas: 1, desatualizadas: 1 });
  });

  test("adiantamento dos sem registro não conta a 1ª quinzena", () => {
    const itens = [
      item({ employeeId: "a", periodLabel: "1ª quinzena", details: QUINZENA }),
      item({ employeeId: "d", details: { semRegistro: true } }),
      item({ employeeId: "clt", details: {} }),
    ];
    expect(adiantamentosSrAGerar(itens)).toBe(1);
  });
});
