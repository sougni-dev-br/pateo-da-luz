import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: { employeeScheduleDay: { findMany: vi.fn() } } }));
vi.mock("../ponto.service.js", () => ({ pontoFechadoDoMes: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { carregarPontoDaApuracao } from "../ponto-apuracao.js";
import { pontoFechadoDoMes } from "../ponto.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const setembro = new Map([["e1", { faltaDias: ["2026-09-28", "2026-09-30"], extraAPagarMin: 90, noturnoMin: 30 }]]);
const outubro = new Map([["e1", { faltaDias: ["2026-10-02", "2026-10-21"], extraAPagarMin: 300, noturnoMin: 74 }]]);

beforeEach(() => {
  vi.clearAllMocks();
  db.employeeScheduleDay.findMany.mockResolvedValue([]);
  vi.mocked(pontoFechadoDoMes).mockImplementation(async (_ano, mes) => (mes === 9 ? setembro : mes === 10 ? outubro : new Map()));
});

const carregar = () => carregarPontoDaApuracao(["e1", "e2"], [{ ini: d("2026-09-26"), fim: d("2026-10-25") }, { ini: d("2026-10-01"), fim: d("2026-10-31") }], { year: 2026, month: 10 });

describe("carregarPontoDaApuracao", () => {
  test("o ciclo atravessa dois meses: junta as faltas dos dois, só as que caem dentro do ciclo", async () => {
    const ponto = await carregar();
    // 28/09, 30/09, 02/10 e 21/10 caem em 26/09–25/10
    expect(ponto.faltas("e1", d("2026-09-26"), d("2026-10-25"))).toBe(4);
  });

  test("o mês do salário usa só os dias do mês civil", async () => {
    const ponto = await carregar();
    expect(ponto.faltas("e1", d("2026-10-01"), d("2026-10-31"))).toBe(2);
  });

  test("as faltas da Escala somam sem repetir o dia que o Ponto também apurou", async () => {
    db.employeeScheduleDay.findMany.mockResolvedValue([
      { employeeId: "e1", date: d("2026-10-02") }, // o Ponto também apurou: não repete
      { employeeId: "e1", date: d("2026-10-10") }, // só a Escala
    ]);
    const ponto = await carregar();
    expect(ponto.faltas("e1", d("2026-10-01"), d("2026-10-31"))).toBe(3);
  });

  test("pessoa sem Ponto fechado: null (vale só a Escala)", async () => {
    const ponto = await carregar();
    expect(ponto.faltas("e2", d("2026-10-01"), d("2026-10-31"))).toBeNull();
    expect(ponto.horas("e2")).toBeNull();
  });

  test("as horas são as do mês do salário", async () => {
    const ponto = await carregar();
    expect(ponto.horas("e1")).toEqual({ horaExtraMin: 300, noturnoMin: 74 });
  });

  test("só uma parte do ciclo com Ponto fechado: conta o fechado e a Escala do resto", async () => {
    vi.mocked(pontoFechadoDoMes).mockImplementation(async (_ano, mes) => (mes === 10 ? outubro : new Map()));
    db.employeeScheduleDay.findMany.mockResolvedValue([{ employeeId: "e1", date: d("2026-09-27") }]);
    const ponto = await carregar();
    expect(ponto.faltas("e1", d("2026-09-26"), d("2026-10-25"))).toBe(3); // 27/09 (Escala) + 02/10 e 21/10 (Ponto)
  });
});
