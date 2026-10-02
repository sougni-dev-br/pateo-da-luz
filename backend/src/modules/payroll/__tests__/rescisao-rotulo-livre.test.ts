import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Auditoria 01/10: excluir a rescisão e lançar de novo batia na chave única
// (pessoa + tipo + competência + rótulo), que inclui os itens excluídos → erro 500.
// O rótulo novo pula os já usados no mês (vivos e excluídos), como nas Férias.
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
vi.mock("../rh-extract.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rh-extract.service.js")>()),
  extrairTextoPdf: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { apurarRescisao, montarSugestao, type ApuracaoRescisao } from "../rescisao-apuracao.js";
import { extrairTextoPdf } from "../rh-extract.service.js";
import { payrollRouter } from "../payroll.routes.js";
import { rescisoesRouter } from "../rescisoes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/payroll/rescisoes", rescisoesRouter);
app.use("/payroll", payrollRouter);

const SAIDA = new Date("2026-09-12T00:00:00Z");
const ana = { id: "e1", firstName: "Ana", lastName: "Silva", modality: "NAO_CLT", terminationDate: SAIDA, deletedAt: null };

function apuracao(vales = 100): ApuracaoRescisao {
  const base: Omit<ApuracaoRescisao, "sugestao"> = {
    saida: "2026-09-12", semRegistro: true,
    vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
    vales: { itens: [], descontos: vales, creditos: 0, liquido: -vales, entraNaRescisao: true },
    gorjeta: null, gorjetaObservacao: null, jaPagoNaLista: null, adiantamento: null,
  };
  return { ...base, sugestao: montarSugestao(base) };
}

// Rótulos já usados na competência (o primeiro lançamento, excluído).
function usados(rotulos: string[]) {
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: { type?: string; deletedAt?: unknown } }) =>
    (where.type === "RESCISAO" && !("deletedAt" in where)
      ? rotulos.map((periodLabel) => ({ periodLabel }))
      : []));
}
const rotulosCriados = () => db.payrollItem.create.mock.calls.map((c: Array<{ data: { periodLabel: string } }>) => c[0].data.periodLabel);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  vi.mocked(apurarRescisao).mockResolvedValue(apuracao());
  db.employee.findFirst.mockResolvedValue(ana);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.findFirst.mockResolvedValue(null);
  db.payrollItem.findMany.mockResolvedValue([]);
  db.payrollItem.create.mockImplementation(async ({ data }: { data: unknown }) => data);
  db.tipPeriod.findFirst.mockResolvedValue(null);
});

describe("POST /termination — rótulo livre na competência", () => {
  test("primeira rescisão do mês: rótulo de sempre", async () => {
    usados([]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 500, gorjeta: 100, valesDiscount: 100 });
    expect(r.status).toBe(201);
    expect(rotulosCriados()).toEqual(["Rescisão"]);
  });

  test("rescisão excluída no mês: a nova vira \"Rescisão (2)\"", async () => {
    usados(["Rescisão"]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 500, gorjeta: 100, valesDiscount: 100 });
    expect(r.status).toBe(201);
    expect(rotulosCriados()).toEqual(["Rescisão (2)"]);
    // A busca dos rótulos inclui os excluídos (sem filtro de deletedAt).
    expect(db.payrollItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { employeeId: "e1", type: "RESCISAO", competenceYear: 2026, competenceMonth: 9 },
    }));
  });

  test("parcelas: cada uma pula o rótulo já usado", async () => {
    usados(["Parcela 1/2", "Parcela 2/2"]);
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 500, gorjeta: 100, valesDiscount: 100, installments: 2, dueDate: "2026-09-30" });
    expect(r.status).toBe(201);
    expect(rotulosCriados()).toEqual(["Parcela 1/2 (2)", "Parcela 2/2 (2)"]);
  });

  test("quitada sem valor excluída e lançada de novo: \"Rescisão (quitada) (2)\"", async () => {
    usados(["Rescisão (quitada)"]);
    vi.mocked(apurarRescisao).mockResolvedValue(apuracao(1000));
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 500, gorjeta: 100, valesDiscount: 1000 });
    expect(r.status).toBe(201);
    expect(rotulosCriados()).toEqual(["Rescisão (quitada) (2)"]);
  });

  test("chave única ainda assim (corrida): 409 com mensagem clara, não 500", async () => {
    usados([]);
    db.payrollItem.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const r = await request(app).post("/payroll/termination/e1").send({ salario: 500, gorjeta: 100, valesDiscount: 100 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/rótulo|já existe/i);
  });
});

describe("POST /rescisoes/:id/termo-sem-valor — rótulo livre", () => {
  const termo = `TERMO DE RESCISÃO DO CONTRATO DE TRABALHO
IDENTIFICAÇÃO DO TRABALHADOR
11 Nome
MARIA DE TESTE SILVA
SP 01.000-000 11111 - 00001 / SP 529.982.247-25
25 Data do Aviso Prévio 26 Data de Afastamento\t24 Data de Admissão
21/07/2026 03/09/2026 03/09/2026
Motivo demissão: Término de contrato de experiência Data pagamento: 11/09/2026
Totais: 812,40 812,40
Líquido rescisão: 0,00
`;
  const maria = {
    id: "e1", firstName: "Maria de Teste", lastName: "Silva", cpf: "529.982.247-25", modality: "CLT",
    terminationDate: new Date("2026-09-03T00:00:00Z"), admissionDate: new Date("2026-07-21T00:00:00Z"), deletedAt: null,
  };
  const corpo = { fileBase64: Buffer.from("%PDF-1.4 termo").toString("base64"), fileName: "termo.pdf", aplicar: true };

  test("quitada no termo excluída e registrada de novo: \"Rescisão (quitada no termo) (2)\"", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(termo);
    db.employee.findFirst.mockResolvedValue(maria);
    usados(["Rescisão (quitada no termo)"]);
    const r = await request(app).post("/payroll/rescisoes/e1/termo-sem-valor").send(corpo);
    expect(r.status).toBe(201);
    expect(rotulosCriados()).toEqual(["Rescisão (quitada no termo) (2)"]);
  });

  test("chave única na corrida: 409 com mensagem clara", async () => {
    vi.mocked(extrairTextoPdf).mockResolvedValue(termo);
    db.employee.findFirst.mockResolvedValue(maria);
    usados([]);
    db.payrollItem.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const r = await request(app).post("/payroll/rescisoes/e1/termo-sem-valor").send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/rótulo|já existe/i);
  });
});
