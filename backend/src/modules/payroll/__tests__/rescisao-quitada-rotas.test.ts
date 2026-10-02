import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// "Quitada no termo": CLT cujo termo (TRCT) da contabilidade veio com líquido zero.
// Registra a rescisão sem valor (paga, R$ 0,00) e ela some do Contas a Pagar.
// Banco de mentira; texto do termo simulado com CPF fictício válido.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
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
vi.mock("../rh-extract.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rh-extract.service.js")>()),
  extrairTextoPdf: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { extrairTextoPdf } from "../rh-extract.service.js";
import { rescisoesRouter } from "../rescisoes.routes.js";
import { payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/payroll/rescisoes", rescisoesRouter);
app.use("/payroll", payrollRouter);

const termo = (o: { nome?: string; cpf?: string; liquido?: string; afastamento?: string; gorjeta?: string } = {}) => `TERMO DE RESCISÃO DO CONTRATO DE TRABALHO
IDENTIFICAÇÃO DO TRABALHADOR
11 Nome
${o.nome ?? "MARIA DE TESTE SILVA"}
SP 01.000-000 11111 - 00001 / SP ${o.cpf ?? "529.982.247-25"}
25 Data do Aviso Prévio 26 Data de Afastamento\t24 Data de Admissão
21/07/2026 ${o.afastamento ?? "03/09/2026"} ${o.afastamento ?? "03/09/2026"}
Motivo demissão: Término de contrato de experiência Data pagamento: 11/09/2026
${o.gorjeta ? `203 GORJETA ${o.gorjeta} ${o.gorjeta}\n` : ""}Totais: 812,40 812,40
Líquido rescisão: ${o.liquido ?? "0,00"}
`;
const PDF = Buffer.from("%PDF-1.4 termo de teste").toString("base64");
const corpo = (aplicar: boolean) => ({ fileBase64: PDF, fileName: "Recibo Rescisão.pdf", aplicar });

const SAIDA = new Date("2026-09-03T00:00:00Z");
const maria = {
  id: "e1", firstName: "Maria de Teste", lastName: "Silva", cpf: "529.982.247-25", modality: "CLT",
  terminationDate: SAIDA, admissionDate: new Date("2026-07-21T00:00:00Z"), deletedAt: null,
};
const trava = () => db.$executeRaw.mock.calls.find((c: unknown[]) => String((c[0] as string[]).join("?")).includes("pg_advisory_xact_lock"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined as never);
  vi.mocked(extrairTextoPdf).mockResolvedValue(termo());
  db.employee.findFirst.mockResolvedValue(maria);
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre-rescisao" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.create.mockImplementation(async ({ data }: { data: { id: string } }) => data);
  db.payrollItem.update.mockResolvedValue({ id: "q1", status: "PAID" });
  db.vtFaltaDeduction.deleteMany.mockResolvedValue({ count: 0 });
});

const URL = "/payroll/rescisoes/e1/termo-sem-valor";

