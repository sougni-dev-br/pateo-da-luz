import express from "express";
import "express-async-errors";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const prisma = {
    product: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    category: { findMany: vi.fn() },
    subcategory: { findMany: vi.fn() },
    inventorySector: { findMany: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn()
  };
  return { prisma };
});

vi.mock("../../../config/database.js", () => ({ prisma }));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(),
  requestIp: () => "127.0.0.1"
}));

import { requireRole } from "../../security/security-utils.js";
import { productBulkRouter } from "../product-bulk.routes.js";

const app = express();
app.use(express.json());
app.use("/bulk", productBulkRouter);
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ message: error instanceof Error ? error.message : "erro" });
});

const estado = (extra: Record<string, unknown> = {}) => ({
  id: "p1", name: "ARROZ", externalCode: "1", categoryId: "c-sec", subcategoryId: null,
  inventorySectorId: "set-est", nature: "INSUMO", controlsStock: true, isActive: true, ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Teste", role: "ADMIN" } as never);
  prisma.category.findMany.mockResolvedValue([
    { id: "c-sec", name: "SECOS", nature: "INSUMO" },
    { id: "c-doc", name: "DOCES", nature: "INSUMO" }
  ]);
  prisma.subcategory.findMany.mockResolvedValue([{ id: "s-arroz", name: "ARROZ", categoryId: "c-sec" }]);
  prisma.inventorySector.findMany.mockResolvedValue([{ id: "set-est", name: "ESTOQUE", isActive: true }]);
  prisma.product.findMany.mockResolvedValue([estado(), estado({ id: "p2", name: "FEIJAO" })]);
  prisma.product.count.mockResolvedValue(2);
  prisma.product.updateMany.mockResolvedValue({ count: 2 });
  prisma.auditLog.create.mockResolvedValue({});
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
});

