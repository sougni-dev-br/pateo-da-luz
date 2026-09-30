import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas da rescisão com o banco de mentira: concorrência (trava + compare-and-set),
// permissão da Gorjeta, gorjeta já paga na lista fechada e o que vaza sem ver Funcionários.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    // Sem histórico do cadastro: vale o valor atual.
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
import { detalhesNaLista, gorjetaMudaApuracao, lancadaVisivel, payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll", payrollRouter);

const SAIDA = new Date("2026-09-12T00:00:00Z");
const emp = { id: "e1", firstName: "Ana", lastName: "Silva", modality: "NAO_CLT", terminationDate: SAIDA, deletedAt: null };
let permissoes: Record<string, boolean> = {};

function apuracao(over: Partial<Omit<ApuracaoRescisao, "sugestao">> = {}): ApuracaoRescisao {
  const base: Omit<ApuracaoRescisao, "sugestao"> = {
    saida: "2026-09-12", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "09/2026", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 9, salarioProporcional: 659.97 },
    gorjetaObservacao: null,
    jaPagoNaLista: null,
    ...over,
  };
  return { ...base, sugestao: montarSugestao(base) };
}

// Período da gorjeta que contém a saída e o participante dele.
function gorjetaDoMes(status: "OPEN" | "CLOSED", participante: Record<string, unknown>) {
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", label: "Gorjeta 26/08–25/09", status });
  db.tipParticipant.findUnique.mockResolvedValue({
    id: "tp1", rescisaoValorFixo: null, rateioAmount: 186.8, totalAPagar: 0, employee: { modality: "NAO_CLT" }, ...participante,
  });
}

const trava = () => db.$executeRaw.mock.calls.find((c: unknown[]) => String((c[0] as string[]).join("?")).includes("pg_advisory_xact_lock"));

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = { "payroll-tips:edit": true };
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(userHasPermission).mockImplementation(async (_u, menu, acao) => permissoes[`${menu}:${acao}`] ?? false);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  db.employee.findFirst.mockResolvedValue(emp);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.create.mockResolvedValue({});
  db.payrollItem.update.mockResolvedValue({ id: "r1", status: "PENDING" });
  db.tipParticipant.update.mockResolvedValue({});
  db.tipParticipant.updateMany.mockResolvedValue({ count: 1 });
  db.vtFaltaDeduction.deleteMany.mockResolvedValue({ count: 0 });
});

describe("POST /termination — gorjeta já paga na lista fechada (não paga em dobro)", () => {
  const ja = { jaPagoNaLista: { valor: 846.77, competencia: "09/2026" }, gorjeta: { ...apuracao().gorjeta!, status: "CLOSED" as const } };

  test("lançar salário e gorjeta de novo sem justificativa é recusado", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao(ja));
    db.payrollItem.findFirst.mockResolvedValue(null);
    gorjetaDoMes("CLOSED", { totalAPagar: 846.77 });
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 659.97, gorjeta: 186.8 });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("salário proporcional");
    expect(r.body.message).toContain("gorjeta até a saída");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("com justificativa lança, mas não mexe na apuração fechada", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao(ja));
    db.payrollItem.findFirst.mockResolvedValue(null);
    gorjetaDoMes("CLOSED", { totalAPagar: 846.77, rateioAmount: 186.8 });
    const r = await request(app).post("/payroll/termination/e1")
      .send({ salario: 659.97, gorjeta: 50, ajusteJustificativa: "Diferença combinada com o RH na saída" });
    expect(r.status).toBe(201);
    // 50 ≠ 186,80 fechado: antes dava erro "reabra a gorjeta"; agora só não aplica.
    expect(db.tipParticipant.update).not.toHaveBeenCalled();
    const details = db.payrollItem.create.mock.calls[0][0].data.details;
    expect(details.gorjetaNaApuracao).toBeNull();
    expect(details.ajusteManual.divergencias.map((d: { campo: string }) => d.campo)).toEqual(["salario", "gorjeta"]);
  });
});

describe("POST /termination — concorrência", () => {
  test("a checagem de rescisão viva é refeita dentro da transação, sob a trava do funcionário", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
    gorjetaDoMes("OPEN", {});
    // Fora da transação ainda não havia; dentro, o POST concorrente já gravou.
    db.payrollItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "outra" });
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 659.97, gorjeta: 186.8 });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Rescisão já lançada para este funcionário.");
    expect(trava()?.[1]).toBe("rescisao:e1");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(db.tipParticipant.update).not.toHaveBeenCalled();
  });
});

