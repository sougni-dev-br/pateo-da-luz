import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas do lote de pagamento da folha: liberar exige o OK, aprovar a gorjeta e ver
// Funcionários; a "Folha paga" passa a ser automática com lotes; o membro de um lote não é
// baixado, editado, excluído nem estornado sozinho.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    vtFaltaDeduction: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tipPeriod: { findUnique: vi.fn() },
    tipPeriodEtapa: { findMany: vi.fn(), create: vi.fn() },
    tipExtrato: { findMany: vi.fn(async () => []) },
    employee: { findMany: vi.fn(async () => []) },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn(), count: vi.fn(async () => 0) },
    folhaLote: { findUnique: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  computeTipCommission: vi.fn(async () => ({ participants: [] })),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  mapaCombinados: vi.fn(async () => new Map()),
}));
vi.mock("../folha-lote.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../folha-lote.service.js")>()),
  liberarLotes: vi.fn(), temLoteVivo: vi.fn(async () => false), cancelarLiberacao: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { liberarLotes, temLoteVivo } from "../folha-lote.service.js";
import { tipConferenciaRouter } from "../tip-conferencia.routes.js";
import { payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/tip", tipConferenciaRouter);
app.use("/payroll", payrollRouter);

const etapa = (nome: string, acao = "MARCOU") => ({ id: nome, periodId: "tp9", etapa: nome, acao, em: new Date("2026-10-01T12:00:00Z"), por: "Eli", obs: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(temLoteVivo).mockResolvedValue(false);
  db.tipPeriod.findUnique.mockResolvedValue({ id: "tp9", code: "GOR-2026-0009", status: "CLOSED", competenceYear: 2026, competenceMonth: 9 });
  db.tipPeriodEtapa.findMany.mockResolvedValue([etapa("ENVIADO_CONTABILIDADE"), etapa("OK_CONTABILIDADE")]);
  vi.mocked(liberarLotes).mockResolvedValue({ criados: [{ id: "l1", rotulo: "Folha 09/2026 · Pateo Exemplo" }], acrescentados: 2, jaLiberada: false, avisos: [], lotes: [] });
});

describe("liberar para pagamento", () => {
  test("com o OK: libera com a folha da competência", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/9/folha-lotes/liberar");
    expect(r.status).toBe(200);
    expect(r.body.criados).toHaveLength(1);
    expect(liberarLotes).toHaveBeenCalledWith(expect.objectContaining({ ano: 2026, mes: 9, linhas: [], extratos: [] }),
      expect.objectContaining({ id: "u1", name: "Eli", ipAddress: "127.0.0.1" }));
  });

  test("sem o OK à contabilidade: recusa", async () => {
    db.tipPeriodEtapa.findMany.mockResolvedValue([etapa("ENVIADO_CONTABILIDADE")]);
    const r = await request(app).post("/payroll/tip/periods/2026/9/folha-lotes/liberar");
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/OK à contabilidade/);
    expect(liberarLotes).not.toHaveBeenCalled();
  });

  test("sem aprovar a gorjeta: 403", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, menu, acao) => !(menu === "payroll-tips" && acao === "approve"));
    const r = await request(app).post("/payroll/tip/periods/2026/9/folha-lotes/liberar");
    expect(r.status).toBe(403);
    expect(liberarLotes).not.toHaveBeenCalled();
  });

  test("sem ver Funcionários: 403 (a folha tem salários)", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    expect((await request(app).post("/payroll/tip/periods/2026/9/folha-lotes/liberar")).status).toBe(403);
    expect((await request(app).get("/payroll/tip/periods/2026/9/folha-lotes/previa")).status).toBe(403);
  });
});

