import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    product: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    category: { findMany: vi.fn() },
    inventorySector: { findMany: vi.fn() }
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(),
  requireMenuPermission: vi.fn(),
  auditLog: vi.fn(),
  requestIp: vi.fn(() => "127.0.0.1")
}));

import { prisma } from "../../../config/database.js";
import { requireRole } from "../../security/security-utils.js";
import { productRouter } from "../product.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/products", productRouter);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Teste", role: "ADMIN" } as never);
  db.category.findMany.mockResolvedValue([{ id: "c-sec", name: "SECOS E GRAOS" }, { id: "c-doc", name: "DOCES" }]);
  db.inventorySector.findMany.mockResolvedValue([{ id: "set-est", name: "ESTOQUE" }]);
  db.product.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
    if (by[0] === "categoryId") return [{ categoryId: "c-sec", _count: { _all: 104 } }, { categoryId: "c-doc", _count: { _all: 57 } }, { categoryId: null, _count: { _all: 3 } }];
    if (by[0] === "nature") return [{ nature: "INSUMO", _count: { _all: 800 } }, { nature: null, _count: { _all: 3 } }];
    return [{ inventorySectorId: "set-est", _count: { _all: 226 } }, { inventorySectorId: null, _count: { _all: 25 } }];
  });
  db.product.count.mockResolvedValue(7);
  db.product.findMany.mockResolvedValue([]);
});

describe("GET /products/facets", () => {
  test("devolve a contagem de cada categoria, natureza, setor e pendência, com nomes", async () => {
    const r = await request(app).get("/products/facets");
    expect(r.status).toBe(200);
    expect(r.body.categorias).toEqual([{ nome: "SECOS E GRAOS", count: 104 }, { nome: "DOCES", count: 57 }]);
    expect(r.body.naturezas).toEqual([{ valor: "INSUMO", count: 800 }]);
    expect(r.body.setores).toEqual([{ nome: "ESTOQUE", count: 226 }]);
    expect(Object.keys(r.body.pendencias).sort()).toEqual(["sem-categoria", "sem-dre", "sem-natureza", "sem-setor", "sem-subcategoria"]);
    expect(r.body.pendencias["sem-setor"]).toBe(7);
  });

  test("cada contagem ignora o filtro do próprio critério e respeita os outros", async () => {
    await request(app).get("/products/facets").query({ category: "SECOS E GRAOS", nature: "INSUMO", isActive: "true" });
    const chamadas = db.product.groupBy.mock.calls.map((c: unknown[]) => ({ por: (c[0] as { by: string[] }).by[0], where: (c[0] as { where: Record<string, unknown> }).where }));
    const categoria = chamadas.find((c: { por: string }) => c.por === "categoryId");
    expect(categoria.where).not.toHaveProperty("category");
    expect(categoria.where).toMatchObject({ nature: "INSUMO", isActive: true });
    const natureza = chamadas.find((c: { por: string }) => c.por === "nature");
    expect(natureza.where).not.toHaveProperty("nature");
    expect(natureza.where).toMatchObject({ category: { name: "SECOS E GRAOS" } });
  });

  test("cada pendência conta junto com as outras já marcadas, para o número bater com o que o clique entrega", async () => {
    await request(app).get("/products/facets").query({ pendencia: "sem-subcategoria" });
    const wheres = db.product.count.mock.calls.map((c: unknown[]) => (c[0] as { where: Record<string, unknown> }).where);
    const semSetor = wheres.find((w: Record<string, unknown>) => "inventorySectorId" in w);
    expect(semSetor).toMatchObject({ inventorySectorId: null, subcategoryId: null });
    const propria = wheres.find((w: Record<string, unknown>) => "subcategoryId" in w && !("inventorySectorId" in w) && !("categoryId" in w) && !("dreCategoryId" in w) && !("nature" in w));
    expect(propria).toEqual({ subcategoryId: null });
  });

  test("sem permissão não consulta", async () => {
    vi.mocked(requireRole).mockImplementation((async (_q: unknown, res: express.Response) => {
      res.status(403).json({ message: "Sem permissão." });
      return null;
    }) as never);
    const r = await request(app).get("/products/facets");
    expect(r.status).toBe(403);
    expect(db.product.groupBy).not.toHaveBeenCalled();
  });
});

describe("GET /products: ordenação", () => {
  test("usa a ordem pedida, com o nome como desempate", async () => {
    db.product.count.mockResolvedValue(0);
    await request(app).get("/products").query({ sort: "category", dir: "desc" });
    expect(db.product.findMany.mock.calls[0][0].orderBy).toEqual([{ category: { name: "desc" } }, { name: "asc" }]);
  });

  test("sem pedido, nome crescente", async () => {
    db.product.count.mockResolvedValue(0);
    await request(app).get("/products");
    expect(db.product.findMany.mock.calls[0][0].orderBy).toEqual([{ name: "asc" }]);
  });
});
