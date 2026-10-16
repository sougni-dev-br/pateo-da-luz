import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas de produto: classificação (categoria e subcategoria), controle de estoque e situação no PUT, e o POST.
// O prisma é simulado com a mesma regra do real para campo ausente (undefined = não mexe, null = limpa).
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    category: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    subcategory: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    product: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    productAlias: { findUnique: vi.fn(), upsert: vi.fn() },
    unitMeasure: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn()
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
import { auditLog, requireRole } from "../../security/security-utils.js";
import { productRouter } from "../product.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/products", productRouter);
app.use((erro: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: erro instanceof Error ? erro.message : "erro" });
});

const BEBIDAS = { id: "c-beb", name: "BEBIDAS", nature: "INSUMO", defaultDreCategoryId: "dre-beb", isActive: true };
const LIMPEZA = { id: "c-limp", name: "LIMPEZA", nature: "CONSUMO", defaultDreCategoryId: "dre-limp", isActive: true };
const DESTILADOS = { id: "s-dest", name: "DESTILADOS", categoryId: "c-beb" };
const VINHOS_DE_LIMPEZA = { id: "s-limp", name: "GERAL", categoryId: "c-limp" };

// Produto como está no banco antes do PUT.
const anterior = {
  id: "p1", inventorySectorId: "set1", categoryId: "c-beb", subcategoryId: "s-dest", unit: "UN", stockUnit: null,
  accountType: null, controlsStock: false, isActive: false, externalCode: "100", estoqueMinimo: null, estoqueIdeal: null,
  leadTimeCompraDias: null, fornecedorPrincipalId: null, storageLocation: null, storageCorridor: null, storageShelf: null,
  storagePosition: null, storageNotes: null
};

// Corpo que o editor manda: o formulário inteiro, com ids.
const corpo = (extra: Record<string, unknown> = {}) => ({
  name: "Produto de teste", externalCode: "100", unitMeasureId: "u1", dreCategoryId: "dre-beb", inventorySectorId: "set1",
  categoryId: "c-beb", subcategoryId: "s-dest", controlsStock: false, isActive: false, ...extra
});

const dadosGravados = () => db.product.update.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Teste", role: "ADMIN" } as never);
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    return sql.includes('"categoryId", "subcategoryId"') ? [{ ...anterior }] : [];
  });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (arg: unknown) => (arg as (tx: unknown) => unknown)(prisma));
  db.product.findFirst.mockResolvedValue(null);
  db.productAlias.findUnique.mockResolvedValue(null);
  db.productAlias.upsert.mockResolvedValue({});
  db.unitMeasure.findFirst.mockResolvedValue({ id: "u1", code: "un" });
  db.category.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => [BEBIDAS, LIMPEZA].find((c) => c.id === where.id) ?? null);
  db.category.findFirst.mockImplementation(async ({ where }: { where: { name: { equals: string } } }) =>
    [BEBIDAS, LIMPEZA].find((c) => c.name.toLowerCase() === String(where.name.equals).toLowerCase()) ?? null);
  db.subcategory.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    [DESTILADOS, VINHOS_DE_LIMPEZA].find((s) => s.id === where.id) ?? null);
  db.subcategory.findFirst.mockResolvedValue(null);
  // Simula o prisma real: undefined não altera a coluna, null limpa.
  db.product.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...anterior,
    ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    category: null, subcategory: null, inventorySector: null, aliases: [], dreCategory: null
  }));
});

