import { beforeEach, describe, expect, test, vi } from "vitest";

// O Ponto fechado alimenta a apuração: faltas (coluna Faltas) e hora extra / adicional noturno (lista de pagamento).
// O que foi digitado vale mais; período fechado não muda; CLT não recebe horas pela lista.
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
vi.mock("../ponto-apuracao.js", () => ({ carregarPontoDaApuracao: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { carregarPontoDaApuracao } from "../ponto-apuracao.js";
import { computeTipCommission } from "../tip-commission.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function participante(over: Record<string, unknown> = {}, emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 2, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: null, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
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

const comPonto = (faltas: number | null, horas: { horaExtraMin: number; noturnoMin: number } | null) =>
  vi.mocked(carregarPontoDaApuracao).mockResolvedValue({ faltas: () => faltas, horas: () => horas });

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
  comPonto(null, null);
});

describe("hora extra e adicional noturno vindos do Ponto fechado", () => {
  test("nada digitado: a lista usa as horas do Ponto, igual a digitá-las", async () => {
    periodo("OPEN", [participante()]);
    comPonto(null, { horaExtraMin: 5 * 60, noturnoMin: 2 * 60 });
    const doPonto = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];

    periodo("OPEN", [participante({ horaExtra: "5:00", adicionalNoturno: "2:00" })]);
    comPonto(null, null);
    const digitado = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];

    expect(doPonto.valorHoraExtra).toBeGreaterThan(0);
    expect(doPonto.valorHoraExtra).toBe(digitado.valorHoraExtra);
    expect(doPonto.valorAdicionalNoturno).toBe(digitado.valorAdicionalNoturno);
    expect(doPonto.totalAPagar).toBe(digitado.totalAPagar);
    expect(doPonto).toMatchObject({ horaExtra: null, horaExtraPonto: "5:00", adicionalNoturnoPonto: "2:00" });
  });

  test("o que foi digitado vence o Ponto, inclusive 0:00", async () => {
    periodo("OPEN", [participante({ horaExtra: "1:00", adicionalNoturno: "0:00" })]);
    comPonto(null, { horaExtraMin: 5 * 60, noturnoMin: 2 * 60 });
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.valorHoraExtra).toBe(15);
    expect(p.valorAdicionalNoturno).toBe(0);
  });

  test("CLT: as horas do Ponto vão para a contabilidade, mas o total a pagar não muda", async () => {
    periodo("OPEN", [participante({}, { modality: "CLT" })]);
    comPonto(null, null);
    const semPonto = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    comPonto(null, { horaExtraMin: 5 * 60, noturnoMin: 2 * 60 });
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.horaExtraPonto).toBe("5:00");
    expect(p.adicionalNoturnoPonto).toBe("2:00");
    expect(p.valorHoraExtra).toBe(0);
    expect(p.totalAPagar).toBe(semPonto.totalAPagar);
  });

  test("sem Ponto fechado: nada muda", async () => {
    periodo("OPEN", [participante()]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.valorHoraExtra).toBe(0);
    expect(p.horaExtraPonto).toBeNull();
  });

  test("período fechado não consulta o Ponto: vale o que o fechamento gravou", async () => {
    periodo("CLOSED", [participante()]);
    db.tipPeriodClosing.findFirst.mockResolvedValue({ id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-30"), closedByName: "Eli", participants: [] });
    comPonto(null, { horaExtraMin: 5 * 60, noturnoMin: 2 * 60 });
    await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(carregarPontoDaApuracao).not.toHaveBeenCalled();
  });
});

describe("faltas vindas do Ponto fechado", () => {
  beforeEach(() => {
    db.employeeScheduleDay.groupBy.mockResolvedValue([{ employeeId: "e1", type: "FALTA", _count: { _all: 1 } }]);
  });

  test("o Ponto soma o que a Escala não tinha: a coluna usa o do Ponto e diz a origem", async () => {
    periodo("OPEN", [participante()]);
    comPonto(3, null);
    const p = (await computeTipCommission(2026, 9)).participants[0];
    expect(p.faltas).toBe(3);
    expect(p.faltasOrigem).toBe("PONTO");
    expect(p.escala.faltas).toBe(1);
  });

  test("Ponto igual à Escala: segue como Escala", async () => {
    periodo("OPEN", [participante()]);
    comPonto(1, null);
    const p = (await computeTipCommission(2026, 9)).participants[0];
    expect(p.faltas).toBe(1);
    expect(p.faltasOrigem).toBe("ESCALA");
  });

  test("falta digitada vence o Ponto", async () => {
    periodo("OPEN", [participante({ faltas: 2 })]);
    comPonto(3, null);
    const p = (await computeTipCommission(2026, 9)).participants[0];
    expect(p.faltas).toBe(2);
    expect(p.faltasOrigem).toBe("MANUAL");
  });

  test("sem Ponto fechado: só a Escala", async () => {
    periodo("OPEN", [participante()]);
    comPonto(null, null);
    const p = (await computeTipCommission(2026, 9)).participants[0];
    expect(p.faltas).toBe(1);
    expect(p.faltasOrigem).toBe("ESCALA");
  });
});
