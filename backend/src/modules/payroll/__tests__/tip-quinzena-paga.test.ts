import { beforeEach, describe, expect, test, vi } from "vitest";

// A lista de pagamento desconta de quem recebe por quinzena o título "1ª quinzena" lançado em
// Contas a Pagar (o valor pago), não a metade fixa do salário. Sem baixa ou sem título,
// desconta o previsto e avisa. Pessoas fictícias.
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
import { primeiraQuinzenaSemRegistro, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";

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
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Beltrano", lastName: "Quinzena", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2000, pixKeyType: null, pixKey: null, recebeAdiantamento: false, pagamentoQuinzenal: true,
      admissionDate: d("2025-01-01"), terminationDate: null,
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

type Titulo = { employeeId: string; amount: number; paidAmount: number | null; paymentDate: Date | null; details?: unknown };
const QUINZENA = { semRegistro: true, primeiraQuinzena: true };
function titulos(itens: Titulo[]) {
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type?: string } }) => (where.type === "ADIANTAMENTO" ? itens : []));
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

const avisosDaQuinzena = (w: string[]) => w.filter((x) => /quinzena/i.test(x));

describe("lista de pagamento: 1ª quinzena pelo título lançado", () => {
  test("título baixado com valor diferente da metade: desconta o PAGO, sem aviso, e não vira adiantamento", async () => {
    periodo([participante()]);
    titulos([{ employeeId: "e1", amount: 1000, paidAmount: 950, paymentDate: d("2026-09-15"), details: QUINZENA }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.primeiraQuinzena).toBe(950);
    expect(p.adiantamentoSalarial).toBe(0);
    expect(p.totalAPagar).toBe(Math.round((2000 - 950 + p.netCommission) * 100) / 100);
    expect(avisosDaQuinzena(comp.warnings)).toEqual([]);
  });

  test("título lançado e ainda sem baixa: desconta o previsto e avisa", async () => {
    periodo([participante()]);
    titulos([{ employeeId: "e1", amount: 1000, paidAmount: null, paymentDate: null, details: QUINZENA }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].primeiraQuinzena).toBe(1000);
    expect(avisosDaQuinzena(comp.warnings)).toEqual([expect.stringMatching(/1ª quinzena de 09\/2026 lançada mas ainda sem baixa.*Beltrano Quinzena/)]);
  });

  test("sem título: desconta a metade do salário e avisa que falta lançar a 1ª quinzena", async () => {
    periodo([participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].primeiraQuinzena).toBe(1000);
    expect(avisosDaQuinzena(comp.warnings)).toEqual([expect.stringMatching(/falta lançar a 1ª quinzena de 09\/2026.*Gerar 1ª quinzena \(sem registro\).*Beltrano Quinzena/)]);
  });

  test("o aviso de falta lançar sai também sem a permissão de Funcionários", async () => {
    periodo([participante()]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].primeiraQuinzena).toBeNull();
    expect(avisosDaQuinzena(comp.warnings)).toHaveLength(1);
  });

  test("entrou depois do dia 15 e sem título: nada a descontar e nenhum aviso", async () => {
    periodo([participante({ admissionDate: d("2026-09-20") })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].primeiraQuinzena).toBe(0);
    expect(avisosDaQuinzena(comp.warnings)).toEqual([]);
  });

  test("adiantamento comum lançado para quem é por quinzena: não desconta (sem desconto em dobro) e avisa; a quinzena segue", async () => {
    periodo([participante()]);
    titulos([
      { employeeId: "e1", amount: 1000, paidAmount: 1000, paymentDate: d("2026-09-15"), details: QUINZENA },
      { employeeId: "e1", amount: 800, paidAmount: 800, paymentDate: d("2026-09-20"), details: { semRegistro: true } },
    ]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.primeiraQuinzena).toBe(1000);
    expect(p.adiantamentoSalarial).toBe(0);
    expect(comp.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Recebem por quinzena, mas têm adiantamento de 09\/2026 lançado/)]));
  });

  test("quem não é por quinzena e tem só o adiantamento: o título comum continua sendo o adiantamento", async () => {
    periodo([participante({ pagamentoQuinzenal: false, recebeAdiantamento: true })]);
    titulos([{ employeeId: "e1", amount: 800, paidAmount: 780, paymentDate: d("2026-09-20"), details: { semRegistro: true } }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(780);
    expect(comp.participants[0].primeiraQuinzena).toBe(0);
  });

  test("informa no participante se recebe por quinzena (para o vencimento do acerto)", async () => {
    periodo([participante()]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].pagamentoQuinzenal).toBe(true);
  });
});

describe("regra pura", () => {
  test("título lançado: desconta o pago (ou o previsto), limitado ao salário proporcional", () => {
    const regras = { start: d("2026-08-26"), end: d("2026-09-25"), mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") } } as unknown as RegrasPeriodo;
    const base = { semRegistro: true, pagamentoQuinzenal: true, salarioBase: 2000, admissao: null, desligamento: null } as unknown as ParticipanteEntrada;
    expect(primeiraQuinzenaSemRegistro({ ...base, quinzenaLancada: { previsto: 1000, pago: 950 } }, regras, 2000)).toBe(950);
    expect(primeiraQuinzenaSemRegistro({ ...base, quinzenaLancada: { previsto: 1000, pago: null } }, regras, 2000)).toBe(1000);
    expect(primeiraQuinzenaSemRegistro({ ...base, quinzenaLancada: { previsto: 1000, pago: 1000 } }, regras, 600)).toBe(600);
  });
});
