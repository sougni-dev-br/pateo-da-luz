import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    wasteEntry: { findUnique: vi.fn() },
    wasteEntryPhoto: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
  },
}));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1") }));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { wastePhotoRouter } from "../waste-photo.routes.js";
import { FOTO_ESPACO_MAXIMO, FOTO_TAMANHO_MAXIMO } from "../waste-photo.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/waste", wastePhotoRouter);

const jpeg = (tamanho = 1000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(tamanho, 1), Buffer.from([0xff, 0xd9])]);
const entrada = (extra: Record<string, unknown> = {}) => ({ id: "w1", registeredById: "u1", cancelledAt: null, photo: null, ...extra });
const enviar = (conteudo: Buffer, id = "w1") => request(app).post(`/waste/${id}/photo`).attach("photo", conteudo, { filename: "foto.jpg", contentType: "image/jpeg" });

let ehGestao = false;
beforeEach(() => {
  vi.clearAllMocks();
  ehGestao = false;
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "ESTOQUISTA" } as never);
  vi.mocked(userHasPermission).mockImplementation(async () => ehGestao);
  db.wasteEntry.findUnique.mockResolvedValue(entrada());
  db.wasteEntryPhoto.create.mockResolvedValue({});
  db.wasteEntryPhoto.aggregate.mockResolvedValue({ _sum: { size: 0 } });
  db.wasteEntryPhoto.deleteMany.mockResolvedValue({ count: 0 });
});

describe("POST /:id/photo", () => {
  test("quem lançou anexa a foto e fica auditado", async () => {
    const r = await enviar(jpeg());
    expect(r.status).toBe(201);
    const data = db.wasteEntryPhoto.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ entryId: "w1", mimeType: "image/jpeg", size: 1006 });
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "ADD_WASTE_PHOTO", entityId: "w1" }));
  });

  test("recusa o que não é JPEG, mesmo declarado como imagem", async () => {
    const r = await request(app).post("/waste/w1/photo").attach("photo", Buffer.from("<html>oi</html>"), { filename: "foto.jpg", contentType: "image/jpeg" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/JPEG/);
    expect(db.wasteEntryPhoto.create).not.toHaveBeenCalled();
  });

  test("foto acima do limite devolve 413 com a mensagem de tamanho, não 500", async () => {
    const r = await enviar(jpeg(FOTO_TAMANHO_MAXIMO + 10));
    expect(r.status).toBe(413);
    expect(r.body.message).toMatch(/300 KB/);
    expect(db.wasteEntryPhoto.create).not.toHaveBeenCalled();
  });

  test("espaço total de fotos esgotado devolve 507 e não grava", async () => {
    db.wasteEntryPhoto.aggregate.mockResolvedValue({ _sum: { size: FOTO_ESPACO_MAXIMO - 500 } });
    const r = await enviar(jpeg());
    expect(r.status).toBe(507);
    expect(r.body.message).toMatch(/espaço/i);
    expect(db.wasteEntryPhoto.create).not.toHaveBeenCalled();
  });

  test("perto do teto, apaga as vencidas antes de recusar e então aceita", async () => {
    db.wasteEntryPhoto.aggregate
      .mockResolvedValueOnce({ _sum: { size: FOTO_ESPACO_MAXIMO - 500 } })
      .mockResolvedValueOnce({ _sum: { size: 1000 } });
    db.wasteEntryPhoto.deleteMany.mockResolvedValue({ count: 40 });
    const r = await enviar(jpeg());
    expect(r.status).toBe(201);
    expect(db.wasteEntryPhoto.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
  });

  test("corpo declarado muito maior que a foto nem chega ao multer", async () => {
    const r = await request(app).post("/waste/w1/photo").set("Content-Length", String(5 * 1024 * 1024)).send("x");
    expect([413, 400]).toContain(r.status);
    expect(db.wasteEntryPhoto.create).not.toHaveBeenCalled();
  });

  test("sem sessão nem o multer é acionado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const r = await enviar(jpeg());
    expect(r.status).toBe(401);
    expect(db.wasteEntry.findUnique).not.toHaveBeenCalled();
  });

  test("sem arquivo", async () => {
    const r = await request(app).post("/waste/w1/photo").send({});
    expect(r.status).toBe(400);
  });

  test("outra pessoa não anexa em lançamento alheio, a gestão sim", async () => {
    db.wasteEntry.findUnique.mockResolvedValue(entrada({ registeredById: "u2" }));
    expect((await enviar(jpeg())).status).toBe(403);
    ehGestao = true;
    expect((await enviar(jpeg())).status).toBe(201);
  });

  test("lançamento inexistente, cancelado ou que já tem foto", async () => {
    db.wasteEntry.findUnique.mockResolvedValue(null);
    expect((await enviar(jpeg())).status).toBe(404);
    db.wasteEntry.findUnique.mockResolvedValue(entrada({ cancelledAt: new Date() }));
    expect((await enviar(jpeg())).status).toBe(409);
    db.wasteEntry.findUnique.mockResolvedValue(entrada({ photo: { id: "f1" } }));
    expect((await enviar(jpeg())).status).toBe(409);
  });

  test("duas fotos ao mesmo tempo: a segunda cai na unicidade e vira 409", async () => {
    db.wasteEntryPhoto.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }));
    expect((await enviar(jpeg())).status).toBe(409);
  });

  test("sem sessão devolve 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await enviar(jpeg())).status).toBe(401);
  });
});

describe("GET e DELETE /:id/photo", () => {
  test("entrega a imagem sem deixar o navegador reinterpretar o tipo", async () => {
    db.wasteEntryPhoto.findUnique.mockResolvedValue({ mimeType: "image/jpeg", content: jpeg(), sha256: "abc" });
    const r = await request(app).get("/waste/w1/photo");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("private, no-cache");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  });

  test("sem foto é 404", async () => {
    db.wasteEntryPhoto.findUnique.mockResolvedValue(null);
    expect((await request(app).get("/waste/w1/photo")).status).toBe(404);
  });

  test("apagar remove e audita; sem foto é 404", async () => {
    db.wasteEntryPhoto.deleteMany.mockResolvedValue({ count: 1 });
    expect((await request(app).delete("/waste/w1/photo")).status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE_WASTE_PHOTO" }));
    db.wasteEntryPhoto.deleteMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete("/waste/w1/photo")).status).toBe(404);
  });
});
