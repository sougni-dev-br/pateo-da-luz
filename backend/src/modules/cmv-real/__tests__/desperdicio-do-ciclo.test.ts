import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { wasteEntry: { findMany: vi.fn() }, inventorySector: { findMany: vi.fn() } },
}));
vi.mock("../cmv-real.service.js", () => ({
  closeCmvPeriod: vi.fn(), deleteCmvPeriod: vi.fn(), getCmvPeriod: vi.fn(), getCmvPeriodPdf: vi.fn(), getCmvRealSuggestions: vi.fn(),
  listCmvBases: vi.fn(), listCmvPeriods: vi.fn(), listCmvSessions: vi.fn(), recalculateCmvPeriod: vi.fn(), reopenCmvPeriod: vi.fn(), saveCmvPeriod: vi.fn(),
}));
vi.mock("../../security/security-utils.js", () => ({
  auditLog: vi.fn(), requestIp: vi.fn(), requireAdmin: vi.fn(), requireRole: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { getCmvPeriod } from "../cmv-real.service.js";
import { requireRole } from "../../security/security-utils.js";
import { cmvRealRouter } from "../cmv-real.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/monthly/cmv-real", cmvRealRouter);

const entrada = (extra: Record<string, unknown>) => ({ productId: "p1", reason: "SPOILED", sectorId: null, totalCost: 100, product: { name: "Salmão" }, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1" } as never);
  vi.mocked(getCmvPeriod).mockResolvedValue({ dataInicial: new Date("2026-09-01T00:00:00Z"), dataFinal: new Date("2026-09-30T00:00:00Z"), cmvReal: 10000 } as never);
  db.inventorySector.findMany.mockResolvedValue([]);
});

describe("GET /:id/desperdicio", () => {
  test("usa a janela do ciclo (depois da contagem inicial, até a final) e calcula o percentual do CMV", async () => {
    db.wasteEntry.findMany.mockResolvedValue([entrada({}), entrada({ reason: "EXPIRED", totalCost: 200 }), entrada({ totalCost: null })]);
    const r = await request(app).get("/monthly/cmv-real/c1/desperdicio");

    expect(r.status).toBe(200);
    const where = db.wasteEntry.findMany.mock.calls[0][0].where;
    expect(where.cancelledAt).toBeNull();
    expect(where.occurredOn.gte.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(where.occurredOn.lte.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(r.body.total).toEqual({ lancamentos: 3, valor: 300, semCusto: 1 });
    expect(r.body.percentualDoCmv).toBe(3);
    expect(r.body.porMotivo[0]).toMatchObject({ chave: "EXPIRED", valor: 200 });
  });

  test("usa o CMV que a tela mostra (ao vivo se aberto), não a coluna gravada que fica velha", async () => {
    // CMV ao vivo R$ 50.000; desperdício R$ 300 => 0,6%, e não 3% (que sairia dos R$ 10.000 antigos).
    vi.mocked(getCmvPeriod).mockResolvedValue({ dataInicial: new Date("2026-09-01T00:00:00Z"), dataFinal: new Date("2026-09-30T00:00:00Z"), cmvReal: 50000 } as never);
    db.wasteEntry.findMany.mockResolvedValue([entrada({}), entrada({ reason: "EXPIRED", totalCost: 200 })]);
    const r = await request(app).get("/monthly/cmv-real/c1/desperdicio");
    expect(r.body.percentualDoCmv).toBe(0.6);
  });

  test("sem desperdício no ciclo não inventa percentual", async () => {
    db.wasteEntry.findMany.mockResolvedValue([]);
    const r = await request(app).get("/monthly/cmv-real/c1/desperdicio");
    expect(r.body.total).toEqual({ lancamentos: 0, valor: 0, semCusto: 0 });
    expect(r.body.percentualDoCmv).toBeNull();
  });

  test("apuração inexistente é 404 e sem permissão não consulta nada", async () => {
    vi.mocked(getCmvPeriod).mockRejectedValueOnce(new Error("nao existe"));
    expect((await request(app).get("/monthly/cmv-real/x/desperdicio")).status).toBe(404);

    vi.mocked(requireRole).mockImplementationOnce(async (_req, res) => { (res as { status: (n: number) => { json: (b: unknown) => void } }).status(403).json({}); return null as never; });
    expect((await request(app).get("/monthly/cmv-real/c1/desperdicio")).status).toBe(403);
    expect(getCmvPeriod).toHaveBeenCalledTimes(1);
  });
});