describe("POST /payroll/rescisoes/:employeeId/termo-sem-valor — prévia", () => {
  test("lê o termo e devolve a prévia, sem gravar e sem CPF", async () => {
    const r = await request(app).post(URL).send(corpo(false));
    expect(r.status).toBe(200);
    expect(r.body.aplicado).toBe(false);
    expect(r.body.previa).toMatchObject({
      employeeId: "e1", nome: "Maria de Teste Silva", nomeNoTermo: "MARIA DE TESTE SILVA", arquivo: "Recibo Rescisão.pdf",
      afastamento: "2026-09-03", pagamento: "2026-09-11", liquido: 0, totalBruto: 812.4, divergencias: [], podeQuitar: true, recusa: null,
    });
    expect(r.body.previa.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r.body)).not.toMatch(/52998224725|529\.982/);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("termo de outra pessoa: 422", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(termo({ nome: "JOSE DE TESTE", cpf: "111.444.777-35" }));
    const r = await request(app).post(URL).send(corpo(false));
    expect(r.status).toBe(422);
    expect(r.body.message).toContain("JOSE DE TESTE");
    expect(r.body.message).not.toMatch(/111\.444|11144477735/);
  });

  test("líquido diferente de zero: prévia avisa que não dá para quitar; aplicar é recusado", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(termo({ liquido: "458,36" }));
    const previa = await request(app).post(URL).send(corpo(false));
    expect(previa.status).toBe(200);
    expect(previa.body.previa).toMatchObject({ liquido: 458.36, podeQuitar: false });
    expect(previa.body.previa.recusa).toMatch(/lance a rescisão/i);

    const aplicar = await request(app).post(URL).send(corpo(true));
    expect(aplicar.status).toBe(422);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("arquivo que não é PDF: 422; PDF que não é termo de rescisão: 422", async () => {
    const naoPdf = await request(app).post(URL).send({ ...corpo(false), fileBase64: Buffer.from("oi").toString("base64") });
    expect(naoPdf.status).toBe(422);
    vi.mocked(extrairTextoPdf).mockResolvedValue("EXTRATO MENSAL DO RH");
    const outro = await request(app).post(URL).send(corpo(false));
    expect(outro.status).toBe(422);
    expect(outro.body.message).toMatch(/termo de rescisão/i);
  });

  test("sem PDF: 400; funcionário inexistente: 404; sem sessão: 401", async () => {
    expect((await request(app).post(URL).send({ aplicar: false })).status).toBe(400);
    db.employee.findFirst.mockResolvedValueOnce(null);
    expect((await request(app).post(URL).send(corpo(false))).status).toBe(404);
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as never);
    expect((await request(app).post(URL).send(corpo(false))).status).toBe(401);
  });
});

describe("POST /payroll/rescisoes/:employeeId/termo-sem-valor — aplicar", () => {
  test("cria uma rescisão de R$ 0,00 já paga na data do termo, com o termo (sem CPF) e auditoria", async () => {
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(201);
    expect(r.body.aplicado).toBe(true);
    expect(trava()?.[1]).toBe("rescisao:e1");
    expect(db.payrollItem.create).toHaveBeenCalledTimes(1);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      employeeId: "e1", type: "RESCISAO", amount: 0, paidAmount: 0, status: "PAID",
      competenceYear: 2026, competenceMonth: 9, dreCategoryId: "dre-rescisao", createdById: "u1",
    });
    expect(data.dueDate.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(data.paymentDate.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect(data.details).toMatchObject({
      quitadaNoTermo: true,
      termo: { arquivo: "Recibo Rescisão.pdf", afastamento: "2026-09-03", pagamento: "2026-09-11", totalBruto: 812.4, liquido: 0 },
    });
    expect(typeof data.details.grupoRescisao).toBe("string");
    expect(data.details.termo.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toMatch(/52998224725|529\.982/);

    const audit = vi.mocked(auditLog).mock.calls[0][0] as { action: string; newValue: Record<string, unknown> };
    expect(audit.action).toBe("RELEASE_TERMINATION");
    expect(audit.newValue).toMatchObject({ employeeId: "e1", quitadaNoTermo: true, net: 0 });
    expect(JSON.stringify(audit)).not.toMatch(/52998224725|529\.982/);
  });

  test("sem data de pagamento no termo: vence e paga no afastamento", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(termo().replace(/Data pagamento: \S+/, ""));
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(201);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data.paymentDate.toISOString().slice(0, 10)).toBe("2026-09-03");
  });

  test("outra rescisão viva aparece sob a trava: recusa sem criar", async () => {
    db.payrollItem.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "r9" });
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/já lançada/i);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("mês travado (competência ou pagamento): recusa sem criar", async () => {
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Período 09/2026 fechado."));
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("fechado");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });
});