describe("etapas com a folha liberada", () => {
  test("a Folha paga não se marca nem desmarca à mão", async () => {
    vi.mocked(temLoteVivo).mockResolvedValue(true);
    const r = await request(app).post("/payroll/tip/periods/2026/9/etapas").send({ etapa: "FOLHA_PAGA", acao: "MARCOU" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/marcada sozinha/);
    expect(db.tipPeriodEtapa.create).not.toHaveBeenCalled();
  });

  test("o OK não se desmarca com títulos liberados", async () => {
    vi.mocked(temLoteVivo).mockResolvedValue(true);
    const r = await request(app).post("/payroll/tip/periods/2026/9/etapas").send({ etapa: "OK_CONTABILIDADE", acao: "DESMARCOU" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Desfazer liberação/);
  });

  test("sem lotes (folha de antes), marcar à mão continua valendo", async () => {
    db.tipPeriodEtapa.create.mockResolvedValue({});
    const r = await request(app).post("/payroll/tip/periods/2026/9/etapas").send({ etapa: "FOLHA_PAGA", acao: "MARCOU" });
    expect(r.status).toBe(200);
    expect(db.tipPeriodEtapa.create).toHaveBeenCalled();
  });
});

describe("membro do lote na Folha", () => {
  const membro = { id: "p1", employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, amount: 1500, dueDate: new Date("2026-10-06"), paymentDate: null, status: "PENDING", folhaLoteId: "l1", details: null };

  beforeEach(() => {
    db.payrollItem.findFirst.mockResolvedValue(membro);
    db.folhaLote.findUnique.mockResolvedValue({ rotulo: "Folha 09/2026 · Pateo Exemplo", status: "ABERTO" });
  });

  test("não é baixado sozinho", async () => {
    const r = await request(app).patch("/payroll/p1/pay").send({ paymentDate: "2026-10-01", paidPaymentMethodName: "PIX" });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Este salário está no lote "Folha 09/2026 · Pateo Exemplo": retire do lote antes.');
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("não é editado nem excluído sozinho", async () => {
    expect((await request(app).patch("/payroll/p1").send({ amount: 10 })).status).toBe(409);
    expect((await request(app).delete("/payroll/p1").send({ reason: "não vai pagar" })).status).toBe(409);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("pago no lote: o estorno é pelo lote", async () => {
    db.payrollItem.findFirst.mockResolvedValue({ ...membro, paymentDate: new Date("2026-10-01"), status: "PAID" });
    db.folhaLote.findUnique.mockResolvedValue({ rotulo: "Folha 09/2026 · Pateo Exemplo", status: "PAGO" });
    const r = await request(app).patch("/payroll/p1/reverse").send({ reason: "engano" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/estorne o lote/);
  });

  test("corrida: liberar põe o item num lote entre a checagem e a gravação — edição e exclusão recusadas", async () => {
    // Na checagem o item está solto; na gravação condicionada (folhaLoteId: null) já não está.
    db.payrollItem.findFirst
      .mockResolvedValueOnce({ ...membro, folhaLoteId: null })
      .mockResolvedValueOnce({ folhaLoteId: "l1" });
    db.payrollItem.update.mockRejectedValueOnce(Object.assign(new Error("não achei"), { code: "P2025" }));
    const r = await request(app).patch("/payroll/p1").send({ amount: 10 });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Este salário está no lote "Folha 09/2026 · Pateo Exemplo": retire do lote antes.');
    expect(db.payrollItem.update.mock.calls[0][0].where).toMatchObject({ id: "p1", folhaLoteId: null, paymentDate: null });
  });

  test("corrida na exclusão: o item entrou no lote — recusada, nada excluído", async () => {
    db.payrollItem.findFirst
      .mockResolvedValueOnce({ ...membro, folhaLoteId: null })
      .mockResolvedValueOnce({ folhaLoteId: "l1" });
    db.payrollItem.update.mockRejectedValueOnce(Object.assign(new Error("não achei"), { code: "P2025" }));
    const r = await request(app).delete("/payroll/p1").send({ reason: "não vai pagar" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/está no lote "Folha 09\/2026 · Pateo Exemplo"/);
    expect(db.payrollItem.update.mock.calls[0][0].where).toMatchObject({ id: "p1", folhaLoteId: null });
  });

  test("lote cancelado não prende o item", async () => {
    db.folhaLote.findUnique.mockResolvedValue({ rotulo: "x", status: "CANCELADO" });
    const r = await request(app).patch("/payroll/p1/pay").send({ paymentDate: "2026-10-01" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Forma de pagamento é obrigatória.");
  });
});