describe("POST /termination — permissão da Gorjeta", () => {
  test("sem editar Gorjeta, não grava a gorjeta na apuração: 403 e nada lançado", async () => {
    permissoes = {};
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
    db.payrollItem.findFirst.mockResolvedValue(null);
    gorjetaDoMes("OPEN", {});
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 659.97, gorjeta: 186.8 });
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Para lançar a gorjeta na apuração é preciso permissão de edição na Gorjeta.");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("com a permissão, a gorjeta vira a gorjeta paga do participante", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
    db.payrollItem.findFirst.mockResolvedValue(null);
    gorjetaDoMes("OPEN", {});
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 659.97, gorjeta: 186.8 });
    expect(r.status).toBe(201);
    expect(db.tipParticipant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "tp1" }, data: expect.objectContaining({ rescisaoValorFixo: 186.8 }),
    }));
  });
});

describe("PUT /termination — ajuste", () => {
  const LIDO = new Date("2026-09-20T10:00:00Z");
  const item = {
    id: "r1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Rescisão",
    dueDate: new Date("2026-09-25T00:00:00Z"), amount: 846.77, paymentDate: null, notes: null, updatedAt: LIDO,
    details: {
      grupoRescisao: "g1", grossAmount: 846.77, vtDiscount: 0, otherDiscount: 0, salario: 659.97, gorjeta: 186.8, creditos: 0, valesDiscount: 0,
      gorjetaNaApuracao: { participantId: "tp1", periodo: "x", anterior: null, aplicada: 186.8 }, historicoAjustes: [],
    },
  };
  const corpo = { salario: 659.97, gorjeta: 186.8, vtDiscount: 10, justificativa: "VT da última semana devolvido" };

  beforeEach(() => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
    db.payrollItem.findMany.mockResolvedValue([item]);
    gorjetaDoMes("OPEN", { rescisaoValorFixo: 186.8 });
  });

  test("grava a 1ª parcela por compare-and-set do updatedAt lido, sob a trava", async () => {
    db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
    const r = await request(app).put("/payroll/termination/e1").send(corpo);
    expect(r.status).toBe(200);
    expect(trava()?.[1]).toBe("rescisao:e1");
    const where = db.payrollItem.updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: "r1", updatedAt: LIDO });
    const historico = db.payrollItem.updateMany.mock.calls[0][0].data.details.historicoAjustes;
    expect(historico).toHaveLength(1);
    expect(historico[0].depois.vtDesconto).toBe(10);
  });

  test("alguém gravou depois da leitura: 0 linhas no compare-and-set = 409", async () => {
    db.payrollItem.updateMany.mockResolvedValue({ count: 0 });
    const r = await request(app).put("/payroll/termination/e1").send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("alterada por outra pessoa");
  });

  test("parcela excluída ou paga desde a leitura também é conflito", async () => {
    db.payrollItem.findMany.mockResolvedValueOnce([item]).mockResolvedValueOnce([item]).mockResolvedValueOnce([]);
    const r = await request(app).put("/payroll/termination/e1").send(corpo);
    expect(r.status).toBe(409);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("sem editar Gorjeta, ajustar só o VT (gorjeta igual) passa e não regrava a apuração", async () => {
    permissoes = {};
    db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
    const r = await request(app).put("/payroll/termination/e1").send(corpo);
    expect(r.status).toBe(200);
    expect(db.tipParticipant.update).not.toHaveBeenCalled();
  });

  test("sem editar Gorjeta, mudar a gorjeta é recusado", async () => {
    permissoes = {};
    const r = await request(app).put("/payroll/termination/e1").send({ ...corpo, gorjeta: 150 });
    expect(r.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE e restaurar rescisão — permissão da Gorjeta e trava", () => {
  const rescisao = {
    id: "r1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, paymentDate: null,
    dueDate: new Date("2026-09-25T00:00:00Z"), createdAt: new Date("2026-09-20T10:00:00Z"),
    details: { grupoRescisao: "g1", gorjetaNaApuracao: { participantId: "tp1", periodo: "x", anterior: null, aplicada: 186.8 } },
  };

  test("excluir a última parcela sem editar Gorjeta, com gorjeta a desfazer: 403", async () => {
    permissoes = {};
    db.payrollItem.findFirst.mockResolvedValue(rescisao);
    db.payrollItem.count.mockResolvedValue(0);
    db.tipParticipant.count.mockResolvedValue(1);
    const r = await request(app).delete("/payroll/r1").send({ reason: "lançada em duplicidade" });
    expect(r.status).toBe(403);
    expect(r.body.message).toContain("permissão de edição na Gorjeta");
    expect(trava()?.[1]).toBe("rescisao:e1");
    expect(db.tipParticipant.updateMany).not.toHaveBeenCalled();
  });

  test("com a permissão, excluir desfaz a gorjeta", async () => {
    db.payrollItem.findFirst.mockResolvedValue(rescisao);
    db.payrollItem.count.mockResolvedValue(0);
    const r = await request(app).delete("/payroll/r1").send({ reason: "lançada em duplicidade" });
    expect(r.status).toBe(200);
    expect(db.tipParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { rescisaoValorFixo: null } }));
  });

  test("restaurar sem editar Gorjeta, com gorjeta a relançar: 403", async () => {
    permissoes = {};
    db.payrollItem.findFirst.mockResolvedValue({ ...rescisao, deletedAt: new Date() });
    db.payrollItem.findMany.mockResolvedValue([]);
    db.tipParticipant.count.mockResolvedValue(1);
    const r = await request(app).patch("/payroll/r1/restore").send({});
    expect(r.status).toBe(403);
    expect(r.body.message).toContain("permissão de edição na Gorjeta");
  });

  test("restaurar confere, sob a trava, se outra rescisão foi lançada: 409", async () => {
    db.payrollItem.findFirst.mockResolvedValue({ ...rescisao, deletedAt: new Date() });
    db.payrollItem.findMany.mockResolvedValue([{ details: { grupoRescisao: "outra" }, createdAt: new Date() }]);
    const r = await request(app).patch("/payroll/r1/restore").send({});
    expect(r.status).toBe(409);
    expect(trava()?.[1]).toBe("rescisao:e1");
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });
});

describe("GET /payroll — salário da rescisão sem ver Funcionários", () => {
  test("rescisão sai com o details na lista branca; outros tipos como estão", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const employee = { firstName: "Ana", lastName: "Silva", displayName: null, sector: "Salão" };
    db.payrollItem.findMany.mockResolvedValue([
      {
        id: "r1", type: "RESCISAO", amount: 400, dueDate: new Date("2099-01-01"), paymentDate: null, employee,
        details: { grupoRescisao: "g1", installmentNumber: 1, installmentTotal: 2, salario: 659.97, apuracaoSistema: { x: 1 }, historicoAjustes: [], valesLabel: "VALE-1" },
      },
      { id: "s1", type: "SALARIO", amount: 2200, dueDate: new Date("2099-01-01"), paymentDate: null, employee, details: { base: 2200 } },
    ]);
    const r = await request(app).get("/payroll?year=2026&month=9");
    expect(r.status).toBe(200);
    expect(r.body.items[0].details).toEqual({ grupoRescisao: "g1", installmentNumber: 1, installmentTotal: 2, valesLabel: "VALE-1" });
    expect(r.body.items[1].details).toEqual({ base: 2200 });
  });
});

