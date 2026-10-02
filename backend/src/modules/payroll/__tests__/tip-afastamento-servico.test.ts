import { beforeEach, describe, expect, test, vi } from "vitest";

// Afastamento não remunerado na apuração: vem da Escala (marca AFASTAMENTO), conta os dias
// do ciclo para a gorjeta e os do mês civil para o salário de quem não tem registro, e sai
// na apuração como "Afastamento (dias)" com origem ESCALA. O retrato do fechamento guarda.
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

function participante(id: string, employee: Record<string, unknown> = {}) {
  return {
    id: `tp-${id}`, employeeId: id, kind: "PONTOS", basePoints: 4, points: 4, pointsAdjustment: 0, fixedAmount: null,
    faltas: null, atestados: null, ferias: null, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: false, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Garçom",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Pessoa", lastName: id, displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: null, pixKeyType: null, pixKey: null, admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Garçom", points: 4, minPoints: null, maxPoints: null },
      ...employee,
    },
  };
}

function periodo(participants: unknown[]) {
  db.tipPeriod.findUnique.mockResolvedValue({
    id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status: "OPEN",
    periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
    grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
    diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: false, descontaOutros: false, proporcionalEntrada: true,
    reservaPontos: 0, participants,
  });
}

const grupo = (employeeId: string, type: string, n: number) => ({ employeeId, type, _count: { _all: n } });

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 10000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
  // Afastada de 26/08 a 20/09: 26 dias no ciclo, 20 no mês civil de setembro.
  db.employeeScheduleDay.groupBy.mockImplementation(async (args: { where: { date: { gte: Date } } }) =>
    args.where.date.gte.getTime() === d("2026-08-26").getTime()
      ? [grupo("a", "AFASTAMENTO", 26)]
      : [grupo("a", "AFASTAMENTO", 20)]);
});

describe("afastamento não remunerado na apuração da gorjeta", () => {
  test("conta os dias da Escala e desconta da presença mesmo com férias sem desconto", async () => {
    periodo([participante("a"), participante("b")]);
    const comp = await computeTipCommission(2026, 9);

    expect(db.employeeScheduleDay.groupBy.mock.calls[0][0].where.type.in).toContain("AFASTAMENTO");
    const a = comp.participants.find((p) => p.employeeId === "a")!;
    expect(a).toMatchObject({ afastamento: 26, afastamentoOrigem: "ESCALA", diasComputados: 4, diasReferencia: 26, pontosApurados: 0.62 });
    expect(a.escala).toMatchObject({ afastamento: 26 });
    expect(comp.participants.find((p) => p.employeeId === "b")).toMatchObject({ afastamento: 0, diasComputados: 26 });

    // O retrato do fechamento guarda os dias.
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants.find((p) => p.employeeId === "a")).toMatchObject({ afastamento: 26 });
  });

  test("gorjeta integral escolhida no fechamento: a pessoa sem desconto de afastamento recebe os 4 pontos", async () => {
    periodo([{ ...participante("a"), descontaAfastamento: false }, participante("b")]);
    const comp = await computeTipCommission(2026, 9);
    const a = comp.participants.find((p) => p.employeeId === "a")!;
    expect(a).toMatchObject({ afastamento: 26, diasComputados: 26, pontosApurados: 4 });
    expect(a.regras.descontaAfastamento).toBe(false);
    expect(a.regrasEfetivas.descontaAfastamento).toBe(false);
    expect(comp.descontaAfastamento).toBe(true);
  });

  test("período sem desconto de afastamento: ninguém perde gorjeta, mas o salário do sem registro desconta", async () => {
    periodo([participante("a", { modality: "NAO_CLT", baseSalary: 2600 })]);
    db.tipPeriod.findUnique.mockResolvedValue({ ...(await db.tipPeriod.findUnique()), descontaAfastamento: false });
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const a = comp.participants[0];
    expect(comp.descontaAfastamento).toBe(false);
    expect(a.diasComputados).toBe(26);
    expect(a.salarioProporcional).toBe(866.7);
    // O retrato do fechamento guarda a regra do período.
    expect(montarRetrato(comp, []).params).toMatchObject({ descontaAfastamento: false });
  });

  describe("período fechado: afastamento lançado depois do fechamento não muda nada", () => {
    test("retrato de antes do campo: vale zero, mesmo com 26 dias na Escala agora", async () => {
      periodo([participante("a", { modality: "NAO_CLT", baseSalary: 2600 })]);
      const aberto = await db.tipPeriod.findUnique();
      db.tipPeriod.findUnique.mockResolvedValue({ ...aberto, status: "CLOSED" });
      db.tipPeriodClosing.findFirst.mockResolvedValue({
        id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-26"), closedByName: "Eli", participants: [{ employeeId: "a" }],
      });
      const a = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
      expect(a).toMatchObject({ afastamento: 0, afastamentoSalario: 0, diasComputados: 26, diasSalario: 30 });
    });

    test("retrato com o campo: vale o gravado (5 no ciclo, 3 no mês), não os 26/20 de hoje", async () => {
      periodo([participante("a", { modality: "NAO_CLT", baseSalary: 2600 })]);
      const aberto = await db.tipPeriod.findUnique();
      db.tipPeriod.findUnique.mockResolvedValue({ ...aberto, status: "CLOSED" });
      db.tipPeriodClosing.findFirst.mockResolvedValue({
        id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-26"), closedByName: "Eli",
        participants: [{ employeeId: "a", afastamento: 5, afastamentoSalario: 3 }],
      });
      const a = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
      // round(26 × 5 ÷ 31) = 4 descontados.
      expect(a).toMatchObject({ afastamento: 5, afastamentoSalario: 3, diasComputados: 22, diasSalario: 27 });
    });
  });

  test("sem registro: o salário desconta os dias do mês civil (20 de setembro), não os do ciclo", async () => {
    periodo([participante("a", { modality: "NAO_CLT", baseSalary: 2600 })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const a = comp.participants[0];
    expect(a.diasSalario).toBe(10);
    expect(a.salarioProporcional).toBe(866.7);
  });
});
