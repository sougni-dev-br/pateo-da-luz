import { beforeEach, describe, expect, test, vi } from "vitest";

// A zeragem de "dia que perdeu todas as vendas" tambem escreve no razao, entao tem que respeitar a
// trava de periodo como o upsert respeita. Antes: (1) um dia TRAVADO que tinha venda saia de
// byDate e caia no "notIn" da zeragem, sendo zerado; (2) um dia travado SEM venda era zerado sem
// consulta nenhuma a trava.
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
const venda = (iso: string) => ({ orderDate: new Date(`${iso}T15:00:00.000Z`), grossAmount: 100, promotionAmount: 10, netAmount: 80, channel: "DELIVERY" });
const travar = (...dias: string[]) =>
  travada.mockImplementation(async (d: Date) => {
    if (dias.some((x) => ehDia(d, x))) throw new PeriodLockedError("fechamento mensal travado");
  });

beforeEach(() => {
  vi.clearAllMocks();
  travada.mockResolvedValue(undefined);
  db.noventaNoveSale.findMany.mockResolvedValue([venda("2026-08-19"), venda("2026-08-20")]);
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.findMany.mockResolvedValue([]);
  db.revenueEntry.updateMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("99Food — zeragem de dia sem venda e a trava de periodo", () => {
  test("dia TRAVADO que tem venda nao entra na zeragem (fica fora dos candidatos)", async () => {
    travar("2026-08-19");
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    const notIn: string[] = db.revenueEntry.findMany.mock.calls[0][0].where.id.notIn;
    expect(notIn).toContain(idDoDia("2026-08-19")); // travado, com venda: preservado
    expect(notIn).toContain(idDoDia("2026-08-20")); // aberto, com venda: gravado
  });

  test("dia sem venda em periodo ABERTO: e zerado, e so ele", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = db.revenueEntry.updateMany.mock.calls[0][0];
    expect(where.id).toEqual({ in: [idDoDia("2026-08-05")] });
    expect(data).toMatchObject({ grossAmount: 0, netAmount: 0, tickets: 0 });
  });

  test("dia sem venda em periodo TRAVADO: nao e zerado e e reportado; o aberto e zerado", async () => {
    travar("2026-08-05");
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    const r = await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-06")] });
    expect(r.bloqueados).toContain("2026-08-05");
  });

  test("todos os candidatos travados: nenhuma escrita de zeragem", async () => {
    travar("2026-08-05", "2026-08-06");
    db.revenueEntry.findMany.mockResolvedValue([
      { id: idDoDia("2026-08-05"), date: dia("2026-08-05") },
      { id: idDoDia("2026-08-06"), date: dia("2026-08-06") }
    ]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("a zeragem consulta a trava com a data do proprio lancamento", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    const datas = travada.mock.calls.map((c) => (c[0] as Date).toISOString().slice(0, 10));
    expect(datas).toContain("2026-08-05");
  });

  test("erro de banco ao checar a trava de um candidato NAO e trava: sobe e nada e zerado", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    const falha = new Error("connection reset");
    travada.mockImplementation(async (d: Date) => {
      if (ehDia(d, "2026-08-05")) throw falha;
    });
    await expect(reflectSalesIntoRevenueEntries(loja, 2026, 8)).rejects.toBe(falha);
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
  });

  test("sem candidatos: nao escreve nada", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
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
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: [idDoDia("2026-08-05")] });
  });

  test("o update por id mantem os filtros de plataforma, status e valor diferente de zero", async () => {
    db.revenueEntry.findMany.mockResolvedValue([{ id: idDoDia("2026-08-05"), date: dia("2026-08-05") }]);
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    const { where } = db.revenueEntry.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ sourcePlatform: "NOVENTA_NOVE", status: "ACTIVE" });
    expect(where.OR).toHaveLength(3);
  });

  test("o filtro dos candidatos continua restrito a loja, a plataforma e ao mes", async () => {
    await reflectSalesIntoRevenueEntries(loja, 2026, 8);
    const where = db.revenueEntry.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ sourcePlatform: "NOVENTA_NOVE", competenceYear: 2026, competenceMonth: 8, status: "ACTIVE" });
    expect(where.id.startsWith).toBe("nnfood-l1-");
  });
});
