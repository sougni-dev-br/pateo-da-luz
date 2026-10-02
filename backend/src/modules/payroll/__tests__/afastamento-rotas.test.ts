import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Afastamento não remunerado lançado pela Folha, como as férias: um intervalo (de/até +
// motivo) vira dias AFASTAMENTO na Escala, sem PayrollItem (não é despesa). Banco de mentira.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findFirst: vi.fn(), findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriod: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForRange: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForRange } from "../../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { afastamentoRouter, agruparAfastamentos, letrasDoMotivo } from "../afastamento.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/afastamentos", afastamentoRouter);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ana = { id: "e1", firstName: "Ana", lastName: "Souza", displayName: null, admissionDate: d("2025-01-10"), terminationDate: null, deletedAt: null };

type Linha = { employeeId: string; date: Date; type: string; notes: string | null };
let linhas: Linha[] = [];

function filtrar(where: Record<string, unknown>): Linha[] {
  const id = where.employeeId as string | { in?: string[] } | undefined;
  const faixa = where.date as { gte?: Date; lte?: Date; lt?: Date } | undefined;
  return linhas.filter((l) => {
    if (typeof id === "string" && l.employeeId !== id) return false;
    if (id && typeof id === "object" && id.in && !id.in.includes(l.employeeId)) return false;
    if (typeof where.type === "string" && l.type !== where.type) return false;
    if (faixa?.gte && l.date < faixa.gte) return false;
    if (faixa?.lte && l.date > faixa.lte) return false;
    if (faixa?.lt && l.date >= faixa.lt) return false;
    return true;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.employee.findFirst.mockResolvedValue(ana);
  db.employee.findMany.mockResolvedValue([ana]);
  db.employeeScheduleDay.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => filtrar(where));
  db.employeeScheduleDay.deleteMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const sai = new Set(filtrar(where));
    linhas = linhas.filter((l) => !sai.has(l));
    return { count: sai.size };
  });
  db.employeeScheduleDay.createMany.mockImplementation(async ({ data }: { data: Linha[] }) => {
    linhas.push(...data.map((x) => ({ employeeId: x.employeeId, date: x.date, type: x.type, notes: x.notes })));
    return { count: data.length };
  });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  vi.mocked(assertPeriodWritableForRange).mockResolvedValue(undefined);
});

// Mês travado (fechamento mensal ou CMV fechado) no intervalo: recusa sem gravar nada.
const travarSetembro = () => vi.mocked(assertPeriodWritableForRange).mockImplementation(async (inicio: Date, fim: Date, contexto: string) => {
  if (inicio <= d("2026-09-30") && fim >= d("2026-09-01")) throw new Error(`${contexto} bloqueado: o fechamento mensal de 09/2026 esta travado.`);
});

const lancar = (body: Record<string, unknown>) => request(app).post("/payroll/afastamentos").send(body);
const CORPO = { employeeId: "e1", inicio: "2026-09-01", fim: "2026-09-20", motivo: "Pedido pessoal da funcionária" };

describe("regras puras", () => {
  test("motivo conta só letras", () => {
    expect(letrasDoMotivo("a.b c-d")).toBe(4);
    expect(letrasDoMotivo("Viagem")).toBe(6);
    expect(letrasDoMotivo("   12345 !!")).toBe(0);
  });

  test("agrupa dias seguidos com o mesmo motivo num intervalo", () => {
    const l = (data: string, notes: string | null, employeeId = "e1") => ({ employeeId, date: d(data), notes });
    const r = agruparAfastamentos([
      l("2026-09-03", "Viagem"), l("2026-09-01", "Viagem"), l("2026-09-02", "Viagem"),
      l("2026-09-05", "Viagem"), l("2026-09-06", "Outro motivo"), l("2026-09-02", "Viagem", "e2"),
    ]);
    expect(r).toEqual([
      { employeeId: "e1", inicio: "2026-09-01", fim: "2026-09-03", dias: 3, motivo: "Viagem" },
      { employeeId: "e1", inicio: "2026-09-05", fim: "2026-09-05", dias: 1, motivo: "Viagem" },
      { employeeId: "e1", inicio: "2026-09-06", fim: "2026-09-06", dias: 1, motivo: "Outro motivo" },
      { employeeId: "e2", inicio: "2026-09-02", fim: "2026-09-02", dias: 1, motivo: "Viagem" },
    ]);
  });
});

