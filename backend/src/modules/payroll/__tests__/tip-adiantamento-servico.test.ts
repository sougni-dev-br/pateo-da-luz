import { beforeEach, describe, expect, test, vi } from "vitest";

// computeTipCommission com o banco de mentira: o adiantamento salarial de quem não tem
// registro sai do total a pagar, só aparece com a permissão de Funcionários e não
// muda um período fechado.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    // Sem histórico do cadastro: vale o valor atual.
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
import { montarRetrato } from "../tip-fechamento.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function participante(over: Record<string, unknown> = {}, emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 2, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Sem", lastName: "Registro", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2200, pixKeyType: null, pixKey: null, recebeAdiantamento: true,
      admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Cozinha", points: 2, minPoints: null, maxPoints: null }, ...emp,
    },
    ...over,
  };
}

function periodo(status: "OPEN" | "CLOSED", participants: unknown[]) {
  db.tipPeriod.findUnique.mockResolvedValue({
    id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status,
    periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
    grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
    diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
    reservaPontos: 0, participants,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 20000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
});

describe("adiantamento salarial no cálculo da gorjeta", () => {
  test("aberto, com permissão: 40% do salário base sai do total e vai para o retrato", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(comp.adiantamento).toEqual({ percent: 40, dia: 20 });
    expect(p.salarioProporcional).toBe(2200);
    expect(p.adiantamentoSalarial).toBe(880);
    expect(p.totalAPagar).toBe(Math.round((2200 - 880 + p.netCommission) * 100) / 100);
    expect(comp.totals.adiantamentos).toBe(880);
    expect(montarRetrato(comp, []).participants[0]).toMatchObject({ adiantamentoSalarial: 880 });
  });

  test("sem a permissão de Funcionários: o adiantamento não sai na resposta", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].adiantamentoSalarial).toBeNull();
    expect(comp.totals.adiantamentos).toBeNull();
  });

  test("recebe só no pagamento: retrato sem o campo, como os de antes", async () => {
    periodo("OPEN", [participante({}, { recebeAdiantamento: false })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(0);
    expect(montarRetrato(comp, []).participants[0]).not.toHaveProperty("adiantamentoSalarial");
    expect(montarRetrato(comp, []).totals).not.toHaveProperty("adiantamentos");
  });

  test("fechado antes do adiantamento: vale o total gravado, e o adiantamento é zero", async () => {
    periodo("CLOSED", [participante({ rateioAmount: 300, netCommission: 300, salarioProporcional: 2200, totalAPagar: 2500 })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].totalAPagar).toBe(2500);
    expect(comp.participants[0].adiantamentoSalarial).toBe(0);
  });

  test("fechado com o adiantamento: o total gravado não muda e explica o adiantamento", async () => {
    periodo("CLOSED", [participante({ rateioAmount: 300, netCommission: 300, salarioProporcional: 2200, totalAPagar: 1620 })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].totalAPagar).toBe(1620);
    expect(comp.participants[0].adiantamentoSalarial).toBe(880);
  });
});

describe("total de adiantamentos com quem foi pago na rescisão", () => {
  test("aberto: o total não soma quem foi pago na rescisão (o fechado grava zero para ele); o valor da pessoa fica", async () => {
    periodo("OPEN", [participante({}, { terminationDate: d("2026-09-22") })]);
    db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type?: string } }) => (where.type === "RESCISAO"
      ? [{ employeeId: "e1", amount: 1500, dueDate: d("2026-10-01"), status: "PENDING", details: null }]
      : []));
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.pagoNaRescisao).toBe(true);
    // A apuração da rescisão lê este valor para descontar o adiantamento já pago.
    expect(p.adiantamentoSalarial).toBeGreaterThan(0);
    expect(comp.totals.adiantamentos).toBe(0);
  });
});
