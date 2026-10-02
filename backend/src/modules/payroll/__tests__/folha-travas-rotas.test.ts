import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Travas contra pagamento em duplicidade, pelas rotas e com o banco de mentira:
// lançamento manual (duplicado, complemento, depois da saída), baixa individual
// (já pago, confirmação) e conferência do lote antes de baixar.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findFirst: vi.fn(), findMany: vi.fn() },
    payrollItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
    paymentMethod: { findUnique: vi.fn() },
    companyBankAccount: { findFirst: vi.fn() },
    vtFaltaDeduction: { createMany: vi.fn() },
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

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { payrollRouter } from "../payroll.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll", payrollRouter);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ana = { id: "e1", firstName: "Ana", lastName: "Silva", displayName: null, terminationDate: null as Date | null, deletedAt: null };
const item = (over: Record<string, unknown> = {}) => ({
  id: "x1", employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Salário",
  periodStart: null, details: null, status: "PENDING", deletedAt: null, paymentDate: null, paidAmount: null,
  amount: 2000, dueDate: d("2026-10-05"), ...over,
});
const acoes = () => vi.mocked(auditLog).mock.calls.map((c) => c[0].action);

// Banco de mentira dos itens: findMany filtra pelo que as rotas pedem (pessoa/tipo/competência/ids).
let itens: Array<Record<string, unknown>> = [];
function filtra(where: Record<string, unknown> = {}) {
  return itens.filter((i) => {
    const emp = where.employeeId as string | { in: string[] } | undefined;
    if (typeof emp === "string" && i.employeeId !== emp) return false;
    if (emp && typeof emp === "object" && !emp.in.includes(i.employeeId as string)) return false;
    if (where.type && i.type !== where.type) return false;
    if (where.competenceYear && i.competenceYear !== where.competenceYear) return false;
    if (where.competenceMonth && i.competenceMonth !== where.competenceMonth) return false;
    const id = where.id as { in?: string[]; notIn?: string[]; not?: string } | undefined;
    if (id?.in && !id.in.includes(i.id as string)) return false;
    if (id?.notIn && id.notIn.includes(i.id as string)) return false;
    if (id?.not && i.id === id.not) return false;
    if (where.deletedAt === null && i.deletedAt != null) return false;
    const pg = where.paymentDate as { not?: null } | undefined;
    if (pg && "not" in pg && i.paymentDate == null) return false;
    return true;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  itens = [];
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.employee.findFirst.mockResolvedValue(ana);
  db.employee.findMany.mockResolvedValue([ana]);
  db.payrollSettings.findUnique.mockResolvedValue({ id: "singleton", advancePercent: 40, advanceDueDay: 20, salaryDueDay: 5, vtSecondPeriodStartDay: 16 });
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[])));
  db.payrollItem.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => filtra(where));
  db.payrollItem.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const alvo = itens.find((i) => i.id === where.id);
    if (!alvo) return null;
    const del = where.deletedAt as null | { not: null } | undefined;
    if (del === null && alvo.deletedAt != null) return null;
    if (del && typeof del === "object" && alvo.deletedAt == null) return null;
    return alvo;
  });
  db.payrollItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
  db.payrollItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, status: "PAID", ...data }));
  db.paymentMethod.findUnique.mockResolvedValue({ id: "pm1", name: "PIX" });
});

