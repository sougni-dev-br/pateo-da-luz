import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: { payrollItem: { findMany: vi.fn() } } }));

import { prisma } from "../../../config/database.js";
import { contarLancamentosExistentes } from "../rh-extract.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

describe("contarLancamentosExistentes (a tela diz 'atualizar' em vez de 'gerar')", () => {
  test("conta pessoas distintas com o lançamento do extrato", async () => {
    db.payrollItem.findMany.mockResolvedValue([{ employeeId: "a" }, { employeeId: "a" }, { employeeId: "b" }]);
    expect(await contarLancamentosExistentes(["a", "b", "c"], "MENSAL", 2026, 8)).toBe(2);
    expect(db.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({
      employeeId: { in: ["a", "b", "c"] }, competenceYear: 2026, competenceMonth: 8, deletedAt: null,
      OR: [{ type: "SALARIO", periodLabel: "Extrato 08/2026" }],
    });
  });

  test("no adiantamento conta também o que entrou como salário antes (vai ser convertido)", async () => {
    db.payrollItem.findMany.mockResolvedValue([]);
    await contarLancamentosExistentes(["a"], "ADIANTAMENTO", 2026, 9);
    expect(db.payrollItem.findMany.mock.calls[0][0].where.OR).toEqual([
      { type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026" },
      { type: "SALARIO", periodLabel: "Extrato 09/2026" },
    ]);
  });

  test("sem ninguém vinculado não consulta o banco", async () => {
    expect(await contarLancamentosExistentes([], "MENSAL", 2026, 8)).toBe(0);
    expect(db.payrollItem.findMany).not.toHaveBeenCalled();
  });
});
