import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { $queryRaw: vi.fn(), dish: { findUnique: vi.fn(), findMany: vi.fn() }, deliveryStore: { findMany: vi.fn() } }
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(),
  auditLog: vi.fn(),
  requestIp: vi.fn(() => "127.0.0.1")
}));

import { prisma } from "../../../config/database.js";
import { requireRole } from "../../security/security-utils.js";
import { DIAS_MAXIMO, DIAS_MINIMO, DIAS_PADRAO, calcularRazoes, calcularRazoesPorFaturamento, lojaDaDescricao, normalizarDias } from "../dish-net-ratios.js";
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

const dia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);
const linhaIfood = (loja: string, bruto: number, liquido: number) => ({
  descricao: `Delivery iFood - ${loja} (consolidado do mes)`, bruto, liquido, de: dia("2026-07-31"), ate: dia("2026-08-31")
});

describe("razão líquido ÷ faturamento (iFood e Keeta)", () => {
  test("lê a loja do iFood na descrição do lançamento", () => {
    expect(lojaDaDescricao("Delivery iFood - Pateo da Luz & Massas e Parmeggiana (consolidado do mes)")).toBe("pateo da luz & massas e parmeggiana");
    expect(lojaDaDescricao("Delivery Keeta - sexta-feira")).toBeNull();
    expect(lojaDaDescricao(null)).toBeNull();
  });

  test("iFood: cada loja pela sua razão, com a plataforma de reserva", () => {
    const canal = calcularRazoesPorFaturamento(
      "IFOOD",
      [linhaIfood("Pateo da Luz", 10_000, 6_000), linhaIfood("Pizzaria", 4_000, 3_000)],
      [{ id: "a", nickname: "Pateo da Luz" }, { id: "b", nickname: "Pateo da Luz Pizzaria" }]
    );
    expect(canal).toMatchObject({ channel: "IFOOD", fonte: "faturamento", plataforma: { razao: 0.6429 } }); // 9000 / 14000
    expect(canal.lojas[0]).toMatchObject({ deliveryStoreId: "a", razao: 0.6, base: "loja" });
    // A "Pizzaria" do lançamento não é o nome da loja ("Pateo da Luz Pizzaria"): sem casar, vale a plataforma.
    expect(canal.lojas[1]).toMatchObject({ deliveryStoreId: "b", razao: 0.6429, base: "plataforma" });
    expect(canal.referencia).toMatchObject({ faturamento: 14_000, de: "2026-07-31", ate: "2026-08-31" });
  });

  test("loja que quase não vendeu ou fechou negativa usa a razão da plataforma", () => {
    const canal = calcularRazoesPorFaturamento(
      "IFOOD",
      [linhaIfood("Pateo da Luz", 10_000, 6_000), linhaIfood("Peposo - Frei Caneca", 208, -243.68), linhaIfood("Pateo da Luz Pizzaria", 1_500, 1_000)],
      [{ id: "a", nickname: "Pateo da Luz" }, { id: "p", nickname: "Peposo - Frei Caneca" }, { id: "z", nickname: "Pateo da Luz Pizzaria" }]
    );
    expect(canal.lojas.map((l) => l.base)).toEqual(["loja", "plataforma", "plataforma"]);
    expect(canal.lojas[1].razao).toBeGreaterThan(0);
  });

  test("Keeta não tem loja cadastrada: a plataforma vira uma loja única", () => {
    const canal = calcularRazoesPorFaturamento(
      "KEETA",
      [{ descricao: "Delivery Keeta - domingo", bruto: 2_000, liquido: 1_560, de: dia("2026-09-13"), ate: dia("2026-09-13") }],
      []
    );
    expect(canal.lojas).toEqual([{ deliveryStoreId: "plataforma:KEETA", storeName: "Keeta (loja única)", razao: 0.78, pedidos: 0, base: "plataforma" }]);
  });

  test("sem lançamentos não inventa razão", () => {
    expect(calcularRazoesPorFaturamento("KEETA", [], []).plataforma.razao).toBeNull();
  });
});

describe("GET /dishes/net-ratios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({ id: "u1", name: "Eli", role: "VISUALIZACAO" } as never);
  });

  test("devolve as razões por loja (sem ser confundida com um prato)", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ id: "s1", nickname: "Pateo Frei Caneca", tabela: "67187.91", liquido: "35913.95", pedidos: 901 }])
      .mockResolvedValueOnce([{ descricao: "Delivery iFood - Pateo da Luz (consolidado do mes)", bruto: "10000", liquido: "6000", de: "2026-07-31", ate: "2026-08-31" }])
      .mockResolvedValueOnce([{ descricao: "Delivery Keeta - domingo", bruto: "2000", liquido: "1560", de: "2026-09-13", ate: "2026-09-13" }]);
    db.deliveryStore.findMany.mockImplementation(async ({ where }: { where: { platform: string } }) =>
      where.platform === "IFOOD" ? [{ id: "i1", nickname: "Pateo da Luz" }] : []);
    const r = await request(app).get("/dishes/net-ratios?dias=30");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ channel: "NOVENTA_NOVE", dias: 30, plataforma: { pedidos: 901 } });
    expect(r.body.lojas[0]).toMatchObject({ deliveryStoreId: "s1", storeName: "Pateo Frei Caneca", base: "loja" });
    expect(r.body.lojas[0].razao).toBeCloseTo(0.5345, 3);
    expect(db.dish.findUnique).not.toHaveBeenCalled();
    // As três plataformas, cada uma dizendo de onde vem a razão.
    expect(r.body.canais.map((c: { channel: string; fonte: string }) => [c.channel, c.fonte])).toEqual([
      ["NOVENTA_NOVE", "tabela"], ["IFOOD", "faturamento"], ["KEETA", "faturamento"]
    ]);
    expect(r.body.canais[1].lojas[0]).toMatchObject({ deliveryStoreId: "i1", razao: 0.6, base: "loja" });
    expect(r.body.canais[2].lojas[0]).toMatchObject({ deliveryStoreId: "plataforma:KEETA", razao: 0.78 });
  });

  test("sem pedidos devolve listas vazias", async () => {
    db.$queryRaw.mockResolvedValue([]);
    db.deliveryStore.findMany.mockResolvedValue([]);
    const r = await request(app).get("/dishes/net-ratios");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dias: DIAS_PADRAO, plataforma: { razao: null }, lojas: [] });
  });
});
