import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: { wasteEntryPhoto: { deleteMany: vi.fn() } } }));

import { prisma } from "../../../config/database.js";
import { expurgarFotosDeDesperdicio } from "../waste-photo-expurgo.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.wasteEntryPhoto.deleteMany.mockResolvedValue({ count: 3 });
});

describe("expurgarFotosDeDesperdicio", () => {
  test("apaga só as fotos com mais de 90 dias e devolve quantas saíram", async () => {
    const agora = new Date("2026-10-14T12:00:00Z");
    expect(await expurgarFotosDeDesperdicio(agora)).toBe(3);
    const limite = db.wasteEntryPhoto.deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(limite.toISOString()).toBe("2026-07-16T12:00:00.000Z");
  });

  test("apaga a foto, nunca o lançamento", async () => {
    await expurgarFotosDeDesperdicio();
    expect(Object.keys(db)).toEqual(["wasteEntryPhoto"]);
  });
});
