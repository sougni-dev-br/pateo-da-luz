import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rescisão calculada aqui (sem termo) cujo líquido dá zero ou negativo (vales e descontos
// empatam ou passam do que a pessoa recebe). Regra do Eli (01/10/2026): líquido zero =
// quitada, nada a pagar; negativo = o saldo devedor é perdoado e a rescisão fica quitada.
// Diferente da quitada no termo, esta grava a gorjeta na apuração — e desfaz ao excluir.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    tipParticipant: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    vtFaltaDeduction: { deleteMany: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../rescisao-apuracao.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rescisao-apuracao.js")>()),
  apurarRescisao: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { apurarRescisao, montarSugestao, type ApuracaoRescisao } from "../rescisao-apuracao.js";
import { detalhesNaLista, payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll", payrollRouter);

const SAIDA = new Date("2026-09-12T00:00:00Z");
const emp = { id: "e1", firstName: "Ana", lastName: "Silva", modality: "NAO_CLT", terminationDate: SAIDA, deletedAt: null };

// Salário 659,97 + gorjeta 186,80 = 846,77 de bruto; vales de 1.000,00 no apurado.
function apuracao(vales = 1000): ApuracaoRescisao {
  const base: Omit<ApuracaoRescisao, "sugestao"> = {
    saida: "2026-09-12", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: vales, creditos: 0, liquido: -vales, entraNaRescisao: true },
    gorjeta: { periodo: "09/2026", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 9, salarioProporcional: 659.97 },
    gorjetaObservacao: null,
    jaPagoNaLista: null,
  };
  return { ...base, sugestao: montarSugestao(base) };
}

const NEGATIVO = { salario: 659.97, gorjeta: 186.8, valesDiscount: 1000, dueDate: "2026-09-30", installments: 3 };
const ZERO = { salario: 659.97, gorjeta: 186.8, valesDiscount: 846.77 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined as never);
  vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
  db.employee.findFirst.mockResolvedValue(emp);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.payrollItem.create.mockImplementation(async ({ data }: { data: unknown }) => data);
  db.payrollItem.update.mockResolvedValue({ id: "q1", status: "PAID" });
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", label: "Gorjeta 26/08–25/09", status: "OPEN" });
  db.tipParticipant.findUnique.mockResolvedValue({ id: "tp1", rescisaoValorFixo: null, rateioAmount: 186.8, totalAPagar: 0, employee: { modality: "NAO_CLT" } });
  db.tipParticipant.update.mockResolvedValue({});
  db.tipParticipant.updateMany.mockResolvedValue({ count: 1 });
  db.vtFaltaDeduction.deleteMany.mockResolvedValue({ count: 0 });
});

describe("POST /termination — líquido negativo: saldo devedor perdoado, rescisão quitada", () => {
  test("cria UMA parcela de R$ 0,00 já paga na saída, com o perdoado e todo o detalhamento", async () => {
    const r = await request(app).post("/payroll/termination/e1").send(NEGATIVO);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ amount: 0, installments: 1, quitadaSemValor: true, saldoDevedorPerdoado: 153.23 });
    expect(db.payrollItem.create).toHaveBeenCalledTimes(1);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "RESCISAO", amount: 0, paidAmount: 0, status: "PAID", periodLabel: "Rescisão (quitada)" });
    expect(data.paymentDate.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(data.dueDate.toISOString().slice(0, 10)).toBe("2026-09-12");
    expect(data.details).toMatchObject({
      quitadaSemValor: true, saldoDevedorPerdoado: 153.23,
      grossAmount: 846.77, salario: 659.97, gorjeta: 186.8, valesDiscount: 1000,
      gorjetaNaApuracao: { participantId: "tp1", aplicada: 186.8 },
      ajusteManual: null,
    });
    expect(data.details).not.toHaveProperty("quitadaNoTermo");
    expect(data.details).not.toHaveProperty("installmentTotal");
    expect(typeof data.details.grupoRescisao).toBe("string");
    expect(data.details.apuracaoSistema).not.toBeNull();
  });

  test("a gorjeta vira a gorjeta paga na apuração, como numa rescisão normal", async () => {
    await request(app).post("/payroll/termination/e1").send(NEGATIVO);
    expect(db.tipParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tp1" }, data: expect.objectContaining({ rescisaoValorFixo: 186.8 }),
    }));
  });

  test("auditoria registra a quitação e o perdoado", async () => {
    await request(app).post("/payroll/termination/e1").send(NEGATIVO);
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { action: string; newValue: Record<string, unknown> };
    expect(audit.action).toBe("RELEASE_TERMINATION");
    expect(audit.newValue).toMatchObject({ net: 0, installments: 1, quitadaSemValor: true, saldoDevedorPerdoado: 153.23 });
  });

  test("sem data de saída no cadastro: paga na data de vencimento informada", async () => {
    db.employee.findFirst.mockResolvedValue({ ...emp, terminationDate: null });
    const r = await request(app).post("/payroll/termination/e1").send(NEGATIVO);
    expect(r.status).toBe(201);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data.paymentDate.toISOString().slice(0, 10)).toBe("2026-09-30");
  });

  test("mês travado: recusa sem criar", async () => {
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Período 09/2026 fechado."));
    const r = await request(app).post("/payroll/termination/e1").send(NEGATIVO);
    expect(r.status).toBe(400);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });
});

