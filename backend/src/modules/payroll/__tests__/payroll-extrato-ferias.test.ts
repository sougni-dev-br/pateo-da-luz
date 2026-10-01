import { beforeEach, describe, expect, test, vi } from "vitest";

// "Gerar folha" com o banco de mentira: não duplica o salário/adiantamento que já veio do
// extrato da contabilidade, e as férias marcadas na Escala tiram os dias do VT.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    vtFaltaDeduction: { findMany: vi.fn() },
    payrollItem: { findMany: vi.fn() },
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
const tarifa = { id: "f1", name: "Ônibus", amount: 5, sundayAmount: null };

const emp = (over: Record<string, unknown> = {}) => ({
  id: "e1", firstName: "Ana", lastName: "Silva", displayName: null, sector: "Cozinha", modality: "CLT", baseSalary: 2600,
  recebeAdiantamento: false, admissionDate: d("2025-01-01"), terminationDate: null, includeInSchedule: true,
  vtType: "NENHUM", vtPeriodicity: "MENSAL", vtFixedAmount: null, vtLegs: [], vtMonthlyFare: null, ...over,
});

type Linha = { employeeId: string; date: Date; type: string };
let escala: Linha[] = [];
let lancamentos: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  escala = [];
  lancamentos = [];
  db.employeeScheduleDay.findMany.mockImplementation(async ({ where }: { where: { type: string | { in: string[] } } }) =>
    escala.filter((l) => (typeof where.type === "string" ? l.type === where.type : where.type.in.includes(l.type))));
  // Só a busca dos lançamentos da competência filtra por competenceYear.
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { competenceYear?: number } }) =>
    (where.competenceYear ? lancamentos : []));
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  db.dRECategory.findMany.mockResolvedValue([{ id: "dre1", name: "Folha de Pagamento" }, { id: "dre2", name: "Vale-Transporte" }]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
});

describe("salário/adiantamento que já veio do extrato", () => {
  beforeEach(() => db.employee.findMany.mockResolvedValue([emp()]));

  test("sem extrato: gera adiantamento e salário", async () => {
    const { items, warnings } = await computePayroll(2026, 9);
    expect(items.filter((i) => i.type !== "VALE_TRANSPORTE").map((i) => [i.type, i.exists])).toEqual([["ADIANTAMENTO", false], ["SALARIO", false]]);
    expect(warnings.some((w) => w.includes("extrato"))).toBe(false);
  });

  test("com PayrollItem EXTRATO_RH ativo do mesmo tipo: vem como existente e avisa", async () => {
    lancamentos = [
      { employeeId: "e1", type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026", amount: 1040, workedDays: null, freeDays: null, source: "EXTRATO_RH" },
      { employeeId: "e1", type: "SALARIO", periodLabel: "Extrato 09/2026", amount: 1560, workedDays: null, freeDays: null, source: "EXTRATO_RH" },
    ];
    const { items, warnings } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "ADIANTAMENTO")?.exists).toBe(true);
    expect(items.find((i) => i.type === "SALARIO")?.exists).toBe(true);
    expect(warnings).toContain("Ana Silva: adiantamento de 09/2026 já veio do extrato da contabilidade; não gerado de novo.");
    expect(warnings).toContain("Ana Silva: salário de 09/2026 já veio do extrato da contabilidade; não gerado de novo.");
  });

  test("só o adiantamento veio do extrato: o salário continua sendo gerado", async () => {
    lancamentos = [{ employeeId: "e1", type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026", amount: 1040, source: "EXTRATO_RH" }];
    const { items } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "ADIANTAMENTO")?.exists).toBe(true);
    expect(items.find((i) => i.type === "SALARIO")?.exists).toBe(false);
  });

  // Trava de duplicidade: o salário já lançado à mão (outro rótulo) é o mesmo pagamento.
  test("salário lançado à mão com outro rótulo: vem como existente e avisa", async () => {
    lancamentos = [{ employeeId: "e1", type: "SALARIO", periodLabel: "Acerto", amount: 100, source: "MANUAL" }];
    const { items, warnings } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "SALARIO")?.exists).toBe(true);
    expect(warnings).toContain('Ana Silva: salário de 09/2026 já lançado como "Acerto"; não gerado de novo.');
  });

  test("complemento lançado à mão não bloqueia o salário do mês", async () => {
    lancamentos = [{ employeeId: "e1", type: "SALARIO", periodLabel: "Salário (complemento)", amount: 100, source: "MANUAL", details: { complemento: { motivo: "diferença de horas" } } }];
    const { items } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "SALARIO")?.exists).toBe(false);
  });

  test("lançamento cancelado não bloqueia", async () => {
    lancamentos = [{ employeeId: "e1", type: "SALARIO", periodLabel: "Acerto", amount: 100, source: "MANUAL", status: "CANCELED" }];
    const { items } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "SALARIO")?.exists).toBe(false);
  });

  test("generatePayroll não grava o que veio do extrato", async () => {
    lancamentos = [
      { employeeId: "e1", type: "ADIANTAMENTO", periodLabel: "Adiantamento 09/2026", amount: 1040, source: "EXTRATO_RH" },
      { employeeId: "e1", type: "SALARIO", periodLabel: "Extrato 09/2026", amount: 1560, source: "EXTRATO_RH" },
    ];
    const tx = { payrollItem: { upsert: vi.fn(), findUnique: vi.fn() }, vtFaltaDeduction: { createMany: vi.fn() } };
    db.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    const r = await generatePayroll(2026, 9, "u1", "FOLHA");
    expect(tx.payrollItem.upsert).not.toHaveBeenCalled();
    expect(r).toMatchObject({ created: 0, skipped: 2 });
  });
});

