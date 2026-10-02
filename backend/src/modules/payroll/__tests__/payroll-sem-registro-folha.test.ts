import { beforeEach, describe, expect, test, vi } from "vitest";

// "Gerar folha" (ALL/FOLHA) não gera o salário nem o adiantamento/1ª quinzena de quem é sem
// registro: o salário dele sai pelo acerto da lista de pagamento, e o adiantamento e a
// quinzena têm botões próprios. E a 1ª quinzena excluída à mão não volta ao regerar.
// Pessoas fictícias.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    vtFaltaDeduction: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    dRECategory: { findMany: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../../config/database.js";
import { computePayroll, generatePayroll } from "../payroll.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const pessoa = (id: string, over: Record<string, unknown>) => ({
  id, firstName: id, lastName: "de Tal", displayName: null, sector: "Cozinha", modality: "NAO_CLT", baseSalary: 2600,
  recebeAdiantamento: false, pagamentoQuinzenal: false, admissionDate: d("2025-01-01"), terminationDate: null, includeInSchedule: true,
  vtType: "NENHUM", vtPeriodicity: "QUINZENAL", vtFixedAmount: null, vtLegs: [], vtMonthlyFare: null, ...over,
});
const AVISO_SR = "Sem registro: salário pelo acerto da lista de pagamento (Gorjeta → lista de pagamento).";

let excluidos: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  excluidos = [];
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  // Linhas vivas: nenhuma. Linhas excluídas (deletedAt not null): as do teste.
  db.payrollItem.findMany.mockImplementation(async (args: { where?: { deletedAt?: unknown } }) =>
    (args?.where?.deletedAt && typeof args.where.deletedAt === "object" ? excluidos : []));
  db.dRECategory.findMany.mockResolvedValue([{ id: "dre-folha", name: "Folha de Pagamento" }]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.payrollItem.upsert.mockResolvedValue({});
  db.payrollItem.update.mockResolvedValue({});
  db.employee.findMany.mockResolvedValue([
    pessoa("quinzenal", { pagamentoQuinzenal: true }),
    pessoa("mensal", { recebeAdiantamento: true }),
    pessoa("clt", { modality: "CLT" }),
  ]);
});

type Criado = { employeeId: string; type: string; periodLabel: string };
const criados = (): Criado[] => db.payrollItem.upsert.mock.calls.map((c: [{ create: Criado }]) => c[0].create);

describe("gerar folha com sem registro", () => {
  test.each(["ALL", "FOLHA"] as const)("%s: só o CLT ganha salário e adiantamento; sem registro fica de fora, com aviso", async (kind) => {
    const r = await generatePayroll(2026, 10, "u1", kind);
    expect(criados().map((c) => [c.employeeId, c.type]).sort()).toEqual([["clt", "ADIANTAMENTO"], ["clt", "SALARIO"]]);
    expect(r.avisos).toContain(AVISO_SR);
  });

  test("a prévia não mostra salário de sem registro", async () => {
    const { items, warnings } = await computePayroll(2026, 10);
    expect(items.filter((i) => i.type === "SALARIO").map((i) => i.employeeId)).toEqual(["clt"]);
    expect(warnings).toContain(AVISO_SR);
  });

  test("os botões próprios continuam: adiantamento e 1ª quinzena dos sem registro", async () => {
    await generatePayroll(2026, 10, "u1", "ADIANTAMENTO_SR");
    await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(criados().map((c) => [c.employeeId, c.periodLabel])).toEqual([["mensal", "Adiantamento"], ["quinzenal", "1ª quinzena"]]);
  });

  test("sem nenhum sem registro: sem o aviso", async () => {
    db.employee.findMany.mockResolvedValue([pessoa("clt", { modality: "CLT" })]);
    const r = await generatePayroll(2026, 10, "u1", "FOLHA");
    expect(r.avisos).not.toContain(AVISO_SR);
  });
});

describe("1ª quinzena excluída à mão", () => {
  test("não volta ao gerar de novo, e avisa", async () => {
    excluidos = [{ employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", deletedAt: d("2026-10-10"), deletedById: "u9" }];
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(0);
    expect(db.payrollItem.upsert).not.toHaveBeenCalled();
    expect(r.avisos).toContainEqual(expect.stringContaining("1ª quinzena excluída à mão"));
  });

  test("excluída sem autor (legado) volta como antes", async () => {
    excluidos = [{ employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", deletedAt: d("2026-10-10"), deletedById: null }];
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(1);
  });
});
