import { beforeEach, describe, expect, test, vi } from "vitest";

// A lista de pagamento desconta do sem registro o adiantamento LANÇADO em Contas a Pagar (o
// valor pago), não os 40% do cadastro. Sem baixa ou sem título, desconta o estimado e avisa.
// Pessoas fictícias.
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
import { computeTipCommission, somarAdiantamentos } from "../tip-commission.service.js";
import { adiantamentoSemRegistro, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function participante(emp: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 2, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Cozinha",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [],
    employee: {
      firstName: "Fulana", lastName: "de Tal", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2600, pixKeyType: null, pixKey: null, recebeAdiantamento: true,
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

type Titulo = { employeeId: string; amount: number; paidAmount: number | null; paymentDate: Date | null };
function titulosDeAdiantamento(itens: Titulo[]) {
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

const avisosDeAdiantamento = (w: string[]) => w.filter((x) => /adiantamento/i.test(x));

describe("lista de pagamento: adiantamento do sem registro pelo título lançado", () => {
  test("título baixado com valor diferente dos 40%: desconta o PAGO, sem aviso", async () => {
    periodo("OPEN", [participante()]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 1040, paidAmount: 966.5, paymentDate: d("2026-09-20") }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.adiantamentoSalarial).toBe(966.5);
    expect(p.totalAPagar).toBe(Math.round((2600 - 966.5 + p.netCommission) * 100) / 100);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([]);
  });

  test("título lançado e ainda sem baixa: desconta o previsto e avisa", async () => {
    periodo("OPEN", [participante()]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 1040, paidAmount: null, paymentDate: null }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(1040);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([expect.stringMatching(/09\/2026 lançado mas ainda sem baixa.*Fulana de Tal/)]);
  });

  test("marcado no cadastro e sem título: desconta os 40% e avisa que não está lançado", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(1040);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([expect.stringMatching(/não está lançado em Contas a Pagar.*40%.*Fulana de Tal/)]);
  });

  test("o aviso sai também sem a permissão de Funcionários (sem mostrar valor)", async () => {
    periodo("OPEN", [participante()]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].adiantamentoSalarial).toBeNull();
    expect(avisosDeAdiantamento(comp.warnings)).toHaveLength(1);
  });

  test("título pago a quem não está marcado: desconta mesmo assim (o dinheiro saiu)", async () => {
    periodo("OPEN", [participante({ recebeAdiantamento: false })]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 880, paidAmount: 880, paymentDate: d("2026-09-20") }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(880);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([]);
  });

  test("não marcado e sem título: nada a descontar, nenhum aviso (como antes)", async () => {
    periodo("OPEN", [participante({ recebeAdiantamento: false })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(0);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([]);
  });

  test("CLT: o título de adiantamento não entra na lista (CLT não recebe por ela)", async () => {
    periodo("OPEN", [participante({ modality: "CLT" })]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 1040, paidAmount: 1040, paymentDate: d("2026-09-20") }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(0);
  });

  test("quem recebe por quinzena: o título lançado não é descontado (sem desconto em dobro) e a lista avisa", async () => {
    periodo("OPEN", [participante({ pagamentoQuinzenal: true, recebeAdiantamento: false })]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 1040, paidAmount: 1040, paymentDate: d("2026-09-20") }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].adiantamentoSalarial).toBe(0);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([expect.stringMatching(/quinzena.*09\/2026 lançado.*Fulana de Tal/)]);
  });

  test("só conta o título marcado como do sem registro (o do extrato CLT fica de fora)", async () => {
    periodo("OPEN", [participante()]);
    await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const consulta = db.payrollItem.findMany.mock.calls.find(([a]: [{ where: { type?: string } }]) => a.where.type === "ADIANTAMENTO");
    expect(consulta[0].where.details).toEqual({ path: ["semRegistro"], equals: true });
  });

  test("mês fechado: vale o total gravado, sem aviso — o título lançado depois não mexe no fechado", async () => {
    periodo("CLOSED", [participante({}, { rateioAmount: 300, netCommission: 300, salarioProporcional: 2600, totalAPagar: 1860 })]);
    titulosDeAdiantamento([{ employeeId: "e1", amount: 1040, paidAmount: 966.5, paymentDate: d("2026-09-20") }]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].totalAPagar).toBe(1860);
    expect(comp.participants[0].adiantamentoSalarial).toBe(1040);
    expect(avisosDeAdiantamento(comp.warnings)).toEqual([]);
  });
});

describe("regras puras", () => {
  test("soma por pessoa: baixado vale o pago, em aberto vale o previsto", () => {
    const m = somarAdiantamentos([
      { employeeId: "a", amount: 1040, paidAmount: 966.5, paymentDate: d("2026-09-20") },
      { employeeId: "b", amount: 880, paidAmount: null, paymentDate: null },
      { employeeId: "c", amount: 500, paidAmount: 500, paymentDate: d("2026-09-20") },
      { employeeId: "c", amount: 300, paidAmount: null, paymentDate: null },
      { employeeId: "d", amount: 880, paidAmount: null, paymentDate: d("2026-09-20") },
    ]);
    expect(m.get("a")).toEqual({ previsto: 1040, pago: 966.5, emAberto: false });
    expect(m.get("b")).toEqual({ previsto: 880, pago: null, emAberto: true });
    expect(m.get("c")).toEqual({ previsto: 800, pago: 800, emAberto: true });
    // Baixa sem valor pago informado: vale o valor do título.
    expect(m.get("d")).toEqual({ previsto: 880, pago: 880, emAberto: false });
  });

  test("o descontado nunca passa do salário proporcional (poucos dias no mês)", () => {
    const regras = { adiantamentoPercent: 40, adiantamentoDia: 20 } as unknown as RegrasPeriodo;
    const p = { semRegistro: true, salarioBase: 2600, adiantamentoLancado: { previsto: 1040, pago: 1040 } } as unknown as ParticipanteEntrada;
    expect(adiantamentoSemRegistro(p, regras, 600)).toBe(600);
  });
});
