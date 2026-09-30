import { beforeEach, describe, expect, test, vi } from "vitest";

// Folgas da Escala na apuração da gorjeta: só aparecem (por tipo), não mexem em nada
// do cálculo; o fechamento guarda no retrato e o período fechado lê de lá. E o que está
// na Escala vem junto mesmo quando o valor foi digitado, para a tela mostrar a diferença.
vi.mock("../../../config/database.js", () => ({
  prisma: {
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

function participante(id: string, over: Record<string, unknown> = {}) {
  return {
    id: `tp-${id}`, employeeId: id, kind: "PONTOS", basePoints: 4, points: 4, pointsAdjustment: 0, fixedAmount: null,
    faltas: null, atestados: null, ferias: null, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Garçom",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Pessoa", lastName: id, displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: null, pixKeyType: null, pixKey: null, admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Garçom", points: 4, minPoints: null, maxPoints: null },
    },
    ...over,
  };
}

function periodo(participants: unknown[], status: "OPEN" | "CLOSED" = "OPEN") {
  db.tipPeriod.findUnique.mockResolvedValue({
    id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status,
    periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
    grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
    diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
    reservaPontos: 0, participants,
  });
}

const grupo = (employeeId: string, type: string, n: number) => ({ employeeId, type, _count: { _all: n } });

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 10000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
});

describe("folgas da escala na apuração", () => {
  test("conta as três folgas por tipo e não muda nenhum número do cálculo", async () => {
    periodo([participante("a"), participante("b")]);
    const semFolgas = await computeTipCommission(2026, 9);

    db.employeeScheduleDay.groupBy.mockResolvedValue([
      grupo("a", "FOLGA", 4), grupo("a", "FOLGA_FERIADO", 1), grupo("a", "FOLGA_BANCO_HORAS", 2),
    ]);
    const comFolgas = await computeTipCommission(2026, 9);

    expect(db.employeeScheduleDay.groupBy.mock.calls[0][0].where.type.in).toEqual(
      expect.arrayContaining(["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "FALTA", "ATESTADO", "FERIAS"]),
    );
    const a = comFolgas.participants.find((p) => p.employeeId === "a")!;
    expect(a.folgasEscala).toEqual({ total: 7, folga: 4, feriado: 1, bancoHoras: 2 });
    expect(comFolgas.participants.find((p) => p.employeeId === "b")!.folgasEscala).toEqual({ total: 0, folga: 0, feriado: 0, bancoHoras: 0 });

    // Nada do cálculo muda por causa das folgas.
    const numeros = (c: typeof comFolgas) => c.participants.map((p) => [p.faltas, p.diasComputados, p.fatorPresenca, p.points, p.rateioAmount, p.netCommission]);
    expect(numeros(comFolgas)).toEqual(numeros(semFolgas));
    expect(comFolgas.pointValue).toBe(semFolgas.pointValue);

    // O retrato do fechamento guarda as folgas.
    const retrato = montarRetrato(comFolgas, []);
    expect(retrato.participants.find((p) => p.employeeId === "a")).toMatchObject({ folgasEscala: { total: 7 } });
  });

  test("valor digitado prevalece, e o da escala vem junto para a tela mostrar a diferença", async () => {
    periodo([participante("a", { faltas: 1, atestados: null, ferias: 0 })]);
    db.employeeScheduleDay.groupBy.mockResolvedValue([grupo("a", "FALTA", 3), grupo("a", "ATESTADO", 2)]);
    // Férias são lidas por data (para juntar com as da Folha sem repetir dia).
    db.employeeScheduleDay.findMany.mockResolvedValue(["01", "02", "03", "04", "05"].map((dd) => ({ employeeId: "a", date: d(`2026-09-${dd}`) })));
    const comp = await computeTipCommission(2026, 9);
    const p = comp.participants[0];
    expect(p).toMatchObject({ faltas: 1, faltasOrigem: "MANUAL", atestados: 2, atestadosOrigem: "ESCALA", ferias: 0, feriasOrigem: "MANUAL" });
    expect(p.escala).toEqual({ faltas: 3, atestados: 2, ferias: 5 });
  });

  test("férias lançadas na Folha contam na gorjeta, somadas às da escala sem repetir o dia", async () => {
    periodo([participante("a")]);
    // Escala marcou 30/08 e 31/08; a Folha lançou de 30/08 a 03/09 (5 dias, 2 em comum).
    db.employeeScheduleDay.findMany.mockResolvedValue([{ employeeId: "a", date: d("2026-08-30") }, { employeeId: "a", date: d("2026-08-31") }]);
    db.payrollItem.findMany.mockImplementation(async (args: { where?: { type?: string } }) =>
      args?.where?.type === "FERIAS" ? [{ employeeId: "a", periodStart: d("2026-08-30"), periodEnd: d("2026-09-03") }] : []);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0]).toMatchObject({ ferias: 5, feriasOrigem: "ESCALA" });
  });

  test("fechado: folgas vêm do retrato, não da escala atual; retrato antigo dá null", async () => {
    periodo([participante("a"), participante("b")], "CLOSED");
    db.employeeScheduleDay.groupBy.mockResolvedValue([grupo("a", "FOLGA", 9), grupo("b", "FOLGA", 9)]);
    db.tipPeriodClosing.findFirst.mockResolvedValue({
      id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-26"), closedByName: "Eli",
      participants: [{ employeeId: "a", folgasEscala: { total: 4, folga: 4, feriado: 0, bancoHoras: 0 } }, { employeeId: "b" }],
    });
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants.find((p) => p.employeeId === "a")!.folgasEscala).toEqual({ total: 4, folga: 4, feriado: 0, bancoHoras: 0 });
    expect(comp.participants.find((p) => p.employeeId === "b")!.folgasEscala).toBeNull();
    // O retrato inteiro não vaza para a resposta.
    expect(comp.fechamento).toEqual({ id: "f1", code: "GOR-2026-0009/v1", version: 1, closedAt: "2026-09-26T00:00:00.000Z", closedByName: "Eli" });
  });
});
