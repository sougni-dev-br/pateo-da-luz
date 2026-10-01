import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro que não participa da gorjeta (foraDaGorjeta): está no período só para
// receber o salário na lista de pagamento. Não entra no rateio — o valor do ponto e o
// livre não mudam com ele — e os vales descontam do total a pagar.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    employeeHistorico: { findMany: vi.fn(async () => []) },
    tipPeriod: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    tipParticipant: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    employeeScheduleDay: { groupBy: vi.fn(), findMany: vi.fn() },
    revenueEntry: { aggregate: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriodClosing: { findFirst: vi.fn() },
    tipReserveMovement: { findMany: vi.fn(), aggregate: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../../../config/database.js";
import { computeTipCommission, mesDoSalario, syncParticipantsFromCadastro } from "../tip-commission.service.js";
import { montarRetrato } from "../tip-fechamento.service.js";
import { calcularRateio, type ParticipanteEntrada, type RegrasPeriodo } from "../tip-rateio.js";
import { montarFolhaLiquidos } from "../tip-conferencia.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ─── Rateio (função pura) ────────────────────────────────────────────────────
const SETEMBRO: RegrasPeriodo = {
  start: d("2026-08-26"), end: d("2026-09-25"), diasPadrao: 26,
  descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
  pointsTotal: 100, deductionPercent: 20, netPool: 16000,
  mesSalario: mesDoSalario(2026, 9),
};

function pessoa(over: Partial<ParticipanteEntrada> = {}): ParticipanteEntrada {
  return {
    kind: "PONTOS", basePoints: 4, ajuste: 0, fixedAmount: null,
    admissao: d("2025-01-01"), desligamento: null,
    faltas: 0, atestados: 0, ferias: 0, outrosDias: 0, diasPrevistosOverride: null,
    regras: { descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null },
    rescisaoServicoBruto: null, rescisaoValorFixo: null,
    semRegistro: false, salarioBase: null, diasSalarioOverride: null, rescisaoLancada: false, gorjetaReal: null,
    vales: [],
    ...over,
  };
}

const carmelita = (over: Partial<ParticipanteEntrada> = {}) => pessoa({
  foraDaGorjeta: true, basePoints: 0, semRegistro: true, salarioBase: 2300, admissao: d("2026-09-23"), ...over,
});

describe("rateio com quem está fora da gorjeta", () => {
  const equipe = [pessoa({ basePoints: 4 }), pessoa({ basePoints: 3.5, desligamento: d("2026-09-10"), rescisaoServicoBruto: 8000 }), pessoa({ kind: "FIXO", fixedAmount: 500 })];

  test("valor do ponto, livre, distribuído e pontos não mudam ao incluir a pessoa", () => {
    const sem = calcularRateio(SETEMBRO, equipe);
    const com = calcularRateio(SETEMBRO, [...equipe, carmelita({ ajuste: 5, gorjetaReal: 900, kind: "FIXO", fixedAmount: 700 })]);
    expect(com.valorPontoBruto).toBe(sem.valorPontoBruto);
    expect(com.saldo).toBe(sem.saldo);
    expect(com.distribuido).toBe(sem.distribuido);
    expect(com.pontosUsados).toBe(sem.pontosUsados);
    expect(com.rescisoes).toEqual(sem.rescisoes);
    expect(com.totalCotasFixas).toBe(sem.totalCotasFixas);
    const linha = com.linhas[3];
    expect(linha).toMatchObject({ foraDaGorjeta: true, tipoCalculo: "MES", rateio: 0, pontosFinais: 0, gorjetaRealAplicada: false, rescisaoPendente: false });
  });

  test("admitida em 23/09 com 2.300: 8 dias de salário (76,67 × 8 = 613,36), gorjeta zero", () => {
    const [l] = calcularRateio(SETEMBRO, [carmelita()]).linhas;
    expect(l.diasSalario).toBe(8);
    expect(l.salarioProporcional).toBe(613.36);
    expect(l.comissaoLiquida).toBe(0);
    expect(l.totalAPagar).toBe(613.36);
  });

  test("total a pagar = salário + hora extra − vales + créditos", () => {
    const [l] = calcularRateio(SETEMBRO, [carmelita({
      horaExtraMin: 120, vales: [{ type: "REFEICAO", amount: 50 }, { type: "CREDITO", amount: 10 }],
    })]).linhas;
    expect(l.comissaoLiquida).toBe(-40);
    expect(l.valorHoraExtra).toBeGreaterThan(0);
    expect(l.totalAPagar).toBe(Math.round((613.36 + l.valorHoraExtra - 40) * 100) / 100);
  });

  test("admitida depois do ciclo (28/09) ainda está no mês do salário", () => {
    const [l] = calcularRateio(SETEMBRO, [carmelita({ admissao: d("2026-09-28") })]).linhas;
    expect(l.tipoCalculo).toBe("MES");
    expect(l.diasSalario).toBe(3);
  });

  test("sem vínculo no mês do salário: fora do período, nada a pagar além dos vales", () => {
    const [l] = calcularRateio(SETEMBRO, [carmelita({ admissao: d("2026-10-02") })]).linhas;
    expect(l.tipoCalculo).toBe("FORA_DO_PERIODO");
    expect(l.salarioProporcional).toBe(0);
  });

  test("saiu no ciclo com a rescisão lançada: recebe na rescisão, zero na lista", () => {
    const [l] = calcularRateio(SETEMBRO, [carmelita({ admissao: d("2025-01-01"), desligamento: d("2026-09-20"), rescisaoLancada: true })]).linhas;
    expect(l.pagoNaRescisao).toBe(true);
    expect(l.totalAPagar).toBe(0);
  });
});

// ─── Cálculo do período (banco de mentira) ───────────────────────────────────
function participante(over: Record<string, unknown> = {}, emp: Record<string, unknown> = {}) {
  return {
    id: "tp1", employeeId: "e1", kind: "PONTOS", basePoints: 4, points: null, pointsAdjustment: 0, fixedAmount: null,
    faltas: null, atestados: null, ferias: null, outrosDias: 0, diasPrevistosOverride: null,
    descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null,
    rescisaoServicoBruto: null, rescisaoValorFixo: null, rescisaoRecibo: null, diasSalarioOverride: null,
    gorjetaReal: null, gorjetaRealMotivo: null, gorjetaRealPor: null, gorjetaRealEm: null,
    rateioAmount: 0, netCommission: 0, salarioProporcional: 0, totalAPagar: 0, functionName: "Salão",
    horaExtra: null, adicionalNoturno: null, justificada: false, vales: [], foraDaGorjeta: false,
    employee: {
      firstName: "Pessoa", lastName: "Um", displayName: null, isActive: true, companyId: null, company: null,
      modality: "CLT", baseSalary: 2000, pixKeyType: null, pixKey: null, recebeAdiantamento: false,
      admissionDate: d("2025-01-01"), terminationDate: null,
      pontosExtra: null, tipFunction: { name: "Salão", points: 4, minPoints: null, maxPoints: null }, ...emp,
    },
    ...over,
  };
}

const carmelitaNoPeriodo = (over: Record<string, unknown> = {}) => participante(
  { id: "tp9", employeeId: "e9", basePoints: 0, foraDaGorjeta: true, functionName: null, ...over },
  { firstName: "Carmelita", lastName: "Teste", modality: "NAO_CLT", baseSalary: 2300, admissionDate: d("2026-09-23"), tipFunction: null, pontosExtra: 5 },
);

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

describe("computeTipCommission com quem está fora da gorjeta", () => {
  test("aberto: salário de 8 dias, gorjeta zero, ponto/livre/composição iguais e sem avisos de gorjeta", async () => {
    periodo("OPEN", [participante()]);
    const sem = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    periodo("OPEN", [participante(), carmelitaNoPeriodo({ pointsAdjustment: 3 })]);
    const com = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(com.pointValue).toBe(sem.pointValue);
    expect(com.saldo).toBe(sem.saldo);
    expect(com.totalPoints).toBe(sem.totalPoints);
    expect(com.composicao).toEqual(sem.composicao);
    expect(com.totals.rateio).toBe(sem.totals.rateio);
    const c = com.participants.find((p) => p.employeeId === "e9")!;
    expect(c).toMatchObject({ foraDaGorjeta: true, semRegistro: true, rateioAmount: 0, points: 0, salarioProporcional: 613.36, totalAPagar: 613.36 });
    expect(com.totals.salarios).toBe(613.36);
    expect(com.totals.totalAPagar).toBe(Math.round((sem.totals.totalAPagar + 613.36) * 100) / 100);
    // Sem função nem pontos e com ponto extra fora de faixa: nada disso vira aviso para ele.
    expect(com.warnings.join(" ")).not.toContain("Carmelita");
    expect(com.pendencias).toEqual([]);
  });

  test("vales descontam do total a pagar; vale maior que o salário vira aviso de pagamento", async () => {
    periodo("OPEN", [carmelitaNoPeriodo({ vales: [{ id: "v1", type: "REFEICAO", amount: 100, date: null, notes: null }] })]);
    let comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0]).toMatchObject({ netCommission: -100, totalAPagar: 513.36 });
    expect(comp.warnings.join(" ")).not.toContain("Vales maiores que a gorjeta");
    periodo("OPEN", [carmelitaNoPeriodo({ vales: [{ id: "v1", type: "REFEICAO", amount: 700, date: null, notes: null }] })]);
    comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.warnings.join(" ")).toContain("Vales maiores que o salário a pagar");
  });

  test("gorjeta real gravada antes de sair da gorjeta não vale e avisa o porquê", async () => {
    periodo("OPEN", [carmelitaNoPeriodo({ gorjetaReal: 300 })]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.participants[0].rateioAmount).toBe(0);
    expect(comp.participants[0].gorjetaReal).toBeNull();
    expect(comp.warnings.join(" ")).toContain("não participa mais da gorjeta");
  });

  test("fechado: vale o gravado, e o retrato guarda o flag (só de quem é)", async () => {
    periodo("CLOSED", [participante(), carmelitaNoPeriodo({ salarioProporcional: 600, totalAPagar: 600, points: 0 })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const c = comp.participants.find((p) => p.employeeId === "e9")!;
    expect(c.salarioProporcional).toBe(600);
    expect(c.totalAPagar).toBe(600);
    const retrato = montarRetrato(comp, []);
    expect(retrato.participants.find((p) => p.employeeId === "e9")).toMatchObject({ foraDaGorjeta: true, gorjeta: 0 });
    expect(retrato.participants.find((p) => p.employeeId === "e1")).not.toHaveProperty("foraDaGorjeta");
  });

  test("folha de líquidos: entra como sem registro pelo total a pagar", async () => {
    periodo("OPEN", [carmelitaNoPeriodo()]);
    const comp = await computeTipCommission(2026, 9);
    const p = comp.participants[0];
    const linhas = montarFolhaLiquidos([{
      employeeId: p.employeeId, nome: p.employeeName, semRegistro: p.semRegistro, noPeriodo: p.tipoCalculo !== "FORA_DO_PERIODO",
      pagoNaRescisao: p.pagoNaRescisao, gorjetaLiquida: p.netCommission, totalAPagar: p.totalAPagar, cnpjEmpresa: null, pix: null,
    }], []);
    expect(linhas).toEqual([expect.objectContaining({ origem: "SEM_REGISTRO", valor: 613.36 })]);
  });
});

// ─── Sincronização com o cadastro ────────────────────────────────────────────
type Emp = {
  id: string; participaGorjeta: boolean; modality: "CLT" | "NAO_CLT"; isActive?: boolean;
  admissionDate: Date | null; terminationDate: Date | null; deletedAt?: Date | null;
  // Ausente = entrou na gorjeta na admissão (o backfill da migration).
  inicioGorjeta?: Date | null;
};

// O banco de mentira aplica o filtro de vínculo no mês que o serviço manda.
function cadastro(emps: Emp[]) {
  db.employee.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const participa = where.participaGorjeta as boolean;
    return emps
      .filter((e) => e.participaGorjeta === participa && !e.deletedAt)
      .filter((e) => {
        if (participa) return true;
        const mes = mesDoSalario(2026, 9);
        const admOk = !e.admissionDate || e.admissionDate <= mes.end;
        const saidaOk = !e.terminationDate || e.terminationDate >= mes.start;
        const ativoOk = e.isActive !== false || e.terminationDate != null;
        return admOk && saidaOk && ativoOk;
      })
      .map((e) => ({
        id: e.id, modality: e.modality, terminationDate: e.terminationDate,
        admissionDate: e.admissionDate, isActive: e.isActive ?? true, participaGorjeta: e.participaGorjeta,
        inicioGorjeta: e.inicioGorjeta === undefined ? (e.participaGorjeta ? e.admissionDate ?? d("2025-01-01") : null) : e.inicioGorjeta,
        tipoGorjeta: "PONTOS", pontosExtra: null, cotaFixaGorjeta: null, tipFunction: { points: 3, name: "Salão" },
      }));
  });
}

