import { beforeEach, describe, expect, test, vi } from "vitest";

// O sync do iFood APAGA as vendas do mes e recria a partir da API. Um mes "sem venda" so e verdade
// quando esse passo terminou sem erro; se ele falhou (ou a API devolveu erro), o vazio nao prova
// nada e zerar o faturamento do mes inteiro seria destruir receita. Por isso a zeragem do mes
// vazio so roda quando o chamador confirma que as vendas foram atualizadas neste sync.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    ifoodSale: { findMany: vi.fn() },
    revenueEntry: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }
  }
}));
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import { assertPeriodWritableForDate } from "../../../../cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../../../../cmv-real/period-locked-error.js";
import { reflectSalesIntoRevenueEntries } from "../ifood-real-sync.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const travada = vi.mocked(assertPeriodWritableForDate);
const loja = { id: "l1", companyId: "c1", nickname: "Loja fictícia" };
const idDoDia = (iso: string) => `ifood-l1-${iso.replace(/-/g, "")}`;
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const ehDia = (d: Date, iso: string) => d.toISOString().slice(0, 10) === iso;

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
  db.ifoodSale.findMany.mockResolvedValue([]);
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.findMany.mockResolvedValue([]);
  db.revenueEntry.updateMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("iFood — mes inteiro sem venda", () => {
  test("vendas confirmadas como atualizadas: lancamentos antigos do mes sao zerados", async () => {
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8, [], true);
    expect(r).toBe(0);
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({
      in: [idDoDia("2026-08-05"), idDoDia("2026-08-06")]
    });
  });

  test("SEM confirmacao (passo de vendas falhou): nao consulta nem escreve nada", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    expect(r).toBe(0);
    expect(db.revenueEntry.findMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("confirmacao explicitamente falsa tambem nao zera", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, [], false);
    expect(db.revenueEntry.findMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("nenhum id e preservado (notIn vazio) e o filtro continua restrito a loja, plataforma e mes", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, [], true);
    const where = db.revenueEntry.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ startsWith: "ifood-l1-", notIn: [] });
    expect(where).toMatchObject({ sourcePlatform: "IFOOD", competenceYear: 2026, competenceMonth: 8, status: "ACTIVE" });
  });

  test("lancamento em periodo TRAVADO nao e zerado e vai para os bloqueios", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-05")) throw new PeriodLockedError("fechamento mensal travado");
    });
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const bloqueios: string[] = [];
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, bloqueios, true);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-06")] });
    expect(bloqueios).toEqual(["2026-08-05"]);
  });

  test("erro de banco ao checar a trava sobe e nada e zerado", async () => {
    const falha = new Error("connection reset");
    travada.mockRejectedValue(falha);
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8, [], true)).rejects.toBe(falha);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("loja sem empresa vinculada continua sem consultar nem escrever", async () => {
    const r = await reflectSalesIntoRevenueEntries({ ...loja, companyId: null }, 2026, 8, [], true);
    expect(r).toBe(0);
    expect(db.ifoodSale.findMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.findMany).not.toHaveBeenCalled();
  });

  test("mes COM venda continua gravando normalmente, com ou sem confirmacao", async () => {
    db.ifoodSale.findMany.mockResolvedValue([{ orderDate: new Date("2026-08-19T15:00:00.000Z"), grossAmount: 100, promotionAmount: 10 }]);
    expect(await reflectSalesIntoRevenueEntries(loja, 2026, 8, [])).toBe(1);
    expect(await reflectSalesIntoRevenueEntries(loja, 2026, 8, [], true)).toBe(1);
  });
});
