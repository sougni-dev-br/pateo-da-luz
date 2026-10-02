import { beforeEach, describe, expect, test, vi } from "vitest";

// Opção A: cálculo de um mês passado usa o salário e o vínculo VIGENTES naquele mês.
// Gorjeta (salário do sem registro), folha (salário/adiantamento gerados) e rescisão
// (vínculo na saída), todos com o banco de mentira e um histórico do cadastro.
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
import { computePayroll } from "../payroll.service.js";
import { apurarRescisao } from "../rescisao-apuracao.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const h = (campo: string, de: string | null, para: string | null, vigente: string) => ({
  employeeId: "e1", campo, valorAnterior: de, valorNovo: para, vigenteDesde: d(vigente), createdAt: new Date(`${vigente}T12:00:00Z`),
});

// Hoje: CLT com 2.600. Até setembro era sem registro com 2.200 (mudou em 01/10).
const MUDOU_EM_OUTUBRO = [h("baseSalary", "2200.00", "2600.00", "2026-10-01"), h("modality", "NAO_CLT", "CLT", "2026-10-01")];

function participante(emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 2, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Ana", lastName: "Silva", displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: 2600, pixKeyType: null, pixKey: null, recebeAdiantamento: false,
      admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Cozinha", points: 2, minPoints: null, maxPoints: null }, ...emp,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeHistorico.findMany.mockResolvedValue(MUDOU_EM_OUTUBRO);
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

describe("gorjeta de mês passado", () => {
  test("setembro usa o salário e o vínculo de setembro, não o aumento de outubro", async () => {
    periodoSetembro([participante()]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.semRegistro).toBe(true);
    expect(p.baseSalary).toBe(2200);
    expect(p.salarioProporcional).toBe(2200);
  });

  test("sem histórico, vale o cadastro atual (CLT: não recebe salário na lista)", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([]);
    periodoSetembro([participante()]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.semRegistro).toBe(false);
    expect(p.salarioProporcional).toBe(0);
  });

  test("empresa do mês vem do histórico, com o nome do cadastro de empresas", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("companyId", "c-velha", "c-nova", "2026-10-01")]);
    db.company.findMany.mockResolvedValue([{ id: "c-velha", tradeName: "Pateo Frei" }]);
    periodoSetembro([participante({ companyId: "c-nova", company: { tradeName: "Pateo Nova" } })]);
    const p = (await computeTipCommission(2026, 9)).participants[0];
    expect(p).toMatchObject({ companyId: "c-velha", companyName: "Pateo Frei" });
  });
});

describe("folha de mês passado", () => {
  const empFolha = {
    id: "e1", firstName: "Ana", lastName: "Silva", displayName: null, sector: "Cozinha", modality: "CLT", baseSalary: 2600,
    recebeAdiantamento: false, admissionDate: d("2025-01-01"), terminationDate: null, includeInSchedule: true,
    vtType: "NENHUM", vtPeriodicity: "QUINZENAL", vtFixedAmount: null, vtLegs: [], vtMonthlyFare: null,
  };

  test("setembro (sem registro): sem salário pela folha (sai pelo acerto da lista) e sem a parcela do dia 20", async () => {
    db.employee.findMany.mockResolvedValue([empFolha]);
    const { items } = await computePayroll(2026, 9);
    expect(items.filter((i) => i.type === "ADIANTAMENTO")).toHaveLength(0);
    expect(items.filter((i) => i.type === "SALARIO")).toHaveLength(0);
  });

  test("setembro usa o base de 2.200 do histórico (adiantamento do sem registro marcado: 40%)", async () => {
    db.employee.findMany.mockResolvedValue([{ ...empFolha, recebeAdiantamento: true }]);
    const { items } = await computePayroll(2026, 9);
    expect(items.find((i) => i.type === "ADIANTAMENTO")).toMatchObject({ amount: 880, details: { base: 2200, semRegistro: true } });
  });

  test("outubro já usa o valor novo (CLT, 2.600, com adiantamento)", async () => {
    db.employee.findMany.mockResolvedValue([empFolha]);
    const { items } = await computePayroll(2026, 10);
    expect(items.find((i) => i.type === "ADIANTAMENTO")).toMatchObject({ amount: 1040 });
    expect(items.find((i) => i.type === "SALARIO")).toMatchObject({ amount: 1560, details: { base: 2600 } });
  });
});

describe("rescisão", () => {
  test("o vínculo é o vigente na saída, não o de hoje", async () => {
    // Saiu em 12/09 sem registro; depois o cadastro foi mudado para CLT.
    db.employee.findFirst.mockResolvedValue({ id: "e1", modality: "CLT", terminationDate: d("2026-09-12"), vtType: "NENHUM", vtLegs: [] });
    db.tipPeriod.findFirst.mockResolvedValue(null);
    const a = (await apurarRescisao("e1"))!;
    expect(a.semRegistro).toBe(true);
    expect(a.vales.entraNaRescisao).toBe(true);
  });

  test("salário proporcional da rescisão sai com o salário vigente na saída", async () => {
    db.employee.findFirst.mockResolvedValue({ id: "e1", modality: "CLT", terminationDate: d("2026-09-12"), vtType: "NENHUM", vtLegs: [] });
    db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", competenceYear: 2026, competenceMonth: 9 });
    db.tipVale.findMany.mockResolvedValue([]);
    periodoSetembro([participante({ terminationDate: d("2026-09-12") })]);
    const a = (await apurarRescisao("e1"))!;
    // 2.200 ÷ 30 = 73,33 × 12 dias = 879,96 (não 2.600 ÷ 30).
    expect(a.gorjeta?.salarioProporcional).toBe(879.96);
  });
});
