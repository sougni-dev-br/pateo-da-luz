import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Aviso e recibo de férias da contabilidade → título no Contas a Pagar. Banco e leitor de PDF de mentira;
// pessoa, empresa e valores fictícios (as contas do recibo fecham: 5.333,68 − 700,00 = 4.633,68).
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findMany: vi.fn(), findFirst: vi.fn() },
    feriasProgramacao: { findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../rh-extract.service.js", () => ({ extrairTextoPdf: vi.fn() }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../folha-trava.js", () => ({ travarFolhaDaPessoa: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { feriasReciboRouter } from "../ferias-recibo.routes.js";
import { extrairTextoPdf } from "../rh-extract.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/ferias/recibo", feriasReciboRouter);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const PDF = Buffer.from("%PDF-1.4 conteudo de teste").toString("base64");

const recibo = (o: { nome?: string; periodos?: string; datas?: [string, string]; liquido?: string } = {}) => {
  const nome = o.nome ?? "ANA PAULA EXEMPLO SOUZA";
  const liquido = o.liquido ?? "4.633,68";
  return [
    "AVISO E RECIBO DE FÉRIAS", "TOTAL BASE CALCULO: 4.000,00",
    o.periodos ?? "01/02/2025 A 31/01/2026 02/12/2026 A 31/12/2026 = 30 Dias",
    nome, "Recebi da firma EMPRESA EXEMPLO COMERCIO LTDA, estabelecida a Avenida DAS FLORES, 100 em SAO PAULO a importância de",
    "TOTAL DOS PROVENTOS: 5.333,68 P", "TOTAL DOS DESCONTOS: 700,00 D", `TOTAL LIQUIDO: ${liquido} P`,
    `a importância líquida de R$ ${liquido} (quatro mil reais )`,
    ...(o.datas ?? ["30/10/2026", "30/11/2026"]).map((x) => `Data: ${x}`),
    `${nome} EMPRESA EXEMPLO COMERCIO LTDA`,
  ].join("\n");
};

const ana = { id: "e1", firstName: "Ana Paula", lastName: "Exemplo Souza", modality: "CLT", terminationDate: null };
const programacao = { id: "fp1", aquisitivoInicio: d("2025-02-01"), gozoInicio: d("2026-12-02"), dias: 30 };

const enviar = (extra: Record<string, unknown> = {}) => request(app).post("/payroll/ferias/recibo").send({ fileBase64: PDF, fileName: "recibo-ana.pdf", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(extrairTextoPdf).mockResolvedValue(recibo());
  vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined as never);
  db.employee.findMany.mockResolvedValue([ana, { id: "e2", firstName: "Bia", lastName: "Lima", modality: "CLT", terminationDate: null }]);
  db.employee.findFirst.mockResolvedValue(ana);
  db.feriasProgramacao.findMany.mockResolvedValue([programacao]);
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.payrollItem.create.mockResolvedValue({ id: "pi1" });
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("POST /payroll/ferias/recibo — prévia", () => {
  test("sem sessão recusa", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await enviar()).status).toBe(401);
  });

  test("lê o recibo, acha a pessoa e a programação, e não grava nada", async () => {
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body.aplicado).toBe(false);
    expect(r.body.previa).toMatchObject({
      employeeId: "e1", nome: "Ana Paula Exemplo Souza", gozoInicio: "2026-12-02", gozoFim: "2026-12-31", dias: 30,
      vencimento: "2026-11-30", liquido: 4633.68, proventos: 5333.68, descontos: 700, programacaoId: "fp1", avisos: [],
    });
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("a resposta não leva CPF, carteira nem salário", async () => {
    const r = await enviar();
    expect(JSON.stringify(r.body)).not.toMatch(/cpf|carteira|salario|027561/i);
  });

  test("arquivo que não é PDF, nem recibo de férias, é recusado", async () => {
    expect((await request(app).post("/payroll/ferias/recibo").send({ fileBase64: Buffer.from("texto").toString("base64") })).status).toBe(422);
    vi.mocked(extrairTextoPdf).mockResolvedValue("EXTRATO MENSAL DO RH");
    const r = await enviar();
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/não parece um aviso e recibo de férias/);
  });

  test("avisa quando não há programação no ERP, ou quando ela tem outra data", async () => {
    db.feriasProgramacao.findMany.mockResolvedValue([]);
    expect((await enviar()).body.previa.avisos.join(" ")).toMatch(/Não há férias programadas no ERP com início em 02\/12\/2026/);
    db.feriasProgramacao.findMany.mockResolvedValue([{ ...programacao, gozoInicio: d("2026-12-15") }]);
    expect((await enviar()).body.previa.avisos.join(" ")).toMatch(/programado para 15\/12\/2026; o recibo começa em 02\/12\/2026/);
    db.feriasProgramacao.findMany.mockResolvedValue([{ ...programacao, dias: 20 }]);
    expect((await enviar()).body.previa.avisos.join(" ")).toMatch(/20 dias; o recibo traz 30/);
  });

  test("pessoa que não está no cadastro, ou que não é CLT, é recusada; homônimos pedem escolha", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(recibo({ nome: "FULANO DE TAL" }));
    const sem = await enviar();
    expect(sem.status).toBe(422);
    expect(sem.body.code).toBe("SEM_FUNCIONARIO");

    vi.mocked(extrairTextoPdf).mockResolvedValue(recibo());
    db.employee.findMany.mockResolvedValue([ana, { ...ana, id: "e9" }]);
    const dois = await enviar();
    expect(dois.status).toBe(409);
    expect(dois.body.code).toBe("AMBIGUO");
    expect(dois.body.candidatos).toHaveLength(2);

    db.employee.findMany.mockResolvedValue([{ ...ana, modality: "NAO_CLT" }]);
    expect((await enviar()).body.message).toMatch(/não é CLT/);
  });

  test("com employeeId escolhido, usa essa pessoa e avisa se o nome difere", async () => {
    db.employee.findFirst.mockResolvedValue({ ...ana, id: "e9", firstName: "Ana", lastName: "Outra" });
    const r = await enviar({ employeeId: "e9" });
    expect(r.status).toBe(200);
    expect(r.body.previa.employeeId).toBe("e9");
    expect(r.body.previa.avisos.join(" ")).toMatch(/diferente do cadastro/);
  });

  test("recusa quem saiu antes das férias e quem está em afastamento nesses dias", async () => {
    db.employee.findMany.mockResolvedValue([{ ...ana, terminationDate: d("2026-11-10") }]);
    expect((await enviar()).body.message).toMatch(/saiu em 10\/11\/2026/);
    db.employee.findMany.mockResolvedValue([ana]);
    db.employeeScheduleDay.findMany.mockResolvedValue([{ date: d("2026-12-10") }]);
    const r = await enviar();
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/afastamento não remunerado de 10\/12\/2026/);
  });

  test("recusa mês travado, recibo já importado e férias já lançadas", async () => {
    vi.mocked(assertPeriodWritableForDate).mockRejectedValue(new Error("Dezembro/2026 está fechado."));
    expect((await enviar()).body.message).toMatch(/fechado/);
    vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined as never);

    db.payrollItem.findFirst.mockResolvedValue({ id: "ja" });
    const jaImportado = await enviar();
    expect(jaImportado.status).toBe(409);
    expect(jaImportado.body.code).toBe("JA_IMPORTADO");

    db.payrollItem.findFirst.mockResolvedValue(null);
    db.payrollItem.findMany.mockResolvedValue([{
      id: "x", employeeId: "e1", type: "FERIAS", competenceYear: 2026, competenceMonth: 12, periodLabel: "Férias", periodStart: d("2026-12-02"),
      details: null, status: "PENDING", deletedAt: null, paymentDate: null, paidAmount: null, amount: 4633.68, dueDate: d("2026-11-30"),
    }]);
    const repetida = await enviar();
    expect(repetida.status).toBe(409);
    expect(repetida.body.code).toBe("DUPLICIDADE");
  });
});

