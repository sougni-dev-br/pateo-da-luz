import { describe, expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buffetCobradoPorData, realizadoPorData } from "../eventos.service.js";

// O que aconteceu no dia: PDV quando existe, histórico da planilha antes dele, sempre sem os 10%.
// Valores fictícios: o repositório é público.
function bancoCom(pdv: unknown[], legado: unknown[]) {
  const revenueEntry = { findMany: vi.fn().mockResolvedValue(pdv) };
  const operationDay = { findMany: vi.fn().mockResolvedValue(legado) };
  return { prisma: { revenueEntry, operationDay } as unknown as PrismaClient, revenueEntry };
}

const meioDia = (d: string) => new Date(`${d}T12:00:00Z`);

describe("realizado do dia", () => {
  test("o último dia do intervalo entra, mesmo gravado ao meio-dia", async () => {
    const { prisma, revenueEntry } = bancoCom([], []);
    await realizadoPorData(prisma, "2030-03-04", "2030-03-06");
    const filtro = revenueEntry.findMany.mock.calls[0][0].where.date;
    expect(filtro.lt.toISOString()).toBe("2030-03-07T00:00:00.000Z");
    expect(filtro.gte.toISOString()).toBe("2030-03-04T00:00:00.000Z");
  });

  test("tira os 10% de cada turno e o PDV ganha do histórico na mesma data", async () => {
    const { prisma } = bancoCom(
      [{ date: meioDia("2030-03-05"), peopleFirstShift: 100, salesFirstShift: 11000, shift1Service: 1000, peopleSecondShift: 20, salesSecondShift: 2200, shift2Service: 200 }],
      [{ date: new Date("2030-03-05T00:00:00Z"), legacyLunchPeople: 90, legacyLunchSales: 9000, legacyDinnerPeople: 15, legacyDinnerSales: 1500 },
        { date: new Date("2029-03-05T00:00:00Z"), legacyLunchPeople: 120, legacyLunchSales: 12000, legacyDinnerPeople: 30, legacyDinnerSales: 2400 }],
    );
    const r = await realizadoPorData(prisma);
    expect(r.get("2030-03-05")).toEqual({ fonte: "PDV", almocos: 100, valorAlmoco: 10000, jantares: 20, valorJantar: 2000 });
    expect(r.get("2029-03-05")).toMatchObject({ fonte: "PLANILHA", almocos: 120, valorAlmoco: 12000 });
  });

  test("lançamento sem número de pessoas não vira zero almoços", async () => {
    const { prisma } = bancoCom(
      [{ date: meioDia("2030-03-05"), peopleFirstShift: null, salesFirstShift: 5000, shift1Service: 0, peopleSecondShift: null, salesSecondShift: 0, shift2Service: 0 }],
      [],
    );
    expect((await realizadoPorData(prisma)).has("2030-03-05")).toBe(false);
  });
});

describe("buffet cobrado no dia (PDV)", () => {
  function bancoComItens(itens: unknown[]) {
    const agileSaleItem = { findMany: vi.fn().mockResolvedValue(itens) };
    return { prisma: { agileSaleItem } as unknown as PrismaClient, agileSaleItem };
  }
  const item = (d: string, produto: string, quantidade: number, total: number) =>
    ({ movementDate: meioDia(d), productName: produto, quantity: quantidade, totalAmount: total });

  test("o preço do dia é o do buffet que mais vendeu; os outros ficam listados", async () => {
    const { prisma, agileSaleItem } = bancoComItens([
      item("2030-03-05", "BUFFET PROMO", 1, 90),
      item("2030-03-05", "BUFFET PROMO", 2, 180),
      item("2030-03-05", "BUFFET GRUPO", 1, 80),
      item("2030-03-06", "BUFFET PROMO", 1, 85),
    ]);
    const r = await buffetCobradoPorData(prisma, "2030-03-05", "2030-03-06");
    expect(r.get("2030-03-05")).toEqual({
      principal: { produto: "BUFFET PROMO", preco: 90, vendidos: 3 },
      outros: [{ produto: "BUFFET GRUPO", preco: 80, vendidos: 1 }],
    });
    expect(r.get("2030-03-06")?.principal.preco).toBe(85);
    // Só venda recebida, só produto de buffet, e o último dia do intervalo entra.
    const where = agileSaleItem.findMany.mock.calls[0][0].where;
    expect(where.saleStatus).toBe("RECEBIDA");
    expect(where.productName).toEqual({ startsWith: "BUFFET", mode: "insensitive" });
    expect(where.movementDate.lt.toISOString()).toBe("2030-03-07T00:00:00.000Z");
  });

  test("troca de preço no meio do dia aparece como dois preços do mesmo buffet", async () => {
    const { prisma } = bancoComItens([item("2030-03-05", "BUFFET PROMO", 5, 450), item("2030-03-05", "BUFFET PROMO", 2, 170)]);
    const r = (await buffetCobradoPorData(prisma)).get("2030-03-05")!;
    expect(r.principal).toEqual({ produto: "BUFFET PROMO", preco: 90, vendidos: 5 });
    expect(r.outros).toEqual([{ produto: "BUFFET PROMO", preco: 85, vendidos: 2 }]);
  });

  test("dia sem buffet vendido (só à la carte) não tem preço", async () => {
    const { prisma } = bancoComItens([]);
    expect((await buffetCobradoPorData(prisma)).size).toBe(0);
  });
});
