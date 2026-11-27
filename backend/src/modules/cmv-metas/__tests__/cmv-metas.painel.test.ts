import { beforeEach, describe, expect, test, vi } from "vitest";

const queryRaw = vi.fn();
const metaFindMany = vi.fn();
const cicloFindFirst = vi.fn();
vi.mock("../../../config/database.js", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    cmvMeta: { findMany: (...a: unknown[]) => metaFindMany(...a) },
    inventorySector: { findMany: vi.fn().mockResolvedValue([{ id: "s1", name: "FREEZER" }]) },
    cmvPeriod: { findFirst: (...a: unknown[]) => cicloFindFirst(...a) },
  },
}));
const getCmvPeriod = vi.fn();
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ getCmvPeriod: (...a: unknown[]) => getCmvPeriod(...a) }));
vi.mock("../../cmv-real/cmv-purchase-base.service.js", () => ({
  cmvPurchasePredicate: () => ({}),
  getCmvPurchaseTotalsByPurchaseDateRange: vi.fn().mockResolvedValue({ total: 50000, count: 3 }),
}));
vi.mock("../../payroll/extras-comum.js", () => ({ hojeEmSaoPaulo: () => "2026-11-25" }));

import { montarPainel } from "../cmv-metas.service.js";

const metaGeral = { id: "g", escopo: "GERAL", sectorId: null, alvoPercentual: 60, alertaPercentual: 55, vigenciaInicio: new Date("2026-01-01T00:00:00Z"), vigenciaFim: null, observacao: null };
const metaSetor = { id: "s", escopo: "SETOR", sectorId: "s1", alvoPercentual: 25, alertaPercentual: 22, vigenciaInicio: new Date("2026-01-01T00:00:00Z"), vigenciaFim: null, observacao: null };

beforeEach(() => {
  vi.clearAllMocks();
  metaFindMany.mockResolvedValue([metaGeral, metaSetor]);
  cicloFindFirst.mockResolvedValue(null);
  queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("RevenueEntry")) return [{ total: 100000 }];
    if (sql.includes('"PurchaseOrder"')) return [];
    return [{ sectorId: "s1", total: 24000 }];
  });
});

const geral = (p: Awaited<ReturnType<typeof montarPainel>>) => p.linhas.find((l) => l.escopo === "GERAL")!;

describe("montarPainel — base do realizado", () => {
  test("ciclo fechado no mês: o realizado é o CMV real (razão vira %), não compras ÷ faturamento", async () => {
    cicloFindFirst.mockResolvedValue({ id: "c1", name: "CMV abr", status: "CLOSED", cmvPercentual: 0.65 });
    const p = await montarPainel(2026, 4);
    const g = geral(p);
    expect(g.base).toBe("CMV_REAL");
    expect(g.realizadoPercentual).toBe(65);
    expect(g.comprasSobreFaturamento).toBe(50);
    expect(g.status).toBe("VERMELHO"); // 65 > meta 60
    expect(g.projecao).toBeNull();
    expect(getCmvPeriod).not.toHaveBeenCalled(); // fechado vale pelo valor congelado
  });

  test("ciclo aberto que já terminou é recalculado, não usa o valor gravado", async () => {
    cicloFindFirst.mockResolvedValue({ id: "c2", name: "CMV mai", status: "OPEN", cmvPercentual: 0.9 });
    getCmvPeriod.mockResolvedValue({ cmvPercentual: 0.5 });
    const g = geral(await montarPainel(2026, 5));
    expect(getCmvPeriod).toHaveBeenCalledWith("c2");
    expect(g.realizadoPercentual).toBe(50);
    expect(g.status).toBe("VERDE");
  });

  test("falha ao recalcular o ciclo aberto cai no valor gravado, sem derrubar o painel", async () => {
    cicloFindFirst.mockResolvedValue({ id: "c3", name: "CMV mai", status: "OPEN", cmvPercentual: 0.58 });
    getCmvPeriod.mockRejectedValue(new Error("sem snapshot"));
    expect(geral(await montarPainel(2026, 5)).realizadoPercentual).toBe(58);
  });

  test("sem ciclo no mês corrente: usa compras ÷ faturamento e projeta o fim do mês", async () => {
    const g = geral(await montarPainel(2026, 11));
    expect(g.base).toBe("COMPRAS");
    expect(g.realizadoPercentual).toBe(50);
    expect(g.projecao).not.toBeNull();
  });

  test("ciclo sem percentual (faturamento zero) não vira base: cai em compras ÷ faturamento", async () => {
    cicloFindFirst.mockResolvedValue({ id: "c4", name: "CMV jun", status: "CLOSED", cmvPercentual: null });
    expect(geral(await montarPainel(2026, 6)).base).toBe("COMPRAS");
  });

  test("setor é sempre compras ÷ faturamento, mesmo com ciclo fechado", async () => {
    cicloFindFirst.mockResolvedValue({ id: "c1", name: "CMV abr", status: "CLOSED", cmvPercentual: 0.65 });
    const setor = (await montarPainel(2026, 4)).linhas.find((l) => l.sectorId === "s1")!;
    expect(setor.base).toBe("COMPRAS");
    expect(setor.realizadoPercentual).toBe(24);
    expect(setor.status).toBe("AMARELO"); // 22 <= 24 <= 25
  });
});
