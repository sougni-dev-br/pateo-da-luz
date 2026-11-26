import { beforeEach, describe, expect, test, vi } from "vitest";

const queryRaw = vi.fn();
const metaFindMany = vi.fn();
vi.mock("../../../config/database.js", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    cmvMeta: { findMany: (...a: unknown[]) => metaFindMany(...a) },
  },
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ getCmvPeriod: vi.fn() }));
vi.mock("../../cmv-real/cmv-purchase-base.service.js", () => ({
  cmvPurchasePredicate: () => ({}),
  getCmvPurchaseTotalsByPurchaseDateRange: vi.fn(),
}));
vi.mock("../../payroll/extras-comum.js", () => ({ hojeEmSaoPaulo: () => "2026-11-10" }));

import { montarRanking, montarVisoes, preencherDias } from "../cmv-metas-visoes.service.js";

const linha = (nome: string, compras: number, comprasAnterior = 0) => ({ id: nome, nome, compras, comprasAnterior });

describe("montarRanking", () => {
  test("ordena pelo mês atual e soma o que passa do limite em outros", () => {
    const r = montarRanking([linha("A", 10), linha("B", 30, 5), linha("C", 20), linha("D", 5, 8)], 2);
    expect(r.linhas.map((l) => l.nome)).toEqual(["B", "C"]);
    expect(r.outros).toEqual({ quantidade: 2, compras: 15, comprasAnterior: 8 });
    expect(r.total).toBe(65);
    expect(r.totalAnterior).toBe(13);
  });

  test("item que só existiu no mês anterior entra (para a queda aparecer), zerado some", () => {
    const r = montarRanking([linha("Só antes", 0, 40), linha("Nada", 0, 0), linha("Agora", 10)]);
    expect(r.linhas.map((l) => l.nome)).toEqual(["Agora", "Só antes"]);
  });
});

describe("preencherDias", () => {
  test("devolve todos os dias do mês, com zero onde não houve movimento", () => {
    const dias = preencherDias(3, new Map([[1, 100]]), new Map([[3, 40]]));
    expect(dias).toEqual([
      { dia: 1, faturamento: 100, compras: 0 },
      { dia: 2, faturamento: 0, compras: 0 },
      { dia: 3, faturamento: 0, compras: 40 },
    ]);
  });
});

describe("montarVisoes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metaFindMany.mockResolvedValue([
      { id: "g", escopo: "GERAL", sectorId: null, alvoPercentual: 30, alertaPercentual: 27, vigenciaInicio: new Date("2026-01-01T00:00:00Z"), vigenciaFim: null },
    ]);
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("RevenueEntry")) return [{ dia: new Date("2026-10-05T00:00:00Z"), total: 1000 }, { dia: new Date("2026-10-20T00:00:00Z"), total: 500 }, { dia: new Date("2026-11-02T00:00:00Z"), total: 800 }];
      if (sql.includes("date_trunc")) return [{ dia: new Date("2026-11-02T00:00:00Z"), total: 200 }];
      return [{ id: "x", nome: "Hortifruti", atual: 200, anterior: 150 }];
    });
  });

  test("mês em andamento: linha para em hoje e a comparação usa o mesmo trecho do mês anterior", async () => {
    const v = await montarVisoes(2026, 11);
    expect(v.mesAnterior).toBe("2026-10");
    expect(v.ritmo.atual).toHaveLength(10);
    expect(v.ritmo.anterior).toHaveLength(31);
    expect(v.ritmo.atual[1]).toEqual({ dia: 2, faturamento: 800, compras: 200 });
    expect(v.comparacaoAteODia).toBe(10);
    // Até o dia 10 de outubro só entra o lançamento do dia 5.
    expect(v.faturamentoAnterior).toBe(1000);
    expect(v.faturamento).toBe(800);
    expect(v.meta).toEqual({ alvoPercentual: 30, alertaPercentual: 27 });
    expect(v.distribuicao.categoria.linhas[0]).toEqual({ id: "x", nome: "Hortifruti", compras: 200, comprasAnterior: 150 });
  });

  test("mês fechado vai até o último dia, nos dois meses", async () => {
    const v = await montarVisoes(2026, 10);
    expect(v.mesCorrente).toBe(false);
    expect(v.ritmo.atual).toHaveLength(31);
    expect(v.comparacaoAteODia).toBe(30); // setembro inteiro
  });

  test("sem meta geral vigente, o teto some (meta null)", async () => {
    metaFindMany.mockResolvedValue([]);
    expect((await montarVisoes(2026, 11)).meta).toBeNull();
  });
});