describe("POST /payroll/ferias/recibo — lançar", () => {
  test("cria o lançamento FERIAS com o líquido, o vencimento do recibo e a categoria Férias, e audita", async () => {
    const r = await enviar({ aplicar: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ aplicado: true, id: expect.any(String) });
    const dados = db.payrollItem.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({
      employeeId: "e1", type: "FERIAS", competenceYear: 2026, competenceMonth: 12, periodLabel: "Férias",
      periodStart: d("2026-12-02"), periodEnd: d("2026-12-31"), dueDate: d("2026-11-30"), amount: 4633.68,
      dreCategoryId: "dre1", source: "MANUAL", createdById: "u1",
    });
    expect(dados.details.recibo).toMatchObject({ liquido: 4633.68, proventos: 5333.68, descontos: 700, aquisitivoInicio: "2025-02-01" });
    expect(dados.details.recibo.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(dados.details.feriasProgramacaoId).toBe("fp1");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "IMPORT_VACATION_RECEIPT", entityId: dados.id }));
  });

  test("sem data de pagamento no recibo, vence 2 dias antes do início", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(recibo().replace(/Data: .*\n?/g, ""));
    const r = await enviar({ aplicar: true });
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.dueDate).toEqual(d("2026-11-30"));
    expect(r.body.previa.avisos.join(" ")).toMatch(/2 dias antes/);
  });

  test("outras férias no mesmo mês ganham rótulo próprio", async () => {
    db.payrollItem.findMany.mockResolvedValue([{
      id: "x", employeeId: "e1", type: "FERIAS", competenceYear: 2026, competenceMonth: 12, periodLabel: "Férias", periodStart: d("2026-12-20"),
      details: null, status: "PENDING", deletedAt: null, paymentDate: null, paidAmount: null, amount: 1000, dueDate: d("2026-12-18"),
    }]);
    const r = await enviar({ aplicar: true });
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.periodLabel).toBe("Férias (2)");
  });

  test("uma recusa da prévia também barra o lançamento, sem gravar nada", async () => {
    db.payrollItem.findFirst.mockResolvedValue({ id: "ja" });
    expect((await enviar({ aplicar: true })).status).toBe(409);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("duas gravações ao mesmo tempo: a segunda enxerga a primeira (duplicidade) e não grava", async () => {
    db.payrollItem.findMany
      .mockResolvedValueOnce([]) // prévia
      .mockResolvedValueOnce([{
        id: "x", employeeId: "e1", type: "FERIAS", competenceYear: 2026, competenceMonth: 12, periodLabel: "Férias", periodStart: d("2026-12-02"),
        details: null, status: "PENDING", deletedAt: null, paymentDate: null, paidAmount: null, amount: 4633.68, dueDate: d("2026-11-30"),
      }]); // dentro da transação, depois da trava
    const r = await enviar({ aplicar: true });
    expect(r.status).toBe(409);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });
});
