import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    planejamentoComentario: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn()
  }
}));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1") }));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));
vi.mock("../planejamento.service.js", () => ({ carregarComparativo: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { planejamentoComentariosRouter } from "../planejamento-comentarios.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/planning/comentarios", planejamentoComentariosRouter);

// Tudo fictício (o repositório é público).
const AGORA = new Date("2026-11-20T12:00:00.000Z");
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const gravado = (extra: Record<string, unknown> = {}) => ({
  id: "c1", contexto: "COMPARATIVO", anoBase: 2025, anoComparado: 2026, mes: 3, metrica: "VENDAS", turno: "TOTAL", texto: "Feriado prolongado.",
  naImpressao: true, autorId: "u1", autorNome: "Maria Teste", editadoEm: null, createdAt: minutosAtras(60), updatedAt: minutosAtras(60),
  apagadoEm: null, apagadoPorId: null, apagadoPorNome: null, valorBase: null, valorComparado: null, variacao: null, ...extra
});
const naLixeira = (minutos: number, por = "u1") => gravado({ apagadoEm: minutosAtras(minutos), apagadoPorId: por, apagadoPorNome: por === "u1" ? "Maria Teste" : "Outra Pessoa" });

let ehAdmin = false;
beforeEach(() => {
  vi.clearAllMocks();
  ehAdmin = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Maria Teste", role: "ESTOQUISTA" } as never);
  vi.mocked(userHasPermission).mockImplementation(async () => ehAdmin);
  vi.mocked(auditLog).mockResolvedValue(undefined as never);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.$executeRaw.mockResolvedValue(0);
  db.planejamentoComentario.count.mockResolvedValue(0);
  db.planejamentoComentario.updateMany.mockResolvedValue({ count: 1 });
  db.planejamentoComentario.findUniqueOrThrow.mockResolvedValue(gravado());
});
afterEach(() => vi.useRealTimers());

describe("DELETE /planning/comentarios/:id (vai para a lixeira)", () => {
  test("marca quem e quando apagou, não remove a linha, e audita", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    const r = await request(app).delete("/planning/comentarios/c1");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, apagadoEm: AGORA.toISOString() });
    expect(db.planejamentoComentario.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", apagadoEm: null },
      data: { apagadoEm: AGORA, apagadoPorId: "u1", apagadoPorNome: "Maria Teste" }
    });
    const chamada = vi.mocked(auditLog).mock.calls[0][0];
    expect(chamada).toMatchObject({ action: "DELETE_PLANNING_COMMENT", previousValue: expect.objectContaining({ texto: "Feriado prolongado." }) });
    expect(chamada.newValue).toEqual({ apagadoEm: AGORA.toISOString(), apagadoPor: { id: "u1", nome: "Maria Teste" } });
  });

  test("autor depois de 24 horas → 403 com mensagem clara; admin apaga", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ createdAt: minutosAtras(24 * 60 + 1) }));
    const r = await request(app).delete("/planning/comentarios/c1");
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Depois de 24 horas, só quem administra o Planejamento pode apagar este comentário.");
    expect(db.planejamentoComentario.updateMany).not.toHaveBeenCalled();
    ehAdmin = true;
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(200);
  });

  test("alheio sem admin → 403; com admin → 200 e a auditoria marca a moderação", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ autorId: "u2", autorNome: "Outra Pessoa" }));
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(403);
    ehAdmin = true;
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(200);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "planning", "admin");
    expect(vi.mocked(auditLog).mock.calls[0][0].newValue).toMatchObject({ moderado: true, autorOriginal: { id: "u2", nome: "Outra Pessoa" } });
  });

  test("inexistente, já na lixeira ou apagado por outra pessoa no meio do caminho → 404", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).delete("/planning/comentarios/x")).status).toBe(404);
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(naLixeira(1));
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(404);
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(gravado());
    db.planejamentoComentario.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(404);
  });

  test("falha na auditoria não vira 500", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado());
    vi.mocked(auditLog).mockRejectedValue(new Error("fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request(app).delete("/planning/comentarios/c1")).status).toBe(200);
  });
});

describe("POST /planning/comentarios/:id/restaurar", () => {
  test("quem apagou desfaz dentro de 10 minutos: limpa a marca e audita", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(10));
    const r = await request(app).post("/planning/comentarios/c1/restaurar");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "c1", texto: "Feriado prolongado." });
    expect(db.planejamentoComentario.updateMany).toHaveBeenCalledWith({ where: { id: "c1", apagadoEm: { not: null } }, data: { apagadoEm: null, apagadoPorId: null, apagadoPorNome: null } });
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({ action: "RESTORE_PLANNING_COMMENT", previousValue: { apagadoEm: minutosAtras(10).toISOString(), apagadoPor: { id: "u1", nome: "Maria Teste" } } });
  });

  test("depois de 10 minutos → 403; administrador restaura a qualquer tempo", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(11));
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(403);
    expect(db.planejamentoComentario.updateMany).not.toHaveBeenCalled();
    ehAdmin = true;
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(60 * 24 * 30));
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(200);
  });

  test("apagado por outra pessoa → 403 para quem não é admin", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(1, "u2"));
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(403);
  });

  test("não apagado → 409; inexistente → 404; restaurado por outro no meio → 409", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(gravado());
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(409);
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).post("/planning/comentarios/x/restaurar")).status).toBe(404);
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(naLixeira(1));
    db.planejamentoComentario.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(409);
  });

  test("respeita o limite de 20 por ponto (contando só os não apagados)", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(1));
    db.planejamentoComentario.count.mockResolvedValueOnce(20).mockResolvedValueOnce(20);
    const r = await request(app).post("/planning/comentarios/c1/restaurar");
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/20 comentários/);
    expect(db.planejamentoComentario.count.mock.calls[1][0].where).toMatchObject({ mes: 3, metrica: "VENDAS", turno: "TOTAL", apagadoEm: null });
    expect(db.planejamentoComentario.updateMany).not.toHaveBeenCalled();
  });

  test("falha na auditoria não vira 500", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(naLixeira(1));
    vi.mocked(auditLog).mockRejectedValue(new Error("fora do ar"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request(app).post("/planning/comentarios/c1/restaurar")).status).toBe(200);
  });
});

describe("GET /planning/comentarios/lixeira", () => {
  test("sem admin → 403", async () => {
    expect((await request(app).get("/planning/comentarios/lixeira?anoComparado=2026")).status).toBe(403);
    expect(db.planejamentoComentario.findMany).not.toHaveBeenCalled();
  });

  test("admin lista os apagados do ano com quem e quando apagou", async () => {
    ehAdmin = true;
    db.planejamentoComentario.findMany.mockResolvedValue([naLixeira(5, "u2")]);
    const r = await request(app).get("/planning/comentarios/lixeira?anoComparado=2026");
    expect(r.status).toBe(200);
    expect(db.planejamentoComentario.findMany.mock.calls[0][0].where).toEqual({ contexto: "COMPARATIVO", anoComparado: 2026, apagadoEm: { not: null } });
    expect(r.body.comentarios[0]).toMatchObject({ id: "c1", apagadoEm: minutosAtras(5).toISOString(), apagadoPorNome: "Outra Pessoa" });
  });

  test("ano inválido → 400", async () => {
    ehAdmin = true;
    expect((await request(app).get("/planning/comentarios/lixeira?anoComparado=1999")).status).toBe(400);
  });
});
