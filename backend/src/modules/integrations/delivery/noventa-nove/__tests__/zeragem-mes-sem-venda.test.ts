import { beforeEach, describe, expect, test, vi } from "vitest";

// Quando o mes inteiro fica sem venda faturada (estorno total, reprocessamento da plataforma), os
// lancamentos antigos do mes tem que ser zerados — antes a funcao saia no "sem vendas" e eles
// ficavam inflados. A zeragem segue respeitando a trava de periodo.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    noventaNoveSale: { findMany: vi.fn() },
    revenueEntry: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }
  }
}));
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import { assertPeriodWritableForDate } from "../../../../cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../../../../cmv-real/period-locked-error.js";
import { reflectSalesIntoRevenueEntries } from "../noventa-nove-real-sync.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const travada = vi.mocked(assertPeriodWritableForDate);
const loja = { id: "l1", companyId: "c1", nickname: "Loja fictícia" };
const idDoDia = (iso: string) => `nnfood-l1-${iso.replace(/-/g, "")}`;
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const ehDia = (d: Date, iso: string) => d.toISOString().slice(0, 10) === iso;

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
  db.noventaNoveSale.findMany.mockResolvedValue([]);
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.findMany.mockResolvedValue([]);
  db.revenueEntry.updateMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("99Food — mes inteiro sem venda faturada", () => {
  test("lancamentos antigos do mes sao zerados e nada novo e gravado", async () => {
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(r).toEqual({ count: 0, bloqueados: [] });
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({
      in: [idDoDia("2026-08-05"), idDoDia("2026-08-06")]
    });
  });

  test("nenhum id e preservado (notIn vazio) e o filtro continua restrito a loja, plataforma e mes", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    const where = db.revenueEntry.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ startsWith: "nnfood-l1-", notIn: [] });
    expect(where).toMatchObject({ sourcePlatform: "NOVENTA_NOVE", competenceYear: 2026, competenceMonth: 8, status: "ACTIVE" });
  });

  test("lancamento em periodo TRAVADO nao e zerado e e reportado", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-05")) throw new PeriodLockedError("fechamento mensal travado");
    });
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-06")] });
    expect(r.bloqueados).toEqual(["2026-08-05"]);
  });

  test("mes todo travado: nenhuma escrita", async () => {
    travada.mockRejectedValue(new PeriodLockedError("travado"));
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("erro de banco ao checar a trava sobe e nada e zerado", async () => {
    const falha = new Error("connection reset");
    travada.mockRejectedValue(falha);
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8)).rejects.toBe(falha);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("mes sem venda e sem lancamento nenhum: nao escreve nada", async () => {
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(r).toEqual({ count: 0, bloqueados: [] });
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("loja sem empresa vinculada continua sem consultar nem escrever", async () => {
    const r = await reflectSalesIntoRevenueEntries({ ...loja, companyId: null }, 2026, 8);
    expect(r).toEqual({ count: 0, bloqueados: [] });
    expect(db.noventaNoveSale.findMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.findMany).not.toHaveBeenCalled();
  });
});