describe("POST /payroll/afastamentos — lançar", () => {
  test("grava um dia AFASTAMENTO por dia do intervalo, com o motivo, substitui as marcas e audita", async () => {
    linhas = [
      { employeeId: "e1", date: d("2026-09-06"), type: "FOLGA", notes: null },
      { employeeId: "e1", date: d("2026-09-21"), type: "FOLGA", notes: null },
    ];
    const res = await lancar(CORPO);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ inicio: "2026-09-01", fim: "2026-09-20", dias: 20, substituidas: 1 });
    const af = linhas.filter((l) => l.type === "AFASTAMENTO");
    expect(af).toHaveLength(20);
    expect(af.every((l) => l.notes === "Pedido pessoal da funcionária")).toBe(true);
    // A folga de fora do intervalo fica.
    expect(linhas.find((l) => l.type === "FOLGA")?.date).toEqual(d("2026-09-21"));
    expect(db.payrollItem.create).toBeUndefined();
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({
      action: "RELEASE_UNPAID_LEAVE", entity: "EmployeeScheduleDay",
      newValue: { employeeId: "e1", inicio: "2026-09-01", fim: "2026-09-20", dias: 20, motivo: "Pedido pessoal da funcionária" },
      previousValue: { marcasSubstituidas: [{ date: "2026-09-06", type: "FOLGA" }] },
    });
  });

  test.each([
    ["motivo curto", { motivo: "a b c" }, "motivo"],
    ["motivo ausente", { motivo: undefined }, "motivo"],
    ["fim antes do início", { inicio: "2026-09-20", fim: "2026-09-01" }, "antes do início"],
    ["data inválida", { inicio: "2026-02-31" }, "inválid"],
    ["sem funcionário", { employeeId: "" }, "Funcionário"],
  ])("recusa %s sem gravar", async (_n, over, trecho) => {
    if ((over as { employeeId?: string }).employeeId === "") db.employee.findFirst.mockResolvedValue(null);
    const res = await lancar({ ...CORPO, ...over });
    expect([400, 404]).toContain(res.status);
    expect(res.body.message).toContain(trecho);
    expect(db.employeeScheduleDay.createMany).not.toHaveBeenCalled();
  });

  test("recusa antes da admissão e depois do desligamento", async () => {
    db.employee.findFirst.mockResolvedValue({ ...ana, terminationDate: d("2026-09-15") });
    const res = await lancar(CORPO);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("desligamento");
    const antes = await lancar({ ...CORPO, inicio: "2025-01-01" });
    expect(antes.status).toBe(400);
    expect(antes.body.message).toContain("admissão");
  });

  test("recusa se já há afastamento no intervalo", async () => {
    linhas = [{ employeeId: "e1", date: d("2026-09-10"), type: "AFASTAMENTO", notes: "Viagem longa" }];
    const res = await lancar(CORPO);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("10/09/2026");
  });

  test("recusa se cruza férias lançadas na Folha", async () => {
    db.payrollItem.findMany.mockResolvedValue([{ periodStart: d("2026-09-15"), periodEnd: d("2026-09-30") }]);
    const res = await lancar(CORPO);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("férias");
  });

  test("recusa se cruza férias marcadas na Escala (sem lançamento na Folha)", async () => {
    linhas = [{ employeeId: "e1", date: d("2026-09-18"), type: "FERIAS", notes: null }];
    const res = await lancar(CORPO);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("férias marcadas na Escala em 18/09/2026");
    expect(db.employeeScheduleDay.createMany).not.toHaveBeenCalled();
  });

  test("mês travado: recusa sem gravar e verifica o intervalo inteiro", async () => {
    travarSetembro();
    const res = await lancar({ ...CORPO, inicio: "2026-08-25", fim: "2026-09-02" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("09/2026 esta travado");
    expect(vi.mocked(assertPeriodWritableForRange).mock.calls[0].slice(0, 2)).toEqual([d("2026-08-25"), d("2026-09-02")]);
    expect(db.employeeScheduleDay.createMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("avisa quando a gorjeta do período já está fechada", async () => {
    db.tipPeriod.findMany.mockResolvedValue([{ label: "Gorjeta 26/08–25/09", code: "GOR-2026-0009" }]);
    const res = await lancar(CORPO);
    expect(res.status).toBe(201);
    expect(res.body.avisos.join(" ")).toContain("GOR-2026-0009");
  });
});

describe("GET, PUT e DELETE /payroll/afastamentos", () => {
  beforeEach(() => {
    linhas = Array.from({ length: 5 }, (_, i) => ({ employeeId: "e1", date: d(`2026-09-0${i + 1}`), type: "AFASTAMENTO", notes: "Viagem longa" }));
  });

  test("lista os intervalos que tocam o mês, com o nome", async () => {
    const res = await request(app).get("/payroll/afastamentos?year=2026&month=9");
    expect(res.status).toBe(200);
    expect(res.body.afastamentos).toEqual([
      { employeeId: "e1", employeeName: "Ana Souza", inicio: "2026-09-01", fim: "2026-09-05", dias: 5, motivo: "Viagem longa" },
    ]);
  });

  test("edita: troca o intervalo e o motivo", async () => {
    const res = await request(app).put("/payroll/afastamentos").send({
      employeeId: "e1", inicioAtual: "2026-09-01", fimAtual: "2026-09-05", inicio: "2026-09-03", fim: "2026-09-08", motivo: "Viagem prolongada",
    });
    expect(res.status).toBe(200);
    const af = linhas.filter((l) => l.type === "AFASTAMENTO").map((l) => l.date.toISOString().slice(0, 10)).sort();
    expect(af).toEqual(["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    expect(linhas.every((l) => l.notes === "Viagem prolongada")).toBe(true);
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({
      action: "UPDATE_UNPAID_LEAVE",
      previousValue: { inicio: "2026-09-01", fim: "2026-09-05", motivo: "Viagem longa" },
      newValue: { inicio: "2026-09-03", fim: "2026-09-08", motivo: "Viagem prolongada" },
    });
  });

  test("GET com ano ou mês fora da faixa: 400", async () => {
    for (const q of ["year=1999&month=9", "year=2026&month=13", "year=abc&month=9", "month=9"]) {
      const res = await request(app).get(`/payroll/afastamentos?${q}`);
      expect(res.status).toBe(400);
    }
  });

  test("mês travado: não edita (nem o intervalo antigo) nem exclui", async () => {
    travarSetembro();
    const editar = await request(app).put("/payroll/afastamentos").send({
      employeeId: "e1", inicioAtual: "2026-09-01", fimAtual: "2026-09-05", inicio: "2026-10-01", fim: "2026-10-05", motivo: "Viagem longa",
    });
    expect(editar.status).toBe(400);
    const excluir = await request(app).delete("/payroll/afastamentos?employeeId=e1&inicio=2026-09-01&fim=2026-09-05");
    expect(excluir.status).toBe(400);
    expect(linhas.filter((l) => l.type === "AFASTAMENTO")).toHaveLength(5);
    expect(db.employeeScheduleDay.deleteMany).not.toHaveBeenCalled();
  });

  test("editar um intervalo que não existe: 404", async () => {
    const res = await request(app).put("/payroll/afastamentos").send({
      employeeId: "e1", inicioAtual: "2026-10-01", fimAtual: "2026-10-05", inicio: "2026-10-01", fim: "2026-10-05", motivo: "Viagem longa",
    });
    expect(res.status).toBe(404);
  });

  test("exclui só os dias de afastamento do intervalo e audita", async () => {
    linhas.push({ employeeId: "e1", date: d("2026-09-06"), type: "FOLGA", notes: null });
    const res = await request(app).delete("/payroll/afastamentos?employeeId=e1&inicio=2026-09-01&fim=2026-09-06");
    expect(res.status).toBe(200);
    expect(res.body.dias).toBe(5);
    expect(linhas).toEqual([{ employeeId: "e1", date: d("2026-09-06"), type: "FOLGA", notes: null }]);
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({ action: "DELETE_UNPAID_LEAVE", previousValue: { dias: 5 } });
  });

  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await lancar(CORPO)).status).toBe(401);
  });
});
