import type { Request } from "express";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Painel de eventos: rotas com banco de mentira. Nomes de evento fictícios (repositório público).
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    operationDay: { findUnique: vi.fn(), upsert: vi.fn() },
    eventSeries: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    eventEdition: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    eventEditionDay: { update: vi.fn() },
    eventSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../eventos.service.js", () => ({
  agendaDoMes: vi.fn(async () => ({ dias: [], limites: {} })),
  eventosPorData: vi.fn(),
  historicoParaPrevisao: vi.fn(),
  limites: vi.fn(async () => ({ smallMaxLunch: 80, largeMinLunch: 150, lunchCapacity: null })),
  fichaDaSerie: vi.fn(),
  listaDeSeries: vi.fn(async () => []),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { resolvePermissionContext } from "../../security/menu-permissions.js";
import { eventosPorData, historicoParaPrevisao } from "../eventos.service.js";
import { eventsRouter } from "../eventos.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/events", eventsRouter);
app.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => { res.status(500).json({ message: "erro" }); });

const feira = { seriesId: "s1", seriesName: "Feira de Exemplo", origin: "CENTRO_CONVENCOES", posicao: "MEIO" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Gerente", email: "g@x", role: "GESTAO_COMPLETA", mustChangePassword: false } as never);
  db.operationDay.upsert.mockImplementation(async ({ create }: { create: object }) => ({ id: "op1", buffetPrice: null, ...create }));
  vi.mocked(eventosPorData).mockResolvedValue(new Map([["2026-10-07", [feira]]]) as never);
  vi.mocked(historicoParaPrevisao).mockResolvedValue([
    { date: "2025-10-08", lunch: 200, eventos: [feira] },
    { date: "2025-10-09", lunch: 180, eventos: [feira] },
    { date: "2025-11-05", lunch: 170, eventos: [{ ...feira, seriesId: "s2" }] },
  ] as never);
});

describe("decisão do dia", () => {
  test("congela a previsão na primeira decisão", async () => {
    db.operationDay.findUnique.mockResolvedValue(null);
    const r = await request(app).put("/events/days/2026-10-07").send({ serviceMode: "BUFFET", buffetPrice: 89.9, notes: "Parceria com a organização" });
    expect(r.status).toBe(200);
    const gravado = db.operationDay.upsert.mock.calls[0][0].create;
    expect(gravado.forecastLunch).toBeGreaterThan(150);
    expect(gravado.forecastSize).toBe("GRANDE");
    expect(gravado.forecastBasis).toMatch(/Feira de Exemplo/);
  });

  test("editar depois não muda a previsão já congelada", async () => {
    db.operationDay.findUnique.mockResolvedValue({ id: "op1", forecastLunch: 120 });
    await request(app).put("/events/days/2026-10-07").send({ serviceMode: "A_LA_CARTE", notes: null });
    expect(db.operationDay.upsert.mock.calls[0][0].update.forecastLunch).toBeUndefined();
  });

  test("dia que já passou não congela previsão", async () => {
    db.operationDay.findUnique.mockResolvedValue(null);
    await request(app).put("/events/days/2026-09-20").send({ serviceMode: "BUFFET", notes: "Como foi o dia" });
    expect(db.operationDay.upsert.mock.calls[0][0].create.forecastLunch).toBeUndefined();
    expect(historicoParaPrevisao).not.toHaveBeenCalled();
  });

  test("data impossível é recusada", async () => {
    const r = await request(app).put("/events/days/2026-02-31").send({});
    expect(r.status).toBe(400);
  });

  test("modalidade fora da lista é recusada", async () => {
    const r = await request(app).put("/events/days/2026-10-07").send({ serviceMode: "RODIZIO" });
    expect(r.status).toBe(400);
  });
});

describe("edições", () => {
  test("cria a edição com um dia por data e uma série nova quando não há parecida", async () => {
    db.eventSeries.findFirst.mockResolvedValue(null);
    db.eventSeries.create.mockResolvedValue({ id: "s9" });
    db.eventEdition.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "e1", ...data }));
    const r = await request(app).post("/events/editions").send({ title: "3º Congresso Fictício", startDate: "2026-11-10", endDate: "2026-11-12", announcedAudience: 1200 });
    expect(r.status).toBe(201);
    const dados = db.eventEdition.create.mock.calls[0][0].data;
    expect(dados.days.create).toHaveLength(3);
    expect(dados.source).toBe("CIRCULAR");
    expect(db.eventSeries.create.mock.calls[0][0].data.name).toBe("Congresso Fictício");
  });

  test("usa a série existente quando o nome bate com outra edição", async () => {
    db.eventSeries.findFirst.mockResolvedValue({ id: "s1" });
    db.eventEdition.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "e2", ...data }));
    const r = await request(app).post("/events/editions").send({ title: "Feira de Exemplo 2026", startDate: "2026-11-10", endDate: "2026-11-10" });
    expect(r.status).toBe(201);
    expect(r.body.seriesId).toBe("s1");
    expect(db.eventSeries.create).not.toHaveBeenCalled();
  });

  test("ano absurdo é recusado sem gerar milhões de dias", async () => {
    const r = await request(app).post("/events/editions").send({ title: "X evento", startDate: "0001-01-01", endDate: "9999-12-31" });
    expect(r.status).toBe(400);
    expect(db.eventEdition.create).not.toHaveBeenCalled();
  });

  test("fim antes do início e edição longa demais são recusados", async () => {
    expect((await request(app).post("/events/editions").send({ title: "X evento", startDate: "2026-11-10", endDate: "2026-11-09" })).status).toBe(400);
    expect((await request(app).post("/events/editions").send({ title: "X evento", startDate: "2026-11-01", endDate: "2026-12-30" })).status).toBe(400);
  });
});