describe("nada depois da saída", () => {
  const saiu = (data: string) => emp({
    terminationDate: d(data), vtType: "BILHETE_MENSAL", vtMonthlyFare: { id: "m1", name: "Mensal", amount: 250 },
  });

  test("saiu em 29/09: outubro não gera salário, adiantamento nem VT, e avisa", async () => {
    db.employee.findMany.mockResolvedValue([saiu("2026-09-29")]);
    const { items, warnings } = await computePayroll(2026, 10);
    expect(items).toEqual([]);
    expect(warnings.filter((w) => w.includes("saiu em 29/09/2026"))).toHaveLength(3);
  });

  test("o mês da própria saída continua: salário, adiantamento e bilhete mensal", async () => {
    db.employee.findMany.mockResolvedValue([saiu("2026-09-29")]);
    const { items } = await computePayroll(2026, 9);
    expect(items.map((i) => i.type).sort()).toEqual(["ADIANTAMENTO", "SALARIO", "VALE_TRANSPORTE"]);
  });

  test("generatePayroll não grava o que é depois da saída e devolve o aviso", async () => {
    db.employee.findMany.mockResolvedValue([saiu("2026-09-29")]);
    const tx = { payrollItem: { upsert: vi.fn(), findUnique: vi.fn() }, vtFaltaDeduction: { createMany: vi.fn() } };
    db.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    const r = await generatePayroll(2026, 10, "u1", "ALL");
    expect(tx.payrollItem.upsert).not.toHaveBeenCalled();
    expect(r.created).toBe(0);
    expect(r.avisos.some((a) => a.includes("saiu em 29/09/2026"))).toBe(true);
  });
});

describe("férias marcadas na escala tiram os dias do VT", () => {
  const comVt = (over: Record<string, unknown> = {}) => emp({
    baseSalary: null, vtType: "TRANSPORTE_PUBLICO",
    vtLegs: [{ direction: "IDA", sortOrder: 0, fare: tarifa }, { direction: "VOLTA", sortOrder: 0, fare: tarifa }], ...over,
  });

  test("dias de FERIAS na escala não são pagos", async () => {
    db.employee.findMany.mockResolvedValue([comVt()]);
    const sem = (await computePayroll(2026, 9)).items.find((i) => i.type === "VALE_TRANSPORTE")!;
    // 14 a 18/09/2026: segunda a sexta.
    escala = [14, 15, 16, 17, 18].map((dia) => ({ employeeId: "e1", date: d(`2026-09-${dia}`), type: "FERIAS" }));
    const com = (await computePayroll(2026, 9)).items.find((i) => i.type === "VALE_TRANSPORTE")!;
    expect(com.workedDays).toBe(sem.workedDays! - 5);
    expect(com.amount).toBe(sem.amount - 50);
    const pagos = (com.details as { diasPagos: number[] }).diasPagos;
    for (const dia of [14, 15, 16, 17, 18]) expect(pagos).not.toContain(dia);
  });

  test("marca da escala sozinha não dispara o aviso de férias e salário na mesma competência", async () => {
    db.employee.findMany.mockResolvedValue([comVt({ baseSalary: 2600 })]);
    escala = [{ employeeId: "e1", date: d("2026-09-14"), type: "FERIAS" }];
    const { warnings } = await computePayroll(2026, 9);
    expect(warnings.some((w) => w.includes("férias e salário"))).toBe(false);
  });
});
