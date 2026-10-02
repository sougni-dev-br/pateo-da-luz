import { beforeEach, describe, expect, test, vi } from "vitest";

// Gorjeta informada à contabilidade pelo teto do IR: a apuração devolve, por pessoa,
// teto − salário registrado VIGENTES no mês, sem mexer no rateio nem no que se paga.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn() },
    employee: { findFirst: vi.fn(), findMany: vi.fn() },
    company: { findMany: vi.fn() },
    tipPeriod: { findUnique: vi.fn(), findFirst: vi.fn() },
    tipVale: { findMany: vi.fn() },
    employeeScheduleDay: { groupBy: vi.fn(), findMany: vi.fn() },
    vtFaltaDeduction: { findMany: vi.fn() },
    revenueEntry: { aggregate: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    dRECategory: { findMany: vi.fn() },
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
const h = (campo: string, de: string | null, para: string | null, vigente: string) => ({
  employeeId: "e1", campo, valorAnterior: de, valorNovo: para, vigenteDesde: d(vigente), createdAt: new Date(`${vigente}T12:00:00Z`),
});

function participante(emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 20, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Elioenai", lastName: "Silva", displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: 3672, tetoIrGorjeta: 5000, pixKeyType: null, pixKey: null, recebeAdiantamento: false,
      admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Cozinha", points: 20, minPoints: null, maxPoints: null }, ...emp,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.vtFaltaDeduction.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 20000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.dRECategory.findMany.mockResolvedValue([]);
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.company.findMany.mockResolvedValue([]);
});

function periodoSetembro(participants: unknown[]) {
  db.tipPeriod.findUnique.mockResolvedValue({
    id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status: "OPEN",
    periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
    grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
    diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
    reservaPontos: 0, participants,
  });
}

const sozinho = async (emp: Record<string, unknown> = {}, dadosPessoais = true) => {
  periodoSetembro([participante(emp)]);
  return (await computeTipCommission(2026, 9, { incluirDadosPessoais: dadosPessoais })).participants[0];
};

describe("gorjeta informada à contabilidade", () => {
  test("com teto: teto − salário registrado; rateio, gorjeta líquida e total a pagar não mudam", async () => {
    const semTeto = await sozinho({ tetoIrGorjeta: null });
    const comTeto = await sozinho();
    expect(comTeto).toMatchObject({ gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 });
    expect(comTeto.rateioAmount).toBe(semTeto.rateioAmount);
    expect(comTeto.netCommission).toBe(semTeto.netCommission);
    expect(comTeto.totalAPagar).toBe(semTeto.totalAPagar);
    expect(comTeto.points).toBe(semTeto.points);
    expect(comTeto.netCommission).not.toBe(1328);
  });

  // Auditoria 01/10: o teto nunca informa mais que a gorjeta real.
  test("com teto e gorjeta real menor que teto − salário: informa a real (2 pts = R$ 320,00)", async () => {
    periodoSetembro([{ ...participante(), basePoints: 2 }]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.gorjetaInformadaPeloTeto).toBe(true);
    expect(p.gorjetaInformada).toBe(p.netCommission);
    expect(p.gorjetaInformada).toBeLessThan(1328);
  });

  test("com teto, em teste (fora do rateio): sem gorjeta real, informa zero (mesmo com crédito na aba Vales)", async () => {
    periodoSetembro([{ ...participante({ participaGorjeta: true, inicioGorjeta: null }), vales: [{ id: "v1", type: "CREDITO", amount: 500, date: null, notes: null }] }]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.foraDaGorjeta).toBe(true);
    expect(p.gorjetaInformadaPeloTeto).toBe(true);
    expect(p.gorjetaInformada).toBe(0);
  });

  test("sem teto: a gorjeta informada é a gorjeta líquida (mesmo sem permissão)", async () => {
    const p = await sozinho({ tetoIrGorjeta: null }, false);
    expect(p).toMatchObject({ gorjetaInformadaPeloTeto: false, tetoIrGorjeta: null });
    expect(p.gorjetaInformada).toBe(p.netCommission);
  });

  test("sem permissão de ver Funcionários: só o indicador (o valor revelaria o salário)", async () => {
    const p = await sozinho({}, false);
    expect(p).toMatchObject({ gorjetaInformada: null, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: null, baseSalary: null });
  });

  test("salário vigente no mês: aumento de outubro não muda setembro (3.600 → 1.400)", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("baseSalary", "3600.00", "3672.00", "2026-10-01")]);
    expect(await sozinho()).toMatchObject({ gorjetaInformada: 1400, gorjetaInformadaPeloTeto: true });
  });

  test("teto vigente no mês: posto em outubro, setembro vai com a gorjeta do rateio", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("tetoIrGorjeta", null, "5000.00", "2026-10-01")]);
    const p = await sozinho();
    expect(p).toMatchObject({ gorjetaInformadaPeloTeto: false, tetoIrGorjeta: null });
    expect(p.gorjetaInformada).toBe(p.netCommission);
  });

  test("teto tirado em outubro: setembro continua pelo teto", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("tetoIrGorjeta", "5000.00", null, "2026-10-01")]);
    expect(await sozinho({ tetoIrGorjeta: null })).toMatchObject({ gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 });
  });

  test("sem registro no mês: o teto não vale", async () => {
    const p = await sozinho({ modality: "NAO_CLT" });
    expect(p.gorjetaInformadaPeloTeto).toBe(false);
    expect(p.gorjetaInformada).toBe(p.netCommission);
  });

  test("teto sem salário registrado: vai a gorjeta do rateio, com aviso", async () => {
    periodoSetembro([participante({ baseSalary: null })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].gorjetaInformadaPeloTeto).toBe(false);
    expect(comp.participants[0].gorjetaInformada).toBe(comp.participants[0].netCommission);
    expect(comp.warnings.join(" ")).toMatch(/teto do IR.*sem salário registrado/i);
  });
});

