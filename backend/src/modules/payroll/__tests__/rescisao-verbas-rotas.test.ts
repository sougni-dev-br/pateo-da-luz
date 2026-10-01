import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Verbas opcionais na rescisão de sem registro (decisão do Eli, 01/10/2026): a tela manda o
// que foi marcado; o servidor RECALCULA férias, 13º e aviso, soma no bruto, grava quem
// marcou e registra na auditoria. CLT recusa. Não são divergência do apurado.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    tipParticipant: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
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
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { apurarRescisao, montarSugestao, type ApuracaoRescisao } from "../rescisao-apuracao.js";
import { calcularVerbasOpcionais } from "../rescisao-verbas-opcionais.js";
import { payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll", payrollRouter);

const SAIDA = new Date("2026-09-24T00:00:00Z");
const emp = { id: "e1", firstName: "Ana", lastName: "Silva", modality: "NAO_CLT", terminationDate: SAIDA, deletedAt: null };
// S 2.200,00, início 10/03/2026: férias 7 avos = 1.711,11 (com 1/3); 13º 7 avos = 1.283,33; aviso 30 dias = 2.200,00.
const CALCULO = calcularVerbasOpcionais({ salarioBase: 2200, inicio: new Date("2026-03-10T00:00:00Z"), saida: SAIDA, feriasRegistradas: [] });

function apuracao(over: Partial<Omit<ApuracaoRescisao, "sugestao">> = {}): ApuracaoRescisao {
  const base: Omit<ApuracaoRescisao, "sugestao"> = {
    saida: "2026-09-24", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
    gorjeta: { periodo: "09/2026", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 24, salarioProporcional: 1760 },
    gorjetaObservacao: null,
    jaPagoNaLista: null,
    verbasOpcionais: { calculo: CALCULO, observacao: null },
    ...over,
  };
  return { ...base, sugestao: montarSugestao(base) };
}

const CORPO = { salario: 1760, gorjeta: 186.8, dueDate: "2026-09-30" };
const nada = { ferias: false, decimoTerceiro: false, aviso: false, livre: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
  db.employee.findFirst.mockResolvedValue(emp);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.payrollItem.create.mockImplementation(async ({ data }: { data: unknown }) => data);
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", label: "Gorjeta 26/08–25/09", status: "OPEN" });
  db.tipParticipant.findUnique.mockResolvedValue({ id: "tp1", rescisaoValorFixo: 186.8, rateioAmount: 186.8, totalAPagar: 0, employee: { modality: "NAO_CLT" } });
  db.tipParticipant.update.mockResolvedValue({});
});

const criado = () => db.payrollItem.create.mock.calls[0][0].data;

