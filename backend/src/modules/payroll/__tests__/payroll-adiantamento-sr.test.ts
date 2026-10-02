import { beforeEach, describe, expect, test, vi } from "vitest";

// "Lançar adiantamento dos sem registro": gera só o título do dia 20 de quem é sem registro e
// recebe adiantamento — nem salário (a lista da gorjeta paga) nem adiantamento de CLT (vem do
// extrato). Pessoas fictícias.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    vtFaltaDeduction: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
    dRECategory: { findMany: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../../config/database.js";
import { generatePayroll } from "../payroll.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const pessoa = (id: string, over: Record<string, unknown>) => ({
  id, firstName: id, lastName: "de Tal", displayName: null, sector: "Cozinha", modality: "NAO_CLT", baseSalary: 2600,
  recebeAdiantamento: false, admissionDate: d("2025-01-01"), terminationDate: null, includeInSchedule: true,
  vtType: "NENHUM", vtPeriodicity: "QUINZENAL", vtFixedAmount: null, vtLegs: [], vtMonthlyFare: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.dRECategory.findMany.mockResolvedValue([]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.payrollItem.upsert.mockResolvedValue({});
  db.employee.findMany.mockResolvedValue([
    pessoa("semregMarcado", { recebeAdiantamento: true }),
    pessoa("semregSemMarca", { recebeAdiantamento: false }),
    pessoa("clt", { modality: "CLT" }),
  ]);
});

const criados = () => db.payrollItem.upsert.mock.calls.map((c: [{ create: { employeeId: string; type: string; amount: number; dueDate: Date; details: unknown } }]) => c[0].create);

describe("lançar adiantamento dos sem registro", () => {
  test("cria só o adiantamento de quem é sem registro e está marcado: 40% do base, vence dia 20", async () => {
    const r = await generatePayroll(2026, 10, "u1", "ADIANTAMENTO_SR");
    expect(r.created).toBe(1);
    expect(criados()).toEqual([expect.objectContaining({
      employeeId: "semregMarcado", type: "ADIANTAMENTO", amount: 1040, dueDate: d("2026-10-20"),
      details: expect.objectContaining({ semRegistro: true, base: 2600, percent: 40 }),
    })]);
  });

  test("a folha completa continua gerando o adiantamento do CLT, sem a marca de sem registro", async () => {
    await generatePayroll(2026, 10, "u1", "FOLHA");
    const doClt = criados().find((c: { employeeId: string; type: string }) => c.employeeId === "clt" && c.type === "ADIANTAMENTO");
    expect(doClt?.details).not.toHaveProperty("semRegistro");
  });

  test("já lançado no mês: não cria de novo", async () => {
    db.payrollItem.findMany.mockResolvedValue([{ id: "x", employeeId: "semregMarcado", type: "ADIANTAMENTO", periodLabel: "Adiantamento", periodStart: null, details: {}, status: "PAID", competenceYear: 2026, competenceMonth: 10 }]);
    const r = await generatePayroll(2026, 10, "u1", "ADIANTAMENTO_SR");
    expect(r.created).toBe(0);
    expect(db.payrollItem.upsert).not.toHaveBeenCalled();
  });
});
