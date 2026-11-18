import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { tipPeriodClosing: { findFirst: vi.fn() } },
}));

import { prisma } from "../../../config/database.js";
import { anteriorDoRetrato, carregarMesAnterior, competenciaAnterior } from "../tip-mes-anterior.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const RETRATO = {
  params: { label: "Outubro/2026" },
  totals: { pointValue: 118.4 },
  participants: [
    { employeeId: "a", gorjeta: 450.5, pontosBase: 3.5, pontosApurados: 3.5, diasComputados: 26, diasReferencia: 26, funcao: "Garçom", tipo: "PONTOS", tipoCalculo: "MES" },
    { employeeId: "b", gorjeta: 0, foraDaGorjeta: true, pontosBase: 0 },
    { employeeId: "c", gorjeta: 100 },
    { nome: "sem id", gorjeta: 10 },
    { employeeId: "d", gorjeta: "texto" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("competenciaAnterior", () => {
  test("volta um mês e atravessa o ano", () => {
    expect(competenciaAnterior(2026, 11)).toEqual({ year: 2026, month: 10 });
    expect(competenciaAnterior(2026, 1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("anteriorDoRetrato", () => {
  test("lê gorjeta, pontos e dias por pessoa e o valor do ponto", () => {
    const r = anteriorDoRetrato(2026, 10, RETRATO)!;
    expect(r).toMatchObject({ year: 2026, month: 10, label: "Outubro/2026", valorPonto: 118.4 });
    expect(r.porPessoa.a).toEqual({ gorjeta: 450.5, pontosBase: 3.5, pontosApurados: 3.5, diasComputados: 26, diasReferencia: 26, funcao: "Garçom", tipo: "PONTOS", tipoCalculo: "MES" });
  });

  test("ignora quem só recebeu salário, sem id ou sem valor legível; campos faltando viram zero, não inventam", () => {
    const r = anteriorDoRetrato(2026, 10, RETRATO)!;
    expect(Object.keys(r.porPessoa)).toEqual(["a", "c"]);
    expect(r.porPessoa.c).toMatchObject({ gorjeta: 100, pontosBase: 0, funcao: null, tipo: null, tipoCalculo: null });
  });

  test("retrato vazio ou torto não derruba e não vira comparação (ninguém seria marcado como novo)", () => {
    expect(anteriorDoRetrato(2026, 3, { params: null, totals: null, participants: null })).toBeNull();
    expect(anteriorDoRetrato(2026, 3, { params: {}, totals: {}, participants: [{ nome: "sem id" }] })).toBeNull();
  });

  test("sem o rótulo no retrato, usa mês/ano", () => {
    const r = anteriorDoRetrato(2026, 3, { params: {}, totals: {}, participants: [{ employeeId: "a", gorjeta: 10 }] });
    expect(r?.label).toBe("03/2026");
  });
});

describe("carregarMesAnterior", () => {
  test("busca o fechamento vigente (não reaberto) do mês anterior", async () => {
    db.tipPeriodClosing.findFirst.mockResolvedValue(RETRATO);
    const r = await carregarMesAnterior(2026, 11);
    expect(db.tipPeriodClosing.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { competenceYear: 2026, competenceMonth: 10, reopenedAt: null }, orderBy: { version: "desc" },
    }));
    expect(r?.label).toBe("Outubro/2026");
  });

  test("sem fechamento vigente, não há comparação", async () => {
    db.tipPeriodClosing.findFirst.mockResolvedValue(null);
    expect(await carregarMesAnterior(2026, 11)).toBeNull();
  });
});
