import { describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { employeeTipHistory: { findMany: vi.fn() }, tipPeriod: { findMany: vi.fn() }, tipReserveMovement: { findMany: vi.fn() } },
}));

import { prisma } from "../../../config/database.js";
import { evolucaoMensal, extratoReserva, listarMudancas, motivoParaNaoRetirar, mudouSituacao } from "../tip-historico.service.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const emp = { firstName: "Luiz", lastName: "Moreno", displayName: null };
let seq = 0;
const linha = (validFrom: string, over: Record<string, unknown>) => ({
  id: `h${++seq}`, employeeId: "e1", validFrom: d(validFrom), participaGorjeta: true, tipFunctionId: "pizzaiolo",
  functionName: "Pizzaiolo", functionPoints: 3.5, pontosPadrao: null, pontosExtra: null, pontosExtraMotivo: null, basePoints: 3.5, reason: null,
  changedById: "u", createdAt: d(validFrom), employee: emp, ...over,
});

describe("listarMudancas", () => {
  test("classifica cada linha pelo que mudou em relação à anterior", async () => {
    vi.mocked(prisma.employeeTipHistory.findMany).mockResolvedValue([
      linha("2025-01-01", { participaGorjeta: false, basePoints: 3.5 }),
      linha("2026-01-10", {}),
      linha("2026-05-01", { pontosExtra: 0.5, basePoints: 4, reason: "Promoção" }),
      linha("2026-07-01", { tipFunctionId: "lider", functionName: "Líder de setor", functionPoints: 5, pontosPadrao: null, basePoints: 5 }),
      linha("2026-08-01", { tipFunctionId: "atend", functionName: "Atendimento", functionPoints: 5, basePoints: 5 }),
      linha("2026-09-01", { basePoints: 4.5, functionPoints: 4.5 }),
    ] as never);

    const r = await listarMudancas({});
    const tipos = Object.fromEntries(r.map((m) => [m.validFrom.slice(0, 10), m.tipo]));
    expect(tipos).toEqual({
      "2025-01-01": "INICIAL",
      "2026-01-10": "ENTRADA",
      "2026-05-01": "PROMOCAO",
      "2026-07-01": "PROMOCAO",
      "2026-08-01": "TROCA_DE_FUNCAO",
      "2026-09-01": "REDUCAO",
    });
    const promocao = r.find((m) => m.validFrom.startsWith("2026-05-01"))!;
    expect(promocao.baseAntes).toBe(3.5);
    expect(promocao.baseDepois).toBe(4);
    expect(promocao.diferenca).toBe(0.5);
    expect(promocao.motivo).toBe("Promoção");
  });

  test("filtro de datas usa a vigência, mas o 'antes' vem da linha anterior mesmo fora do filtro", async () => {
    vi.mocked(prisma.employeeTipHistory.findMany).mockResolvedValue([
      linha("2025-01-01", {}),
      linha("2026-09-10", { pontosExtra: 1.5, basePoints: 5 }),
    ] as never);
    const r = await listarMudancas({ de: d("2026-09-01"), ate: d("2026-09-30") });
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe("PROMOCAO");
    expect(r[0].baseAntes).toBe(3.5);
  });
});

describe("mudouSituacao", () => {
  const base = { participaGorjeta: true, tipFunctionId: "f", pontosExtra: null, pontosExtraMotivo: null };
  test("empresa ou outro campo fora da gorjeta não gera histórico", () => {
    expect(mudouSituacao(base, { ...base })).toBe(false);
  });
  test("função, pontos ou participação geram", () => {
    expect(mudouSituacao(base, { ...base, tipFunctionId: "g" })).toBe(true);
    expect(mudouSituacao(base, { ...base, pontosExtra: 1, pontosExtraMotivo: "Líder de turno" })).toBe(true);
    expect(mudouSituacao({ ...base, pontosExtra: 1, pontosExtraMotivo: "a" }, { ...base, pontosExtra: 1, pontosExtraMotivo: "b" })).toBe(true);
    expect(mudouSituacao(base, { ...base, participaGorjeta: false })).toBe(true);
  });
});

describe("motivoParaNaoRetirar (reabrir/refechar não deixa o fundo negativo)", () => {
  test("reserva ainda no fundo: pode retirar", () => {
    expect(motivoParaNaoRetirar(1000, 1000, "07/2026")).toBeNull();
  });
  test("reserva já distribuída: bloqueia e explica", () => {
    const m = motivoParaNaoRetirar(200, 1000, "07/2026");
    expect(m).toContain("07/2026");
    expect(m).toContain("-800.00");
  });
  test("refechar com reserva maior (retirada negativa) nunca bloqueia", () => {
    expect(motivoParaNaoRetirar(0, -150, "07/2026")).toBeNull();
  });
});

describe("apelido nos relatórios (nome continua o completo)", () => {
  const comApelido = { firstName: "José", lastName: "Carlos", displayName: "Zé" };

  test("mudanças de função/pontos", async () => {
    vi.mocked(prisma.employeeTipHistory.findMany).mockResolvedValue([linha("2026-01-01", { employee: comApelido }), linha("2026-02-01", {})] as never);
    const r = await listarMudancas({});
    expect(r.map((m) => [m.employeeName, m.apelido])).toEqual([["Luiz Moreno", null], ["José Carlos", "Zé"]]);
  });

  test("evolução mês a mês", async () => {
    vi.mocked(prisma.tipPeriod.findMany).mockResolvedValue([{
      competenceYear: 2026, competenceMonth: 9, status: "CLOSED", pointValue: 150,
      participants: [{ employeeId: "e2", functionName: "Garçom", basePoints: 4, points: 4, rateioAmount: 600, employee: comApelido }],
    }] as never);
    const r = await evolucaoMensal({ ano: 2026, mes: 9 }, { ano: 2026, mes: 9 });
    expect(r.linhas[0]).toMatchObject({ employeeId: "e2", employeeName: "José Carlos", apelido: "Zé" });
  });

  test("movimentos do fundo de reserva trazem employeeId e apelido", async () => {
    vi.mocked(prisma.tipReserveMovement.findMany).mockResolvedValue([
      { id: "m1", date: d("2026-09-25"), type: "FECHAMENTO_RESERVA", amount: 300, notes: null, employeeId: null, employee: null, period: { competenceYear: 2026, competenceMonth: 9 } },
      { id: "m2", date: d("2026-09-26"), type: "DISTRIBUICAO", amount: -100, notes: null, employeeId: "e2", employee: comApelido, period: null },
    ] as never);
    const r = await extratoReserva();
    expect(r.movimentos.map((m) => [m.employeeId, m.employeeName, m.apelido])).toEqual([["e2", "José Carlos", "Zé"], [null, null, null]]);
    expect(JSON.stringify(r)).not.toMatch(/cpf|salar/i);
  });
});
