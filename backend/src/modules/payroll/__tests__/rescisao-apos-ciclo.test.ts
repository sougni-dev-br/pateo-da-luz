import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro que saiu depois do fim do ciclo, ainda no mês do salário (ciclo de setembro
// até 25/09, saída em 29/09). Decisão do Eli: "tudo na rescisão". A rescisão soma o mês
// (período de setembro: salário, gorjeta do ciclo, vales, adiantamento, hora extra) e os
// dias depois do ciclo (período de outubro, que contém a saída: gorjeta de 26 a 29/09 e vales).
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    tipParticipant: { findUnique: vi.fn() },
    tipVale: { findMany: vi.fn() },
  },
}));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { apurarRescisao, localizarGorjetaNaApuracao, semDadosPessoais } from "../rescisao-apuracao.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SAIDA = d("2026-09-29");

const SETEMBRO = { id: "per9", competenceYear: 2026, competenceMonth: 9, periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), label: "Gorjeta 26/08–25/09", status: "OPEN" };
const OUTUBRO = { id: "per10", competenceYear: 2026, competenceMonth: 10, periodStart: d("2026-09-26"), periodEnd: d("2026-10-25"), label: "Gorjeta 26/09–25/10", status: "OPEN" };

type Cenario = {
  modality?: string;
  outubro?: typeof OUTUBRO | null;
  naOutubro?: boolean;
  setembroStatus?: "OPEN" | "CLOSED";
  setembroTotal?: number;
  outubroPendente?: boolean;
};

function cenario(c: Cenario = {}) {
  const outubro = c.outubro === undefined ? OUTUBRO : c.outubro;
  db.employee.findFirst.mockResolvedValue({ id: "e1", modality: c.modality ?? "NAO_CLT", terminationDate: SAIDA, vtType: "TRANSPORTE_PUBLICO", vtLegs: [] });
  db.payrollItem.findMany.mockResolvedValue([]);
  // Período que contém a saída (outubro) ou o do mês do salário pela competência (setembro).
  db.tipPeriod.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if ("competenceMonth" in args.where) return args.where.competenceMonth === 9 ? SETEMBRO : null;
    return outubro;
  });
  db.tipVale.findMany.mockImplementation(async (args: { where: { participantId: string } }) => (args.where.participantId === "tp9"
    ? [
      { codigo: "VALE-9", date: d("2026-09-10"), type: "ADIANTAMENTO", notes: null, amount: 50 },
      { codigo: "CRED-9", date: d("2026-09-11"), type: "CREDITO", notes: null, amount: 10 },
    ]
    : [{ codigo: "VALE-10", date: d("2026-09-27"), type: "ADIANTAMENTO", notes: null, amount: 20 }]));
  vi.mocked(computeTipCommission).mockImplementation((async (_ano: number, mes: number) => {
    if (mes === 9) {
      return {
        label: SETEMBRO.label, status: c.setembroStatus ?? "OPEN", adiantamento: { percent: 40, dia: 20 },
        participants: [{
          employeeId: "e1", participantId: "tp9", tipoCalculo: "MES", points: 4, pontosDireito: 4, valorPonto: 186.33,
          rateioAmount: 745.32, valorDireito: null, rescisaoPendente: false, diasSalario: 29, salarioProporcional: 2126.57,
          adiantamentoSalarial: 880, primeiraQuinzena: 0, valorHoraExtra: 150, valorAdicionalNoturno: 0, horaExtra: "10:00", adicionalNoturno: null,
          descontos: 50, creditos: 10, totalAPagar: c.setembroTotal ?? 0,
        }],
      };
    }
    return {
      label: OUTUBRO.label, status: "OPEN", adiantamento: { percent: 40, dia: 20 },
      participants: c.naOutubro === false ? [] : [{
        employeeId: "e1", participantId: "tp10", tipoCalculo: "RESCISAO", points: 0.5, pontosDireito: 0.5, valorPonto: c.outubroPendente ? 0 : 100,
        rateioAmount: c.outubroPendente ? 0 : 50, valorDireito: null, rescisaoPendente: c.outubroPendente ?? false, diasSalario: 0, salarioProporcional: 0,
        adiantamentoSalarial: 0, primeiraQuinzena: 0, valorHoraExtra: 0, valorAdicionalNoturno: 0, horaExtra: null, adicionalNoturno: null,
        descontos: 20, creditos: 0, totalAPagar: 0,
      }],
    };
  }) as never);
}

