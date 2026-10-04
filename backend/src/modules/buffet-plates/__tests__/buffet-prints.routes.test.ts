import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    buffetPlateItem: { findMany: vi.fn() },
    buffetPlatePrint: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { resolvePermissionContext } from "../../security/menu-permissions.js";
import { buffetPrintsRouter, todayInSaoPaulo } from "../buffet-prints.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/buffet-plates", buffetPrintsRouter);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1" } as never);
  db.buffetPlateItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => id !== "sumiu").map((id) => ({ id })));
  db.buffetPlatePrint.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data, createdAt: new Date() }));
});

const impressao = { servedOn: todayInSaoPaulo(), kind: "BUFFET", listId: "l1", listName: "Buffet de sexta", itemIds: ["i1", "i2", "i1", "sumiu"] };

describe("impressões de plaquinhas", () => {
  test("registra os pratos do dia sem repetir e sem prato que não existe", async () => {
    const r = await request(app).post("/buffet-plates/prints").send(impressao);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ servedOn: todayInSaoPaulo(), itemCount: 2 });
    const data = db.buffetPlatePrint.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "BUFFET", listId: "l1", listName: "Buffet de sexta", itemIds: ["i1", "i2"], createdById: "u1" });
    expect(data.servedOn.toISOString()).toBe(`${todayInSaoPaulo()}T00:00:00.000Z`);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "REGISTER_BUFFET_PLATE_PRINT" }));
  });

  test.each([
    [{ servedOn: "2026-02-31" }, /data inválida/],
    [{ kind: "JANTAR" }, /kind/],
    [{ itemIds: [] }, /nenhum prato/],
    [{ servedOn: "2062-10-09" }, /fora do intervalo/],
    [{ servedOn: "2002-10-09" }, /fora do intervalo/],
  ])("recusa entrada inválida %j", async (patch, msg) => {
    const r = await request(app).post("/buffet-plates/prints").send({ ...impressao, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(msg);
  });

  test("sem sessão não grava", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).post("/buffet-plates/prints").send(impressao)).status).toBe(401);
    expect(db.buffetPlatePrint.create).not.toHaveBeenCalled();
  });

  test("apagar um registro errado fica na auditoria", async () => {
    db.buffetPlatePrint.findUnique.mockResolvedValue({ id: "p1" });
    expect((await request(app).delete("/buffet-plates/prints/p1")).status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE_BUFFET_PLATE_PRINT", entityId: "p1" }));
    db.buffetPlatePrint.findUnique.mockResolvedValue(null);
    expect((await request(app).delete("/buffet-plates/prints/nao")).status).toBe(404);
  });

  test("o acompanhamento lê só o tipo pedido e devolve o relatório", async () => {
    db.buffetPlatePrint.findMany.mockResolvedValue([{ servedOn: new Date(`${todayInSaoPaulo()}T00:00:00Z`), itemIds: ["i1"] }]);
    const r = await request(app).get("/buffet-plates/usage?kind=COFFEE_BREAK&days=7");
    expect(r.status).toBe(200);
    expect(db.buffetPlatePrint.findMany.mock.calls[0][0].where.kind).toBe("COFFEE_BREAK");
    expect(r.body.period).toMatchObject({ windowDays: 7, servedDays: 1 });
    expect(r.body.ranking[0]).toMatchObject({ itemId: "i1", days: 1 });
  });

  test("o dia é o de São Paulo, não o do servidor em UTC", () => {
    expect(todayInSaoPaulo(new Date("2026-10-10T01:30:00Z"))).toBe("2026-10-09");
  });

  test("rotas resolvem para o módulo Plaquinhas do buffet", async () => {
    const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {}, query: {} } as never);
    expect(await ctx("POST", "/buffet-plates/prints")).toEqual({ menuId: "buffet-plates", action: "create" });
    expect(await ctx("GET", "/buffet-plates/usage")).toEqual({ menuId: "buffet-plates", action: "view" });
    expect(await ctx("DELETE", "/buffet-plates/prints/p1")).toEqual({ menuId: "buffet-plates", action: "delete" });
  });
});