describe("PUT /products/:id: classificação", () => {
  test("trocar a categoria e deixar a subcategoria vazia limpa a subcategoria da categoria antiga", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ categoryId: "c-limp", subcategoryId: "" }));
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBe("c-limp");
    expect(dadosGravados().subcategoryId).toBeNull();
  });

  test("cliente antigo que troca a categoria e nem manda subcategoria também não deixa a antiga para trás", async () => {
    const { subcategoryId: _omitida, ...semSub } = corpo({ categoryId: "c-limp" });
    const r = await request(app).put("/products/p1").send(semSub);
    expect(r.status).toBe(200);
    expect(dadosGravados().subcategoryId).toBeNull();
  });

  test("limpar só a subcategoria, mantendo a categoria, grava null", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ subcategoryId: "" }));
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBe("c-beb");
    expect(dadosGravados().subcategoryId).toBeNull();
  });

  test("mesma categoria e subcategoria enviada: mantém", async () => {
    const r = await request(app).put("/products/p1").send(corpo());
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBe("c-beb");
    expect(dadosGravados().subcategoryId).toBe("s-dest");
  });

  test("mesma categoria sem nenhum campo de classificação (cliente antigo): não mexe", async () => {
    const { categoryId: _c, subcategoryId: _s, ...semClassificacao } = corpo();
    const r = await request(app).put("/products/p1").send(semClassificacao);
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBeUndefined();
    expect(dadosGravados().subcategoryId).toBeUndefined();
  });

  test("subcategoria de outra categoria é recusada", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ categoryId: "c-limp", subcategoryId: "s-dest" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/subcategoria/i);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  test("categoria que não existe é recusada, sem estourar erro de chave estrangeira", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ categoryId: "nao-existe", subcategoryId: "" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/categoria/i);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  test("categoria por nome que não existe não é criada na rota de produto", async () => {
    const { categoryId: _c, subcategoryId: _s, ...semIds } = corpo({ categoryName: "CATEGORIA NOVA" });
    const r = await request(app).put("/products/p1").send(semIds);
    expect(r.status).toBe(400);
    expect(db.category.upsert).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  test("categoria por nome acha a existente sem diferenciar maiúsculas", async () => {
    const { categoryId: _c, subcategoryId: _s, ...semIds } = corpo({ categoryName: "limpeza" });
    const r = await request(app).put("/products/p1").send(semIds);
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBe("c-limp");
    expect(db.category.upsert).not.toHaveBeenCalled();
  });
});

describe("PUT /products/:id: casos de borda da classificação", () => {
  test("o id vence quando o nome da categoria vem junto e discorda", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ categoryId: "c-limp", subcategoryId: "", categoryName: "BEBIDAS" }));
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBe("c-limp");
  });

  test("categoryId vazio não apaga a categoria do produto", async () => {
    const { subcategoryId: _s, ...semSub } = corpo({ categoryId: "" });
    const r = await request(app).put("/products/p1").send(semSub);
    expect(r.status).toBe(200);
    expect(dadosGravados().categoryId).toBeUndefined();
    expect(dadosGravados().subcategoryId).toBeUndefined();
  });

  test("subcategoria por nome é achada dentro da categoria final", async () => {
    db.subcategory.findFirst.mockImplementation(async ({ where }: { where: { categoryId: string } }) =>
      where.categoryId === "c-limp" ? { id: "s-limp" } : null);
    const { subcategoryId: _s, ...semSub } = corpo({ categoryId: "c-limp", subcategoryName: "geral" });
    const r = await request(app).put("/products/p1").send(semSub);
    expect(r.status).toBe(200);
    expect(dadosGravados().subcategoryId).toBe("s-limp");
  });

  test("subcategoria por nome que não existe nessa categoria é recusada", async () => {
    const { subcategoryId: _s, ...semSub } = corpo({ subcategoryName: "inexistente" });
    const r = await request(app).put("/products/p1").send(semSub);
    expect(r.status).toBe(400);
    expect(db.subcategory.upsert).not.toHaveBeenCalled();
  });

  test("DRE e tipo de conta omitidos não são apagados", async () => {
    const { dreCategoryId: _d, ...semDre } = corpo();
    const r = await request(app).put("/products/p1").send(semDre);
    expect(r.status).toBe(200);
    expect(dadosGravados().dreCategoryId).toBeUndefined();
    expect(dadosGravados().accountType).toBeUndefined();
  });
});

