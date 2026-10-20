import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: { $queryRawUnsafe: vi.fn() } }));

import { prisma } from "../../../config/database.js";
import { mesesDaCobertura, montarPanorama } from "../tax-payment-panorama.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

describe("mesesDaCobertura", () => {
  test("12 meses terminando no mês de hoje, do mais antigo ao mais novo", () => {
    const meses = mesesDaCobertura("2026-10-20");
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe("2025-11");
    expect(meses[11]).toBe("2026-10");
  });

  test("atravessa a virada do ano", () => {
    expect(mesesDaCobertura("2026-02-05", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("montarPanorama", () => {
  beforeEach(() => vi.clearAllMocks());

  function responder(situacao: object, cobertura: object[], semCompetencia: number) {
    db.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY 1, 2")) return cobertura;
      if (sql.includes(`"competenceDate" IS NULL`)) return [{ total: semCompetencia }];
      return [situacao];
    });
  }

  test("monta situações, faixas de vencimento, cobertura e guias sem competência", async () => {
    responder(
      { todas: 10, canceladas: 1, pagas: 6, vencidas: 2, a_vencer: 2, v_qtd: 2, v_valor: "300.50", s7_qtd: 1, s7_valor: "100", s30_qtd: 1, s30_valor: "250.25", d_qtd: 0, d_valor: "0" },
      [{ mes: "2026-09", grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: "1980.00" }],
      4
    );

    const p = await montarPanorama(new Date("2026-10-20T15:00:00Z"));

    expect(p.hoje).toBe("2026-10-20");
    expect(p.situacoes).toEqual({ todas: 10, vencidas: 2, aVencer: 2, pagas: 6, canceladas: 1 });
    expect(p.aPagar.vencido).toEqual({ qtd: 2, valor: 300.5 });
    expect(p.aPagar.ate7).toEqual({ qtd: 1, valor: 100 });
    expect(p.aPagar.ate30).toEqual({ qtd: 1, valor: 250.25 });
    expect(p.aPagar.depois).toEqual({ qtd: 0, valor: 0 });
    expect(p.cobertura).toEqual([{ mes: "2026-09", grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 1980 }]);
    expect(p.semCompetencia).toBe(4);
    expect(p.meses[11]).toBe("2026-10");
  });

  test("sem nenhuma guia devolve zeros, não quebra", async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    const p = await montarPanorama(new Date("2026-10-20T15:00:00Z"));
    expect(p.situacoes.todas).toBe(0);
    expect(p.aPagar.vencido).toEqual({ qtd: 0, valor: 0 });
    expect(p.cobertura).toEqual([]);
    expect(p.semCompetencia).toBe(0);
  });

  test("todas as consultas ignoram guia excluída e as de cobertura ignoram cancelada", async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    await montarPanorama(new Date("2026-10-20T15:00:00Z"));
    const consultas = db.$queryRawUnsafe.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(consultas).toHaveLength(3);
    for (const q of consultas) expect(q).toContain(`"deletedAt" IS NULL`);
    for (const q of consultas.filter((s: string) => s.includes("competenceDate"))) expect(q).toContain(`"status" <> 'CANCELED'`);
  });

  test("usa o dia de hoje em Brasília, não NOW()", async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    // 01h UTC de 21/10 ainda é 20/10 em Brasília
    await montarPanorama(new Date("2026-10-21T01:00:00Z"));
    const consultas = db.$queryRawUnsafe.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(consultas[0]).toContain(`'2026-10-20'::timestamp`);
    expect(consultas.join()).not.toContain("NOW()");
  });
});