describe("POST /payroll — lançamento manual", () => {
  const salario = { employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, amount: 2000 };

  test("sem nada no mês: cria", async () => {
    const r = await request(app).post("/payroll").send(salario);
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data).toMatchObject({ employeeId: "e1", type: "SALARIO", periodLabel: "Salário", amount: 2000, source: "MANUAL" });
  });

  test("já existe o salário do mês (com outro rótulo): 409 DUPLICIDADE com o que existe", async () => {
    itens = [item({ id: "ex1", periodLabel: "Extrato 09/2026", amount: 1873.4, source: "EXTRATO_RH" })];
    const r = await request(app).post("/payroll").send(salario);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICIDADE");
    expect(r.body.existentes).toEqual([expect.objectContaining({ id: "ex1", tipo: "SALARIO", competencia: "09/2026", valor: 1873.4, status: "PENDING", vencimento: "2026-10-05" })]);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("complemento sem motivo suficiente: 400", async () => {
    itens = [item()];
    const r = await request(app).post("/payroll").send({ ...salario, complemento: true, motivoComplemento: "curto" });
    expect(r.status).toBe(400);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("complemento com motivo: cria com rótulo próprio, grava details.complemento e a auditoria", async () => {
    itens = [item()];
    const r = await request(app).post("/payroll").send({ ...salario, amount: 150, complemento: true, motivoComplemento: "Horas extras de agosto que ficaram de fora" });
    expect(r.status).toBe(201);
    const data = db.payrollItem.create.mock.calls[0][0].data;
    expect(data.periodLabel).toBe("Salário (complemento)");
    expect(data.details.complemento).toMatchObject({ motivo: "Horas extras de agosto que ficaram de fora", por: "u1", porNome: "Eli" });
    expect(acoes()).toContain("LANCAMENTO_FOLHA_COMPLEMENTO");
  });

  test("rótulo já ocupado por item EXCLUÍDO (a chave única não olha deletedAt): numera", async () => {
    itens = [item({ deletedAt: new Date(), periodLabel: "Salário" })];
    const r = await request(app).post("/payroll").send(salario);
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.periodLabel).toBe("Salário (2)");
  });

  test("tipo de rescisão/férias não entra por aqui", async () => {
    const r = await request(app).post("/payroll").send({ ...salario, type: "RESCISAO" });
    expect(r.status).toBe(400);
  });

  describe("depois da saída", () => {
    beforeEach(() => db.employee.findFirst.mockResolvedValue({ ...ana, terminationDate: d("2026-09-29") }));
    const vt = (mes: number, quinzena: 1 | 2) => ({ employeeId: "e1", type: "VALE_TRANSPORTE", competenceYear: 2026, competenceMonth: mes, quinzena, amount: 120 });

    test("VT de outubro para quem saiu em 29/09: 409 APOS_SAIDA", async () => {
      const r = await request(app).post("/payroll").send(vt(10, 1));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("APOS_SAIDA");
      expect(r.body.message).toContain("29/09/2026");
      expect(db.payrollItem.create).not.toHaveBeenCalled();
    });

    test("VT da 2ª quinzena de setembro (contém a saída): cria", async () => {
      const r = await request(app).post("/payroll").send(vt(9, 2));
      expect(r.status).toBe(201);
      const data = db.payrollItem.create.mock.calls[0][0].data;
      expect((data.periodStart as Date).toISOString().slice(0, 10)).toBe("2026-09-16");
      expect(data.periodLabel).toBe("VT 2ª quinzena");
    });

    test("salário de outubro: 409; confirmado com motivo: cria e audita", async () => {
      const outubro = { ...salario, competenceMonth: 10 };
      expect((await request(app).post("/payroll").send(outubro)).status).toBe(409);
      const semMotivo = await request(app).post("/payroll").send({ ...outubro, confirmaAposSaida: true, motivoAposSaida: "curto" });
      expect(semMotivo.status).toBe(400);
      const ok = await request(app).post("/payroll").send({ ...outubro, confirmaAposSaida: true, motivoAposSaida: "Acordo: dias trabalhados no aviso" });
      expect(ok.status).toBe(201);
      expect(db.payrollItem.create.mock.calls[0][0].data.details.aposSaida).toMatchObject({ motivo: "Acordo: dias trabalhados no aviso", saida: "2026-09-29" });
      expect(acoes()).toContain("LANCAMENTO_FOLHA_APOS_SAIDA");
    });
  });
});

describe("PATCH /payroll/:id/pay — baixa em duplicidade", () => {
  const baixa = { paymentDate: "2026-09-30", paidAmount: 2000, paidPaymentMethodId: "pm1" };

  test("outro salário de setembro da mesma pessoa já pago: 409 BAIXA_DUPLICADA com o que foi pago", async () => {
    itens = [item({ id: "a" }), item({ id: "pago", periodLabel: "Extrato 09/2026", paymentDate: d("2026-09-28"), paidAmount: 1990, status: "PAID" })];
    const r = await request(app).patch("/payroll/a/pay").send(baixa);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("BAIXA_DUPLICADA");
    expect(r.body.pessoa).toBe("Ana Silva");
    expect(r.body.jaPagos).toEqual([expect.objectContaining({ id: "pago", pagoEm: "2026-09-28", valorPago: 1990 })]);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("confirmado: baixa e registra a confirmação na auditoria", async () => {
    itens = [item({ id: "a" }), item({ id: "pago", periodLabel: "Extrato 09/2026", paymentDate: d("2026-09-28"), status: "PAID" })];
    const r = await request(app).patch("/payroll/a/pay").send({ ...baixa, confirmaDuplicidade: true });
    expect(r.status).toBe(200);
    expect(db.payrollItem.update).toHaveBeenCalled();
    expect(acoes()).toContain("BAIXA_FOLHA_DUPLICIDADE_CONFIRMADA");
  });

  test("parcela da mesma rescisão já paga: baixa sem perguntar", async () => {
    const g = { grupoRescisao: "g1" };
    itens = [
      item({ id: "p2", type: "RESCISAO", periodLabel: "Parcela 2/2", details: g }),
      item({ id: "p1", type: "RESCISAO", periodLabel: "Parcela 1/2", details: g, paymentDate: d("2026-09-10"), status: "PAID" }),
    ];
    const r = await request(app).patch("/payroll/p2/pay").send(baixa);
    expect(r.status).toBe(200);
  });

  test("VT da outra quinzena já pago: baixa sem perguntar", async () => {
    itens = [
      item({ id: "q2", type: "VALE_TRANSPORTE", periodLabel: "VT 2ª quinzena", periodStart: d("2026-09-16"), amount: 120 }),
      item({ id: "q1", type: "VALE_TRANSPORTE", periodLabel: "VT 1ª quinzena", periodStart: d("2026-09-01"), paymentDate: d("2026-08-31"), status: "PAID" }),
    ];
    const r = await request(app).patch("/payroll/q2/pay").send({ ...baixa, paidAmount: 120 });
    expect(r.status).toBe(200);
  });
});

describe("POST /payroll/pay-check — conferência do lote antes de baixar", () => {
  test("acusa o já pago e os duplicados dentro do próprio lote, de uma vez", async () => {
    const bia = { id: "e2", firstName: "Bia", lastName: "Souza", displayName: null };
    db.employee.findMany.mockResolvedValue([ana, bia]);
    itens = [
      item({ id: "a" }),
      item({ id: "pagoA", periodLabel: "Extrato 09/2026", paymentDate: d("2026-09-28"), status: "PAID" }),
      item({ id: "b1", employeeId: "e2" }),
      item({ id: "b2", employeeId: "e2", periodLabel: "Salário (2)" }),
      item({ id: "c", employeeId: "e2", type: "ADIANTAMENTO", periodLabel: "Adiantamento" }),
    ];
    const r = await request(app).post("/payroll/pay-check").send({ ids: ["a", "b1", "b2", "c"] });
    expect(r.status).toBe(200);
    const porId = Object.fromEntries(r.body.suspeitos.map((s: { item: { id: string } }) => [s.item.id, s]));
    expect(Object.keys(porId).sort()).toEqual(["a", "b1", "b2"]);
    expect(porId.a.pessoa).toBe("Ana Silva");
    expect(porId.a.jaPagos[0].id).toBe("pagoA");
    expect(porId.b1.noLote[0].id).toBe("b2");
    expect(porId.b2.noLote[0].id).toBe("b1");
  });

  test("lote limpo: nenhum suspeito", async () => {
    itens = [item({ id: "a" })];
    const r = await request(app).post("/payroll/pay-check").send({ ids: ["a"] });
    expect(r.body.suspeitos).toEqual([]);
  });
});

describe("PATCH /payroll/:id/restore — restaurar não pode criar duplicidade", () => {
  test("com outro salário do mês vivo: 409 DUPLICIDADE", async () => {
    itens = [item({ id: "del", deletedAt: new Date(), deletedById: "u1" }), item({ id: "vivo", periodLabel: "Extrato 09/2026" })];
    const r = await request(app).patch("/payroll/del/restore").send();
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICIDADE");
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });
});

describe("POST /payroll/vacation — as mesmas férias duas vezes", () => {
  const ferias = { employeeId: "e1", startDate: "2026-09-14", endDate: "2026-09-28", amount: 3000 };

  test("mesmo início já lançado: 409 DUPLICIDADE", async () => {
    itens = [item({ id: "f1", type: "FERIAS", periodLabel: "Férias", periodStart: d("2026-09-14") })];
    const r = await request(app).post("/payroll/vacation").send(ferias);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("DUPLICIDADE");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("outro período no mesmo mês: cria com rótulo próprio (sem estourar a chave única)", async () => {
    itens = [item({ id: "f1", type: "FERIAS", periodLabel: "Férias", periodStart: d("2026-09-01") })];
    const r = await request(app).post("/payroll/vacation").send(ferias);
    expect(r.status).toBe(201);
    expect(db.payrollItem.create.mock.calls[0][0].data.periodLabel).toBe("Férias (2)");
  });
});

// Auditoria 01/10 — itens baixos.
describe("auditoria 01/10: restaurar, baixar e vencimento", () => {
  const complemento = { complemento: { motivo: "pagamento a mais combinado", por: "u1", porNome: "Eli", em: "2026-09-30" } };

  test("restaurar um complemento com o salário do mês vivo: restaura (complemento não é duplicidade)", async () => {
    itens = [item({ id: "del", periodLabel: "Salário (complemento)", details: complemento, deletedAt: new Date(), deletedById: "u1" }), item({ id: "vivo" })];
    const r = await request(app).patch("/payroll/del/restore").send();
    expect(r.status).toBe(200);
  });

  test("restaurar o salário com só um complemento vivo no mês: restaura", async () => {
    itens = [item({ id: "del", deletedAt: new Date(), deletedById: "u1" }), item({ id: "comp", periodLabel: "Salário (complemento)", details: complemento })];
    const r = await request(app).patch("/payroll/del/restore").send();
    expect(r.status).toBe(200);
  });

  test("baixa: a checagem de duplicidade e a gravação correm dentro da trava da pessoa", async () => {
    itens = [item({ id: "a" })];
    const r = await request(app).patch("/payroll/a/pay").send({ paymentDate: "2026-09-30", paidAmount: 2000, paidPaymentMethodId: "pm1" });
    expect(r.status).toBe(200);
    const trava = db.$executeRaw.mock.calls.findIndex((c: unknown[]) => String((c[0] as string[]).join("?")).includes("pg_advisory_xact_lock"));
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(db.$executeRaw.mock.calls[trava][1]).toBe("folha:e1");
    const ordemTrava = db.$executeRaw.mock.invocationCallOrder[trava];
    const ordemBusca = db.payrollItem.findMany.mock.invocationCallOrder.at(-1);
    const ordemGravacao = db.payrollItem.update.mock.invocationCallOrder[0];
    expect(ordemTrava).toBeLessThan(ordemBusca);
    expect(ordemBusca).toBeLessThan(ordemGravacao);
  });

  test("lançamento manual: o mês do vencimento também passa pela trava de período", async () => {
    const { assertPeriodWritableForDate } = await import("../../cmv-real/cmv-real.service.js");
    vi.mocked(assertPeriodWritableForDate).mockImplementation(async (data: Date) => {
      if (data.getUTCMonth() === 9 && data.getUTCFullYear() === 2026) throw new Error("Período 10/2026 fechado.");
    });
    const r = await request(app).post("/payroll").send({ employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, amount: 2000, dueDate: "2026-10-05" });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("10/2026");
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    vi.mocked(assertPeriodWritableForDate).mockReset();
  });
});

describe("PATCH /payroll/:id — acerto da lista ajustado à mão", () => {
  test("editar o valor de um acerto da lista marca details.editadoAMao (o relançamento não sobrescreve)", async () => {
    itens = [item({ id: "ac", periodLabel: "Acerto (lista de pagamento)", amount: 1695, details: { origem: "LISTA_PAGAMENTO", totalAPagar: 1695 } })];
    const r = await request(app).patch("/payroll/ac").send({ amount: 1500 });
    expect(r.status).toBe(200);
    expect(db.payrollItem.update.mock.calls[0][0].data).toMatchObject({
      amount: 1500, details: { origem: "LISTA_PAGAMENTO", totalAPagar: 1695, editadoAMao: true },
    });
  });

  test("editar outro lançamento não mexe no details", async () => {
    itens = [item({ id: "s1" })];
    await request(app).patch("/payroll/s1").send({ amount: 1500 });
    expect(db.payrollItem.update.mock.calls[0][0].data).not.toHaveProperty("details");
  });
});
