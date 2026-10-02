import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas da rescisão de sem registro que saiu depois do ciclo, no mês do salário ("tudo na
// rescisão"): a gorjeta lançada não vai inteira para o período seguinte (consumiria pontos
// dele) — só a parte dos dias depois do ciclo. Excluir a rescisão desfaz exatamente isso.
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
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn() }));
vi.mock("../rescisao-apuracao.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rescisao-apuracao.js")>()),
  apurarRescisao: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { apurarRescisao, montarSugestao, type ApuracaoRescisao } from "../rescisao-apuracao.js";
import { payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll", payrollRouter);

const SAIDA = new Date("2026-09-29T00:00:00Z");
const emp = { id: "e1", firstName: "Ana", lastName: "Silva", modality: "NAO_CLT", terminationDate: SAIDA, deletedAt: null };
const OUTUBRO = { id: "per10", label: "Gorjeta 26/09–25/10", status: "OPEN" };

// Ciclo de setembro: 745,32; de 26 a 29/09 (outubro): 50,00.
function apuracao(): ApuracaoRescisao {
  const base: Omit<ApuracaoRescisao, "sugestao"> = {
    saida: "2026-09-29", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "Gorjeta 26/08–25/09 + Gorjeta 26/09–25/10", status: "OPEN", pontos: 4.5, valorPonto: 186.33, gorjeta: 795.32, pendente: false, diasSalario: 29, salarioProporcional: 2126.57 },
    gorjetaObservacao: null,
    jaPagoNaLista: null,
    adiantamento: null,
    gorjetaPartes: [
      { periodo: "Gorjeta 26/08–25/09", competencia: "09/2026", dias: "26/08 a 25/09", valor: 745.32, pendente: false, jaPagoNaLista: false },
      { periodo: "Gorjeta 26/09–25/10", competencia: "10/2026", dias: "26/09 a 29/09", valor: 50, pendente: false, jaPagoNaLista: false },
    ],
  };
  return { ...base, sugestao: montarSugestao(base) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
  db.employee.findFirst.mockResolvedValue(emp);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.create.mockResolvedValue({});
  db.payrollItem.update.mockResolvedValue({ id: "r1", status: "PENDING" });
  db.tipParticipant.update.mockResolvedValue({});
  db.tipParticipant.updateMany.mockResolvedValue({ count: 1 });
  db.vtFaltaDeduction.deleteMany.mockResolvedValue({ count: 0 });
  // O período que contém a saída é outubro; o participante dele é o dos dias 26 a 29/09.
  db.tipPeriod.findFirst.mockResolvedValue(OUTUBRO);
  db.tipParticipant.findUnique.mockResolvedValue({
    id: "tp10", rescisaoValorFixo: null, rateioAmount: 50, totalAPagar: 0, employee: { modality: "NAO_CLT" },
  });
});

describe("POST /termination — saída depois do ciclo, no mês do salário", () => {
  test("grava em outubro só a gorjeta lançada menos a do ciclo de setembro", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    const r = await request(app).post("/payroll/termination/e1")
      .send({ salario: 2126.57, gorjeta: 800, ajusteJustificativa: "Gorjeta de 26 a 29/09 arredondada com o RH" });
    expect(r.status).toBe(201);
    expect(db.tipParticipant.update).toHaveBeenCalledTimes(1);
    expect(db.tipParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tp10" }, data: expect.objectContaining({ rescisaoValorFixo: 54.68 }),
    }));
    const details = db.payrollItem.create.mock.calls[0][0].data.details;
    expect(details.gorjetaNaApuracao).toEqual({ participantId: "tp10", periodo: OUTUBRO.label, anterior: null, aplicada: 54.68 });
    expect(details.gorjeta).toBe(800);
  });

  test("gorjeta igual à apurada: grava os 50,00 de outubro, sem divergência", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 2126.57, gorjeta: 795.32 });
    expect(r.status).toBe(201);
    expect(db.tipParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tp10" }, data: expect.objectContaining({ rescisaoValorFixo: 50 }),
    }));
  });

  test("sem o período de outubro: lança a rescisão e não grava nada na gorjeta", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    db.tipPeriod.findFirst.mockResolvedValue(null);
    const r = await request(app).post("/payroll/termination/e1")
      .send({ salario: 2126.57, gorjeta: 745.32, ajusteJustificativa: "Outubro ainda não foi aberto na gorjeta" });
    expect(r.status).toBe(201);
    expect(db.tipParticipant.update).not.toHaveBeenCalled();
    expect(db.payrollItem.create.mock.calls[0][0].data.details.gorjetaNaApuracao).toBeNull();
  });
});

describe("DELETE da rescisão — desfaz exatamente o que gravou", () => {
  test("volta o participante de outubro ao valor anterior, só se ainda tiver o aplicado", async () => {
    db.payrollItem.findFirst.mockResolvedValue({
      id: "r1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, paymentDate: null,
      dueDate: new Date("2026-10-05T00:00:00Z"), createdAt: new Date("2026-09-30T10:00:00Z"),
      details: { grupoRescisao: "g1", gorjetaNaApuracao: { participantId: "tp10", periodo: OUTUBRO.label, anterior: null, aplicada: 54.68 } },
    });
    db.payrollItem.count.mockResolvedValue(0);
    const r = await request(app).delete("/payroll/r1").send({ reason: "lançada com o valor errado" });
    expect(r.status).toBe(200);
    expect(db.tipParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "tp10", rescisaoValorFixo: 54.68 }),
      data: { rescisaoValorFixo: null },
    }));
  });
});

// Auditoria 01/10: a lista do mês só zera quando a rescisão foi lançada pela regra "tudo na
// rescisão" — o lançamento grava o marcador quando a apuração tem as partes da gorjeta.
describe("POST /termination — marcador tudoNaRescisao", () => {
  test("apuração com as partes (saída depois do ciclo): grava details.tudoNaRescisao = true", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    db.payrollItem.findMany.mockResolvedValue([]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 2126.57, gorjeta: 795.32 });
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.details.tudoNaRescisao).toBe(true);
  });

  test("parcelado: o marcador vai em todas as parcelas", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    db.payrollItem.findMany.mockResolvedValue([]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 2126.57, gorjeta: 795.32, installments: 2, dueDate: "2026-10-05" });
    expect(r.status).toBe(201);
    for (const c of db.payrollItem.create.mock.calls) expect(c[0].data.details.tudoNaRescisao).toBe(true);
  });

  test("apuração sem as partes (saída dentro do ciclo): sem o marcador", async () => {
    const semPartes = apuracao();
    delete semPartes.gorjetaPartes;
    vi.mocked(apurarRescisao).mockResolvedValue(semPartes);
    db.payrollItem.findFirst.mockResolvedValue(null);
    db.payrollItem.findMany.mockResolvedValue([]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 2126.57, gorjeta: 795.32 });
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.details).not.toHaveProperty("tudoNaRescisao");
  });
});