describe("POST /termination — verbas opcionais", () => {
  test("nada marcado: o bruto é o de sempre e nada de verbas gravado", async () => {
    const r = await request(app).post("/payroll/termination/e1").send({ ...CORPO, verbasOpcionais: nada });
    expect(r.status).toBe(201);
    expect(criado().details.grossAmount).toBe(1946.8);
    expect(criado().details.verbasOpcionais ?? null).toBeNull();
    expect(criado().details.verbasOpcionaisPor ?? null).toBeNull();
  });

  test("marcadas: o servidor recalcula (ignora valor vindo da tela), soma no bruto e grava quem marcou", async () => {
    const r = await request(app).post("/payroll/termination/e1").send({
      ...CORPO,
      verbasOpcionais: { ferias: true, decimoTerceiro: true, aviso: false, livre: { valor: 300, descricao: "Gratificação de saída" }, valorFerias: 99999 },
      grossAmount: 999999,
    });
    expect(r.status).toBe(201);
    const det = criado().details;
    // 1.946,80 + 1.711,11 + 1.283,33 + 300,00
    expect(det.grossAmount).toBe(5241.24);
    expect(criado().amount).toBe(5241.24);
    expect(det.verbasOpcionais.total).toBe(3294.44);
    expect(det.verbasOpcionais.itens).toEqual([
      expect.objectContaining({ tipo: "FERIAS", avos: 7, valor: 1711.11, memoria: "S 2.200,00 ÷ 12 × 7 avos = 1.283,33 + 1/3 (427,78)" }),
      expect.objectContaining({ tipo: "DECIMO_TERCEIRO", avos: 7, valor: 1283.33 }),
      expect.objectContaining({ tipo: "LIVRE", valor: 300, descricao: "Gratificação de saída" }),
    ]);
    expect(det.verbasOpcionaisPor).toEqual({ userId: "u1", nome: "Eli", em: expect.any(String) });
    // Não são divergência do apurado: nada de justificativa.
    expect(det.ajusteManual).toBeNull();
  });

  test("auditoria RELEASE_TERMINATION leva as verbas marcadas", async () => {
    await request(app).post("/payroll/termination/e1").send({ ...CORPO, verbasOpcionais: { ...nada, aviso: true } });
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { action: string; newValue: Record<string, unknown> };
    expect(audit.action).toBe("RELEASE_TERMINATION");
    expect(audit.newValue).toMatchObject({
      gross: 4146.8,
      verbasOpcionais: { total: 2200, itens: [expect.objectContaining({ tipo: "AVISO", dias: 30, valor: 2200 })] },
    });
  });

  test("valor livre sem descrição: 400, nada criado", async () => {
    const r = await request(app).post("/payroll/termination/e1").send({ ...CORPO, verbasOpcionais: { ...nada, livre: { valor: 300, descricao: "" } } });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("descrição");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("marcou férias sem cálculo possível (sem salário no cadastro): 400", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ verbasOpcionais: { calculo: null, observacao: "Sem salário base" } }));
    const r = await request(app).post("/payroll/termination/e1").send({ ...CORPO, verbasOpcionais: { ...nada, ferias: true } });
    expect(r.status).toBe(400);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("CLT com verba marcada: 400 com mensagem clara", async () => {
    db.employee.findFirst.mockResolvedValue({ ...emp, modality: "CLT" });
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ semRegistro: false, verbasOpcionais: null }));
    const r = await request(app).post("/payroll/termination/e1").send({ grossAmount: 3000, verbasOpcionais: { ...nada, aviso: true } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/só para quem não tem registro/);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("CLT sem nada marcado: segue normal", async () => {
    db.employee.findFirst.mockResolvedValue({ ...emp, modality: "CLT" });
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ semRegistro: false, verbasOpcionais: null }));
    const r = await request(app).post("/payroll/termination/e1").send({ grossAmount: 3000, verbasOpcionais: nada });
    expect(r.status).toBe(201);
    expect(criado().details.grossAmount).toBe(3000);
  });

  test("quitada sem valor: as verbas entram no bruto antes de comparar com os descontos", async () => {
    // Vales de 2.500,00 > bruto de 1.946,80 → negativo; com o aviso (2.200,00) o líquido fica 1.646,80.
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ vales: { itens: [], descontos: 2500, creditos: 0, liquido: 2500, entraNaRescisao: true } }));
    const r = await request(app).post("/payroll/termination/e1").send({ ...CORPO, valesDiscount: 2500, verbasOpcionais: { ...nada, aviso: true } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ amount: 1646.8, quitadaSemValor: false });
  });

  test("quitada sem valor continua: valor livre pequeno reduz o perdoado", async () => {
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ vales: { itens: [], descontos: 2500, creditos: 0, liquido: 2500, entraNaRescisao: true } }));
    const r = await request(app).post("/payroll/termination/e1").send({ ...CORPO, valesDiscount: 2500, verbasOpcionais: { ...nada, livre: { valor: 100, descricao: "Acordo" } } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ amount: 0, quitadaSemValor: true, saldoDevedorPerdoado: 453.2 });
    expect(criado().details.verbasOpcionais.total).toBe(100);
  });
});

