import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Telas de analise do salao (cancelamentos e vendas por pessoa). Banco de mentira.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileSale: { findMany: vi.fn() },
    agileSaleItem: { findMany: vi.fn(), aggregate: vi.fn() }
  };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { getSessionUser } from "../../../security/security-utils.js";
import { userHasPermission } from "../../../security/menu-permissions.js";
import { agileAnaliseRouter } from "../agile-analise.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/analise", agileAnaliseRouter);

const venda = (over = {}) => ({
  saleId: "1", movementDate: new Date("2026-10-01T12:00:00Z"), shift: "Jantar", saleStatus: "CANCELADA",
  saleHour: "20:10", people: 2, totalAmount: { toString: () => "120.50" }, cancelledBy: "Ana", cancelReason: null, ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", role: "GESTAO_COMPLETA" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  db.agileSale.findMany.mockResolvedValue([venda(), venda({ saleId: "2", saleStatus: "RECEBIDA", totalAmount: { toString: () => "300" }, cancelledBy: null })]);
  db.agileSaleItem.findMany.mockResolvedValue([
    { saleId: "1", launchedBy: "Ana", productGroup: "Bebidas", quantity: { toString: () => "2" }, totalAmount: { toString: () => "40" } }
  ]);
});

const URLS = ["/analise/cancelamentos", "/analise/vendas-por-pessoa", "/analise/itens-cancelados"];

describe.each(URLS)("%s — acesso", (url) => {
  test("sem sessao: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get(`${url}?inicio=2026-10-01&fim=2026-10-07`)).status).toBe(401);
  });

  test("sem a permissao do modulo analise-salao: 403 e nada consultado", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    const r = await request(app).get(`${url}?inicio=2026-10-01&fim=2026-10-07`);
    expect(r.status).toBe(403);
    expect(userHasPermission).toHaveBeenCalledWith(expect.anything(), "analise-salao", "view");
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
    expect(db.agileSaleItem.findMany).not.toHaveBeenCalled();
  });
});

describe.each(URLS)("%s — periodo", (url) => {
  test.each([
    ["sem parametros", ""],
    ["formato errado", "?inicio=01/10/2026&fim=07/10/2026"],
    ["fim antes do inicio", "?inicio=2026-10-07&fim=2026-10-01"],
    ["mais de 366 dias", "?inicio=2025-01-01&fim=2026-10-07"],
    ["dia inexistente", "?inicio=2026-02-30&fim=2026-03-05"]
  ])("%s: 400 com mensagem", async (_nome, qs) => {
    const r = await request(app).get(url + qs);
    expect(r.status).toBe(400);
    expect(typeof r.body.message).toBe("string");
  });
});

