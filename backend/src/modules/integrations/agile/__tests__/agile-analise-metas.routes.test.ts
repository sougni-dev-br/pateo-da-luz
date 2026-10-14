import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Metas mensais do salao: leitura, gravacao e permissoes. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileSale: { findMany: vi.fn() },
    agileSaleItem: { findMany: vi.fn(), aggregate: vi.fn() },
    agileSalaoMeta: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    $queryRaw: vi.fn()
  };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { getSessionUser } from "../../../security/security-utils.js";
import { userHasPermission } from "../../../security/menu-permissions.js";
import { agileAnaliseRouter } from "../agile-analise.routes.js";
import { obterMetas } from "../agile-analise.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const dec = (n: number) => ({ toString: () => String(n) });
const linha = (iso: string, valor = 1000, pessoas = 10) => ({
  saleId: `${iso}-${valor}`, movementDate: new Date(`${iso}T12:00:00Z`), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: pessoas,
  totalAmount: dec(valor), subtotalAmount: null, discountAmount: null, discountLabel: null, cancelledBy: null, cancelReason: null
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.agileSale.findMany.mockResolvedValue([linha("2026-10-05")]);
  db.agileSalaoMeta.findMany.mockResolvedValue([]);
  db.agileSalaoMeta.upsert.mockResolvedValue({});
  db.agileSalaoMeta.deleteMany.mockResolvedValue({ count: 1 });
  db.$queryRaw.mockResolvedValue([]);
});

describe("GET /metas", () => {
  test("sem sessao: 401; sem a permissao analise-salao: 403; nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/analise/metas?ano=2026&mes=10")).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).get("/analise/metas?ano=2026&mes=10")).status).toBe(403);
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
  });

  test.each(["", "?ano=2026", "?ano=2026&mes=13", "?ano=2026&mes=0", "?ano=1999&mes=5", "?ano=abc&mes=5"])("mes invalido %s: 400", async (qs) => {
    const r = await request(app).get("/analise/metas" + qs);
    expect(r.status).toBe(400);
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
  });

  test("devolve os quatro indicadores com a meta gravada", async () => {
    db.agileSalaoMeta.findMany.mockResolvedValue([{ indicador: "faturamento", valor: dec(300000) }, { indicador: "perdaPct", valor: dec(0.02) }]);
    const r = await request(app).get("/analise/metas?ano=2026&mes=10");
    expect(r.status).toBe(200);
    expect(r.body.indicadores.map((i: { indicador: string }) => i.indicador)).toEqual(["faturamento", "pessoas", "ticketPessoa", "perdaPct"]);
    expect(r.body.indicadores[0].meta).toBe(300000);
    expect(r.body.indicadores[1].meta).toBeNull();
    expect(r.body.indicadores[3].meta).toBe(0.02);
    expect(db.agileSalaoMeta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ano: 2026, mes: 10 } }));
  });

  test("falha do banco: 500 com mensagem generica, sem vazar o erro", async () => {
    db.agileSale.findMany.mockRejectedValue(new Error("senha=segredo"));
    const r = await request(app).get("/analise/metas?ano=2026&mes=10");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});

describe("obterMetas: janelas consultadas", () => {
  test("o realizado do mes, o ritmo (56 dias antes de hoje) e o historico (6 meses antes do mes) usam intervalos certos", async () => {
    await obterMetas(2026, 10, "2026-10-15");
    const intervalos = db.agileSale.findMany.mock.calls.map((c: Array<{ where: { movementDate: { gte: Date; lt: Date } } }>) => [
      c[0].where.movementDate.gte.toISOString().slice(0, 10), c[0].where.movementDate.lt.toISOString().slice(0, 10)
    ]);
    expect(intervalos).toContainEqual(["2026-10-01", "2026-11-01"]); // mes (fim exclusivo)
    expect(intervalos).toContainEqual(["2026-08-20", "2026-10-15"]); // 56 dias fechados
    expect(intervalos).toContainEqual(["2026-04-01", "2026-10-01"]); // 6 meses antes
  });
});

describe("PUT /metas", () => {
  const corpo = { ano: 2026, mes: 10, indicador: "faturamento", valor: 300000 };

  test("sem a permissao de editar: 403 e nada gravado (ver nao basta)", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, _m, acao) => acao === "view");
    const r = await request(app).put("/analise/metas").send(corpo);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "edit");
    expect(db.agileSalaoMeta.upsert).not.toHaveBeenCalled();
    expect(db.agileSalaoMeta.deleteMany).not.toHaveBeenCalled();
  });

  test("sem sessao: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).put("/analise/metas").send(corpo)).status).toBe(401);
  });

  test.each([
    ["valor zero", { ...corpo, valor: 0 }],
    ["valor negativo", { ...corpo, valor: -5 }],
    ["valor texto", { ...corpo, valor: "300000" }],
    ["indicador desconhecido", { ...corpo, indicador: "lucro" }],
    ["perda acima de 100%", { ...corpo, indicador: "perdaPct", valor: 1.5 }],
    ["faturamento absurdo", { ...corpo, valor: 1e12 }],
    ["mes 13", { ...corpo, mes: 13 }],
    ["sem valor", { ano: 2026, mes: 10, indicador: "faturamento" }]
  ])("rejeita %s com 400 e nao grava", async (_nome, body) => {
    const r = await request(app).put("/analise/metas").send(body);
    expect(r.status).toBe(400);
    expect(db.agileSalaoMeta.upsert).not.toHaveBeenCalled();
  });

  test("grava pela chave unica (ano, mes, indicador) com o usuario e devolve as metas atualizadas", async () => {
    const r = await request(app).put("/analise/metas").send(corpo);
    expect(r.status).toBe(200);
    expect(db.agileSalaoMeta.upsert).toHaveBeenCalledWith({
      where: { ano_mes_indicador: { ano: 2026, mes: 10, indicador: "faturamento" } },
      create: { ano: 2026, mes: 10, indicador: "faturamento", valor: 300000, updatedById: "u1" },
      update: { valor: 300000, updatedById: "u1" }
    });
    expect(r.body.indicadores).toHaveLength(4);
  });

  test("valor null apaga a meta do indicador no mes", async () => {
    const r = await request(app).put("/analise/metas").send({ ...corpo, valor: null });
    expect(r.status).toBe(200);
    expect(db.agileSalaoMeta.deleteMany).toHaveBeenCalledWith({ where: { ano: 2026, mes: 10, indicador: "faturamento" } });
    expect(db.agileSalaoMeta.upsert).not.toHaveBeenCalled();
  });

  test("perda aceita fracao entre 0 e 1", async () => {
    const r = await request(app).put("/analise/metas").send({ ano: 2026, mes: 10, indicador: "perdaPct", valor: 0.025 });
    expect(r.status).toBe(200);
  });

  test("falha ao gravar: 500 generico", async () => {
    db.agileSalaoMeta.upsert.mockRejectedValue(new Error("conexao com senha=x"));
    const r = await request(app).put("/analise/metas").send(corpo);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("senha");
  });
});
