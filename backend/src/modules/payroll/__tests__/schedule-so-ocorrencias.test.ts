import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Escala com o banco de mentira: quem está fora da escala (includeInSchedule=false)
// aparece como "só ocorrências", só aceita falta/atestado/férias/folga e não ganha
// crédito automático de feriado nem entra no histórico de domingos.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findMany: vi.fn() },
    employeeScheduleDay: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    scheduleDayEvent: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    payrollSettings: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { scheduleRouter } from "../schedule.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/schedule", scheduleRouter);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function funcionario(id: string, includeInSchedule: boolean, over: Record<string, unknown> = {}) {
  return {
    id, firstName: id === "fora" ? "Rita" : "Ana", lastName: "Souza", displayName: null, sector: "Salão", subgroup: null, position: null,
    shiftStart: null, shiftEnd: null, scheduleRegime: "SEIS_POR_UM", admissionDate: d("2025-01-01"), terminationDate: null,
    gender: "FEMININO", holidayCompBalance: 0, isActive: true, includeInSchedule, ...over,
  };
}

type Linha = { employeeId: string; date: Date; type: string };
let linhas: Linha[] = [];

// Filtro mínimo do findMany da escala: funcionário, tipo e faixa de datas (inclusive o OR das bordas).
function filtrar(where: Record<string, unknown>): Linha[] {
  const ids = (where.employeeId as { in?: string[] } | undefined)?.in;
  const faixa = (w: { gte?: Date; lt?: Date } | undefined, dt: Date) => !w || ((!w.gte || dt >= w.gte) && (!w.lt || dt < w.lt));
  return linhas.filter((l) => {
    if (ids && !ids.includes(l.employeeId)) return false;
    if (typeof where.type === "string" && l.type !== where.type) return false;
    if (Array.isArray(where.OR)) return (where.OR as Array<{ date?: { gte?: Date; lt?: Date } }>).some((o) => faixa(o.date, l.date));
    return faixa(where.date as { gte?: Date; lt?: Date } | undefined, l.date);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.employeeScheduleDay.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => filtrar(where));
  db.payrollItem.findMany.mockResolvedValue([]);
  db.scheduleDayEvent.findMany.mockResolvedValue([]);
  db.payrollSettings.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

afterEach(() => { vi.useRealTimers(); });

describe("GET /schedule — quem está fora da escala", () => {
  test("a listagem não filtra mais por 'Entra na escala' e marca quem está fora como só ocorrências", async () => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true), funcionario("fora", false)]);
    linhas = [{ employeeId: "fora", date: d("2026-09-10"), type: "FALTA" }];

    const res = await request(app).get("/schedule?year=2026&month=9");

    expect(res.status).toBe(200);
    const where = db.employee.findMany.mock.calls[0][0].where;
    expect(where.includeInSchedule).toBeUndefined();
    expect(where.deletedAt).toBeNull();
    const porId = Object.fromEntries(res.body.employees.map((e: { id: string }) => [e.id, e]));
    expect(porId.dentro.somenteOcorrencias).toBe(false);
    expect(porId.fora.somenteOcorrencias).toBe(true);
    expect(porId.fora.includeInSchedule).toBeUndefined();
    expect(res.body.entries).toEqual([{ employeeId: "fora", day: 10, type: "FALTA" }]);
  });

  test("histórico de domingos só de quem monta escala", async () => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true), funcionario("fora", false)]);
    linhas = [
      { employeeId: "dentro", date: d("2026-08-02"), type: "FOLGA" },
      { employeeId: "fora", date: d("2026-08-02"), type: "FOLGA" },
    ];
    const res = await request(app).get("/schedule?year=2026&month=9");
    const ids = new Set(res.body.sundayHistory.map((h: { employeeId: string }) => h.employeeId));
    expect(ids.has("dentro")).toBe(true);
    expect(ids.has("fora")).toBe(false);
  });

  test("feriado sem marca não vira crédito para quem está fora; folga de feriado debita igual", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(d("2026-11-18"));
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true), funcionario("fora", false, { holidayCompBalance: 1 })]);
    // Uma marca em novembro para cada um: o mês "tem escala" para os dois.
    linhas = [
      { employeeId: "dentro", date: d("2026-11-05"), type: "FALTA" },
      { employeeId: "fora", date: d("2026-11-05"), type: "FOLGA_FERIADO" },
    ];
    const res = await request(app).get("/schedule?year=2026&month=11");
    const porId = Object.fromEntries(res.body.employees.map((e: { id: string; holidayCompBalance: number }) => [e.id, e.holidayCompBalance]));
    expect(porId.dentro).toBeGreaterThan(0); // 02/11 e 15/11 trabalhados
    expect(porId.fora).toBe(0); // 1 do ajuste manual − 1 folga de feriado, sem crédito
  });
});

describe("POST /schedule/bulk — só ocorrências", () => {
  const salvar = (entries: unknown[]) => request(app).post("/schedule/bulk").send({ year: 2026, month: 9, entries, dateEvents: [] });

  test.each(["TURNO", "EVENTO"])("recusa %s para quem está fora da escala, sem gravar nada", async (tipo) => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true), funcionario("fora", false)]);
    const res = await salvar([{ employeeId: "dentro", day: 3, type: "TURNO" }, { employeeId: "fora", day: 4, type: tipo }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Rita Souza");
    expect(res.body.message).toContain("dia 4");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.deleteMany).not.toHaveBeenCalled();
  });

  test("aceita falta, atestado, férias e as três folgas; reescreve o mês de quem aparece na tela", async () => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true), funcionario("fora", false)]);
    const tipos = ["FALTA", "ATESTADO", "FERIAS", "FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"];
    const res = await salvar([
      { employeeId: "dentro", day: 1, type: "TURNO" },
      ...tipos.map((type, i) => ({ employeeId: "fora", day: i + 2, type })),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
    const where = db.employee.findMany.mock.calls[0][0].where;
    expect(where.includeInSchedule).toBeUndefined();
    const gravados = db.employeeScheduleDay.createMany.mock.calls[0][0].data as Array<{ employeeId: string; type: string }>;
    expect(gravados.filter((g) => g.employeeId === "fora").map((g) => g.type)).toEqual(tipos);
    expect(db.employeeScheduleDay.deleteMany.mock.calls[0][0].where.employeeId.in).toEqual(["dentro", "fora"]);
  });

  test.each([["desconhecido", "FERIADO"], ["ausente", undefined], ["minúsculo", "ferias"]])("tipo de dia %s: 400 e nada gravado (antes virava FOLGA)", async (_nome, tipo) => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true)]);
    const res = await salvar([{ employeeId: "dentro", day: 3, type: "TURNO" }, { employeeId: "dentro", day: 5, type: tipo }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("dia 5");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.employeeScheduleDay.deleteMany).not.toHaveBeenCalled();
  });

  test("turno continua valendo para quem está na escala", async () => {
    db.employee.findMany.mockResolvedValue([funcionario("dentro", true)]);
    const res = await salvar([{ employeeId: "dentro", day: 3, type: "TURNO" }]);
    expect(res.status).toBe(200);
  });
});
