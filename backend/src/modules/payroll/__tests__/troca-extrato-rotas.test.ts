import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Cenário real (09/2026): a folha já liberada (títulos abertos), a contabilidade reemite o
// extrato de uma empresa com 1 pessoa R$ 1 diferente. Trocar o extrato vale com o OK dado,
// com motivo e mesmo CNPJ; a resposta diz quem mudou e quem ficou diferente no Contas a
// Pagar (sem mexer nele). Desmarcar o envio (ou o OK) com títulos liberados é recusado, e
// reabrir o período (que desmarcaria tudo) também.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    tipPeriod: { findUnique: vi.fn() },
    tipPeriodEtapa: { findMany: vi.fn(), create: vi.fn() },
    tipExtrato: { findMany: vi.fn(async () => []), findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    tipConferenciaAceite: { findMany: vi.fn(async () => []) },
    employee: { findMany: vi.fn(async () => []) },
    payrollItem: { findMany: vi.fn(async () => []) },
    folhaLote: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  computeTipCommission: vi.fn(async () => ({ participants: [] })),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  mapaCombinados: vi.fn(async () => new Map()),
}));
vi.mock("../rh-extract.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rh-extract.service.js")>()),
  parseExtratoMensal: vi.fn(),
}));
vi.mock("../folha-lote.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../folha-lote.service.js")>()),
  temLoteVivo: vi.fn(async () => true),
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { parseExtratoMensal } from "../rh-extract.service.js";
import { temLoteVivo } from "../folha-lote.service.js";
import { reopenTipPeriod } from "../tip-commission.service.js";
import { MSG_FOLHA_LIBERADA, tipConferenciaRouter } from "../tip-conferencia.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/payroll/tip", tipConferenciaRouter);

const CNPJ = "22.222.222/0001-22";
const etapa = (nome: string, acao = "MARCOU") => ({ id: nome, periodId: "tp9", etapa: nome, acao, em: new Date("2026-10-01T12:00:00Z"), por: "Eli", obs: null });
const linha = (employeeId: string, nome: string, liquido: number, gorjeta: number) => ({ employeeId, nome, liquido, gorjeta, adiantamento: 400, situacao: null, vinculo: "CPF" });
const ANTES = [linha("e1", "ANA EXEMPLO", 1500, 300), linha("e2", "BRUNO EXEMPLO", 1200, 250)];
const lido = (bruno = 1201, gorjetaBruno = 250) => ({
  calculo: "MENSAL", empresa: "CANECA EXEMPLO LTDA", cnpj: CNPJ, competenceYear: 2026, competenceMonth: 9,
  funcionarios: [
    { nome: "ANA EXEMPLO", cpfNorm: "11111111111", liquido: 1500, gorjeta: 300, adiantamento: 400, situacao: null },
    { nome: "BRUNO EXEMPLO", cpfNorm: "22222222222", liquido: bruno, gorjeta: gorjetaBruno, adiantamento: 400, situacao: null },
  ],
});
const enviar = (corpo: Record<string, unknown> = {}) =>
  request(app).post("/payroll/tip/periods/2026/9/extratos").send({ fileBase64: Buffer.from("%PDF-falso").toString("base64"), fileName: "caneca.pdf", ...corpo });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(temLoteVivo).mockResolvedValue(true);
  vi.mocked(parseExtratoMensal).mockResolvedValue(lido() as never);
  db.tipPeriod.findUnique.mockResolvedValue({ id: "tp9", code: "GOR-2026-0009", status: "CLOSED", competenceYear: 2026, competenceMonth: 9 });
  db.tipPeriodEtapa.findMany.mockResolvedValue([etapa("ENVIADO_CONTABILIDADE"), etapa("OK_CONTABILIDADE")]);
  db.employee.findMany.mockResolvedValue([
    { id: "e1", cpf: "111.111.111-11", firstName: "Ana", lastName: "Exemplo" },
    { id: "e2", cpf: "222.222.222-22", firstName: "Bruno", lastName: "Exemplo" },
  ]);
  db.tipExtrato.findUnique.mockResolvedValue({ linhas: ANTES });
  db.tipExtrato.findFirst.mockResolvedValue({ empresa: "CANECA EXEMPLO LTDA", cnpj: CNPJ });
  // SALARIO do Retorno do RH ainda com o líquido antigo, dentro do título da empresa.
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { periodLabel?: string } }) => (where.periodLabel === "Extrato 09/2026" ? [
    { employeeId: "e1", amount: 1500, details: { liquido: 1500 }, employee: { firstName: "Ana", lastName: "Exemplo" }, folhaLote: { rotulo: "Folha 09/2026 · Caneca Exemplo", status: "ABERTO" } },
    { employeeId: "e2", amount: 1200, details: { liquido: 1200 }, employee: { firstName: "Bruno", lastName: "Exemplo" }, folhaLote: { rotulo: "Folha 09/2026 · Caneca Exemplo", status: "ABERTO" } },
  ] : []));
});

