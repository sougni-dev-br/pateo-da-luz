import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: { payrollItem: { findMany: vi.fn() } } }));

import { prisma } from "../../../config/database.js";
import { contarLancamentosExistentes } from "../rh-extract.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

const item = (over: Record<string, unknown>) => ({
  employeeId: "a", type: "SALARIO", periodLabel: "Extrato 08/2026", amount: 1000, source: "EXTRATO_RH", deletedAt: null, ...over,
});

describe("contarLancamentosExistentes (a tela diz 'atualizar' em vez de 'gerar')", () => {
  test("conta pessoas distintas com o lançamento ativo do extrato", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ employeeId: "a" }), item({ employeeId: "b" })]);
    const pessoas = [{ employeeId: "a", liquido: 1000 }, { employeeId: "a", liquido: 1000 }, { employeeId: "b", liquido: 900 }, { employeeId: "c", liquido: 800 }];
    expect(await contarLancamentosExistentes(pessoas, "MENSAL", 2026, 8)).toBe(2);
    expect(db.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({
      employeeId: { in: ["a", "b", "c"] }, competenceYear: 2026, competenceMonth: 8,
      OR: [{ type: "SALARIO", periodLabel: "Extrato 08/2026" }],
    });
  });

  test("excluído (à mão: vai ser pulado; legado: volta como novo) não conta como atualizado", async () => {
    db.payrollItem.findMany.mockResolvedValue([
      item({ employeeId: "a", deletedAt: new Date() }),
      item({ employeeId: "b", deletedAt: new Date() }),
    ]);
    const pessoas = [{ employeeId: "a", liquido: 1000 }, { employeeId: "b", liquido: 1000 }];
    expect(await contarLancamentosExistentes(pessoas, "MENSAL", 2026, 8)).toBe(0);
  });

  test("no adiantamento conta o SALARIO 'Extrato' ativo de mesmo valor (vai ser convertido)", async () => {
    db.payrollItem.findMany.mockResolvedValue([
      item({ employeeId: "a", periodLabel: "Extrato 09/2026", amount: 1034 }),          // mesmo valor: converte
      item({ employeeId: "b", periodLabel: "Extrato 09/2026", amount: 2500 }),          // salário de verdade: não
      item({ employeeId: "c", periodLabel: "Extrato 09/2026", amount: 800, deletedAt: new Date() }), // excluído: não
    ]);
    const pessoas = [{ employeeId: "a", liquido: 1034 }, { employeeId: "b", liquido: 1000 }, { employeeId: "c", liquido: 800 }];
    expect(await contarLancamentosExistentes(pessoas, "ADIANTAMENTO", 2026, 9)).toBe(1);
    expect(db.payrollItem.findMany.mock.calls[0][0].where.OR).toEqual([
      { type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026" },
      { type: "SALARIO", periodLabel: "Extrato 09/2026" },
    ]);
  });

  test("adiantamento com a própria chave excluída à mão não conta, mesmo com SALARIO antigo de mesmo valor", async () => {
    db.payrollItem.findMany.mockResolvedValue([
      item({ employeeId: "a", type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026", amount: 1034, deletedAt: new Date() }),
      item({ employeeId: "a", periodLabel: "Extrato 09/2026", amount: 1034 }),
    ]);
    expect(await contarLancamentosExistentes([{ employeeId: "a", liquido: 1034 }], "ADIANTAMENTO", 2026, 9)).toBe(0);
  });

  test("sem ninguém vinculado não consulta o banco", async () => {
    expect(await contarLancamentosExistentes([], "MENSAL", 2026, 8)).toBe(0);
    expect(db.payrollItem.findMany).not.toHaveBeenCalled();
  });
});
