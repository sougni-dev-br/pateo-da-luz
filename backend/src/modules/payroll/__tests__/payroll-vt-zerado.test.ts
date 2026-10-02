import { beforeEach, describe, expect, test, vi } from "vitest";

// VT de R$ 0,00 não vira título: em 07/2026 o gerador gravou quatro (trajeto em branco,
// bilhete mensal sem tarifa) e eles ficaram vencidos no Contas a Pagar. Pessoas fictícias.
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
import { generatePayroll } from "../payroll.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const pessoa = (id: string, over: Record<string, unknown>) => ({
  id, firstName: id, lastName: "de Tal", displayName: null, sector: "Cozinha", modality: "CLT", baseSalary: 2600,
  recebeAdiantamento: false, pagamentoQuinzenal: false, admissionDate: d("2025-01-01"), terminationDate: null, includeInSchedule: true,
  vtType: "NENHUM", vtPeriodicity: "MENSAL", vtFixedAmount: null, vtLegs: [], vtMonthlyFare: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.dRECategory.findMany.mockResolvedValue([{ id: "dre-vt", name: "Vale Transporte" }]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.payrollItem.upsert.mockResolvedValue({});
  db.employee.findMany.mockResolvedValue([
    pessoa("semTrajeto", { vtType: "TRANSPORTE_PUBLICO" }),
    pessoa("semTarifa", { vtType: "BILHETE_MENSAL" }),
    pessoa("comTarifa", { vtType: "BILHETE_MENSAL", vtMonthlyFare: { id: "f1", name: "Bilhete mensal", amount: 300 } }),
    pessoa("naoRecebe", { vtType: "NENHUM" }),
  ]);
});

const criados = () => db.payrollItem.upsert.mock.calls.map((c: [{ create: { employeeId: string; amount: number } }]) => c[0].create);

describe("VT de valor zero não vira título", () => {
  test("sem trajeto ou sem tarifa: não grava e avisa; com tarifa grava normalmente", async () => {
    const r = await generatePayroll(2026, 10, "u1", "VT");
    expect(criados().map((c: { employeeId: string; amount: number }) => [c.employeeId, c.amount])).toEqual([["comTarifa", 300]]);
    expect(r.created).toBe(1);
    expect(r.avisos).toEqual(expect.arrayContaining([
      expect.stringMatching(/^semTrajeto de Tal: .* não gerado — vale de R\$ 0,00\.$/),
      expect.stringMatching(/^semTarifa de Tal: VT Bilhete Único Mensal de 10\/2026 não gerado — vale de R\$ 0,00\.$/),
    ]));
  });

  test("ajuste manual com valor na prévia: o vale é gravado com o valor ajustado", async () => {
    await generatePayroll(2026, 10, "u1", "VT", [
      { employeeId: "semTarifa", type: "VALE_TRANSPORTE", periodLabel: "VT Bilhete Único Mensal", amount: 250 },
    ]);
    expect(criados().map((c: { employeeId: string; amount: number }) => [c.employeeId, c.amount])).toEqual([["semTarifa", 250], ["comTarifa", 300]]);
  });
});