beforeEach(() => vi.clearAllMocks());

describe("apurarRescisao: saiu em 29/09, depois do ciclo de setembro", () => {
  test("soma o mês (setembro) e os dias depois do ciclo (outubro)", async () => {
    cenario();
    const a = (await apurarRescisao("e1"))!;
    expect(a.sugestao).toMatchObject({
      salario: 2126.57,
      gorjeta: 795.32, // 745,32 do ciclo + 50,00 de 26 a 29/09
      horaExtra: 150,
      creditos: 160, // crédito de 10 + hora extra de 150
      adiantamento: 880,
      vales: 950, // 50 + 20 + adiantamento 880
      bruto: 3081.89,
    });
    expect(a.gorjetaPartes).toEqual([
      { periodo: "Gorjeta 26/08–25/09", competencia: "09/2026", dias: "26/08 a 25/09", valor: 745.32, pendente: false, jaPagoNaLista: false },
      { periodo: "Gorjeta 26/09–25/10", competencia: "10/2026", dias: "26/09 a 29/09", valor: 50, pendente: false, jaPagoNaLista: false },
    ]);
    expect(a.gorjeta).toMatchObject({ gorjeta: 795.32, pendente: false, diasSalario: 29, salarioProporcional: 2126.57 });
    expect(a.gorjeta!.periodo).toContain("Gorjeta 26/08–25/09");
    expect(a.gorjeta!.periodo).toContain("Gorjeta 26/09–25/10");
    expect(a.vales.itens.map((v) => v.codigo)).toEqual(["VALE-9", "CRED-9", "VALE-10"]);
    expect(a.vales).toMatchObject({ descontos: 70, creditos: 10 });
    expect(a.adiantamento).toEqual({ valor: 880, data: "2026-09-20" });
    expect(a.jaPagoNaLista).toBeNull();
    expect(a.gorjetaObservacao).toContain("a lista de 09/2026 não paga nada");
  });

  test("sem o período de outubro: só o mês, com observação, sem quebrar", async () => {
    cenario({ outubro: null });
    const a = (await apurarRescisao("e1"))!;
    expect(a.sugestao).toMatchObject({ salario: 2126.57, gorjeta: 745.32, vales: 930, creditos: 160, bruto: 3031.89 });
    expect(a.gorjetaPartes).toHaveLength(2);
    expect(a.gorjetaPartes![1]).toMatchObject({ competencia: "10/2026", dias: "26/09 a 29/09", valor: null, pendente: false });
    expect(a.gorjetaObservacao).toContain("A gorjeta de 26/09 a 29/09 ainda não pode ser apurada: o período de gorjeta de 10/2026 não existe. Lance depois ou ajuste.");
  });

  test("outubro existe mas ela não está nele: só o mês, com observação", async () => {
    cenario({ naOutubro: false });
    const a = (await apurarRescisao("e1"))!;
    expect(a.sugestao).toMatchObject({ gorjeta: 745.32, vales: 930 });
    expect(a.gorjetaObservacao).toContain("A gorjeta de 26/09 a 29/09 ainda não pode ser apurada: ela não está no período de gorjeta de 10/2026. Lance depois ou ajuste.");
  });

  test("gorjeta de outubro pendente (falta o serviço até a saída): gorjeta e bruto ficam pendentes", async () => {
    cenario({ outubroPendente: true });
    const a = (await apurarRescisao("e1"))!;
    expect(a.gorjeta!.pendente).toBe(true);
    expect(a.sugestao.gorjeta).toBeNull();
    expect(a.sugestao.bruto).toBeNull();
    expect(a.sugestao.salario).toBe(2126.57);
    expect(a.gorjetaPartes![1]).toMatchObject({ valor: null, pendente: true });
    expect(a.gorjetaObservacao).toContain("falta o serviço até a saída");
  });

  test("lista de setembro fechada já pagando a pessoa: só entra outubro", async () => {
    cenario({ setembroStatus: "CLOSED", setembroTotal: 2100 });
    const a = (await apurarRescisao("e1"))!;
    expect(a.sugestao).toMatchObject({ salario: 0, gorjeta: 50, creditos: 0, horaExtra: 0, adiantamento: 0, vales: 20, bruto: 50 });
    expect(a.gorjetaPartes![0]).toMatchObject({ competencia: "09/2026", valor: 0, jaPagoNaLista: true });
    expect(a.vales.itens.map((v) => v.codigo)).toEqual(["VALE-10"]);
    expect(a.adiantamento).toBeNull();
    expect(a.horaExtra).toBeNull();
    // O aviso "não lance de novo aqui" não vale: a parte de outubro ainda é da rescisão.
    expect(a.jaPagoNaLista).toBeNull();
    expect(a.gorjetaObservacao).toContain("já foi paga na lista de pagamento da gorjeta de 09/2026");
  });

  test("CLT que sai em 29/09: inalterado (só o período que contém a saída)", async () => {
    cenario({ modality: "CLT" });
    const a = (await apurarRescisao("e1"))!;
    expect(a.gorjetaPartes ?? null).toBeNull();
    expect(a.gorjeta!.periodo).toBe("Gorjeta 26/09–25/10");
    expect(vi.mocked(computeTipCommission).mock.calls.map((c) => c[1])).toEqual([10]);
  });

  test("sem ver Funcionários: o salário some, as partes da gorjeta ficam", async () => {
    cenario();
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    expect(a.sugestao.salario).toBeNull();
    expect(a.gorjeta!.salarioProporcional).toBeNull();
    expect(a.gorjetaPartes).toHaveLength(2);
    expect(a.sugestao.gorjeta).toBe(795.32);
  });
});