describe("PUT /products/:id: estoque e situação não voltam ao padrão por omissão", () => {
  test("sem controlsStock no corpo, o produto que não conta estoque continua sem contar", async () => {
    const { controlsStock: _omitido, ...semEstoque } = corpo();
    const r = await request(app).put("/products/p1").send(semEstoque);
    expect(r.status).toBe(200);
    expect(dadosGravados().controlsStock).toBe(false);
  });

  test("sem isActive no corpo, o produto inativo continua inativo", async () => {
    const { isActive: _omitido, ...semSituacao } = corpo();
    const r = await request(app).put("/products/p1").send(semSituacao);
    expect(r.status).toBe(200);
    expect(dadosGravados().isActive).toBe(false);
  });

  test("o valor enviado vence o anterior", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ controlsStock: true, isActive: true }));
    expect(r.status).toBe(200);
    expect(dadosGravados().controlsStock).toBe(true);
    expect(dadosGravados().isActive).toBe(true);
  });

  test("mudar o controle de estoque gera registro de reclassificação com o valor anterior", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ controlsStock: true }));
    expect(r.status).toBe(200);
    const chamadasDeAuditoria = db.$executeRaw.mock.calls.filter((c: unknown[]) => (c[0] as string[]).join("?").includes("RECLASSIFY_PRODUCT"));
    expect(chamadasDeAuditoria).toHaveLength(1);
    expect(JSON.stringify(chamadasDeAuditoria[0])).toContain('\\"controlsStock\\":false');
  });
});

describe("PUT /products/:id: natureza", () => {
  test("sem natureza no corpo, não mexe na natureza gravada", async () => {
    const r = await request(app).put("/products/p1").send(corpo());
    expect(r.status).toBe(200);
    expect("nature" in dadosGravados()).toBe(false);
  });

  test("com natureza, exige os campos do tipo", async () => {
    const r = await request(app).put("/products/p1").send(corpo({ nature: "INSUMO", unitMeasureId: "", dreCategoryId: "" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/unidade/);
  });

  test("produto inexistente devolve 404", async () => {
    db.$queryRaw.mockResolvedValue([]);
    const r = await request(app).put("/products/nao-existe").send(corpo());
    expect(r.status).toBe(404);
  });
});

describe("POST /products", () => {
  beforeEach(() => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("?").includes("ProductSequence") ? [{ currentValue: 1259 }] : []);
    db.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "novo", ...data, category: null, subcategory: null, inventorySector: null, aliases: [], dreCategory: null
    }));
  });

  test("honra categoryId e subcategoryId enviados (antes ignorava os ids e gravava sem categoria)", async () => {
    const r = await request(app).post("/products").send(corpo({ nature: "INSUMO", controlsStock: true, isActive: true }));
    expect(r.status).toBe(201);
    const dados = db.product.create.mock.calls[0][0].data;
    expect(dados.categoryId).toBe("c-beb");
    expect(dados.subcategoryId).toBe("s-dest");
  });

  test("subcategoria de outra categoria é recusada também no cadastro", async () => {
    const r = await request(app).post("/products").send(corpo({ categoryId: "c-limp", subcategoryId: "s-dest" }));
    expect(r.status).toBe(400);
    expect(db.product.create).not.toHaveBeenCalled();
  });

  test("com natureza e faltando campo, recusa antes de gastar um código", async () => {
    const r = await request(app).post("/products").send({ name: "Item", nature: "INSUMO" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Preencha antes de salvar/);
    expect(db.product.create).not.toHaveBeenCalled();
  });
});

describe("GET /products/:id e /products/similar", () => {
  test("produto inexistente devolve 404", async () => {
    db.product.findUnique.mockResolvedValue(null);
    const r = await request(app).get("/products/nao-existe");
    expect(r.status).toBe(404);
  });

  test("similar: sem palavras úteis devolve lista vazia sem consultar o banco", async () => {
    const r = await request(app).get("/products/similar?name=de");
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });

  test("similar: devolve os nomes parecidos pelas palavras em comum", async () => {
    db.product.findMany.mockResolvedValue([
      { id: "a", name: "FARINHA DE TRIGO 1KG", normalizedName: "farinha de trigo 1kg", externalCode: "1", unit: "UN" },
      { id: "b", name: "DETERGENTE", normalizedName: "detergente", externalCode: "2", unit: "UN" }
    ]);
    const r = await request(app).get("/products/similar?name=farinha%20trigo");
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual(["a"]);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