describe("POST /bulk (simular)", () => {
  test("sem aplicar, devolve o resumo e não grava nada", async () => {
    const r = await request(app).post("/bulk").send({ ids: ["p1", "p2"], mudancas: { categoryId: "c-doc" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ aplicado: false, total: 2, alterar: 2, recusados: 0, contagens: { categoria: 2 } });
    expect(r.body.avisos.join(" ")).toMatch(/DRE/);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  test("por filtro usa o mesmo filtro da lista", async () => {
    const r = await request(app).post("/bulk").send({ filtro: { category: "SECOS", pendencia: "sem-subcategoria" }, mudancas: { subcategoryId: "s-arroz" } });
    expect(r.status).toBe(200);
    const where = prisma.product.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ category: { name: "SECOS" }, subcategoryId: null });
  });

  test("filtro largo demais é recusado antes de carregar produtos", async () => {
    prisma.product.count.mockResolvedValue(2500);
    const r = await request(app).post("/bulk").send({ filtro: {}, mudancas: { isActive: false } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/limite/i);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  test("exige ids ou filtro, nunca os dois nem nenhum", async () => {
    expect((await request(app).post("/bulk").send({ mudancas: { isActive: false } })).status).toBe(400);
    expect((await request(app).post("/bulk").send({ ids: ["p1"], filtro: {}, mudancas: { isActive: false } })).status).toBe(400);
  });

  test("exige ao menos uma mudança e recusa campos desconhecidos (como a categoria DRE)", async () => {
    expect((await request(app).post("/bulk").send({ ids: ["p1"], mudancas: {} })).status).toBe(400);
    expect((await request(app).post("/bulk").send({ ids: ["p1"], mudancas: { dreCategoryId: "x" } })).status).toBe(400);
  });

  test("sem permissão não faz nada", async () => {
    vi.mocked(requireRole).mockImplementation((async (_req: unknown, res: express.Response) => {
      res.status(403).json({ message: "Sem permissão." });
      return null;
    }) as never);
    const r = await request(app).post("/bulk").send({ ids: ["p1"], mudancas: { isActive: false } });
    expect(r.status).toBe(403);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /bulk (aplicar)", () => {
  test("grava numa transação, agrupa produtos com o mesmo patch e registra o lote com antes e depois", async () => {
    const r = await request(app).post("/bulk").send({ ids: ["p1", "p2"], mudancas: { categoryId: "c-doc" }, aplicar: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ aplicado: true, alterar: 2 });
    expect(r.body.loteId).toEqual(expect.any(String));
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["p1", "p2"] } }, data: { categoryId: "c-doc" } });
    const lote = prisma.auditLog.create.mock.calls[0][0].data;
    expect(lote).toMatchObject({ id: r.body.loteId, action: "BULK_UPDATE_PRODUCTS", userId: "u1" });
    expect(lote.previousValue.produtos[0]).toMatchObject({ id: "p1", antes: { categoryId: "c-sec" }, depois: { categoryId: "c-doc" } });
  });

  test("produto que já tem a categoria não é tocado nem perde a subcategoria", async () => {
    prisma.product.findMany.mockResolvedValue([estado({ subcategoryId: "s-arroz" }), estado({ id: "p2", categoryId: "c-doc" })]);
    const r = await request(app).post("/bulk").send({ ids: ["p1", "p2"], mudancas: { categoryId: "c-doc" }, aplicar: true });
    expect(r.body).toMatchObject({ alterar: 1, semMudanca: 1 });
    expect(prisma.product.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ["p1"] } });
    expect(prisma.product.updateMany.mock.calls[0][0].data).toEqual({ categoryId: "c-doc", subcategoryId: null });
  });

  test("produtos recusados ficam de fora e aparecem no resumo", async () => {
    prisma.product.findMany.mockResolvedValue([estado({ controlsStock: false, inventorySectorId: null }), estado({ id: "p2", controlsStock: false })]);
    const r = await request(app).post("/bulk").send({ ids: ["p1", "p2"], mudancas: { controlsStock: true }, aplicar: true });
    expect(r.body).toMatchObject({ alterar: 1, recusados: 1 });
    expect(r.body.recusadosPorMotivo[0].motivo).toMatch(/setor/i);
    expect(prisma.product.updateMany.mock.calls[0][0].where).toEqual({ id: { in: ["p2"] } });
  });

  test("sem nada a alterar não grava e não cria lote", async () => {
    const r = await request(app).post("/bulk").send({ ids: ["p1", "p2"], mudancas: { isActive: true }, aplicar: true });
    expect(r.body).toMatchObject({ aplicado: true, loteId: null, alterar: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /bulk/:loteId/desfazer", () => {
  const lote = {
    id: "lote1",
    previousValue: {
      produtos: [
        { id: "p1", antes: estado({ categoryId: "c-sec", subcategoryId: "s-arroz" }), depois: estado({ categoryId: "c-doc", subcategoryId: null }) },
        { id: "p2", antes: estado({ id: undefined, categoryId: "c-sec" }), depois: estado({ categoryId: "c-doc" }) }
      ]
    }
  };

  beforeEach(() => {
    prisma.auditLog.findFirst.mockImplementation(async ({ where }: { where: { action: string } }) =>
      where.action === "BULK_UPDATE_PRODUCTS" ? lote : null);
    prisma.product.findMany.mockResolvedValue([
      estado({ categoryId: "c-doc", subcategoryId: null }),
      estado({ id: "p2", categoryId: "c-sec", nature: "CONSUMO" }) // editado depois do lote
    ]);
  });

  test("devolve ao estado anterior só quem ainda está como o lote deixou", async () => {
    const r = await request(app).post("/bulk/lote1/desfazer").send({});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ desfeitos: 1, ignorados: 1 });
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ["p1"] } },
      data: { categoryId: "c-sec", subcategoryId: "s-arroz" }
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "UNDO_BULK_UPDATE_PRODUCTS", entityId: "lote1" });
  });

  test("lote inexistente dá 404", async () => {
    prisma.auditLog.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/bulk/nao-existe/desfazer").send({})).status).toBe(404);
  });

  test("lote já desfeito não é desfeito de novo", async () => {
    prisma.auditLog.findFirst.mockImplementation(async ({ where }: { where: { action: string } }) =>
      where.action === "BULK_UPDATE_PRODUCTS" ? lote : { id: "undo1" });
    const r = await request(app).post("/bulk/lote1/desfazer").send({});
    expect(r.status).toBe(409);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });
});
