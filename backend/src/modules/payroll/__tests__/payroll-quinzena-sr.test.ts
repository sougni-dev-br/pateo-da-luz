import { beforeEach, describe, expect, test, vi } from "vitest";

// "Gerar 1ª quinzena (sem registro)": o título do dia 15 de quem é sem registro e recebe por
// quinzena — metade do salário base vigente no dia 15. A lista de pagamento desconta este
// título (o pago). Pessoas fictícias.
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

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.dRECategory.findMany.mockResolvedValue([{ id: "dre-folha", name: "Folha de Pagamento" }]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.payrollItem.upsert.mockResolvedValue({});
  db.payrollItem.update.mockResolvedValue({});
  db.employee.findMany.mockResolvedValue([
    pessoa("quinzenal", { pagamentoQuinzenal: true }),
    pessoa("mensal", { recebeAdiantamento: true }),
    pessoa("clt", { modality: "CLT", pagamentoQuinzenal: true }),
  ]);
});

type Criado = { employeeId: string; type: string; periodLabel: string; amount: number; dueDate: Date; details: Record<string, unknown>; dreCategoryId: string | null };
const criados = (): Criado[] => db.payrollItem.upsert.mock.calls.map((c: [{ create: Criado }]) => c[0].create);

describe("gerar a 1ª quinzena dos sem registro", () => {
  test("cria só o título de quem é sem registro e recebe por quinzena: metade do base, vence no dia 15", async () => {
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(1);
    expect(criados()).toEqual([expect.objectContaining({
      employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", amount: 1300, dueDate: d("2026-10-15"),
      dreCategoryId: "dre-folha",
      details: expect.objectContaining({ semRegistro: true, primeiraQuinzena: true, base: 2600 }),
    })]);
  });

  test("usa o salário vigente no dia 15 (aumento depois do dia 15 não muda a quinzena)", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([{
      employeeId: "quinzenal", campo: "baseSalary", valorAnterior: "2000.00", valorNovo: "2600.00",
      vigenteDesde: d("2026-10-20"), createdAt: d("2026-10-20"),
    }]);
    await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(criados()[0]).toMatchObject({ employeeId: "quinzenal", amount: 1000, details: expect.objectContaining({ base: 2000 }) });
  });

  test("passou a receber por quinzena depois do dia 15: não tem a 1ª quinzena do mês", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([{
      employeeId: "quinzenal", campo: "pagamentoQuinzenal", valorAnterior: "false", valorNovo: "true",
      vigenteDesde: d("2026-10-20"), createdAt: d("2026-10-20"),
    }]);
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(0);
  });

  test("entrou depois do dia 15 ou saiu antes dele: sem quinzena", async () => {
    db.employee.findMany.mockResolvedValue([
      pessoa("entrou16", { pagamentoQuinzenal: true, admissionDate: d("2026-10-16") }),
      pessoa("saiu14", { pagamentoQuinzenal: true, terminationDate: d("2026-10-14") }),
      pessoa("saiu15", { pagamentoQuinzenal: true, terminationDate: d("2026-10-15") }),
    ]);
    await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(criados().map((c) => c.employeeId)).toEqual(["saiu15"]);
  });

  test("nunca passa do salário proporcional do mês (entrou no dia 15 de fevereiro: 14 dias)", async () => {
    // 15 a 28/02 = 14 dias × 86,67 = 1.213,38, menos que a metade (1.300).
    db.employee.findMany.mockResolvedValue([pessoa("entrou15", { pagamentoQuinzenal: true, admissionDate: d("2027-02-15") })]);
    await generatePayroll(2027, 2, "u1", "QUINZENA_SR");
    expect(criados()[0]).toMatchObject({ amount: 1213.38, dueDate: d("2027-02-15") });
  });

  test("o adiantamento dos sem registro não leva a quinzena (e a quinzena não leva o adiantamento)", async () => {
    await generatePayroll(2026, 10, "u1", "ADIANTAMENTO_SR");
    expect(criados().map((c) => [c.employeeId, c.periodLabel])).toEqual([["mensal", "Adiantamento"]]);
  });

  test("já lançada com o mesmo valor: não cria nem mexe", async () => {
    db.payrollItem.findMany.mockResolvedValue([{
      id: "q1", employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", amount: 1300, paymentDate: null,
      periodStart: null, details: { primeiraQuinzena: true, semRegistro: true }, status: "PENDING", source: "GENERATED",
    }]);
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(0);
    expect(r.atualizados).toBe(0);
    expect(db.payrollItem.upsert).not.toHaveBeenCalled();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("lançada sem baixa com outro valor (salário mudou): atualiza o valor", async () => {
    db.payrollItem.findMany.mockResolvedValue([{
      id: "q1", employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", amount: 1000, paymentDate: null,
      periodStart: null, details: { primeiraQuinzena: true, semRegistro: true }, status: "PENDING", source: "GENERATED",
    }]);
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.created).toBe(0);
    expect(r.atualizados).toBe(1);
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "q1" }, data: expect.objectContaining({ amount: 1300, updatedById: "u1" }),
    }));
  });

  test("já paga: nunca muda, mesmo com valor diferente", async () => {
    db.payrollItem.findMany.mockResolvedValue([{
      id: "q1", employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", amount: 1000, paymentDate: d("2026-10-15"),
      periodStart: null, details: { primeiraQuinzena: true, semRegistro: true }, status: "PAID", source: "GENERATED",
    }]);
    const r = await generatePayroll(2026, 10, "u1", "QUINZENA_SR");
    expect(r.atualizados).toBe(0);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.upsert).not.toHaveBeenCalled();
  });

  test("a prévia marca a quinzena sem baixa e desatualizada (o botão conta para atualizar)", async () => {
    db.payrollItem.findMany.mockResolvedValue([{
      id: "q1", employeeId: "quinzenal", type: "ADIANTAMENTO", periodLabel: "1ª quinzena", amount: 1000, paymentDate: null,
      periodStart: null, details: { primeiraQuinzena: true, semRegistro: true }, status: "PENDING", source: "GENERATED",
    }]);
    const { items } = await computePayroll(2026, 10);
    const q = items.find((i) => i.employeeId === "quinzenal" && i.periodLabel === "1ª quinzena");
    expect(q).toMatchObject({ exists: true, desatualizado: true, amount: 1300 });
  });
});