describe("GET /analise/cancelamentos", () => {
  test("consulta o intervalo do dia inicial ate o fim do dia final (sem depender do horario gravado)", async () => {
    await request(app).get("/analise/cancelamentos?inicio=2026-10-01&fim=2026-10-07");
    const where = db.agileSale.findMany.mock.calls[0][0].where;
    expect(where.movementDate.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(where.movementDate.lt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  test("devolve o relatorio com os numeros convertidos de Decimal", async () => {
    const r = await request(app).get("/analise/cancelamentos?inicio=2026-10-01&fim=2026-10-07");
    expect(r.status).toBe(200);
    expect(r.body.periodo).toEqual({ inicio: "2026-10-01", fim: "2026-10-07" });
    expect(r.body.resumo).toMatchObject({ vendas: 2, canceladas: 1, valorCancelado: 120.5, valorFaturado: 300 });
    expect(r.body.porPessoa[0]).toMatchObject({ pessoa: "Ana", canceladas: 1, valor: 120.5 });
  });

  test("falha do banco: 500 com { erro } sem vazar detalhe", async () => {
    db.agileSale.findMany.mockRejectedValue(new Error("connection string postgres://secreto"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get("/analise/cancelamentos?inicio=2026-10-01&fim=2026-10-07");
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secreto");
  });
});

describe("GET /analise/vendas-por-pessoa", () => {
  test("so considera itens de venda RECEBIDA no intervalo pedido", async () => {
    await request(app).get("/analise/vendas-por-pessoa?inicio=2026-10-01&fim=2026-10-07");
    const where = db.agileSaleItem.findMany.mock.calls[0][0].where;
    expect(where.saleStatus).toBe("RECEBIDA");
    expect(where.movementDate.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(where.movementDate.lt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  test("devolve o relatorio por pessoa", async () => {
    const r = await request(app).get("/analise/vendas-por-pessoa?inicio=2026-10-01&fim=2026-10-07");
    expect(r.status).toBe(200);
    expect(r.body.pessoas[0]).toMatchObject({ pessoa: "Ana", valor: 40, itens: 2, vendas: 1 });
    expect(r.body.cobertura).toEqual({ itensComPessoa: 1, itensSemPessoa: 0 });
  });
});

describe("GET /analise/itens-cancelados", () => {
  const itemCancelado = (over = {}) => ({
    saleId: "1", movementDate: new Date("2026-10-01T12:00:00Z"), productName: "BUFFET PROMO 15", productGroup: "Buffet",
    quantity: { toString: () => "2" }, totalAmount: { toString: () => "90" }, launchedBy: "Ana", cancelledBy: "Bruno", cancelReason: null, ...over
  });

  beforeEach(() => {
    // 1a chamada: itens cancelados; as vendas vem de agileSale.findMany.
    db.agileSaleItem.findMany.mockResolvedValue([itemCancelado(), itemCancelado({ saleId: "2" }), itemCancelado({ saleId: "3" })]);
    db.agileSale.findMany.mockResolvedValue([
      { saleId: "1", saleStatus: "RECEBIDA", saleHour: "13:10" },
      { saleId: "2", saleStatus: "CANCELADA", saleHour: "20:00" } // venda inteira cancelada: ja esta em "Cancelamentos"
      // venda "3" nao existe em AgileSale: fica de fora, nao inventa hora
    ]);
    db.agileSaleItem.aggregate.mockResolvedValue({ _sum: { totalAmount: { toString: () => "5000" } } });
  });

  test("consulta so itens CANCELADOS no intervalo, e o total vendido como denominador", async () => {
    await request(app).get("/analise/itens-cancelados?inicio=2026-10-01&fim=2026-10-07");
    const where = db.agileSaleItem.findMany.mock.calls[0][0].where;
    expect(where.saleStatus).toBe("CANCELADA"); // comanda "EM ABERTO/CONSUMINDO" nao e item cancelado
    expect(where.movementDate.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(where.movementDate.lt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(db.agileSaleItem.aggregate.mock.calls[0][0].where.saleStatus).toBe("RECEBIDA");
  });

  test("so conta item cancelado de venda PAGA (venda inteira cancelada e venda sem registro ficam fora)", async () => {
    const r = await request(app).get("/analise/itens-cancelados?inicio=2026-10-01&fim=2026-10-07");
    expect(r.status).toBe(200);
    expect(r.body.resumo).toMatchObject({ itens: 1, vendasAfetadas: 1, valorCancelado: 90, valorItensRecebidos: 5000 });
    // Só o item da venda "3" (sem registro) conta como "sem venda"; o da venda inteira cancelada é outro relatório.
    expect(r.body.cobertura.itensSemVenda).toBe(1);
    expect(r.body.maiores[0]).toMatchObject({ produto: "BUFFET PROMO 15", hora: "13:10", quemLancou: "Ana", quemCancelou: "Bruno" });
  });

  test("sem item cancelado nem venda para consultar: nao vai buscar vendas a toa", async () => {
    db.agileSaleItem.findMany.mockResolvedValue([]);
    db.agileSaleItem.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
    const r = await request(app).get("/analise/itens-cancelados?inicio=2026-10-01&fim=2026-10-07");
    expect(r.status).toBe(200);
    expect(r.body.resumo.itens).toBe(0);
    expect(r.body.resumo.valorItensRecebidos).toBe(0);
    expect(db.agileSale.findMany).not.toHaveBeenCalled();
  });

  test("falha do banco: 500 com mensagem generica", async () => {
    db.agileSaleItem.findMany.mockRejectedValue(new Error("postgres://secreto"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get("/analise/itens-cancelados?inicio=2026-10-01&fim=2026-10-07");
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secreto");
  });
});
