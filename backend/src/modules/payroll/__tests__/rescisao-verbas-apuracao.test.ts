import { beforeEach, describe, expect, test, vi } from "vitest";

// A apuração da rescisão de sem registro devolve o cálculo das verbas opcionais (férias,
// 13º, aviso) com a memória — fora do bruto sugerido: só entram se alguém marcar.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function cenario(opts: { modality?: string; baseSalary?: number | null; admissionDate?: string | null; historicoSalario?: Array<{ de: string; para: string; desde: string }> } = {}) {
  db.employee.findFirst.mockResolvedValue({
    id: "e1", modality: opts.modality ?? "NAO_CLT", terminationDate: new Date("2026-09-24T00:00:00Z"), vtType: "NENHUM", vtLegs: [],
    baseSalary: opts.baseSalary === undefined ? 2500 : opts.baseSalary,
    admissionDate: opts.admissionDate === undefined ? new Date("2026-03-10T00:00:00Z") : opts.admissionDate ? new Date(`${opts.admissionDate}T00:00:00Z`) : null,
  });
  db.employeeHistorico.findMany.mockResolvedValue((opts.historicoSalario ?? []).map((h, i) => ({
    employeeId: "e1", campo: "baseSalary", valorAnterior: h.de, valorNovo: h.para,
    vigenteDesde: new Date(`${h.desde}T00:00:00Z`), createdAt: new Date(2026, 0, 1 + i),
  })));
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", competenceYear: 2026, competenceMonth: 9 });
  db.tipVale.findMany.mockResolvedValue([]);
  vi.mocked(computeTipCommission).mockResolvedValue({
    label: "Gorjeta 26/08–25/09", status: "OPEN", adiantamento: { percent: 40, dia: 20 },
    participants: [{
      employeeId: "e1", participantId: "tp1", tipoCalculo: "RESCISAO", points: 2, pontosDireito: 2, valorPonto: 93.4,
      rateioAmount: 186.8, valorDireito: null, rescisaoPendente: false, diasSalario: 24, salarioProporcional: 1760,
      adiantamentoSalarial: 0, descontos: 0, creditos: 0, totalAPagar: 0,
    }],
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("apuração: verbas opcionais de sem registro", () => {
  test("usa o salário base VIGENTE na saída (histórico do cadastro) e não mexe no bruto sugerido", async () => {
    // Hoje 2.500,00; até 30/09 valia 2.200,00.
    cenario({ historicoSalario: [{ de: "2200.00", para: "2500.00", desde: "2026-10-01" }] });
    const a = (await apurarRescisao("e1"))!;
    const c = a.verbasOpcionais!.calculo!;
    expect(c.base).toBe(2200);
    expect(c.ferias).toMatchObject({ avos: 7, valor: 1711.11, memoria: "S 2.200,00 ÷ 12 × 7 avos = 1.283,33 + 1/3 (427,78)" });
    expect(c.decimoTerceiro).toMatchObject({ avos: 7, valor: 1283.33 });
    expect(c.aviso).toMatchObject({ dias: 30, valor: 2200 });
    expect(a.sugestao.bruto).toBe(1946.8); // 1.760,00 + 186,80: nada das verbas
  });

  test("sem salário no cadastro: sem cálculo, com o porquê", async () => {
    cenario({ baseSalary: null });
    const a = (await apurarRescisao("e1"))!;
    expect(a.verbasOpcionais).toEqual({ calculo: null, observacao: expect.stringContaining("salário base") });
  });

  test("sem data de início: sem cálculo, com o porquê", async () => {
    cenario({ admissionDate: null });
    const a = (await apurarRescisao("e1"))!;
    expect(a.verbasOpcionais).toEqual({ calculo: null, observacao: expect.stringContaining("início") });
  });

  test("CLT: não há verbas opcionais (vêm no termo da contabilidade)", async () => {
    cenario({ modality: "CLT" });
    const a = (await apurarRescisao("e1"))!;
    expect(a.verbasOpcionais ?? null).toBeNull();
  });

  test("sem ver Funcionários: avos e dias ficam, valores e memória saem", async () => {
    cenario();
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    const c = a.verbasOpcionais!.calculo!;
    expect(c.base).toBeNull();
    expect(c.ferias).toMatchObject({ avos: 7, valor: null, ferias: null, terco: null });
    expect(c.ferias.memoria).not.toContain("2.500");
    expect(c.decimoTerceiro).toMatchObject({ avos: 7, valor: null });
    expect(c.aviso).toMatchObject({ dias: 30, valor: null });
  });
});
