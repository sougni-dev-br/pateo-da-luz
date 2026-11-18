import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { employee: { findMany: vi.fn() }, tipPeriod: { findMany: vi.fn() } },
}));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  carregarParaSync: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { carregarParaSync } from "../tip-commission.service.js";
import { previaSyncCadastro } from "../tip-sync-previa.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const funcao = (name: string, points: number) => ({ name, points });

const periodo = { periodStart: d("2026-10-26"), periodEnd: d("2026-11-25"), competenceYear: 2026, competenceMonth: 11 };
const pessoa = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
  id, firstName: nome, lastName: "Teste", displayName: null, tipoGorjeta: "PONTOS", pontosExtra: null, cotaFixaGorjeta: null,
  tipFunction: funcao("Atendimento", 3.5), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([]);
  db.tipPeriod.findMany.mockResolvedValue([]);
});

describe("previaSyncCadastro", () => {
  test("avisa quem entraria, o que mudou nos pontos e não grava nada", async () => {
    vi.mocked(carregarParaSync).mockResolvedValue({
      periodo,
      elegiveis: [pessoa("a", "Nova"), pessoa("b", "Antiga", { tipFunction: funcao("Pia 2", 2) })],
      emTeste: [], soSalario: [],
      existing: [{ id: "p1", employeeId: "b", kind: "PONTOS", basePoints: 3.5, functionName: "Atendimento", foraDaGorjeta: false, _count: { vales: 0 } }],
    } as never);
    const r = await previaSyncCadastro("per");
    expect(r.diferencas.map((x) => `${x.nome}:${x.tipo}`)).toEqual(["Nova Teste:INCLUIR", "Antiga Teste:PONTOS", "Antiga Teste:FUNCAO"]);
    expect(r.diferencas[0].detalhe).toContain("3,5 pts");
  });

  test("lista quem está fora do rateio com o motivo e conta os desligados antigos marcados", async () => {
    vi.mocked(carregarParaSync).mockResolvedValue({
      periodo, elegiveis: [], emTeste: [], soSalario: [],
      existing: [{ id: "p2", employeeId: "r", kind: "PONTOS", basePoints: 0, functionName: null, foraDaGorjeta: true, _count: { vales: 0 } }],
    } as never);
    // 1ª chamada: quem tem vínculo no ciclo; 2ª: desligados ainda marcados (ciclo da saída fechado).
    db.employee.findMany.mockResolvedValueOnce([
      { id: "r", firstName: "Rafa", lastName: "Teste", displayName: null, modality: "NAO_CLT", participaGorjeta: false, inicioGorjeta: null, tipoGorjeta: "PONTOS", pontosExtra: null, tipFunction: null },
      { id: "z", firstName: "Zeca", lastName: "Teste", displayName: null, modality: "CLT", participaGorjeta: true, inicioGorjeta: d("2026-01-01"), tipoGorjeta: "PONTOS", pontosExtra: null, tipFunction: funcao("Pia 1", 2.5) },
    ]).mockResolvedValueOnce([
      { id: "x", firstName: "Analia", lastName: "Teste", displayName: null, terminationDate: d("2026-09-17") },
    ]);
    db.tipPeriod.findMany.mockResolvedValue([{ periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), status: "CLOSED" }]);
    const r = await previaSyncCadastro("per");
    expect(r.foraDoRateio).toHaveLength(1);
    expect(r.foraDoRateio[0]).toMatchObject({ employeeId: "r", soSalario: true });
    expect(r.foraDoRateio[0].motivo).toContain("desmarcado");
    expect(r.desligadosComParticipaMarcado).toBe(1);
    expect(r.desligadosParaLimpar).toEqual([{ employeeId: "x", nome: "Analia Teste", saida: "2026-09-17T00:00:00.000Z" }]);
  });
});
