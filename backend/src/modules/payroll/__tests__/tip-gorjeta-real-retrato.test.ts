import { beforeEach, describe, expect, test, vi } from "vitest";

// computeTipCommission com o banco de mentira: a gorjeta real só aparece (e só vai para
// o retrato do fechamento) quando entra no cálculo; gravada sem efeito vira aviso.
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

let seq = 0;
function participante(over: Record<string, unknown>, emp: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `tp${seq}`, employeeId: `e${seq}`, kind: "PONTOS", basePoints: 4, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Garçom",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Pessoa", lastName: String(seq), displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: null, pixKeyType: null, pixKey: null, admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Garçom", points: 4, minPoints: null, maxPoints: null }, ...emp,
    },
    ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 10000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
});

describe("gorjeta real no cálculo", () => {
  test("aplicada: aparece no participante e no retrato", async () => {
    periodo([participante({ gorjetaReal: 500, gorjetaRealMotivo: "combinado" }, { displayName: "Zé" })]);
    const comp = await computeTipCommission(2026, 9);
    const p = comp.participants[0];
    expect(p.gorjetaReal).toMatchObject({ valor: 500, motivo: "combinado" });
    expect(p.rateioAmount).toBe(500);
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants[0]).toMatchObject({ gorjetaReal: { valor: 500 }, apelido: "Zé" });
    expect(comp.warnings.some((w) => w.includes("não vale mais"))).toBe(false);
  });

  test("ganhou data de saída: some do participante e do retrato, com aviso para rever", async () => {
    periodo([participante({ gorjetaReal: 500, rescisaoServicoBruto: 8000 }, { terminationDate: d("2026-09-10") })]);
    const comp = await computeTipCommission(2026, 9);
    const p = comp.participants[0];
    expect(p.tipoCalculo).toBe("RESCISAO");
    expect(p.gorjetaReal).toBeNull();
    expect(montarRetrato(comp, []).participants[0]).not.toHaveProperty("gorjetaReal");
    expect(comp.warnings).toContainEqual(expect.stringMatching(/A gorjeta real de Pessoa \d+ .*não vale mais porque saiu no período/));
  });

  test("virou cota fixa: aviso com o motivo", async () => {
    periodo([participante({ kind: "FIXO", fixedAmount: 300, basePoints: null, gorjetaReal: 500 })]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].gorjetaReal).toBeNull();
    expect(comp.participants[0].rateioAmount).toBe(300);
    expect(comp.warnings).toContainEqual(expect.stringContaining("porque passou a receber cota fixa"));
  });
});

describe("retrato do fechamento", () => {
  test("cada pessoa leva o apelido (null sem apelido), sem CPF nem PIX", async () => {
    periodo([participante({}, { displayName: "Neném", pixKey: "123", cpf: "000" }), participante({})]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const r = montarRetrato(comp, []);
    expect(r.participants.map((p) => p.apelido)).toEqual(["Neném", null]);
    expect(JSON.stringify(r.participants)).not.toMatch(/pix|cpf/i);
  });
});
