import { beforeEach, describe, expect, test, vi } from "vitest";

// computeTipCommission com o banco de mentira: sem registro que saiu depois do fim do ciclo
// (25/09), ainda no mês do salário (29/09), com a rescisão lançada — "tudo na rescisão":
// a lista de setembro não paga nada, mas os valores seguem calculados para a rescisão.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    tipPeriod: { findUnique: vi.fn() },
    employeeScheduleDay: { groupBy: vi.fn(), findMany: vi.fn() },
    revenueEntry: { aggregate: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriodClosing: { findFirst: vi.fn() },
    tipReserveMovement: { findMany: vi.fn(), aggregate: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function participante(emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 2, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: "10:00", adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Sem", lastName: "Registro", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2200, pixKeyType: null, pixKey: null, recebeAdiantamento: false,
      admissionDate: d("2025-01-01"), terminationDate: d("2026-09-29"),
      pontosExtra: null, tipFunction: { name: "Cozinha", points: 2, minPoints: null, maxPoints: null }, ...emp,
    },
  };
}

function periodo(participants: unknown[]) {
  db.tipPeriod.findUnique.mockResolvedValue({
    id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status: "OPEN",
    periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
    grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
    diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
    reservaPontos: 0, participants,
  });
}

// Rescisão lançada em Contas a Pagar na competência da saída (09/2026).
function comRescisaoLancada(lancada: boolean) {
  db.payrollItem.findMany.mockImplementation(async (args: { where?: { type?: string } }) => (
    lancada && args?.where?.type === "RESCISAO"
      ? [{ employeeId: "e1", amount: 3000, dueDate: d("2026-10-05"), status: "PENDING", details: null }]
      : []));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 20000 } });
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
});

describe("sem registro que saiu em 29/09 (ciclo até 25/09)", () => {
  test("com a rescisão lançada: a lista não paga, os valores ficam, e avisa", async () => {
    comRescisaoLancada(true);
    periodo([participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.tipoCalculo).toBe("MES");
    expect(p.pagoNaRescisao).toBe(true);
    expect(p.totalAPagar).toBe(0);
    expect(p.rescisaoContasPagar).not.toBeNull();
    expect(p.salarioProporcional).toBe(2126.57); // 29 dias
    expect(p.rateioAmount).toBeGreaterThan(0);
    expect(p.valorHoraExtra).toBe(150);
    expect(comp.totals.totalAPagar).toBe(0);
    expect(comp.totals.horasExtrasSemRegistro).toBe(0);
    expect(comp.warnings.join(" ")).toContain("depois do fim do ciclo");
  });

  test("sem a rescisão lançada: a lista paga como hoje", async () => {
    comRescisaoLancada(false);
    periodo([participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.pagoNaRescisao).toBe(false);
    expect(p.totalAPagar).toBeGreaterThan(2126.57);
  });

  test("CLT que sai em 29/09: a rescisão em Contas a Pagar não muda a lista", async () => {
    comRescisaoLancada(true);
    periodo([participante({ modality: "CLT" })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.pagoNaRescisao).toBe(false);
    expect(p.totalAPagar).toBe(p.netCommission);
  });
});