describe("POST /termination — líquido zero", () => {
  test("quitada, nada perdoado", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao(846.77));
    const r = await request(app).post("/payroll/termination/e1").send(ZERO);
    expect(r.status).toBe(201);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ amount: 0, status: "PAID", details: { quitadaSemValor: true, saldoDevedorPerdoado: 0 } });
  });

  test("líquido positivo continua como antes: título em aberto, sem a marca", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao(100));
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 659.97, gorjeta: 186.8, valesDiscount: 100 });
    expect(r.status).toBe(201);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data.amount).toBe(746.77);
    expect(data.paymentDate).toBeUndefined();
    expect(data.details).not.toHaveProperty("quitadaSemValor");
  });
});

describe("Folha: a rescisão quitada sem valor", () => {
  const quitada = {
    id: "q1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, amount: 0, paidAmount: 0,
    status: "PAID", paymentDate: SAIDA, dueDate: SAIDA, createdAt: new Date("2026-10-01T10:00:00Z"), updatedAt: new Date("2026-10-01T10:00:00Z"),
    details: {
      grupoRescisao: "g1", quitadaSemValor: true, saldoDevedorPerdoado: 153.23,
      gorjetaNaApuracao: { participantId: "tp1", periodo: "x", anterior: null, aplicada: 186.8 },
    },
  };

  test("estornar é recusado: não houve pagamento", async () => {
    db.payrollItem.findFirst.mockResolvedValue(quitada);
    const r = await request(app).patch("/payroll/q1/reverse").send({ reason: "teste" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Rescisão quitada sem valor: não houve pagamento a estornar; para refazer, exclua.");
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("excluir funciona mesmo paga, e desfaz a gorjeta gravada na apuração", async () => {
    db.payrollItem.findFirst.mockResolvedValue(quitada);
    db.payrollItem.count.mockResolvedValue(0);
    const r = await request(app).delete("/payroll/q1").send({ reason: "lançada com o vale errado" });
    expect(r.status).toBe(200);
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q1", folhaLoteId: null } }));
    expect(db.tipParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { rescisaoValorFixo: null } }));
  });

  test("restaurar relança a gorjeta", async () => {
    db.payrollItem.findFirst.mockResolvedValue({ ...quitada, deletedAt: new Date() });
    db.payrollItem.findMany.mockResolvedValue([]);
    const r = await request(app).patch("/payroll/q1/restore").send({});
    expect(r.status).toBe(200);
    expect(db.tipParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rescisaoValorFixo: 186.8 }) }));
  });

  test("ajustar é recusado com o caminho certo (excluir e lançar de novo)", async () => {
    db.payrollItem.findMany.mockResolvedValue([quitada]);
    const r = await request(app).put("/payroll/termination/e1").send({ ...NEGATIVO, justificativa: "trocar o valor do vale" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/quitada sem valor/i);
    expect(r.body.message).toMatch(/exclua/i);
  });

  test("ajuste que zeraria o líquido de uma rescisão em aberto é recusado (não cria título de R$ 0,00)", async () => {
    const aberta = { ...quitada, amount: 746.77, paidAmount: null, paymentDate: null, status: "PENDING", details: { grupoRescisao: "g1", grossAmount: 846.77, salario: 659.97, gorjeta: 186.8, valesDiscount: 100, creditos: 0 } };
    db.payrollItem.findMany.mockResolvedValue([aberta]);
    const r = await request(app).put("/payroll/termination/e1").send({ ...NEGATIVO, justificativa: "vale maior que o lançado" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/exclua/i);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("a lista da Folha sem ver Funcionários mantém a marca e o perdoado", () => {
    expect(detalhesNaLista("RESCISAO", { quitadaSemValor: true, saldoDevedorPerdoado: 10, salario: 1 }, false))
      .toEqual({ quitadaSemValor: true, saldoDevedorPerdoado: 10 });
  });
});

describe("GET /termination — a lançada quitada sem valor", () => {
  test("lancada traz a quitação e o perdoado (o painel mostra \"quitada\", não \"estorne\")", async () => {
    const item = {
      id: "q1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Rescisão (quitada)", amount: 0,
      paymentDate: SAIDA, dueDate: SAIDA, notes: null,
      details: { grupoRescisao: "g1", grossAmount: 846.77, valesDiscount: 1000, quitadaSemValor: true, saldoDevedorPerdoado: 153.23 },
    };
    db.payrollItem.findMany.mockResolvedValue([item]);
    db.payrollItem.findFirst.mockResolvedValue(item);
    const r = await request(app).get("/payroll/termination/e1");
    expect(r.status).toBe(200);
    expect(r.body.lancada).toMatchObject({ liquido: 0, algumaPaga: true, quitadaSemValor: { saldoDevedorPerdoado: 153.23 } });
  });
});
