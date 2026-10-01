import { beforeEach, describe, expect, test, vi } from "vitest";

// computeTipCommission com o banco de mentira: a 1ª quinzena de quem não tem registro e
// recebe por quinzena sai do total a pagar, usa o cadastro VIGENTE no mês (histórico), só
// aparece com a permissão de Funcionários, vai para o retrato e não muda um período fechado.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn() },
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
import { composicaoSemRegistro } from "../tip-conferencia.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const h = (campo: string, de: string | null, para: string | null, vigente: string) => ({
  employeeId: "e1", campo, valorAnterior: de, valorNovo: para, vigenteDesde: d(vigente), createdAt: new Date(`${vigente}T12:00:00Z`),
});

// Rafa: sem registro, R$ 2.000, recebe por quinzena (dias 15 e 30). Fora do rateio (0 pontos)
// para o total ser só o salário.
function rafa(over: Record<string, unknown> = {}, emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 0, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Salão",
    horaExtra: null, adicionalNoturno: null, justificada: false, foraDaGorjeta: false, vales: [],
    employee: {
      firstName: "Rafa", lastName: "Teste", displayName: null, isActive: true, companyId: null, company: null,
      modality: "NAO_CLT", baseSalary: 2000, pixKeyType: null, pixKey: null, recebeAdiantamento: false, pagamentoQuinzenal: true,
      admissionDate: d("2026-01-10"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Salão", points: 0, minPoints: null, maxPoints: null }, ...emp,
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
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.employeeScheduleDay.groupBy.mockResolvedValue([]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.revenueEntry.aggregate.mockResolvedValue({ _sum: { serviceAmount: 20000 } });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriodClosing.findFirst.mockResolvedValue(null);
  db.tipReserveMovement.findMany.mockResolvedValue([]);
  db.tipReserveMovement.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20 });
});

describe("1ª quinzena no cálculo da gorjeta", () => {
  test("aberto, com permissão: Rafa recebe 1.000 no dia 30; a quinzena vai para o retrato e os totais", async () => {
    periodo("OPEN", [rafa()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.salarioProporcional).toBe(2000);
    expect(p.primeiraQuinzena).toBe(1000);
    expect(p.adiantamentoSalarial).toBe(0);
    expect(p.totalAPagar).toBe(1000);
    expect(comp.totals.primeirasQuinzenas).toBe(1000);
    expect(comp.totals.adiantamentos).toBe(0);
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants[0]).toMatchObject({ primeiraQuinzena: 1000, totalAPagar: 1000 });
    expect(retrato.participants[0]).not.toHaveProperty("adiantamentoSalarial");
    expect(retrato.totals).toMatchObject({ primeirasQuinzenas: 1000 });
  });

  test("sem a permissão de Funcionários: a quinzena (metade do salário) não sai na resposta", async () => {
    periodo("OPEN", [rafa()]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].primeiraQuinzena).toBeNull();
    expect(comp.totals.primeirasQuinzenas).toBeNull();
    // O total a pagar continua descontando (ele já aparecia sem a permissão).
    expect(comp.participants[0].totalAPagar).toBe(1000);
  });

  test("recebe só no pagamento: retrato sem o campo, como os de antes", async () => {
    periodo("OPEN", [rafa({}, { pagamentoQuinzenal: false })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0].primeiraQuinzena).toBe(0);
    expect(comp.participants[0].totalAPagar).toBe(2000);
    expect(montarRetrato(comp, []).participants[0]).not.toHaveProperty("primeiraQuinzena");
    expect(montarRetrato(comp, []).totals).not.toHaveProperty("primeirasQuinzenas");
  });

  test("vale a forma de pagamento VIGENTE no mês: passou a receber por quinzena em outubro, setembro não muda", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("pagamentoQuinzenal", "false", "true", "2026-10-01")]);
    periodo("OPEN", [rafa()]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.primeiraQuinzena).toBe(0);
    expect(p.totalAPagar).toBe(2000);
  });

  test("a quinzena é metade do salário base VIGENTE no mês (aumento de outubro não muda setembro)", async () => {
    db.employeeHistorico.findMany.mockResolvedValue([h("baseSalary", "2000.00", "2400.00", "2026-10-01")]);
    periodo("OPEN", [rafa({}, { baseSalary: 2400 })]);
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.primeiraQuinzena).toBe(1000);
  });

  test("fechado com a quinzena: vale o total gravado e a quinzena do retrato; nada vira adiantamento", async () => {
    periodo("CLOSED", [rafa({ salarioProporcional: 2000, totalAPagar: 1000 })]);
    db.tipPeriodClosing.findFirst.mockResolvedValue({
      id: "f1", code: "GOR-2026-0009", version: 1, closedAt: d("2026-09-30"), closedByName: "Eli",
      participants: [{ employeeId: "e1", primeiraQuinzena: 1000, totalAPagar: 1000 }],
    });
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.totalAPagar).toBe(1000);
    expect(p.primeiraQuinzena).toBe(1000);
    expect(p.adiantamentoSalarial).toBe(0);
  });

  test("fechado antes da quinzena existir: o total gravado não muda e a quinzena é zero", async () => {
    periodo("CLOSED", [rafa({ salarioProporcional: 2000, totalAPagar: 2000 })]);
    db.tipPeriodClosing.findFirst.mockResolvedValue({
      id: "f1", code: "GOR-2026-0009", version: 1, closedAt: d("2026-09-30"), closedByName: "Eli",
      participants: [{ employeeId: "e1", totalAPagar: 2000 }],
    });
    const p = (await computeTipCommission(2026, 9, { incluirDadosPessoais: true })).participants[0];
    expect(p.totalAPagar).toBe(2000);
    expect(p.primeiraQuinzena).toBe(0);
  });

  test("rescisão lançada em Contas a Pagar: total zero e fora do total de quinzenas; o valor fica para a rescisão", async () => {
    periodo("OPEN", [rafa({}, { terminationDate: d("2026-09-22") })]);
    db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type?: string } }) => (where.type === "RESCISAO"
      ? [{ employeeId: "e1", amount: 1500, dueDate: d("2026-10-01"), status: "PENDING", details: null }]
      : []));
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const p = comp.participants[0];
    expect(p.pagoNaRescisao).toBe(true);
    expect(p.totalAPagar).toBe(0);
    expect(p.primeiraQuinzena).toBe(1000);
    expect(comp.totals.primeirasQuinzenas).toBe(0);
  });
});

describe("folha de líquidos: composição do sem registro", () => {
  const base = { employeeId: "e1", nome: "Rafa", semRegistro: true, noPeriodo: true, pagoNaRescisao: false,
    gorjetaLiquida: 0, totalAPagar: 1000, cnpjEmpresa: null, pix: null };
  test("com a 1ª quinzena", () => {
    expect(composicaoSemRegistro({ ...base, primeiraQuinzena: 1000 })).toBe("salário − 1ª quinzena + gorjeta − vales");
  });
  test("sem quinzena e sem adiantamento, como antes", () => {
    expect(composicaoSemRegistro(base)).toBe("salário + gorjeta − vales");
    expect(composicaoSemRegistro({ ...base, adiantamentoSalarial: 800, comHoraExtra: true }))
      .toBe("salário − adiantamento + gorjeta − vales + hora extra/noturno");
  });
});