function noPeriodo(lista: Array<{ id: string; employeeId: string; foraDaGorjeta: boolean; vales?: number; basePoints?: number }>) {
  db.tipParticipant.findMany.mockResolvedValue(lista.map((p) => ({
    id: p.id, employeeId: p.employeeId, kind: "PONTOS", basePoints: p.basePoints ?? 3, functionName: "Salão",
    foraDaGorjeta: p.foraDaGorjeta, _count: { vales: p.vales ?? 0 },
  })));
}

describe("syncParticipantsFromCadastro com quem não participa", () => {
  beforeEach(() => {
    db.tipPeriod.findUniqueOrThrow.mockResolvedValue({ periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), competenceYear: 2026, competenceMonth: 9 });
  });

  test("traz o sem registro ativo no mês como fora da gorjeta; deixa de fora CLT, inativo e quem não tem vínculo no mês", async () => {
    cadastro([
      { id: "carmelita", participaGorjeta: false, modality: "NAO_CLT", admissionDate: d("2026-09-23"), terminationDate: null },
      { id: "clt", participaGorjeta: false, modality: "CLT", admissionDate: d("2025-01-01"), terminationDate: null },
      { id: "outubro", participaGorjeta: false, modality: "NAO_CLT", admissionDate: d("2026-10-05"), terminationDate: null },
      { id: "saiu-agosto", participaGorjeta: false, modality: "NAO_CLT", admissionDate: d("2025-01-01"), terminationDate: d("2026-08-28") },
      { id: "inativo", participaGorjeta: false, modality: "NAO_CLT", isActive: false, admissionDate: d("2025-01-01"), terminationDate: null },
      { id: "saiu-setembro", participaGorjeta: false, modality: "NAO_CLT", admissionDate: d("2025-01-01"), terminationDate: d("2026-09-03") },
      { id: "participa", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2025-01-01"), terminationDate: null },
    ]);
    noPeriodo([]);
    const r = await syncParticipantsFromCadastro("per1");
    const criados = db.tipParticipant.createMany.mock.calls[0][0].data as Array<{ employeeId: string; foraDaGorjeta?: boolean; basePoints: number | null }>;
    expect(criados.map((c) => c.employeeId).sort()).toEqual(["carmelita", "participa", "saiu-setembro"]);
    expect(criados.find((c) => c.employeeId === "carmelita")).toMatchObject({ foraDaGorjeta: true, basePoints: 0 });
    expect(criados.find((c) => c.employeeId === "participa")?.foraDaGorjeta).toBeUndefined();
    expect(r).toMatchObject({ added: 3, removidos: 0 });
  });

  test("passou a participar: vira participante normal com os pontos da função", async () => {
    cadastro([{ id: "carmelita", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-09-23"), terminationDate: null }]);
    noPeriodo([{ id: "tp9", employeeId: "carmelita", foraDaGorjeta: true, basePoints: 0 }]);
    await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.update).toHaveBeenCalledWith({
      where: { id: "tp9" },
      data: expect.objectContaining({ foraDaGorjeta: false, kind: "PONTOS", basePoints: 3, functionName: "Salão" }),
    });
    expect(db.tipParticipant.createMany).not.toHaveBeenCalled();
  });

  test("deixou de participar (sem registro): fica só pelo salário", async () => {
    cadastro([{ id: "carmelita", participaGorjeta: false, modality: "NAO_CLT", admissionDate: d("2025-01-01"), terminationDate: null }]);
    noPeriodo([{ id: "tp9", employeeId: "carmelita", foraDaGorjeta: false }]);
    await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.update).toHaveBeenCalledWith({ where: { id: "tp9" }, data: { foraDaGorjeta: true } });
  });

  test("CLT que deixou de participar continua como estava (regra de antes)", async () => {
    cadastro([{ id: "clt", participaGorjeta: false, modality: "CLT", admissionDate: d("2025-01-01"), terminationDate: null }]);
    noPeriodo([{ id: "tp1", employeeId: "clt", foraDaGorjeta: false }]);
    await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.update).not.toHaveBeenCalled();
    expect(db.tipParticipant.deleteMany).not.toHaveBeenCalled();
  });

  test("virou CLT: quem estava só pelo salário sai do período, a não ser que tenha vale", async () => {
    cadastro([
      { id: "virou-clt", participaGorjeta: false, modality: "CLT", admissionDate: d("2025-01-01"), terminationDate: null },
      { id: "com-vale", participaGorjeta: false, modality: "CLT", admissionDate: d("2025-01-01"), terminationDate: null },
    ]);
    noPeriodo([
      { id: "tpA", employeeId: "virou-clt", foraDaGorjeta: true },
      { id: "tpB", employeeId: "com-vale", foraDaGorjeta: true, vales: 1 },
    ]);
    const r = await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["tpA"] }, foraDaGorjeta: true } });
    expect(r.removidos).toBe(1);
  });

  test("vínculo vigente no mês pelo histórico: virou CLT em outubro, setembro ainda é sem registro", async () => {
    cadastro([{ id: "carmelita", participaGorjeta: false, modality: "CLT", admissionDate: d("2026-09-23"), terminationDate: null }]);
    db.employeeHistorico.findMany.mockResolvedValue([
      { employeeId: "carmelita", campo: "modality", valorAnterior: "NAO_CLT", valorNovo: "CLT", vigenteDesde: d("2026-10-01"), createdAt: d("2026-10-01") },
    ]);
    noPeriodo([]);
    await syncParticipantsFromCadastro("per1");
    const criados = db.tipParticipant.createMany.mock.calls[0]?.[0].data ?? [];
    expect(criados).toEqual([expect.objectContaining({ employeeId: "carmelita", foraDaGorjeta: true })]);
  });
});

