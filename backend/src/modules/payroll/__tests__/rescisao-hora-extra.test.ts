import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro com horas na gorjeta do período da saída: a rescisão tira a pessoa da
// lista, então a hora extra e o noturno entram nos créditos da rescisão (somam ao bruto).
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
import { apurarRescisao, semDadosPessoais } from "../rescisao-apuracao.js";
import { lerValoresRescisao } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function cenario(opts: { modality?: string; status?: "OPEN" | "CLOSED"; totalAPagar?: number; creditos?: number; dsr?: number } = {}) {
  db.employee.findFirst.mockResolvedValue({
    id: "e1", modality: opts.modality ?? "NAO_CLT", terminationDate: new Date("2026-09-22T00:00:00Z"), vtType: "TRANSPORTE_PUBLICO", vtLegs: [],
  });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", competenceYear: 2026, competenceMonth: 9 });
  db.tipVale.findMany.mockResolvedValue([]);
  vi.mocked(computeTipCommission).mockResolvedValue({
    label: "Gorjeta 26/08–25/09", status: opts.status ?? "OPEN", adiantamento: { percent: 40, dia: 20 },
    participants: [{
      employeeId: "e1", participantId: "tp1", tipoCalculo: "RESCISAO", points: 2, pontosDireito: 2, valorPonto: 93.4,
      rateioAmount: 186.8, valorDireito: null, rescisaoPendente: false, diasSalario: 22, salarioProporcional: 1613.26,
      adiantamentoSalarial: 0, descontos: 0, creditos: opts.creditos ?? 0, totalAPagar: opts.totalAPagar ?? 0,
      horaExtra: "10:00", adicionalNoturno: "7:00", valorHoraExtra: 150, valorAdicionalNoturno: 16,
      ...(opts.dsr != null ? { valorDsr: opts.dsr } : {}),
    }],
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("hora extra na rescisão de sem registro", () => {
  test("entra nos créditos e no bruto sugerido, com as horas para conferir", async () => {
    cenario({ creditos: 50 });
    const a = (await apurarRescisao("e1"))!;
    expect(a.horaExtra).toEqual({ horaExtra: "10:00", adicionalNoturno: "7:00", valor: 166 });
    expect(a.sugestao).toMatchObject({ horaExtra: 166, creditos: 216, bruto: 2016.06 });
    // O lançamento usa os créditos apurados: o bruto gravado leva a hora extra.
    const lido = lerValoresRescisao({ salario: 1613.26, gorjeta: 186.8 }, true, a.sugestao.creditos);
    expect(lido).toMatchObject({ gross: 2016.06, creditos: 216 });
  });

  test("CLT: não entra (vai pela contabilidade)", async () => {
    cenario({ modality: "CLT" });
    const a = (await apurarRescisao("e1"))!;
    expect(a.horaExtra).toBeNull();
    expect(a.sugestao.creditos).toBe(0);
  });

  test("já pago na lista fechada: a lista já levou a hora extra, a rescisão não paga de novo", async () => {
    cenario({ status: "CLOSED", totalAPagar: 1966.06 });
    const a = (await apurarRescisao("e1"))!;
    expect(a.horaExtra).toBeNull();
    expect(a.sugestao).toMatchObject({ creditos: 0, horaExtra: 0 });
  });

  test("sem ver Funcionários: o valor (salário ÷ 220) some dos créditos; as horas ficam", async () => {
    cenario({ creditos: 50 });
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    expect(a.horaExtra).toEqual({ horaExtra: "10:00", adicionalNoturno: "7:00", valor: null });
    expect(a.sugestao).toMatchObject({ creditos: 50, horaExtra: 0, bruto: null });
  });

  test("com DSR: a hora extra da rescisão leva o DSR do mês (mesmo cálculo da lista)", async () => {
    cenario({ creditos: 50, dsr: 33.2 });
    const a = (await apurarRescisao("e1"))!;
    expect(a.horaExtra).toEqual({ horaExtra: "10:00", adicionalNoturno: "7:00", dsr: 33.2, valor: 199.2 });
    expect(a.sugestao).toMatchObject({ horaExtra: 199.2, creditos: 249.2, bruto: 2049.26 });
  });

  test("com DSR, sem ver Funcionários: o DSR também some", async () => {
    cenario({ creditos: 50, dsr: 33.2 });
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    expect(a.horaExtra).toEqual({ horaExtra: "10:00", adicionalNoturno: "7:00", dsr: null, valor: null });
    expect(a.sugestao).toMatchObject({ creditos: 50, horaExtra: 0 });
  });
});