describe("sugestão de evento conhecido", () => {
  test("acha pelo nome e não sugere evento só porque tem 'Brasil' ou 'Congresso' no nome", async () => {
    db.eventSeries.findMany.mockResolvedValue([
      { id: "s1", name: "Feira de Exemplo Brasil", nameKey: "FEIRA EXEMPLO BRASIL", aliasKeys: [], origin: "CENTRO_CONVENCOES" },
      { id: "s2", name: "Encontro Fictício Brasil", nameKey: "ENCONTRO FICTICIO BRASIL", aliasKeys: [], origin: "CENTRO_CONVENCOES" },
      { id: "s3", name: "Congresso Fictício", nameKey: "CONGRESSO FICTICIO", aliasKeys: ["CONGRESSO FICTICIOS"], origin: "CENTRO_CONVENCOES" },
    ]);
    const r = await request(app).get("/events/series-match").query({ name: "12ª Feira de Exemplo Brasil 2027" });
    expect(r.body).toEqual([{ id: "s1", name: "Feira de Exemplo Brasil", origin: "CENTRO_CONVENCOES", exato: true }]);
    const porApelido = await request(app).get("/events/series-match").query({ name: "Congresso Fictícios" });
    expect(porApelido.body[0]).toMatchObject({ id: "s3", exato: true });
  });
});

describe("juntar séries", () => {
  test("move as edições e guarda o nome antigo como apelido", async () => {
    db.eventSeries.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "a"
        ? { id: "a", name: "Feira Ex.", nameKey: "FEIRA EX", aliasKeys: [], organizer: "Organizadora Fictícia", area: "FEIRA_VAREJO", notes: "Combinar panfleto antes.", editions: [{ id: "e1", startDate: new Date("2025-03-01T00:00:00Z") }] }
        : { id: "b", name: "Feira de Exemplo", nameKey: "FEIRA EXEMPLO", aliasKeys: ["FEIRA EXEMPLOS"], organizer: null, area: "OUTRO", notes: "Público grande no sábado.", editions: [{ startDate: new Date("2026-03-01T00:00:00Z") }] });
    const r = await request(app).post("/events/series/a/merge").send({ intoId: "b" });
    expect(r.status).toBe(200);
    expect(db.eventEdition.updateMany).toHaveBeenCalledWith({ where: { seriesId: "a" }, data: { seriesId: "b" } });
    const juntada = db.eventSeries.update.mock.calls[0][0].data;
    expect(juntada.aliasKeys).toEqual(["FEIRA EXEMPLOS", "FEIRA EX"]);
    // O que se sabia do evento absorvido não se perde.
    expect(juntada).toMatchObject({ organizer: "Organizadora Fictícia", area: "FEIRA_VAREJO", notes: "Público grande no sábado.\n\nCombinar panfleto antes." });
    expect(db.eventSeries.delete).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  test("não junta quando as duas têm edição no mesmo início", async () => {
    const mesma = [{ id: "e1", startDate: new Date("2026-03-01T00:00:00Z") }];
    db.eventSeries.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, nameKey: where.id, aliasKeys: [], editions: mesma }));
    const r = await request(app).post("/events/series/a/merge").send({ intoId: "b" });
    expect(r.status).toBe(409);
    expect(db.eventEdition.updateMany).not.toHaveBeenCalled();
  });
});

describe("configuração", () => {
  test("o Grande tem de começar acima do Pequeno", async () => {
    const r = await request(app).put("/events/settings").send({ smallMaxLunch: 150, largeMinLunch: 80 });
    expect(r.status).toBe(400);
  });
});

// Sem a regra no menuFromRequest, o prefixo novo passaria sem checar permissão.
describe("controle de acesso", () => {
  const ctx = (method: string, path: string) => resolvePermissionContext({ method, path, body: {}, query: {} } as unknown as Request);
  test("rotas resolvem para o módulo Painel de eventos", async () => {
    expect(await ctx("GET", "/events/agenda")).toEqual({ menuId: "events", action: "view" });
    expect(await ctx("PUT", "/events/days/2026-10-07")).toEqual({ menuId: "events", action: "edit" });
    expect(await ctx("POST", "/Events/editions")).toEqual({ menuId: "events", action: "create" });
  });
  test("juntar apaga o evento absorvido: pede permissão de apagar", async () => {
    expect(await ctx("POST", "/events/series/abc/merge")).toEqual({ menuId: "events", action: "delete" });
  });
  test("mudar limites e capacidade é configuração: pede admin", async () => {
    expect(await ctx("PUT", "/events/settings")).toEqual({ menuId: "events", action: "admin" });
    expect(await ctx("GET", "/events/settings")).toEqual({ menuId: "events", action: "view" });
  });
});
