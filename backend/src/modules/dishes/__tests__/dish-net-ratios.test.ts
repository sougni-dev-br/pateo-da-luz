import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { $queryRaw: vi.fn(), dish: { findUnique: vi.fn(), findMany: vi.fn() } }
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(),
  auditLog: vi.fn(),
  requestIp: vi.fn(() => "127.0.0.1")
}));

import { prisma } from "../../../config/database.js";
import { requireRole } from "../../security/security-utils.js";
import { DIAS_MAXIMO, DIAS_MINIMO, DIAS_PADRAO, calcularRazoes, normalizarDias } from "../dish-net-ratios.js";
import { dishesRouter } from "../dishes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/dishes", dishesRouter);
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: "erro" });
});

const loja = (deliveryStoreId: string, nickname: string, tabela: number, liquido: number, pedidos: number) => ({ deliveryStoreId, nickname, tabela, liquido, pedidos });

describe("razão líquido ÷ tabela da 99 (pura)", () => {
  test("cada loja tem a sua razão, medida nos pedidos dela", () => {
    const r = calcularRazoes([loja("a", "Frei Caneca", 1000, 540, 100), loja("b", "Pizzaria", 1000, 380, 80)], 60);
    expect(r.lojas.map((l) => [l.storeName, l.razao, l.base])).toEqual([["Frei Caneca", 0.54, "loja"], ["Pizzaria", 0.38, "loja"]]);
    expect(r.plataforma).toEqual({ razao: 0.46, pedidos: 180 }); // (540 + 380) / 2000
    expect(r.dias).toBe(60);
  });

  test("loja com poucos pedidos usa a razão da plataforma, e diz isso", () => {
    const r = calcularRazoes([loja("a", "Grande", 1000, 500, 200), loja("b", "Nova", 100, 90, 5)], 60);
    expect(r.lojas[1]).toMatchObject({ storeName: "Nova", base: "plataforma", pedidos: 5 });
    expect(r.lojas[1].razao).toBeCloseTo(590 / 1100, 3);
  });

  test("sem pedidos com preço de tabela não inventa razão", () => {
    expect(calcularRazoes([], 60)).toMatchObject({ plataforma: { razao: null, pedidos: 0 }, lojas: [] });
    expect(calcularRazoes([loja("a", "X", 0, 0, 50)], 60).lojas[0].razao).toBeNull();
  });

  test("a janela de dias tem padrão, mínimo e máximo", () => {
    expect(normalizarDias(undefined)).toBe(DIAS_PADRAO);
    expect(normalizarDias("abc")).toBe(DIAS_PADRAO);
    expect(normalizarDias(1)).toBe(DIAS_MINIMO);
    expect(normalizarDias(9999)).toBe(DIAS_MAXIMO);
    expect(normalizarDias("90")).toBe(90);
  });
});

describe("GET /dishes/net-ratios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Eli", role: "VISUALIZACAO" } as never);
  });

  test("devolve as razões por loja (sem ser confundida com um prato)", async () => {
    db.$queryRaw.mockResolvedValue([{ id: "s1", nickname: "Pateo Frei Caneca", tabela: "67187.91", liquido: "35913.95", pedidos: 901 }]);
    const r = await request(app).get("/dishes/net-ratios?dias=30");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ channel: "NOVENTA_NOVE", dias: 30, plataforma: { pedidos: 901 } });
    expect(r.body.lojas[0]).toMatchObject({ deliveryStoreId: "s1", storeName: "Pateo Frei Caneca", base: "loja" });
    expect(r.body.lojas[0].razao).toBeCloseTo(0.5345, 3);
    expect(db.dish.findUnique).not.toHaveBeenCalled();
  });

  test("sem pedidos devolve listas vazias", async () => {
    db.$queryRaw.mockResolvedValue([]);
    const r = await request(app).get("/dishes/net-ratios");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dias: DIAS_PADRAO, plataforma: { razao: null }, lojas: [] });
  });
});
