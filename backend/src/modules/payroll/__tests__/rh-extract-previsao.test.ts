import { beforeEach, describe, expect, test, vi } from "vitest";

// Prévia do Retorno do RH: diz quantos vão gerar lançamento de verdade. Líquido zero e
// desligado antes da competência não são "novos"; excluído à mão e já pago também não.
vi.mock("../../../config/database.js", () => ({ prisma: { payrollItem: { findMany: vi.fn() }, employee: { findMany: vi.fn() } } }));

import { prisma } from "../../../config/database.js";
import { preverImportacao } from "../rh-extract.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const item = (over: Record<string, unknown>) => ({
  employeeId: "a", type: "SALARIO", periodLabel: "Extrato 09/2026", amount: 1000, source: "EXTRATO_RH",
  deletedAt: null, deletedById: null, paymentDate: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([]);
  // Sem lançamento com outro rótulo (a busca do "mesmo pagamento" também usa findMany).
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => (where.OR ? itens : []));
});
let itens: Array<Record<string, unknown>> = [];

describe("preverImportacao", () => {
  test("8 com lançamento ativo e 6 com líquido zero: 0 novos, 8 a atualizar, 6 zerados", async () => {
    itens = Array.from({ length: 8 }, (_, i) => item({ employeeId: `a${i}` }));
    const pessoas = [
      ...Array.from({ length: 8 }, (_, i) => ({ employeeId: `a${i}`, liquido: 1000 })),
      ...Array.from({ length: 6 }, (_, i) => ({ employeeId: `z${i}`, liquido: 0 })),
    ];
    expect(await preverImportacao(pessoas, "MENSAL", 2026, 9)).toEqual({
      novos: 0, atualizar: 8, zerados: 6, desligados: 0, excluidosAMao: 0, jaPagos: 0, comOutroRotulo: 0,
    });
  });

  test("desligado antes da competência, excluído à mão, já pago e novo de verdade", async () => {
    itens = [
      item({ employeeId: "x", deletedAt: new Date("2026-09-20T12:00:00Z"), deletedById: "u9" }),
      item({ employeeId: "p", paymentDate: new Date("2026-10-06T12:00:00Z") }),
    ];
    db.employee.findMany.mockResolvedValue([{ id: "d", terminationDate: new Date("2026-08-20T00:00:00Z") }]);
    const r = await preverImportacao([
      { employeeId: "d", liquido: 500 }, { employeeId: "x", liquido: 500 }, { employeeId: "p", liquido: 500 },
      { employeeId: "n", liquido: 500 }, { employeeId: null, liquido: 300 }, { employeeId: null, liquido: 0 },
    ], "MENSAL", 2026, 9);
    expect(r).toEqual({ novos: 2, atualizar: 0, zerados: 1, desligados: 1, excluidosAMao: 1, jaPagos: 1, comOutroRotulo: 0 });
  });

  test("já lançado com outro rótulo não é novo", async () => {
    itens = [];
    db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => (where.OR ? [] : [
      { id: "g1", employeeId: "a", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Salário", amount: 1000,
        status: "PENDING", deletedAt: null, paymentDate: null, details: null, periodStart: null },
    ]));
    expect((await preverImportacao([{ employeeId: "a", liquido: 1000 }], "MENSAL", 2026, 9)).comOutroRotulo).toBe(1);
  });
});