// ─── Entrada na gorjeta (em teste) ───────────────────────────────────────────
describe("syncParticipantsFromCadastro com quem está em teste", () => {
  beforeEach(() => {
    db.tipPeriod.findUniqueOrThrow.mockResolvedValue({ periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), competenceYear: 2026, competenceMonth: 9 });
  });
  const criados = () => (db.tipParticipant.createMany.mock.calls[0]?.[0].data ?? []) as Array<{ employeeId: string; foraDaGorjeta?: boolean; basePoints: number | null }>;

  test("sem registro sem a data de entrada: entra só pelo salário; CLT em teste fica fora", async () => {
    cadastro([
      { id: "teste-sr", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-09-15"), terminationDate: null, inicioGorjeta: null },
      { id: "teste-clt", participaGorjeta: true, modality: "CLT", admissionDate: d("2026-09-15"), terminationDate: null, inicioGorjeta: null },
      { id: "efetivo", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2025-01-01"), terminationDate: null },
    ]);
    noPeriodo([]);
    const r = await syncParticipantsFromCadastro("per1");
    expect(criados().map((c) => c.employeeId).sort()).toEqual(["efetivo", "teste-sr"]);
    expect(criados().find((c) => c.employeeId === "teste-sr")).toMatchObject({ foraDaGorjeta: true, basePoints: 0 });
    expect(criados().find((c) => c.employeeId === "efetivo")?.foraDaGorjeta).toBeUndefined();
    expect(r.added).toBe(2);
  });

  test("entrada depois do fim do ciclo: ainda em teste neste período", async () => {
    cadastro([{ id: "sr", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-09-15"), terminationDate: null, inicioGorjeta: d("2026-09-26") }]);
    noPeriodo([]);
    await syncParticipantsFromCadastro("per1");
    expect(criados()).toEqual([expect.objectContaining({ employeeId: "sr", foraDaGorjeta: true })]);
  });

  test("entrada no meio do ciclo: participante normal (um só), com os pontos da função", async () => {
    cadastro([{ id: "sr", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-09-01"), terminationDate: null, inicioGorjeta: d("2026-09-10") }]);
    noPeriodo([{ id: "tp9", employeeId: "sr", foraDaGorjeta: true, basePoints: 0 }]);
    await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.update).toHaveBeenCalledWith({
      where: { id: "tp9" }, data: expect.objectContaining({ foraDaGorjeta: false, basePoints: 3 }),
    });
    expect(db.tipParticipant.createMany).not.toHaveBeenCalled();
  });

  test("voltou para teste (data apagada): sem registro fica só pelo salário; CLT sai do rateio, a não ser que tenha vale", async () => {
    cadastro([
      { id: "sr", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-09-01"), terminationDate: null, inicioGorjeta: null },
      { id: "clt", participaGorjeta: true, modality: "CLT", admissionDate: d("2026-09-01"), terminationDate: null, inicioGorjeta: null },
      { id: "clt-vale", participaGorjeta: true, modality: "CLT", admissionDate: d("2026-09-01"), terminationDate: null, inicioGorjeta: null },
    ]);
    noPeriodo([
      { id: "tpS", employeeId: "sr", foraDaGorjeta: false },
      { id: "tpC", employeeId: "clt", foraDaGorjeta: false },
      { id: "tpV", employeeId: "clt-vale", foraDaGorjeta: false, vales: 1 },
    ]);
    const r = await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.update).toHaveBeenCalledWith({ where: { id: "tpS" }, data: { foraDaGorjeta: true } });
    expect(db.tipParticipant.update).toHaveBeenCalledWith({ where: { id: "tpV" }, data: { foraDaGorjeta: true } });
    expect(db.tipParticipant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["tpC"] }, foraDaGorjeta: true } });
    expect(r.removidos).toBe(1);
  });

  test("sem registro em teste sem vínculo no mês do salário não entra", async () => {
    cadastro([{ id: "sr", participaGorjeta: true, modality: "NAO_CLT", admissionDate: d("2026-10-03"), terminationDate: null, inicioGorjeta: null }]);
    noPeriodo([]);
    await syncParticipantsFromCadastro("per1");
    expect(db.tipParticipant.createMany).not.toHaveBeenCalled();
  });
});

describe("computeTipCommission com quem está em teste", () => {
  const emTeste = (over: Record<string, unknown> = {}, emp: Record<string, unknown> = {}) => participante(
    { id: "tp9", employeeId: "e9", basePoints: 4, ...over },
    {
      firstName: "Teste", lastName: "Novo", modality: "NAO_CLT", baseSalary: 2300, admissionDate: d("2026-09-23"),
      participaGorjeta: true, inicioGorjeta: null, ...emp,
    },
  );

  test("participante normal sem recarregar, com o cadastro em teste: só salário, gorjeta zero e aviso", async () => {
    periodo("OPEN", [participante(), emTeste()]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const t = comp.participants.find((p) => p.employeeId === "e9")!;
    expect(t).toMatchObject({ foraDaGorjeta: true, rateioAmount: 0, points: 0, salarioProporcional: 613.36, totalAPagar: 613.36 });
    expect(comp.warnings).toContain("Teste Novo está em teste (fora da gorjeta desde a admissão em 23/09). Para incluir, preencha 'Entra na gorjeta em' no cadastro.");
  });

  test("entrada depois do ciclo também avisa, com a data", async () => {
    periodo("OPEN", [emTeste({ foraDaGorjeta: true, basePoints: 0 }, { inicioGorjeta: d("2026-09-28") })]);
    const comp = await computeTipCommission(2026, 9);
    expect(comp.warnings.join(" ")).toContain("Teste Novo está em teste (fora da gorjeta desde a admissão em 23/09; a entrada na gorjeta (28/09) é depois deste ciclo)");
  });

  test("entrada no meio do ciclo: gorjeta proporcional desde a entrada, salário desde a admissão", async () => {
    periodo("OPEN", [participante(), emTeste({}, { admissionDate: d("2026-09-01"), inicioGorjeta: d("2026-09-10") })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    const t = comp.participants.find((p) => p.employeeId === "e9")!;
    expect(t.foraDaGorjeta).toBe(false);
    expect(t.points).toBeGreaterThan(0);
    expect(t.points).toBeLessThan(4);
    expect(t.salarioProporcional).toBe(2300);
    expect(comp.warnings.join(" ")).not.toContain("está em teste");
  });

  test("fechado não muda: segue o que o período gravou", async () => {
    periodo("CLOSED", [emTeste({ rateioAmount: 400, netCommission: 400, totalAPagar: 1013.36, salarioProporcional: 613.36, points: 4 })]);
    const comp = await computeTipCommission(2026, 9, { incluirDadosPessoais: true });
    expect(comp.participants[0]).toMatchObject({ foraDaGorjeta: false, rateioAmount: 400, totalAPagar: 1013.36 });
  });
});
