import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Margem do buffet por pessoa: leitura, custo informado por mes e permissoes. Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileSaleItem: { aggregate: vi.fn() },
    agileBuffetCusto: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
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
import { obterMargemBuffet } from "../agile-analise.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/analise", agileAnaliseRouter);

const dec = (n: number) => ({ toString: () => String(n), valueOf: () => n });
const QS = "?inicio=2026-09-01&fim=2026-10-10";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.agileSaleItem.aggregate.mockResolvedValue({ _sum: { totalAmount: dec(25000) } });
  db.agileBuffetCusto.findMany.mockResolvedValue([]);
  db.agileBuffetCusto.upsert.mockResolvedValue({});
  db.agileBuffetCusto.deleteMany.mockResolvedValue({ count: 1 });
  // 1a consulta: faixas; 2a: meses.
  db.$queryRaw
    .mockResolvedValueOnce([{ produto: "BUFFET PROMO 15", comandas: 100, pessoas: 200, receita: dec(17000), receita_com_pessoas: dec(17000) }])
    .mockResolvedValueOnce([{ ano: 2026, mes: 9, comandas: 80, pessoas: 160, receita: dec(13600), receita_com_pessoas: dec(13600) }]);
});

describe("GET /margem-buffet", () => {
  test("sem sessao: 401; sem permissao: 403; nada consultado", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get("/analise/margem-buffet" + QS)).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "X" } as never);
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).get("/analise/margem-buffet" + QS)).status).toBe(403);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  test("devolve receita por pessoa e, com o custo do mes, a margem (valores do banco chegam como Decimal)", async () => {
    db.agileBuffetCusto.findMany.mockReset();
    db.agileBuffetCusto.findMany.mockResolvedValue([{ ano: 2026, mes: 9, valor: dec(35) }]);
    const r = await request(app).get("/analise/margem-buffet" + QS);
    expect(r.status).toBe(200);
    expect(r.body.buffet).toMatchObject({ pessoas: 160, receitaPorPessoa: 85 });
    expect(r.body.margem).toMatchObject({ custoPorPessoa: 35, margemPorPessoa: 50 });
    expect(r.body.referencia).toEqual({ ano: 2026, mes: 9, valor: 35 });
  });

  test("busca so os custos dos meses do periodo (setembro e outubro)", async () => {
    await request(app).get("/analise/margem-buffet" + QS);
    expect(db.agileBuffetCusto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ ano: 2026, mes: 9 }, { ano: 2026, mes: 10 }] } }));
  });

  test("periodo invalido: 400", async () => {
    expect((await request(app).get("/analise/margem-buffet?inicio=x&fim=y")).status).toBe(400);
  });

  test("falha do banco: 500 generico, sem vazar o erro", async () => {
    db.$queryRaw.mockReset();
    db.$queryRaw.mockRejectedValue(new Error("senha=segredo"));
    const r = await request(app).get("/analise/margem-buffet" + QS);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});

describe("obterMargemBuffet: janelas", () => {
  test("so hoje no periodo: nada e consultado nas vendas e o aviso de hoje de fora aparece", async () => {
    const r = await obterMargemBuffet({ inicio: "2026-10-14", fim: "2026-10-14" }, "2026-10-14");
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.agileSaleItem.aggregate).not.toHaveBeenCalled();
    expect(r.hojeFicouDeFora).toBe(true);
    expect(r.buffet.pessoas).toBe(0);
  });

  test("periodo que atravessa a virada do ano lista os meses certos", async () => {
    await obterMargemBuffet({ inicio: "2025-11-20", fim: "2026-01-05" }, "2026-02-01");
    expect(db.agileBuffetCusto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ ano: 2025, mes: 11 }, { ano: 2025, mes: 12 }, { ano: 2026, mes: 1 }] } }));
  });
});

describe("PUT /margem-buffet/custo", () => {
  const corpo = { ano: 2026, mes: 9, valor: 35.5 };

  test("sem a permissao de editar: 403 e nada gravado", async () => {
    vi.mocked(userHasPermission).mockImplementation(async (_u, _m, acao) => acao === "view");
    const r = await request(app).put("/analise/margem-buffet/custo").send(corpo);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "edit");
    expect(db.agileBuffetCusto.upsert).not.toHaveBeenCalled();
    expect(db.agileBuffetCusto.deleteMany).not.toHaveBeenCalled();
  });

  test("sem sessao: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).put("/analise/margem-buffet/custo").send(corpo)).status).toBe(401);
  });

  test.each([
    ["valor zero", { ...corpo, valor: 0 }],
    ["valor negativo", { ...corpo, valor: -5 }],
    ["valor texto", { ...corpo, valor: "35" }],
    ["valor absurdo", { ...corpo, valor: 10_000.01 }],
    ["mes 13", { ...corpo, mes: 13 }],
    ["ano antigo", { ...corpo, ano: 1999 }],
    ["sem valor", { ano: 2026, mes: 9 }]
  ])("rejeita %s com 400 e nao grava", async (_nome, body) => {
    const r = await request(app).put("/analise/margem-buffet/custo").send(body);
    expect(r.status).toBe(400);
    expect(db.agileBuffetCusto.upsert).not.toHaveBeenCalled();
  });

  test("grava pela chave unica (ano, mes) com o usuario", async () => {
    const r = await request(app).put("/analise/margem-buffet/custo").send(corpo);
    expect(r.status).toBe(200);
    expect(db.agileBuffetCusto.upsert).toHaveBeenCalledWith({
      where: { ano_mes: { ano: 2026, mes: 9 } },
      create: { ano: 2026, mes: 9, valor: 35.5, updatedById: "u1" },
      update: { valor: 35.5, updatedById: "u1" }
    });
  });

  test("valor null apaga o custo do mes", async () => {
    const r = await request(app).put("/analise/margem-buffet/custo").send({ ...corpo, valor: null });
    expect(r.status).toBe(200);
    expect(db.agileBuffetCusto.deleteMany).toHaveBeenCalledWith({ where: { ano: 2026, mes: 9 } });
    expect(db.agileBuffetCusto.upsert).not.toHaveBeenCalled();
  });

  test("falha ao gravar: 500 generico", async () => {
    db.agileBuffetCusto.upsert.mockRejectedValue(new Error("conexao com senha=x"));
    const r = await request(app).put("/analise/margem-buffet/custo").send(corpo);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("senha");
  });
});