describe("localizarGorjetaNaApuracao: só a parte depois do ciclo vai para outubro", () => {
  const participanteOutubro = (over: Record<string, unknown> = {}) => db.tipParticipant.findUnique.mockResolvedValue({
    id: "tp10", rescisaoValorFixo: null, rateioAmount: 50, totalAPagar: 0, employee: { modality: "NAO_CLT" }, ...over,
  });

  test("grava gorjeta lançada − gorjeta do ciclo no participante de outubro", async () => {
    cenario();
    const a = await apurarRescisao("e1");
    db.tipPeriod.findFirst.mockResolvedValue(OUTUBRO);
    participanteOutubro();
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 800, a)).toEqual({
      alvo: { participantId: "tp10", periodo: OUTUBRO.label, anterior: null, aplicada: 54.68 },
    });
    // Abaixo da gorjeta do ciclo: grava zero (nunca negativo).
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 700, a)).toMatchObject({ alvo: { aplicada: 0 } });
  });

  test("sem o período de outubro: não grava nada", async () => {
    cenario({ outubro: null });
    const a = await apurarRescisao("e1");
    db.tipPeriod.findFirst.mockResolvedValue(null);
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 800, a)).toEqual({ alvo: null });
  });

  test("lista de setembro já paga: a gorjeta lançada é toda de outubro", async () => {
    cenario({ setembroStatus: "CLOSED", setembroTotal: 2100 });
    const a = await apurarRescisao("e1");
    db.tipPeriod.findFirst.mockResolvedValue(OUTUBRO);
    participanteOutubro();
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 50, a)).toMatchObject({ alvo: { participantId: "tp10", aplicada: 50 } });
  });

  test("outubro fechado: aceita só o valor fechado (pela parte de outubro), senão pede reabrir", async () => {
    cenario();
    const a = await apurarRescisao("e1");
    db.tipPeriod.findFirst.mockResolvedValue({ ...OUTUBRO, status: "CLOSED" });
    participanteOutubro({ rateioAmount: 50 });
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 795.32, a)).toEqual({ alvo: null });
    const r = await localizarGorjetaNaApuracao("e1", SAIDA, 900, a);
    expect(r).toHaveProperty("erro");
    expect((r as { erro: string }).erro).toContain("Reabra a gorjeta");
  });

  test("sem a apuração (ou fora do caso): grava a gorjeta inteira, como hoje", async () => {
    db.tipPeriod.findFirst.mockResolvedValue(OUTUBRO);
    participanteOutubro();
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 800)).toMatchObject({ alvo: { participantId: "tp10", aplicada: 800 } });
  });
});
