import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    planejamentoComentario: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn()
  }
}));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1") }));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { planejamentoComentariosRouter } from "../planejamento-comentarios.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/planning/comentarios", planejamentoComentariosRouter);

const corpo = { anoBase: 2025, anoComparado: 2026, mes: 3, metrica: "VENDAS", turno: "TOTAL", texto: "Feriado prolongado." };
const lido = new Date("2026-11-20T10:00:00.000Z");
const gravado = (extra: Record<string, unknown> = {}) => ({
  id: "c1", contexto: "COMPARATIVO", ...corpo, naImpressao: true, autorId: "u1", autorNome: "Maria Teste",
  editadoEm: null, createdAt: lido, updatedAt: lido, ...extra
});

let ehAdmin = false;
beforeEach(() => {
  vi.clearAllMocks();
  ehAdmin = false;
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Maria Teste", role: "ESTOQUISTA" } as never);
  vi.mocked(userHasPermission).mockImplementation(async () => ehAdmin);
  vi.mocked(auditLog).mockResolvedValue(undefined as never);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.$queryRaw.mockResolvedValue([]);
  db.planejamentoComentario.count.mockResolvedValue(0);
  db.planejamentoComentario.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => gravado(data));
});

describe("GET /planning/comentarios", () => {
  test("exige sessão", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/planning/comentarios?anoComparado=2026")).status).toBe(401);
  });

  test("devolve todos do ano comparado, sem restringir pelo ano-base, com flags de poder", async () => {
    db.planejamentoComentario.findMany.mockResolvedValue([gravado(), gravado({ id: "c2", autorId: "u2" })]);
    const r = await request(app).get("/planning/comentarios?anoComparado=2026&anoBase=2024");
    expect(r.status).toBe(200);
    expect(db.planejamentoComentario.findMany.mock.calls[0][0].where).toEqual({ contexto: "COMPARATIVO", anoComparado: 2026 });
    expect(r.body.comentarios.map((c: { podeEditar: boolean; podeApagar: boolean }) => [c.podeEditar, c.podeApagar])).toEqual([[true, true], [false, false]]);
  });

  test("admin do módulo pode apagar os de outros, mas não editar", async () => {
    ehAdmin = true;
    db.planejamentoComentario.findMany.mockResolvedValue([gravado({ autorId: "u2" })]);
    const r = await request(app).get("/planning/comentarios?anoComparado=2026");
    expect(r.body.comentarios[0]).toMatchObject({ podeEditar: false, podeApagar: true });
  });

  test("ano comparado inválido → 400", async () => {
    expect((await request(app).get("/planning/comentarios?anoComparado=1999")).status).toBe(400);
    expect((await request(app).get("/planning/comentarios")).status).toBe(400);
  });
});

describe("POST /planning/comentarios", () => {
  test("grava com o autor da sessão e ignora autorId do corpo", async () => {
    const r = await request(app).post("/planning/comentarios").send({ ...corpo, autorId: "invasor", autorNome: "Invasor" });
    expect(r.status).toBe(201);
    expect(db.planejamentoComentario.create.mock.calls[0][0].data).toMatchObject({ autorId: "u1", autorNome: "Maria Teste", naImpressao: true });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_PLANNING_COMMENT", entity: "PlanejamentoComentario" }));
  });

  test("corpo inválido → 400 sem gravar", async () => {
    const r = await request(app).post("/planning/comentarios").send({ ...corpo, texto: "   " });
    expect(r.status).toBe(400);
    expect(db.planejamentoComentario.create).not.toHaveBeenCalled();
  });

  test("20 comentários no ponto → 409 com mensagem clara", async () => {
    db.planejamentoComentario.count.mockResolvedValueOnce(50).mockResolvedValueOnce(20);
    const r = await request(app).post("/planning/comentarios").send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/20 comentários/);
    expect(db.planejamentoComentario.create).not.toHaveBeenCalled();
  });

  test("300 comentários no ano comparado → 409", async () => {
    db.planejamentoComentario.count.mockResolvedValueOnce(300);
    const r = await request(app).post("/planning/comentarios").send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/300 comentários/);
  });

  test("falha na auditoria não vira 500", async () => {
    vi.mocked(auditLog).mockRejectedValue(new Error("auditoria fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request(app).post("/planning/comentarios").send(corpo)).status).toBe(201);
  });
});

