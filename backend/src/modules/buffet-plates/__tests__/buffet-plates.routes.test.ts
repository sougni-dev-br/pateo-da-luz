import type { Request } from "express";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Plaquinhas do buffet: catálogo bilíngue e listas do dia. Banco de mentira.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    buffetPlateItem: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    buffetPlateList: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
// Erro não tratado vira 500, como no app real.
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => { res.status(500).json({ message: "erro" }); });

const penne = { id: "i1", namePt: "Penne ao molho rosé", nameEn: "Penne in rosé sauce", category: "Massas", isActive: true };
const cafe = { id: "i2", namePt: "Café", nameEn: "Brewed coffee", category: "Bebidas", isActive: true };
const catalogo = [penne, cafe];
const lista = { id: "l1", name: "Coffee break", kind: "COFFEE_BREAK", eventDate: new Date("2026-10-10T00:00:00Z"), format: "tent", theme: "wine", items: [{ itemId: "i1", qty: 2 }, { itemId: "i2", qty: 1 }], updatedAt: new Date("2026-10-04T12:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Cozinha", email: "c@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.buffetPlateItem.findMany.mockImplementation(async ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
    where?.id ? catalogo.filter((c) => where.id!.in.includes(c.id)) : catalogo);
  db.buffetPlateItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => catalogo.find((c) => c.id === where.id) ?? null);
  db.buffetPlateItem.findFirst.mockImplementation(async ({ where }: { where: { namePt: { equals: string }; id?: { not: string } } }) =>
    catalogo.find((c) => c.namePt.toLowerCase() === where.namePt.equals.toLowerCase() && c.id !== where.id?.not) ?? null);
  db.buffetPlateItem.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data, isActive: true }));
  db.buffetPlateItem.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ ...catalogo.find((c) => c.id === where.id), ...data }));
  db.buffetPlateList.findMany.mockResolvedValue([lista]);
  db.buffetPlateList.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "l1" ? lista : null));
  db.buffetPlateList.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data, updatedAt: new Date() }));
  db.buffetPlateList.update.mockImplementation(async ({ data }: { data: object }) => ({ ...lista, ...data, updatedAt: new Date() }));
  db.buffetPlateList.delete.mockResolvedValue(lista);
});

const listaValida = { name: "Buffet de sexta", kind: "BUFFET", eventDate: "2026-10-09", format: "std", theme: "gold", items: [{ itemId: "i1", qty: 1 }] };

describe("catálogo", () => {
  test("prato novo sem inglês é recusado", async () => {
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "Bolo de fubá", nameEn: "  ", category: "Sobremesas" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/nameEn: nome em inglês obrigatório/);
    expect(db.buffetPlateItem.create).not.toHaveBeenCalled();
  });

  test("categoria fora da lista é recusada", async () => {
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "Bolo de fubá", nameEn: "Cornmeal cake", category: "Outros" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/categoria inválida/);
  });

  test("cria prato com espaços normalizados e registra auditoria", async () => {
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "  Bolo   de fubá ", nameEn: "Cornmeal  cake", category: "Sobremesas" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ namePt: "Bolo de fubá", nameEn: "Cornmeal cake", category: "Sobremesas" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_BUFFET_PLATE_ITEM" }));
  });

  test("nome repetido devolve mensagem clara em vez de erro 500", async () => {
    db.buffetPlateItem.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }));
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "Café", nameEn: "Coffee", category: "Bebidas" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Já existe um prato/);
  });

  test("nome igual com maiúsculas diferentes conta como repetido; editar o próprio prato não", async () => {
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "penne ao molho ROSÉ", nameEn: "Penne", category: "Massas" });
    expect(r.status).toBe(400);
    expect(db.buffetPlateItem.create).not.toHaveBeenCalled();
    const e = await request(app).put("/buffet-plates/items/i1").send({ namePt: "Penne ao molho rosé", nameEn: "Penne in pink sauce", category: "Massas" });
    expect(e.status).toBe(200);
  });

  test("excluir só inativa: listas antigas continuam apontando para o prato", async () => {
    const r = await request(app).delete("/buffet-plates/items/i1");
    expect(r.status).toBe(200);
    expect(db.buffetPlateItem.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { isActive: false } });
  });

  test("sem sessão não grava", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const r = await request(app).post("/buffet-plates/items").send({ namePt: "Café", nameEn: "Coffee", category: "Bebidas" });
    expect(r.status).toBe(401);
  });
});

