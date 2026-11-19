import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    buffetPlateItem: { findUnique: vi.fn() },
    buffetPot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    buffetWeighing: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../buffet-costs.service.js", () => ({
  custosDosPratos: vi.fn(async () => new Map()), custoVisivel: vi.fn(async () => true), semValores: (c: object) => ({ ...c, costPerKg: null }), MAX_PRATOS_NO_CUSTO: 300,
}));

import { Prisma } from "@prisma/client";
import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { custoVisivel, custosDosPratos } from "../buffet-costs.service.js";
import { todayInSaoPaulo } from "../buffet-prints.routes.js";
import { buffetWeighingsRouter } from "../buffet-weighings.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/buffet-plates", buffetWeighingsRouter);

const hoje = todayInSaoPaulo();
const panela = { id: "p1", code: "P01", name: null, tareG: 2400, isActive: true };
const linha = (o: object = {}) => ({
  id: "w1", servedOn: new Date(`${hoje}T00:00:00Z`), kind: "BUFFET", itemId: "i1", potId: "p1", phase: "PRODUCAO",
  grossG: 10400, tareG: 2400, netG: 8000, notes: null, createdAt: new Date(), item: { namePt: "Arroz branco" }, pot: { code: "P01" }, ...o,
});
const erroPrisma = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "5" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1" } as never);
  db.buffetPlateItem.findUnique.mockResolvedValue({ id: "i1" });
  db.buffetPot.findUnique.mockResolvedValue(panela);
  db.buffetPot.count.mockResolvedValue(3);
  db.buffetWeighing.create.mockImplementation(async ({ data }: { data: object }) => linha(data));
});

describe("pesagem: lançar", () => {
  test("abate a panela do peso bruto e grava o peso da panela da época", async () => {
    const r = await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 10400 });
    expect(r.status).toBe(201);
    const data = db.buffetWeighing.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ grossG: 10400, tareG: 2400, netG: 8000, phase: "PRODUCAO", kind: "BUFFET", createdById: "u1" });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_BUFFET_WEIGHING" }));
  });

  test("ignora líquido enviado pelo navegador", async () => {
    await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 5000, netG: 99999, tareG: 1 });
    expect(db.buffetWeighing.create.mock.calls[0][0].data).toMatchObject({ netG: 2600, tareG: 2400 });
  });

  test("recusa bruto menor que a panela vazia", async () => {
    const r = await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 2000 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/menor que o da panela P01 vazia/);
    expect(db.buffetWeighing.create).not.toHaveBeenCalled();
  });

  test("aceita bruto igual à panela (sobra zerada)", async () => {
    const r = await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 2400, phase: "SOBRA" });
    expect(r.status).toBe(201);
    expect(db.buffetWeighing.create.mock.calls[0][0].data).toMatchObject({ netG: 0, phase: "SOBRA" });
  });

  test("recusa panela inativa, prato inexistente e sessão ausente", async () => {
    db.buffetPot.findUnique.mockResolvedValueOnce({ ...panela, isActive: false });
    expect((await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 9000 })).status).toBe(400);
    db.buffetPlateItem.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "x", potId: "p1", grossG: 9000 })).status).toBe(400);
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as never);
    expect((await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 9000 })).status).toBe(401);
  });

  test.each([
    [{ grossG: 0 }, /maior que zero/],
    [{ grossG: 12.5 }, /gramas inteiras/],
    [{ grossG: 500000 }, /acima de 200 kg/],
    [{ servedOn: "2026-02-31" }, /data inválida/],
    [{ servedOn: "2062-10-09" }, /fora do intervalo/],
    [{ phase: "OUTRA" }, /opção inválida/],
  ])("recusa entrada inválida %j", async (patch, msg) => {
    const r = await request(app).post("/buffet-plates/weighings").send({ servedOn: hoje, itemId: "i1", potId: "p1", grossG: 9000, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(msg);
  });
});