describe("PATCH /planning/comentarios/:id", () => {
  const edicao = { texto: "Texto novo", atualizadoEm: lido.toISOString() };

  test("autor edita: grava editadoEm e audita antes/depois", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    db.planejamentoComentario.updateMany.mockResolvedValue({ count: 1 });
    db.planejamentoComentario.findUniqueOrThrow.mockResolvedValue(gravado({ texto: "Texto novo" }));
    const r = await request(app).patch("/planning/comentarios/c1").send(edicao);
    expect(r.status).toBe(200);
    const args = db.planejamentoComentario.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "c1", autorId: "u1", updatedAt: lido });
    expect(args.data.editadoEm).toBeInstanceOf(Date);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE_PLANNING_COMMENT" }));
  });

  test("não-autor → 403, mesmo sendo admin", async () => {
    ehAdmin = true;
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ autorId: "u2" }));
    expect((await request(app).patch("/planning/comentarios/c1").send(edicao)).status).toBe(403);
    expect(db.planejamentoComentario.updateMany).not.toHaveBeenCalled();
  });

  test("atualizadoEm velho → 409", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    db.planejamentoComentario.updateMany.mockResolvedValue({ count: 0 });
    const r = await request(app).patch("/planning/comentarios/c1").send(edicao);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/mudou/);
  });

  test("sumiu entre a leitura e a gravação → 404", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(gravado()).mockResolvedValueOnce(null);
    db.planejamentoComentario.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).patch("/planning/comentarios/c1").send(edicao)).status).toBe(404);
  });

  test("inexistente → 404 e corpo inválido → 400", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(null);
    expect((await request(app).patch("/planning/comentarios/x").send(edicao)).status).toBe(404);
    expect((await request(app).patch("/planning/comentarios/x").send({ atualizadoEm: lido.toISOString() })).status).toBe(400);
  });
});

describe("DELETE /planning/comentarios/:id", () => {
  test("autor apaga o próprio, sem pedir admin, e o texto vai para a auditoria", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    db.planejamentoComentario.delete.mockResolvedValue(gravado());
    const r = await request(app).delete("/planning/comentarios/c1");
    expect(r.status).toBe(200);
    expect(userHasPermission).not.toHaveBeenCalled();
    const chamada = vi.mocked(auditLog).mock.calls[0][0];
    expect(chamada).toMatchObject({ action: "DELETE_PLANNING_COMMENT", previousValue: expect.objectContaining({ texto: corpo.texto }) });
    expect(chamada.newValue).toBeUndefined();
  });

  test("alheio sem admin → 403 e nada é apagado", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ autorId: "u2" }));
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(403);
    expect(db.planejamentoComentario.delete).not.toHaveBeenCalled();
  });

  test("alheio com admin → 200 e auditoria marca moderação com o autor original", async () => {
    ehAdmin = true;
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ autorId: "u2", autorNome: "Outra Pessoa" }));
    db.planejamentoComentario.delete.mockResolvedValue(gravado());
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(200);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "planning", "admin");
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({
      previousValue: expect.objectContaining({ autorId: "u2" }),
      newValue: { moderado: true, autorOriginal: { id: "u2", nome: "Outra Pessoa" } }
    });
  });

  test("falha na auditoria não vira 500", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    db.planejamentoComentario.delete.mockResolvedValue(gravado());
    vi.mocked(auditLog).mockRejectedValue(new Error("fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(200);
  });

  test("inexistente ou apagado por outra pessoa (P2025) → 404", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).delete("/planning/comentarios/x")).status).toBe(404);
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(gravado());
    db.planejamentoComentario.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("sumiu", { code: "P2025", clientVersion: "5" }));
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(404);
  });
});
