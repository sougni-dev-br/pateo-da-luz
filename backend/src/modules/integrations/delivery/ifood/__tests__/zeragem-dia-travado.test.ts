import { beforeEach, describe, expect, test, vi } from "vitest";

// Mesma regra do 99Food: a zeragem de "dia que perdeu todas as vendas" escreve no razao e por isso
// respeita a trava de periodo. Antes, dia TRAVADO com venda saia de byDate e era zerado, e dia
// travado sem venda era zerado sem consulta a trava.
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
const venda = (iso: string) => ({ orderDate: new Date(`${iso}T15:00:00.000Z`), grossAmount: 100, promotionAmount: 10 });
const travar = (...dias: string[]) =>
  travada.mockImplementation(async (d: Date) => {
    if (dias.some((x) => ehDia(d, x))) throw new PeriodLockedError("fechamento mensal travado");
  });

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
  db.ifoodSale.findMany.mockResolvedValue([venda("2026-08-19"), venda("2026-08-20")]);
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.findMany.mockResolvedValue([]);
  db.revenueEntry.updateMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("iFood — zeragem de dia sem venda e a trava de periodo", () => {
  test("dia TRAVADO que tem venda nao entra na zeragem (fica fora dos candidatos)", async () => {
    travar("2026-08-19");
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    const notIn: string[] = db.revenueEntry.findMany.mock.calls[0][0].where.id.notIn;
    expect(notIn).toContain(idDoDia("2026-08-19"));
    expect(notIn).toContain(idDoDia("2026-08-20"));
  });

  test("dia sem venda em periodo ABERTO: e zerado, e so ele", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = db.revenueEntry.updateMany.mock.calls[0][0];
    expect(where.id).toEqual({ in: [idDoDia("2026-08-05")] });
    expect(data).toMatchObject({ grossAmount: 0, netAmount: 0, tickets: 0 });
  });

  test("dia sem venda em periodo TRAVADO: nao e zerado e vai para os bloqueios; o aberto e zerado", async () => {
    travar("2026-08-05");
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const bloqueios: string[] = [];
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, bloqueios);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-06")] });
    expect(bloqueios).toContain("2026-08-05");
  });

  test("todos os candidatos travados: nenhuma escrita de zeragem", async () => {
    travar("2026-08-05", "2026-08-06");
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("erro de banco ao checar a trava de um candidato NAO e trava: sobe e nada e zerado", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    const falha = new Error("connection reset");
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-05")) throw falha;
    });
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8, [])).rejects.toBe(falha);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("sem candidatos: nao escreve nada", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("com o banco simulado: lancamento de dia TRAVADO com venda sobrevive; o sem venda aberto e zerado", async () => {
    travar("2026-08-19");
    const noBanco = [
      { id: idDoDia("2026-08-19"), date: dia("2026-08-19") }, // travado, com venda
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") } // aberto, sem venda
    ];
    // simula o filtro notIn que o banco aplicaria
    db.revenueEntry.findMany.mockImplementation(async ({ where }: { where: { id: { notIn: string[] } } }) =>
      noBanco.filter((e) => !where.id.notIn.includes(e.id))
    );
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-05")] });
  });

  test("o update por id mantem os filtros de plataforma, status e valor diferente de zero", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    const { where } = db.revenueEntry.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ sourcePlatform: "IFOOD", status: "ACTIVE" });
    expect(where.OR).toHaveLength(3);
  });

  test("o filtro dos candidatos continua restrito a loja, a plataforma e ao mes", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8, []);
    const where = db.revenueEntry.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ sourcePlatform: "IFOOD", competenceYear: 2026, competenceMonth: 8, status: "ACTIVE" });
    expect(where.id.startsWith).toBe("ifood-l1-");
  });
});