describe("funções puras", () => {
  test("detalhesNaLista: com permissão devolve tudo", () => {
    const d = { salario: 1, grupoRescisao: "g" };
    expect(detalhesNaLista("RESCISAO", d, true)).toBe(d);
    expect(detalhesNaLista("RESCISAO", null, false)).toBeNull();
  });

  test("gorjetaMudaApuracao: só quando o valor gravado muda", () => {
    expect(gorjetaMudaApuracao(null, 100)).toBe(false);
    expect(gorjetaMudaApuracao({ anterior: null }, null)).toBe(false);
    expect(gorjetaMudaApuracao({ anterior: null }, 100)).toBe(true);
    expect(gorjetaMudaApuracao({ anterior: 100 }, 100.001)).toBe(false);
    expect(gorjetaMudaApuracao({ anterior: 100 }, 99.99)).toBe(true);
  });

  test("lancadaVisivel tira o salário do histórico, inclusive das divergências com o apurado", () => {
    const valores = { bruto: 846.77, salario: 659.97, gorjeta: 186.8, vales: 0, vtDesconto: 0, outroDesconto: 0, liquido: 846.77 };
    const l = {
      ...valores, valesRotulo: null, outroDescontoRotulo: null, parcelas: [], algumaPaga: false, notes: null,
      ajusteManual: { divergencias: [{ campo: "salario", apurado: 659.97 }, { campo: "gorjeta", apurado: 186.8 }] },
      historicoAjustes: [{
        em: "x", porUserId: "u", porNome: null, justificativa: "j", antes: valores, depois: valores,
        divergenciasDoApurado: [{ campo: "salario", apurado: 659.97, lancado: 700 }],
      }],
    };
    const r = lancadaVisivel(l as never, false)!;
    expect(r.salario).toBeNull();
    expect(r.historicoAjustes[0].antes.salario).toBeNull();
    expect(r.historicoAjustes[0].depois.salario).toBeNull();
    expect(r.historicoAjustes[0]).not.toHaveProperty("divergenciasDoApurado");
    expect(JSON.stringify(r)).not.toContain("659.97");
  });
});
