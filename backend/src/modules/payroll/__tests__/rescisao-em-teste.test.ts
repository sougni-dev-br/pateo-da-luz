import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro que saiu ainda em teste (antes de entrar na gorjeta): está no período só pelo
// salário (foraDaGorjeta). A apuração da rescisão paga os dias de salário e gorjeta zero.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    tipVale: { findMany: vi.fn() },
  },
}));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { apurarRescisao } from "../rescisao-apuracao.js";
import { calcularRateio, type ParticipanteEntrada } from "../tip-rateio.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SAIDA = d("2026-09-18");
const SETEMBRO = { id: "per9", competenceYear: 2026, competenceMonth: 9, periodStart: d("2026-08-26"), periodEnd: d("2026-09-25") };

const emTeste: ParticipanteEntrada = {
  kind: "PONTOS", basePoints: 0, ajuste: 0, fixedAmount: null,
  admissao: d("2026-09-15"), inicioGorjeta: null, desligamento: SAIDA,
  faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
  regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
  rescisaoServicoBruto: null, rescisaoValorFixo: null,
  semRegistro: true, salarioBase: 2400, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
  foraDaGorjeta: true, vales: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findFirst.mockResolvedValue({
    id: "e1", modality: "NAO_CLT", terminationDate: SAIDA, vtType: "TRANSPORTE_PUBLICO", vtLegs: [], baseSalary: 2400, admissionDate: d("2026-09-15"),
  });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
    ("competenceMonth" in args.where ? null : SETEMBRO));
  db.tipVale.findMany.mockResolvedValue([]);
  const [l] = calcularRateio({
    start: SETEMBRO.periodStart, end: SETEMBRO.periodEnd, diasPadrao: 26,
    descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
    pointsTotal: 100, deductionPercent: 20, netPool: 16000,
    mesSalario: { start: d("2026-09-01"), end: d("2026-09-30") },
  }, [emTeste]).linhas;
  vi.mocked(computeTipCommission).mockResolvedValue({
    label: "Gorjeta 26/08–25/09", status: "OPEN", adiantamento: { percent: 40, dia: 20 },
    participants: [{
      employeeId: "e1", participantId: "tp1", tipoCalculo: l.tipoCalculo, foraDaGorjeta: true,
      points: l.pontosFinais, pontosDireito: l.pontosDireito, valorPonto: l.valorPonto, rateioAmount: l.rateio, valorDireito: l.valorDireito,
      rescisaoPendente: l.rescisaoPendente, diasSalario: l.diasSalario, salarioProporcional: l.salarioProporcional,
      adiantamentoSalarial: l.adiantamentoSalarial, primeiraQuinzena: l.primeiraQuinzena,
      valorHoraExtra: 0, valorAdicionalNoturno: 0, horaExtra: null, adicionalNoturno: null,
      descontos: 0, creditos: 0, totalAPagar: l.totalAPagar,
    }],
  } as never);
});

describe("apurarRescisao de quem saiu em teste", () => {
  test("paga só o salário dos dias (15 a 18/09 = 4 dias de 80,00), gorjeta zero", async () => {
    const a = (await apurarRescisao("e1"))!;
    expect(a.gorjeta).toMatchObject({ gorjeta: 0, pontos: 0, pendente: false, diasSalario: 4, salarioProporcional: 320 });
    expect(a.sugestao).toMatchObject({ salario: 320, gorjeta: 0, bruto: 320 });
  });
});
