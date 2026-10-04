import { describe, expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { realizadoPorData } from "../eventos.service.js";

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