describe("Folha: a rescisão quitada no termo", () => {
  const quitada = {
    id: "q1", employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9, amount: 0, paidAmount: 0,
    status: "PAID", paymentDate: new Date("2026-09-11T00:00:00Z"), dueDate: new Date("2026-09-11T00:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    details: { grupoRescisao: "g1", quitadaNoTermo: true, gorjetaNaApuracao: null, termo: { arquivo: "t.pdf", liquido: 0 } },
  };

  test("excluir funciona mesmo paga, e não mexe em gorjeta nenhuma", async () => {
    db.payrollItem.findFirst.mockResolvedValue(quitada);
    db.payrollItem.count.mockResolvedValue(0);
    // Uma rescisão antiga, excluída, com gorjeta: não pode ser desfeita por tabela.
    db.payrollItem.findMany.mockResolvedValue([{ details: { gorjetaNaApuracao: { participantId: "tp1", anterior: null, aplicada: 50 } } }]);
    const r = await request(app).delete("/payroll/q1").send({ reason: "termo importado para a pessoa errada" });
    expect(r.status).toBe(200);
    expect(db.payrollItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q1" } }));
    expect(db.tipParticipant.updateMany).not.toHaveBeenCalled();
    expect(db.tipParticipant.count).not.toHaveBeenCalled();
  });

  test("estornar é recusado: não houve pagamento", async () => {
    db.payrollItem.findFirst.mockResolvedValue(quitada);
    const r = await request(app).patch("/payroll/q1/reverse").send({ reason: "teste" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/quitada no termo/i);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("restaurar não relança gorjeta", async () => {
    db.payrollItem.findFirst.mockResolvedValue({ ...quitada, deletedAt: new Date() });
    db.payrollItem.findMany.mockResolvedValue([]);
    const r = await request(app).patch("/payroll/q1/restore").send({});
    expect(r.status).toBe(200);
    expect(db.tipParticipant.updateMany).not.toHaveBeenCalled();
    expect(db.tipParticipant.count).not.toHaveBeenCalled();
  });
});

// Auditoria 01/10: a quitada no termo olhava o vínculo de HOJE (não o da saída) e aceitava
// qualquer data de pagamento do termo (inválida, antes da admissão, anos à frente).
describe("termo-sem-valor — vínculo na saída e data de pagamento", () => {
  const h = (de: string, para: string, vigente: string) => ({
    employeeId: "e1", campo: "modality", valorAnterior: de, valorNovo: para,
    vigenteDesde: new Date(`${vigente}T00:00:00.000Z`), createdAt: new Date(`${vigente}T12:00:00Z`),
  });

  test("hoje sem registro, mas CLT na saída: pode quitar", async () => {
    db.employee.findFirst.mockResolvedValue({ ...maria, modality: "NAO_CLT" });
    db.employeeHistorico.findMany.mockResolvedValueOnce([h("CLT", "NAO_CLT", "2026-09-20")]);
    const r = await request(app).post(URL).send(corpo(false));
    expect(r.status).toBe(200);
    expect(r.body.previa).toMatchObject({ podeQuitar: true, recusa: null });
  });

  test("hoje CLT, mas sem registro na saída: recusa", async () => {
    db.employee.findFirst.mockResolvedValue({ ...maria, modality: "CLT" });
    db.employeeHistorico.findMany.mockResolvedValueOnce([h("NAO_CLT", "CLT", "2026-09-20")]);
    const r = await request(app).post(URL).send(corpo(false));
    expect(r.body.previa.podeQuitar).toBe(false);
    expect(r.body.previa.recusa).toMatch(/Sem registro/);
  });

  const comPagamento = (data: string) => termo().replace("Data pagamento: 11/09/2026", `Data pagamento: ${data}`);

  test("pagamento antes da admissão: recusa", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(comPagamento("01/07/2026"));
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/admissão/);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("pagamento muito no futuro: recusa", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(comPagamento("11/09/2030"));
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/futuro/);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("pagamento com data impossível (31/02): recusa", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(comPagamento("31/02/2026"));
    const r = await request(app).post(URL).send(corpo(true));
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/data de pagamento/i);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });
});
