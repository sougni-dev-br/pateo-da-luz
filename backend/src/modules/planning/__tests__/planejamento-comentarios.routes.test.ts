import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
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
import { carregarComparativo } from "../planejamento.service.js";
import { mesesEncerradosAte, montarComparativo, type MesDoSalao } from "../planejamento-comparativo.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/planning/comentarios", planejamentoComentariosRouter);

const corpo = { anoBase: 2025, anoComparado: 2026, mes: 3, metrica: "VENDAS", turno: "TOTAL", texto: "Feriado prolongado." };
const lido = new Date("2026-11-20T10:00:00.000Z");
const gravado = (extra: Record<string, unknown> = {}) => ({
  id: "c1", contexto: "COMPARATIVO", ...corpo, naImpressao: true, autorId: "u1", autorNome: "Maria Teste",
  editadoEm: null, createdAt: lido, updatedAt: lido, apagadoEm: null, apagadoPorId: null, apagadoPorNome: null,
  valorBase: null, valorComparado: null, variacao: null, ...extra
});

let ehAdmin = false;
beforeEach(() => {
  vi.clearAllMocks();
  ehAdmin = false;
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Maria Teste", role: "ESTOQUISTA" } as never);
  vi.mocked(userHasPermission).mockImplementation(async () => ehAdmin);
  vi.mocked(auditLog).mockResolvedValue(undefined as never);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.$executeRaw.mockResolvedValue(0);
  db.planejamentoComentario.count.mockResolvedValue(0);
  db.planejamentoComentario.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => gravado(data));
  vi.mocked(carregarComparativo).mockResolvedValue({ ...comparativoFicticio, hoje: "2026-11-26" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

// Março fictício: 2025 vendeu 100 mil, 2026 vendeu 80 mil (−20%).
const marco = (ano: number, vendas: number): MesDoSalao => ({
  ano, mes: 3, vendasAlmoco: vendas / 2, vendasJantar: vendas / 2, clientesAlmoco: 500, clientesJantar: 500, servico: 0, fonte: "HISTORICO"
});
const comparativoFicticio = montarComparativo([marco(2025, 100000), marco(2026, 80000)], 2025, 2026, mesesEncerradosAte("2026-11-26", [2025, 2026]), "2026-11");

describe("GET /planning/comentarios", () => {
  test("exige sessão", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/planning/comentarios?anoComparado=2026")).status).toBe(401);
  });

  test("devolve todos do ano comparado, sem restringir pelo ano-base, com flags de poder", async () => {
    db.planejamentoComentario.findMany.mockResolvedValue([gravado(), gravado({ id: "c2", autorId: "u2" })]);
    const r = await request(app).get("/planning/comentarios?anoComparado=2026&anoBase=2024");
    expect(r.status).toBe(200);
    expect(db.planejamentoComentario.findMany.mock.calls[0][0].where).toEqual({ contexto: "COMPARATIVO", anoComparado: 2026, apagadoEm: null });
    expect(r.body.comentarios.map((c: { podeEditar: boolean; podeApagar: boolean }) => [c.podeEditar, c.podeApagar])).toEqual([[true, true], [false, false]]);
    expect(r.body.podeModerar).toBe(false);
  });

  test("podeApagar reflete o prazo de 24 horas do autor; o administrador segue podendo", async () => {
    db.planejamentoComentario.findMany.mockResolvedValue([gravado({ createdAt: new Date("2026-11-19T11:59:59.000Z") })]);
    const r = await request(app).get("/planning/comentarios?anoComparado=2026");
    expect(r.body.comentarios[0]).toMatchObject({ podeEditar: true, podeApagar: false });
    ehAdmin = true;
    const r2 = await request(app).get("/planning/comentarios?anoComparado=2026");
    expect(r2.body.comentarios[0]).toMatchObject({ podeApagar: true });
    expect(r2.body.podeModerar).toBe(true);
  });

  test("devolve o número da época como número (Decimal vira number)", async () => {
    db.planejamentoComentario.findMany.mockResolvedValue([gravado({ valorBase: new Prisma.Decimal("100000"), valorComparado: new Prisma.Decimal("80000"), variacao: new Prisma.Decimal("-0.2") })]);
    const r = await request(app).get("/planning/comentarios?anoComparado=2026");
    expect(r.body.comentarios[0].epoca).toEqual({ valorBase: 100000, valorComparado: 80000, variacao: -0.2 });
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

  test("grava o número da época calculado pelo comparativo do servidor (ignora números do corpo)", async () => {
    const r = await request(app).post("/planning/comentarios").send({ ...corpo, valorBase: 1, variacao: 9 });
    expect(r.status).toBe(201);
    expect(carregarComparativo).toHaveBeenCalledWith(2025, 2026);
    expect(db.planejamentoComentario.create.mock.calls[0][0].data).toMatchObject({ valorBase: 100000, valorComparado: 80000, variacao: -0.2 });
    expect(r.body.epoca).toEqual({ valorBase: 100000, valorComparado: 80000, variacao: -0.2 });
  });

  test("ponto sem número grava nulo; falha no comparativo não impede o comentário", async () => {
    await request(app).post("/planning/comentarios").send({ ...corpo, mes: 4 });
    expect(db.planejamentoComentario.create.mock.calls[0][0].data).toMatchObject({ valorBase: null, valorComparado: null, variacao: null });
    vi.mocked(carregarComparativo).mockRejectedValue(new Error("banco lento"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await request(app).post("/planning/comentarios").send(corpo);
    expect(r.status).toBe(201);
    expect(db.planejamentoComentario.create.mock.calls[1][0].data).toMatchObject({ valorBase: null, variacao: null });
  });

  test("os limites contam só os não apagados", async () => {
    await request(app).post("/planning/comentarios").send(corpo);
    expect(db.planejamentoComentario.count).toHaveBeenCalledTimes(2);
    for (const [args] of db.planejamentoComentario.count.mock.calls) expect(args.where).toMatchObject({ apagadoEm: null });
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
    expect(args.where).toEqual({ id: "c1", autorId: "u1", updatedAt: lido, apagadoEm: null });
    expect(args.data).not.toHaveProperty("valorBase");
    expect(args.data).not.toHaveProperty("variacao");
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
    db.planejamentoComentario.findFirst.mockResolvedValue(gravado());
    db.planejamentoComentario.updateMany.mockResolvedValue({ count: 0 });
    const r = await request(app).patch("/planning/comentarios/c1").send(edicao);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/mudou/);
  });

  test("sumiu entre a leitura e a gravação → 404", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValueOnce(gravado());
    db.planejamentoComentario.findFirst.mockResolvedValueOnce(null);
    db.planejamentoComentario.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).patch("/planning/comentarios/c1").send(edicao)).status).toBe(404);
  });

  test("comentário na lixeira não se edita → 404", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(gravado({ apagadoEm: lido, apagadoPorId: "u1", apagadoPorNome: "Maria Teste" }));
    expect((await request(app).patch("/planning/comentarios/c1").send(edicao)).status).toBe(404);
    expect(db.planejamentoComentario.updateMany).not.toHaveBeenCalled();
  });

  test("inexistente → 404 e corpo inválido → 400", async () => {
    db.planejamentoComentario.findUnique.mockResolvedValue(null);
    expect((await request(app).patch("/planning/comentarios/x").send(edicao)).status).toBe(404);
    expect((await request(app).patch("/planning/comentarios/x").send({ atualizadoEm: lido.toISOString() })).status).toBe(400);
  });
});
