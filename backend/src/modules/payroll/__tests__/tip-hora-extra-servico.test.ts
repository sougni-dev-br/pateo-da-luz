import { beforeEach, describe, expect, test, vi } from "vitest";

// computeTipCommission com o banco de mentira: a hora extra e o adicional noturno de
// quem não tem registro entram no total a pagar, só aparecem com a permissão de
// Funcionários, vão para o retrato e não mudam um período fechado.
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
    horaExtra: "10:00", adicionalNoturno: "7:00", justificada: false, vales: [],
    employee: {
      firstName: "Sem", lastName: "Registro", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2200, pixKeyType: null, pixKey: null, recebeAdiantamento: false,
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

function fechamento(participantes: unknown[]) {
  db.tipPeriodClosing.findFirst.mockResolvedValue({
    id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-30"), closedByName: "Eli", participants: participantes,
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

describe("hora extra de quem não tem registro na gorjeta", () => {
  test("aberto, com permissão: R$ 150 de HE + R$ 16 de noturno no total, nos totais e no retrato", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.valorHoraExtra).toBe(150);
    expect(p.valorAdicionalNoturno).toBe(16);
    expect(p.totalAPagar).toBe(Math.round((2200 + p.netCommission + 166) * 100) / 100);
    expect(comp.totals.horasExtrasSemRegistro).toBe(166);
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants[0]).toMatchObject({ horaExtra: "10:00", adicionalNoturno: "7:00", valorHoraExtra: 150, valorAdicionalNoturno: 16 });
    expect(retrato.totals).toMatchObject({ horasExtrasSemRegistro: 166 });
  });

  test("sem a permissão de Funcionários: valores null, mas o total já os leva", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9);
    const p = comp.participants[0];
    expect(p.valorHoraExtra).toBeNull();
    expect(p.valorAdicionalNoturno).toBeNull();
    expect(comp.totals.horasExtrasSemRegistro).toBeNull();
    expect(p.totalAPagar).toBe(Math.round((2200 + p.netCommission + 166) * 100) / 100);
  });

  test("sem horas: retrato e totais sem os campos novos, como os de antes", async () => {
    periodo("OPEN", [participante({ horaExtra: null, adicionalNoturno: null })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].valorHoraExtra).toBe(0);
    expect(comp.totals.horasExtrasSemRegistro).toBe(0);
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants[0]).not.toHaveProperty("valorHoraExtra");
    expect(retrato.totals).not.toHaveProperty("horasExtrasSemRegistro");
  });

  test("CLT com horas: só informativo, não muda o total nem os totais", async () => {
    periodo("OPEN", [participante({}, { modality: "CLT" })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.valorHoraExtra).toBe(0);
    expect(p.totalAPagar).toBe(p.netCommission);
    expect(comp.totals.horasExtrasSemRegistro).toBe(0);
  });

  test("texto de horas ilegível vira aviso e conta zero", async () => {
    periodo("OPEN", [participante({ horaExtra: "ver planilha", adicionalNoturno: null })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].valorHoraExtra).toBe(0);
    expect(comp.warnings.join(" ")).toContain("ilegível");
  });

  test("fechado com o retrato: vale o total gravado e o valor gravado, e o adiantamento sai certo", async () => {
    // Gravado: salário 2200 − adiantamento 880 + gorjeta 320 + HE 166 = 1806.
    periodo("CLOSED", [participante({ rateioAmount: 320, netCommission: 320, salarioProporcional: 2200, totalAPagar: 1806 }, { recebeAdiantamento: true, baseSalary: 3000 })]);
    fechamento([{ employeeId: "e1", valorHoraExtra: 150, valorAdicionalNoturno: 16 }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    // Salário de hoje (3.000) não recalcula a hora extra do fechado.
    expect(p.valorHoraExtra).toBe(150);
    expect(p.valorAdicionalNoturno).toBe(16);
    expect(p.totalAPagar).toBe(1806);
    expect(p.adiantamentoSalarial).toBe(880);
  });

  test("fechado antes desta versão (retrato sem os campos): hora extra zero e total gravado", async () => {
    periodo("CLOSED", [participante({ rateioAmount: 320, netCommission: 320, salarioProporcional: 2200, totalAPagar: 2520 })]);
    fechamento([{ employeeId: "e1", horaExtra: "10:00" }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.valorHoraExtra).toBe(0);
    expect(p.totalAPagar).toBe(2520);
    expect(p.adiantamentoSalarial).toBe(0);
  });

  test("rescisão lançada: a lista leva zero, o total de HE não soma, e avisa que vai na rescisão", async () => {
    periodo("OPEN", [participante({}, { terminationDate: d("2026-09-22") })]);
    db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type?: string } }) => (where.type === "RESCISAO"
      ? [{ employeeId: "e1", amount: 1500, dueDate: d("2026-10-01"), status: "PENDING", details: null }]
      : []));
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.pagoNaRescisao).toBe(true);
    expect(p.totalAPagar).toBe(0);
    expect(p.valorHoraExtra).toBe(150);
    expect(comp.totals.horasExtrasSemRegistro).toBe(0);
    expect(comp.warnings.join(" ")).toContain("paga na rescisão");
  });
});