describe("listas", () => {
  test("resumo conta pratos e plaquinhas", async () => {
    const r = await request(app).get("/buffet-plates/lists");
    expect(r.body[0]).toMatchObject({ id: "l1", itemCount: 2, plateCount: 3, eventDate: "2026-10-10" });
  });

  test("detalhe ignora prato que sumiu do banco", async () => {
    db.buffetPlateList.findUnique.mockResolvedValue({ ...lista, items: [...lista.items, { itemId: "fantasma", qty: 1 }] });
    const r = await request(app).get("/buffet-plates/lists/l1");
    expect(r.body.items).toEqual([{ itemId: "i1", qty: 2 }, { itemId: "i2", qty: 1 }]);
  });

  test("dado gravado estragado não derruba a leitura", async () => {
    db.buffetPlateList.findMany.mockResolvedValue([{ ...lista, items: [null, { itemId: "i1", qty: "x" }, "lixo"] }]);
    const r = await request(app).get("/buffet-plates/lists");
    expect(r.body[0]).toMatchObject({ itemCount: 1, plateCount: 1 });
  });

  test("salva lista válida com a data do evento", async () => {
    const r = await request(app).post("/buffet-plates/lists").send(listaValida);
    expect(r.status).toBe(201);
    const data = db.buffetPlateList.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Buffet de sexta", format: "std", theme: "gold", createdById: "u1" });
    expect(data.eventDate.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  test("o mesmo prato repetido vira uma linha com as quantidades somadas", async () => {
    const r = await request(app).post("/buffet-plates/lists").send({ ...listaValida, items: [{ itemId: "i1", qty: 2 }, { itemId: "i2", qty: 1 }, { itemId: "i1", qty: 3 }] });
    expect(r.status).toBe(201);
    expect(db.buffetPlateList.create.mock.calls[0][0].data.items).toEqual([{ itemId: "i1", qty: 5 }, { itemId: "i2", qty: 1 }]);
  });

  test("recusa prato que não existe no catálogo", async () => {
    const r = await request(app).post("/buffet-plates/lists").send({ ...listaValida, items: [{ itemId: "xx", qty: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/não existem mais no catálogo/);
  });

  test.each([
    [{ format: "a3" }, /format/],
    [{ items: [{ itemId: "i1", qty: 0 }] }, /quantidade mínima/],
    [{ items: [{ itemId: "i1", qty: 21 }] }, /quantidade máxima/],
    [{ eventDate: "10/10/2026" }, /data inválida/],
    [{ eventDate: "2026-02-31" }, /data inválida/],
    [{ eventDate: "2026-13-01" }, /data inválida/],
  ])("recusa entrada inválida %j", async (patch, msg) => {
    const r = await request(app).post("/buffet-plates/lists").send({ ...listaValida, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(msg);
  });

  test("atualizar lista inexistente devolve 404", async () => {
    const r = await request(app).put("/buffet-plates/lists/nao").send(listaValida);
    expect(r.status).toBe(404);
  });

  test("apagar lista registra auditoria", async () => {
    const r = await request(app).delete("/buffet-plates/lists/l1");
    expect(r.status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE_BUFFET_PLATE_LIST", entityId: "l1" }));
  });
});

// Sem a regra no menuFromRequest, o prefixo novo passaria sem checar permissão.
describe("controle de acesso", () => {
  const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {}, query: {} } as unknown as Request);
  test("rotas resolvem para o módulo Plaquinhas do buffet", async () => {
    expect(await ctx("GET", "/buffet-plates/items")).toEqual({ menuId: "buffet-plates", action: "view" });
    expect(await ctx("POST", "/buffet-plates/lists")).toEqual({ menuId: "buffet-plates", action: "create" });
    expect(await ctx("PUT", "/Buffet-Plates/lists/x/")).toEqual({ menuId: "buffet-plates", action: "edit" });
    expect(await ctx("DELETE", "/buffet-plates/items/x")).toEqual({ menuId: "buffet-plates", action: "delete" });
  });
});