// O fechamento guarda a gorjeta informada (e se foi pelo teto): um teto ou salário mudado
// depois, com data retroativa, não muda o que foi enviado de um mês FECHADO. Reabrir recalcula.
describe("gorjeta informada no período fechado", () => {
  function fechado(retrato: unknown[] | null, status: "CLOSED" | "OPEN" = "CLOSED") {
    db.tipPeriod.findUnique.mockResolvedValue({
      id: "per1", code: "GOR-2026-0009", label: "Gorjeta 26/08–25/09", status,
      periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"),
      grossPool: 20000, servicoFaturamento: 20000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
      diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
      reservaPontos: 0, participants: [{ ...participante(), netCommission: 3200 }],
    });
    db.tipPeriodClosing.findFirst.mockResolvedValue(retrato == null ? null
      : { id: "c1", code: "GOR-2026-0009/v1", version: 1, closedAt: d("2026-09-30"), closedByName: "Eli", participants: retrato });
  }
  // Salário mudado depois do fechamento, valendo desde 01/09: o recálculo daria 5.000 − 3.800 = 1.200.
  const salarioRetroativo = () => db.employeeHistorico.findMany.mockResolvedValue([h("baseSalary", "3672.00", "3800.00", "2026-09-01")]);
  const calcular = async (dadosPessoais = true) => (await computeTipCommission(2026, 9, { incluirDadosPessoais: dadosPessoais })).participants[0];

  test("fechado pelo teto: vale o valor gravado, não o recálculo", async () => {
    fechado([{ employeeId: "e1", gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 }]);
    salarioRetroativo();
    expect(await calcular()).toMatchObject({ gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 });
  });

  test("fechado sem teto e teto posto depois com data retroativa: continua sem teto", async () => {
    fechado([{ employeeId: "e1", gorjetaInformada: 777.77 }]);
    const p = await calcular();
    expect(p).toMatchObject({ gorjetaInformada: 777.77, gorjetaInformadaPeloTeto: false, tetoIrGorjeta: null });
  });

  test("fechado, sem permissão de ver Funcionários: pelo teto continua sem o valor", async () => {
    fechado([{ employeeId: "e1", gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 }]);
    expect(await calcular(false)).toMatchObject({ gorjetaInformada: null, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: null });
  });

  test("reaberto: volta a recalcular pelo cadastro", async () => {
    fechado(null, "OPEN");
    salarioRetroativo();
    expect(await calcular()).toMatchObject({ gorjetaInformada: 1200, gorjetaInformadaPeloTeto: true });
  });

  test("retrato antigo (sem o campo): recalcula, como antes", async () => {
    fechado([{ employeeId: "e1" }]);
    salarioRetroativo();
    expect(await calcular()).toMatchObject({ gorjetaInformada: 1200, gorjetaInformadaPeloTeto: true });
  });

  test("o retrato do fechamento guarda a gorjeta informada e o teto de quem é CLT", async () => {
    periodoSetembro([participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(montarRetrato(comp, []).participants[0]).toMatchObject({ gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000 });
  });

  test("CLT sem teto: guarda a informada (a líquida), sem o indicador de teto", async () => {
    periodoSetembro([participante({ tetoIrGorjeta: null })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = montarRetrato(comp, []).participants[0];
    expect(p.gorjetaInformada).toBe(comp.participants[0].netCommission);
    expect(p).not.toHaveProperty("gorjetaInformadaPeloTeto");
  });
});
