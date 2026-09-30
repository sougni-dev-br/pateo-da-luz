import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro que recebe adiantamento e saiu depois do dia 20: o adiantamento já pago
// no mês desconta na rescisão, junto dos vales.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    // Sem histórico do cadastro: vale o valor atual.
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
import { apurarRescisao, divergenciasDoApurado, montarSugestao, semDadosPessoais } from "../rescisao-apuracao.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function cenario(adiantamentoSalarial: number, status: "OPEN" | "CLOSED" = "OPEN", totalAPagar = 0) {
  db.employee.findFirst.mockResolvedValue({ id: "e1", modality: "NAO_CLT", terminationDate: new Date("2026-09-22T00:00:00Z"), vtType: "TRANSPORTE_PUBLICO", vtLegs: [] });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", competenceYear: 2026, competenceMonth: 9 });
  db.tipVale.findMany.mockResolvedValue([{ codigo: "VALE-1", date: null, type: "ADIANTAMENTO", notes: null, amount: 20 }]);
  vi.mocked(computeTipCommission).mockResolvedValue({
    label: "Gorjeta 26/08–25/09", status, adiantamento: { percent: 40, dia: 20 },
    participants: [{
      employeeId: "e1", participantId: "tp1", tipoCalculo: "RESCISAO", points: 2, pontosDireito: 2, valorPonto: 93.4,
      rateioAmount: 186.8, valorDireito: null, rescisaoPendente: false, diasSalario: 22, salarioProporcional: 1613.26,
      adiantamentoSalarial, descontos: 20, creditos: 0, totalAPagar,
    }],
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("adiantamento salarial na rescisão de sem registro", () => {
  test("saiu depois do dia 20 e recebe adiantamento: desconta junto dos vales, com rótulo", async () => {
    cenario(880);
    const a = (await apurarRescisao("e1"))!;
    expect(a.adiantamento).toEqual({ valor: 880, data: "2026-09-20" });
    expect(a.sugestao).toMatchObject({ salario: 1613.26, gorjeta: 186.8, vales: 900, adiantamento: 880, bruto: 1800.06 });
    expect(a.sugestao.valesRotulo).toBe("VALE-1, Adiantamento salarial 20/09");
    // Lançar só os vales (sem o adiantamento) vira divergência a justificar.
    expect(divergenciasDoApurado(a.sugestao, { salario: 1613.26, gorjeta: 186.8, vales: 20, vtDesconto: 0 }).map((d) => d.campo)).toEqual(["vales"]);
  });

  test("sem adiantamento no cálculo (não recebe, ou saiu antes do dia 20): nada muda", async () => {
    cenario(0);
    const a = (await apurarRescisao("e1"))!;
    expect(a.adiantamento).toBeNull();
    expect(a.sugestao).toMatchObject({ vales: 20, adiantamento: 0, valesRotulo: "VALE-1" });
  });

  test("já pago na lista fechada: a lista já descontou, a rescisão não desconta de novo", async () => {
    cenario(880, "CLOSED", 900);
    const a = (await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).not.toBeNull();
    expect(a.adiantamento).toBeNull();
    expect(a.sugestao).toMatchObject({ vales: 0, adiantamento: 0 });
  });

  test("sem ver Funcionários: o adiantamento (% do salário) some do desconto e da apuração", async () => {
    cenario(880);
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    expect(a.adiantamento).toEqual({ valor: null, data: "2026-09-20" });
    expect(a.sugestao).toMatchObject({ vales: 20, adiantamento: 0, valesRotulo: "VALE-1" });
  });

  test("montarSugestao: só o adiantamento, sem vales", () => {
    const s = montarSugestao({
      saida: "2026-09-22", semRegistro: true,
      vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
      vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
      gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 22, salarioProporcional: 1613.26 },
      gorjetaObservacao: null, jaPagoNaLista: null, adiantamento: { valor: 880, data: "2026-09-20" },
    });
    expect(s).toMatchObject({ vales: 880, adiantamento: 880, valesRotulo: "Adiantamento salarial 20/09" });
  });
});