describe("pesagem: ler, corrigir e apagar", () => {
  test("lista o dia com resumo de produzido, sobra e consumido", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha(), linha({ id: "w2", phase: "SOBRA", netG: 1500 })]);
    const r = await request(app).get(`/buffet-plates/weighings?date=${hoje}`);
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(2);
    expect(r.body.summary).toMatchObject({ producedG: 8000, leftoverG: 1500, consumedG: 6500 });
  });

  test("traz o valor do dia pelo custo por kg da ficha", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha()]);
    vi.mocked(custosDosPratos).mockResolvedValueOnce(new Map([["i1", { state: "OK", dishId: "d1", dishName: "Arroz", costPerKg: 8, reason: null }]]));
    const r = await request(app).get(`/buffet-plates/weighings?date=${hoje}`);
    expect(r.body.costVisible).toBe(true);
    expect(r.body.costs.i1.costPerKg).toBe(8);
    expect(r.body.value).toMatchObject({ producedCost: 64, itemsWithCost: 1, itemsTotal: 1 });
  });

  test("sem permissão de custos não sai nenhum valor, só o estado da ficha", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([linha()]);
    vi.mocked(custosDosPratos).mockResolvedValueOnce(new Map([["i1", { state: "OK", dishId: "d1", dishName: "Arroz", costPerKg: 8, reason: null }]]));
    vi.mocked(custoVisivel).mockResolvedValueOnce(false);
    const r = await request(app).get(`/buffet-plates/weighings?date=${hoje}`);
    expect(r.body.costVisible).toBe(false);
    expect(r.body.value).toBeNull();
    expect(r.body.costs.i1).toMatchObject({ state: "OK", costPerKg: null });
    expect(JSON.stringify(r.body)).not.toMatch(/"costPerKg":8|producedCost/);
  });

  test("a leitura aceita histórico antigo, além do limite de gravação", async () => {
    db.buffetWeighing.findMany.mockResolvedValue([]);
    expect((await request(app).get("/buffet-plates/weighings?date=2024-01-10")).status).toBe(200);
  });

  test("exige data válida na leitura", async () => {
    expect((await request(app).get("/buffet-plates/weighings")).status).toBe(400);
  });

  test("corrigir o bruto mantém o peso da panela da época", async () => {
    db.buffetWeighing.findUnique.mockResolvedValue(linha({ tareG: 2300 }));
    db.buffetWeighing.update.mockImplementation(async ({ data }: { data: object }) => linha(data));
    const r = await request(app).put("/buffet-plates/weighings/w1").send({ grossG: 9300 });
    expect(r.status).toBe(200);
    expect(db.buffetWeighing.update.mock.calls[0][0].data).toMatchObject({ tareG: 2300, netG: 7000, grossG: 9300 });
  });

  test("trocar a panela passa a valer o peso atual da nova", async () => {
    db.buffetWeighing.findUnique.mockResolvedValue(linha());
    db.buffetPot.findUnique.mockResolvedValue({ ...panela, id: "p2", code: "P02", tareG: 3000 });
    db.buffetWeighing.update.mockImplementation(async ({ data }: { data: object }) => linha(data));
    await request(app).put("/buffet-plates/weighings/w1").send({ potId: "p2" });
    expect(db.buffetWeighing.update.mock.calls[0][0].data).toMatchObject({ potId: "p2", tareG: 3000, netG: 7400 });
  });

  test("corrigir para bruto abaixo da panela é recusado; pesagem inexistente é 404", async () => {
    db.buffetWeighing.findUnique.mockResolvedValueOnce(linha());
    expect((await request(app).put("/buffet-plates/weighings/w1").send({ grossG: 1000 })).status).toBe(400);
    db.buffetWeighing.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put("/buffet-plates/weighings/zz").send({ grossG: 9000 })).status).toBe(404);
  });

  test("apagar registra auditoria; registro removido no meio vira 404", async () => {
    db.buffetWeighing.findUnique.mockResolvedValue(linha());
    db.buffetWeighing.delete.mockResolvedValueOnce({});
    expect((await request(app).delete("/buffet-plates/weighings/w1")).status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE_BUFFET_WEIGHING" }));
    db.buffetWeighing.delete.mockRejectedValueOnce(erroPrisma("P2025"));
    expect((await request(app).delete("/buffet-plates/weighings/w1")).status).toBe(404);
  });
});

describe("panelas", () => {
  test("cadastra com o peso em gramas", async () => {
    db.buffetPot.create.mockImplementation(async ({ data }: { data: object }) => data);
    const r = await request(app).post("/buffet-plates/pots").send({ code: " P03 ", tareG: 2750 });
    expect(r.status).toBe(201);
    expect(db.buffetPot.create.mock.calls[0][0].data).toMatchObject({ code: "P03", tareG: 2750 });
  });

  test("grava o código sempre em maiúscula", async () => {
    db.buffetPot.create.mockImplementation(async ({ data }: { data: object }) => data);
    await request(app).post("/buffet-plates/pots").send({ code: "p07", tareG: 2000 });
    expect(db.buffetPot.create.mock.calls[0][0].data.code).toBe("P07");
  });

  test("código repetido vira 409 em português", async () => {
    db.buffetPot.create.mockRejectedValueOnce(erroPrisma("P2002"));
    const r = await request(app).post("/buffet-plates/pots").send({ code: "P01", tareG: 2400 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Já existe uma panela com o código P01/);
  });

  test("peso da panela inválido e limite de panelas", async () => {
    expect((await request(app).post("/buffet-plates/pots").send({ code: "P9", tareG: 0 })).status).toBe(400);
    db.buffetPot.count.mockResolvedValueOnce(200);
    expect((await request(app).post("/buffet-plates/pots").send({ code: "P9", tareG: 2000 })).status).toBe(400);
  });

  test("atualiza o peso e inativa; panela inexistente é 404", async () => {
    db.buffetPot.findUnique.mockResolvedValueOnce(panela);
    db.buffetPot.update.mockImplementation(async ({ data }: { data: object }) => ({ ...panela, ...data }));
    const r = await request(app).put("/buffet-plates/pots/p1").send({ tareG: 2500, isActive: false });
    expect(r.status).toBe(200);
    expect(db.buffetPot.update.mock.calls[0][0].data).toEqual({ tareG: 2500, isActive: false });
    db.buffetPot.findUnique.mockResolvedValueOnce(null);
    expect((await request(app).put("/buffet-plates/pots/zz").send({ tareG: 2500 })).status).toBe(404);
  });

  test("lista só as ativas, ou todas com all=1", async () => {
    db.buffetPot.findMany.mockResolvedValue([panela]);
    await request(app).get("/buffet-plates/pots");
    expect(db.buffetPot.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    await request(app).get("/buffet-plates/pots?all=1");
    expect(db.buffetPot.findMany.mock.calls[1][0].where).toEqual({});
  });
});