describe("trocar o extrato com a folha liberada", () => {
  test("com motivo e mesmo CNPJ: troca, diz o que mudou e quem ficou diferente no Contas a Pagar", async () => {
    const r = await enviar({ motivo: "contabilidade reemitiu", substitui: "x2" });
    expect(r.status).toBe(200);
    expect(db.tipExtrato.upsert).toHaveBeenCalled();
    expect(r.body.troca.diferencas).toEqual([
      { employeeId: "e2", nome: "BRUNO EXEMPLO", situacao: "MUDOU", liquidoAntes: 1200, liquidoDepois: 1201, gorjetaAntes: 250, gorjetaDepois: 250 },
    ]);
    expect(r.body.troca.contasAPagar).toEqual([
      { employeeId: "e2", nome: "Bruno Exemplo", noContasAPagar: 1200, extratoNovo: 1201, titulo: "Folha 09/2026 · Caneca Exemplo" },
    ]);
    expect(r.body.troca.avisoContasAPagar).toBe("Reimporte este PDF em RH → Retorno do RH para atualizar o Contas a Pagar.");
    // O Contas a Pagar não é tocado daqui.
    expect(db.payrollItem.update).toBeUndefined();
    const audit = vi.mocked(auditLog).mock.calls.map((c) => c[0]).find((a) => a.action === "TIP_EXTRATO_TROCADO");
    expect(audit?.newValue).toMatchObject({ motivo: "contabilidade reemitiu", comOkMarcado: true, diferencas: [expect.objectContaining({ nome: "BRUNO EXEMPLO" })] });
  });

  test("gorjeta mudou: troca, mantém o OK e avisa", async () => {
    vi.mocked(parseExtratoMensal).mockResolvedValue(lido(1201, 260) as never);
    const r = await enviar({ motivo: "contabilidade reemitiu", substitui: "x2" });
    expect(r.status).toBe(200);
    expect(r.body.avisos).toContain("A gorjeta de alguém mudou no extrato novo: confira a pendência na conferência. O OK continua marcado.");
    expect(db.tipPeriodEtapa.create).not.toHaveBeenCalled();
  });

  test("sem motivo (ou curto demais): recusa e não grava", async () => {
    const r = await enviar({ motivo: "ok", substitui: "x2" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/exige o motivo/);
    expect(db.tipExtrato.upsert).not.toHaveBeenCalled();
  });

  test("PDF de outra empresa no lugar do extrato escolhido: recusa", async () => {
    db.tipExtrato.findFirst.mockResolvedValue({ empresa: "PATEO EXEMPLO LTDA", cnpj: "11.111.111/0001-11" });
    const r = await enviar({ motivo: "contabilidade reemitiu", substitui: "x1" });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Escolha o PDF da mesma empresa/);
    expect(db.tipExtrato.upsert).not.toHaveBeenCalled();
  });

  test("empresa nova (sem extrato anterior) com o OK dado: recusa", async () => {
    db.tipExtrato.findUnique.mockResolvedValue(null);
    const r = await enviar({ motivo: "contabilidade reemitiu" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/já está na conferência/);
  });

  test("outra competência continua recusada", async () => {
    vi.mocked(parseExtratoMensal).mockResolvedValue({ ...lido(), competenceMonth: 8 } as never);
    expect((await enviar({ motivo: "contabilidade reemitiu" })).status).toBe(422);
  });

  test("sem ver Funcionários: só nomes, sem valores", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await enviar({ motivo: "contabilidade reemitiu", substitui: "x2" });
    expect(r.body.troca.diferencas[0]).toMatchObject({ nome: "BRUNO EXEMPLO", liquidoAntes: null, liquidoDepois: null });
    expect(r.body.troca.contasAPagar[0]).toMatchObject({ nome: "Bruno Exemplo", noContasAPagar: null, extratoNovo: null });
  });

  test("sem OK e sem títulos: como antes, sem exigir motivo", async () => {
    vi.mocked(temLoteVivo).mockResolvedValue(false);
    db.tipPeriodEtapa.findMany.mockResolvedValue([etapa("ENVIADO_CONTABILIDADE")]);
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body.troca).toBeUndefined();
    expect(vi.mocked(auditLog).mock.calls.map((c) => c[0].action)).toContain("TIP_EXTRATO_CONFERENCIA");
  });
});

describe("o furo: desmarcar o envio com a folha liberada", () => {
  test("desmarcar 'Enviado à contabilidade' é recusado com o caminho certo", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/9/etapas").send({ etapa: "ENVIADO_CONTABILIDADE", acao: "DESMARCOU" });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(MSG_FOLHA_LIBERADA);
    expect(db.tipPeriodEtapa.create).not.toHaveBeenCalled();
  });

  test("desmarcar o OK também", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/9/etapas").send({ etapa: "OK_CONTABILIDADE", acao: "DESMARCOU" });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(MSG_FOLHA_LIBERADA);
  });

  test("reabrir com título da folha já PAGO é recusado (mudaria salário pago)", async () => {
    db.folhaLote.count.mockImplementation(async (q: { where?: { status?: unknown } }) => (q?.where?.status === "PAGO" ? 1 : 3));
    await expect(reopenTipPeriod(2026, 9, { id: "u1", name: "Eli" }, "contabilidade reemitiu o extrato"))
      .rejects.toThrow(/já pago: reabrir mudaria salário já pago/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("reabrir com os títulos ainda em aberto continua permitido (fechar de novo relança os acertos)", async () => {
    db.folhaLote.count.mockImplementation(async (q: { where?: { status?: unknown } }) => (q?.where?.status === "PAGO" ? 0 : 3));
    await reopenTipPeriod(2026, 9, { id: "u1", name: "Eli" }, "registrar o ocorrido no sistema").catch(() => undefined);
    expect(db.$transaction).toHaveBeenCalled();
  });
});
