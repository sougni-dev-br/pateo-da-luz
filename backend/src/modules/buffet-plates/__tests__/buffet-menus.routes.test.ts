import type { Request } from "express";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Cardápio do evento (display de acrílico, frente e verso). Banco de mentira.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    buffetMenuCard: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { resolvePermissionContext } from "../../security/menu-permissions.js";
import { buffetPlatesRouter } from "../buffet-plates.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/buffet-plates", buffetPlatesRouter);

const secao = { face: "front", titlePt: "Entradas", titleEn: "Starters", items: [{ namePt: "Saladinha do Pateo", nameEn: "Pateo side salad" }] };
const valido = { name: "Evento sexta", eventDate: "2026-10-09", theme: "wine", faceWidthMm: 92, faceHeightMm: 76, copies: 2, sections: [secao] };
const gravado = { id: "m1", ...valido, eventDate: new Date("2026-10-09T00:00:00Z"), updatedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Cozinha", email: "c@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.buffetMenuCard.findMany.mockResolvedValue([gravado]);
  db.buffetMenuCard.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "m1" ? gravado : null));
  db.buffetMenuCard.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data, updatedAt: new Date() }));
  db.buffetMenuCard.update.mockImplementation(async ({ data }: { data: object }) => ({ ...gravado, ...data, updatedAt: new Date() }));
  db.buffetMenuCard.delete.mockResolvedValue(gravado);
});

describe("cardápio do evento", () => {
  test("salva cardápio válido com a data e registra auditoria", async () => {
    const r = await request(app).post("/buffet-plates/menus").send(valido);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "Evento sexta", sectionCount: 1, itemCount: 1, eventDate: "2026-10-09", copies: 2 });
    expect(db.buffetMenuCard.create.mock.calls[0][0].data).toMatchObject({ createdById: "u1", faceWidthMm: 92 });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_BUFFET_MENU_CARD" }));
  });

  test("aceita até 30 seções", async () => {
    const r = await request(app).post("/buffet-plates/menus").send({ ...valido, sections: Array.from({ length: 30 }, () => secao) });
    expect(r.status).toBe(201);
  });

  test("sem dizer a distribuição, é o mesmo cardápio em todos os displays; um display por seção é aceito", async () => {
    await request(app).post("/buffet-plates/menus").send(valido);
    expect(db.buffetMenuCard.create.mock.calls[0][0].data.layout).toBe("same");
    const r = await request(app).post("/buffet-plates/menus").send({ ...valido, layout: "perSection" });
    expect(r.status).toBe(201);
    expect(r.body.layout).toBe("perSection");
    const porPrato = await request(app).post("/buffet-plates/menus").send({ ...valido, layout: "perItem" });
    expect(porPrato.body.layout).toBe("perItem");
  });

  test.each([
    ["prato sem inglês", { sections: [{ ...secao, items: [{ namePt: "Saladinha", nameEn: " " }] }] }, /prato em inglês obrigatório/],
    ["seção sem inglês", { sections: [{ ...secao, titleEn: "" }] }, /título da seção em inglês obrigatório/],
    ["seção vazia", { sections: [{ ...secao, items: [] }] }, /pelo menos um prato/],
    ["cardápio sem seção", { sections: [] }, /pelo menos uma seção/],
    ["face inválida", { sections: [{ ...secao, face: "lado" }] }, /face/],
    ["face pequena demais", { faceWidthMm: 20 }, /largura mínima/],
    ["face maior que a folha", { faceHeightMm: 400 }, /altura máxima/],
    ["displays demais", { copies: 50 }, /no máximo 20 displays/],
    ["distribuição desconhecida", { layout: "mosaico" }, /layout/],
    ["seções demais", { sections: Array.from({ length: 31 }, () => secao) }, /no máximo 30 seções/],
    ["data impossível", { eventDate: "2026-02-31" }, /data inválida/],
  ])("recusa %s", async (_nome, patch, msg) => {
    const r = await request(app).post("/buffet-plates/menus").send({ ...valido, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(msg);
    expect(db.buffetMenuCard.create).not.toHaveBeenCalled();
  });

  test("detalhe descarta seção estragada no banco em vez de quebrar", async () => {
    db.buffetMenuCard.findUnique.mockResolvedValue({ ...gravado, sections: [secao, { face: "front" }, "lixo"] });
    const r = await request(app).get("/buffet-plates/menus/m1");
    expect(r.status).toBe(200);
    expect(r.body.sections).toHaveLength(1);
  });

  test("atualizar e apagar inexistente devolvem 404", async () => {
    expect((await request(app).put("/buffet-plates/menus/nao").send(valido)).status).toBe(404);
    expect((await request(app).delete("/buffet-plates/menus/nao")).status).toBe(404);
  });

  test("sem sessão não grava", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).post("/buffet-plates/menus").send(valido)).status).toBe(401);
  });

  test("rotas do cardápio usam a permissão das plaquinhas", async () => {
    const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {}, query: {} } as unknown as Request);
    expect(await ctx("GET", "/buffet-plates/menus")).toEqual({ menuId: "buffet-plates", action: "view" });
    expect(await ctx("PUT", "/buffet-plates/menus/x")).toEqual({ menuId: "buffet-plates", action: "edit" });
    expect(await ctx("DELETE", "/buffet-plates/menus/x")).toEqual({ menuId: "buffet-plates", action: "delete" });
  });
});
