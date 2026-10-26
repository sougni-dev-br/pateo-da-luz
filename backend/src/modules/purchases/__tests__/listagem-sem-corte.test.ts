import express from "express";
import request from "supertest";
import { beforeEach, expect, test, vi } from "vitest";

// A lista de Compras cortava em 100 ANTES de tirar as canceladas (elas ocupavam vagas) e
// os cartões de resumo da tela somavam só essas 100. O corte agora é só um limite de
// segurança, avisado por cabeçalho, e as canceladas saem no banco.
vi.mock("../../../config/database.js", () => ({
  prisma: { purchase: { findMany: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));

import { prisma } from "../../../config/database.js";
import { purchaseRouter } from "../purchase.routes.js";
import { LIMITE_POR_ORIGEM } from "../payables-limite.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/purchases", purchaseRouter);

const compra = (i: number) => ({ id: `c${i}`, purchaseDate: new Date(Date.UTC(2026, 0, 1)), items: [], installments: [] });

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

test("devolve mais de 100 compras do período, sem cortar", async () => {
  db.purchase.findMany.mockResolvedValue(Array.from({ length: 250 }, (_, i) => compra(i)));
  const r = await request(app).get("/purchases");
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(250);
  expect(r.headers["x-purchases-truncado"]).toBeUndefined();
});

test("canceladas saem na consulta (antes de qualquer corte), não depois", async () => {
  db.purchase.findMany.mockResolvedValue([]);
  await request(app).get("/purchases");
  expect(db.purchase.findMany.mock.calls[0][0].where.status).toEqual({ not: "CANCELLED" });
});

test("showCancelled=true não filtra por status", async () => {
  db.purchase.findMany.mockResolvedValue([]);
  await request(app).get("/purchases?showCancelled=true");
  expect(db.purchase.findMany.mock.calls[0][0].where.status).toBeUndefined();
});

test("limite de segurança atingido: devolve o limite e avisa no cabeçalho", async () => {
  db.purchase.findMany.mockResolvedValue(Array.from({ length: LIMITE_POR_ORIGEM + 1 }, (_, i) => compra(i)));
  const r = await request(app).get("/purchases");
  expect(r.body).toHaveLength(LIMITE_POR_ORIGEM);
  expect(r.headers["x-purchases-truncado"]).toBe("1");
});

test("ids vão ao SQL como um único array (ano inteiro não estoura o limite de parâmetros)", async () => {
  db.purchase.findMany.mockResolvedValue(Array.from({ length: LIMITE_POR_ORIGEM }, (_, i) => ({ ...compra(i), items: [{ id: `i${i}` }] })));
  await request(app).get("/purchases");
  for (const chamada of db.$queryRaw.mock.calls) {
    expect(chamada.length - 1).toBeLessThanOrEqual(2);
  }
});
