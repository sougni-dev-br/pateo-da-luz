import { beforeEach, describe, expect, test, vi } from "vitest";

// Mesma regra do sync do 99Food e do PDV: so a TRAVA faz o dia ser pulado. Qualquer outro erro
// sobe, para o passo "revenueEntries" aparecer como falha no resultado do sync em vez de o dia
// ficar sem gravar sob a etiqueta falsa "periodo fechado".
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    ifoodSale: { findMany: vi.fn() },
    revenueEntry: { upsert: vi.fn(), updateMany: vi.fn() }
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

const venda = (dia: string) => ({ orderDate: new Date(`${dia}T15:00:00.000Z`), grossAmount: 100, promotionAmount: 10 });
const ehDia = (d: Date, iso: string) => d.toISOString().slice(0, 10) === iso;

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
  db.ifoodSale.findMany.mockResolvedValue([venda("2026-08-19"), venda("2026-08-20")]);
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.updateMany.mockResolvedValue({ count: 0 });
});

describe("iFood — reflectSalesIntoRevenueEntries e a trava de periodo", () => {
  test("sem trava: grava os dois dias", async () => {
    const bloqueios: string[] = [];
    expect(await reflectSalesIntoRevenueEntries(loja, 2026, 8, bloqueios)).toBe(2);
    expect(bloqueios).toEqual([]);
    expect(db.revenueEntry.upsert).toHaveBeenCalledTimes(2);
  });

  test("dia em periodo TRAVADO de verdade: e pulado e reportado; o outro dia grava", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-19")) throw new PeriodLockedError("fechamento mensal de 08/2026 travado");
    });
    const bloqueios: string[] = [];
    expect(await reflectSalesIntoRevenueEntries(loja, 2026, 8, bloqueios)).toBe(1);
    expect(bloqueios).toEqual(["2026-08-19"]);
    expect(db.revenueEntry.upsert).toHaveBeenCalledTimes(1);
  });

  test("erro de banco NAO e trava: sobe com a causa original, nada gravado e nenhum dia 'bloqueado'", async () => {
    const falha = new Error("Can't reach database server");
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-20")) throw falha;
    });
    const bloqueios: string[] = [];
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8, bloqueios)).rejects.toBe(falha);
    expect(bloqueios).toEqual([]);
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("erro no PRIMEIRO dia tambem sobe", async () => {
    travada.mockRejectedValueOnce(new Error("timeout"));
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8, [])).rejects.toThrow("timeout");
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
  });

  test("trava num dia e erro em outro: o erro vence e nada e gravado", async () => {
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-19")) throw new PeriodLockedError("travado");
      throw new Error("connection reset");
    });
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8, [])).rejects.toThrow("connection reset");
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
  });

  test("loja sem empresa vinculada: nao consulta trava nem grava", async () => {
    expect(await reflectSalesIntoRevenueEntries({ ...loja, companyId: null }, 2026, 8, [])).toBe(0);
    expect(travada).not.toHaveBeenCalled();
  });
});