describe("PUT /termination — marcar e desmarcar verbas no ajuste", () => {
  const LIDO = new Date("2026-09-25T10:00:00Z");
  const item = (verbas: unknown = null) => ({
    id: "r1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Rescisão",
    dueDate: new Date("2026-09-30T00:00:00Z"), amount: verbas ? 4146.8 : 1946.8, paymentDate: null, notes: null, updatedAt: LIDO,
    details: {
      grupoRescisao: "g1", grossAmount: verbas ? 4146.8 : 1946.8, vtDiscount: 0, otherDiscount: 0, salario: 1760, gorjeta: 186.8, creditos: 0, valesDiscount: 0,
      gorjetaNaApuracao: { participantId: "tp1", periodo: "x", anterior: null, aplicada: 186.8 }, historicoAjustes: [],
      ...(verbas ? { verbasOpcionais: verbas, verbasOpcionaisPor: { userId: "u0", nome: "Outro", em: "2026-09-25T00:00:00Z" } } : {}),
    },
  });
  const AVISO = { itens: [{ tipo: "AVISO", rotulo: "Aviso prévio indenizado", valor: 2200, memoria: "S 2.200,00 ÷ 30 × 30 dias", dias: 30 }], total: 2200 };

  beforeEach(() => db.payrollItem.updateMany.mockResolvedValue({ count: 1 }));

  test("marcar o 13º no ajuste: recalcula, soma no bruto, grava quem marcou e o histórico", async () => {
    db.payrollItem.findMany.mockResolvedValue([item()]);
    const r = await request(app).put("/payroll/termination/e1").send({
      ...CORPO, justificativa: "Empresa decidiu pagar o 13º", verbasOpcionais: { ...nada, decimoTerceiro: true },
    });
    expect(r.status).toBe(200);
    const data = db.payrollItem.updateMany.mock.calls[0][0].data;
    expect(data.amount).toBe(3230.13);
    expect(data.details.grossAmount).toBe(3230.13);
    expect(data.details.verbasOpcionais).toMatchObject({ total: 1283.33, itens: [expect.objectContaining({ tipo: "DECIMO_TERCEIRO" })] });
    expect(data.details.verbasOpcionaisPor).toMatchObject({ userId: "u1", nome: "Eli" });
    const h = data.details.historicoAjustes[0];
    expect(h.antes.verbasOpcionaisTotal).toBe(0);
    expect(h.depois.verbasOpcionaisTotal).toBe(1283.33);
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { action: string; newValue: Record<string, unknown> };
    expect(audit.action).toBe("ADJUST_TERMINATION");
    expect(audit.newValue).toMatchObject({ verbasOpcionais: { total: 1283.33 } });
  });

  test("desmarcar tudo: tira do bruto e limpa as verbas", async () => {
    db.payrollItem.findMany.mockResolvedValue([item(AVISO)]);
    const r = await request(app).put("/payroll/termination/e1").send({ ...CORPO, justificativa: "Aviso não será pago afinal", verbasOpcionais: nada });
    expect(r.status).toBe(200);
    const data = db.payrollItem.updateMany.mock.calls[0][0].data;
    expect(data.amount).toBe(1946.8);
    expect(data.details.verbasOpcionais).toBeNull();
    expect(data.details.verbasOpcionaisPor).toMatchObject({ userId: "u1" });
  });

  test("ajuste sem mandar verbas: mantém as gravadas como estão", async () => {
    db.payrollItem.findMany.mockResolvedValue([item(AVISO)]);
    const r = await request(app).put("/payroll/termination/e1").send({ ...CORPO, vtDiscount: 10, justificativa: "VT devolvido da última semana" });
    expect(r.status).toBe(200);
    const data = db.payrollItem.updateMany.mock.calls[0][0].data;
    expect(data.amount).toBe(4136.8);
    expect(data.details.verbasOpcionais).toEqual(AVISO);
    expect(data.details.verbasOpcionaisPor).toMatchObject({ userId: "u0" });
  });

  test("só trocar a escolha (mesmo total) conta como mudança", async () => {
    db.payrollItem.findMany.mockResolvedValue([item(AVISO)]);
    const r = await request(app).put("/payroll/termination/e1").send({
      ...CORPO, justificativa: "Troca por acordo de mesmo valor", verbasOpcionais: { ...nada, livre: { valor: 2200, descricao: "Acordo de saída" } },
    });
    expect(r.status).toBe(200);
  });

  test("CLT no ajuste com verba marcada: 400", async () => {
    db.employee.findFirst.mockResolvedValue({ ...emp, modality: "CLT" });
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao({ semRegistro: false, verbasOpcionais: null }));
    db.payrollItem.findMany.mockResolvedValue([item()]);
    const r = await request(app).put("/payroll/termination/e1").send({ grossAmount: 3000, justificativa: "Tentando pagar aviso", verbasOpcionais: { ...nada, aviso: true } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/só para quem não tem registro/);
  });
});

describe("GET /termination — rescisão lançada com verbas", () => {
  test("devolve as verbas gravadas; sem ver Funcionários, oculta valor e memória das calculadas", async () => {
    const AVISO_E_LIVRE = {
      itens: [
        { tipo: "AVISO", rotulo: "Aviso prévio indenizado", valor: 2200, memoria: "S 2.200,00 ÷ 30 × 30 dias", dias: 30 },
        { tipo: "LIVRE", rotulo: "Acordo", valor: 100, memoria: null, descricao: "Acordo" },
      ],
      total: 2300,
    };
    db.payrollItem.findMany.mockImplementation(async (a: { where: { type: string } }) => (a.where.type === "RESCISAO" ? [{
      id: "r1", amount: 4246.8, paymentDate: null, notes: null, periodLabel: "Rescisão", dueDate: new Date("2026-09-30T00:00:00Z"),
      details: { grossAmount: 4246.8, salario: 1760, gorjeta: 186.8, verbasOpcionais: AVISO_E_LIVRE, verbasOpcionaisPor: { userId: "u1", nome: "Eli", em: "x" } },
    }] : []));
    db.payrollItem.findFirst.mockResolvedValue({ id: "r1" });
    const r = await request(app).get("/payroll/termination/e1");
    expect(r.body.lancada.verbasOpcionais).toMatchObject({ total: 2300, por: { nome: "Eli" } });

    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r2 = await request(app).get("/payroll/termination/e1");
    const itens = r2.body.lancada.verbasOpcionais.itens;
    expect(itens[0]).toMatchObject({ tipo: "AVISO", valor: null, dias: 30 });
    expect(itens[0].memoria).not.toContain("2.200");
    expect(itens[1]).toMatchObject({ tipo: "LIVRE", valor: 100 });
    expect(r2.body.lancada.verbasOpcionais.total).toBeNull();
  });
});
