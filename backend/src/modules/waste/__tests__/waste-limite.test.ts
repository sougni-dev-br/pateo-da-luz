import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn() }));

import { getSessionUser } from "../../security/security-utils.js";
import { criarLimitador, limitarGravacoes } from "../waste-limite.js";

describe("criarLimitador", () => {
  test("deixa passar até o limite e depois informa quantos segundos esperar", () => {
    let agora = 1_000_000;
    const l = criarLimitador({ quantidade: 3, porMinuto: 1 }, () => agora);
    expect([l.tentar("u1"), l.tentar("u1"), l.tentar("u1")]).toEqual([0, 0, 0]);
    agora += 10_000;
    expect(l.tentar("u1")).toBe(50);
  });

  test("a janela desliza: depois de um minuto volta a passar", () => {
    let agora = 0;
    const l = criarLimitador({ quantidade: 1, porMinuto: 1 }, () => agora);
    expect(l.tentar("u1")).toBe(0);
    agora = 59_000;
    expect(l.tentar("u1")).toBeGreaterThan(0);
    agora = 60_001;
    expect(l.tentar("u1")).toBe(0);
  });

  test("cada usuário tem o seu contador", () => {
    const l = criarLimitador({ quantidade: 1, porMinuto: 1 }, () => 0);
    expect(l.tentar("a")).toBe(0);
    expect(l.tentar("b")).toBe(0);
    expect(l.tentar("a")).toBeGreaterThan(0);
  });
});

describe("limitarGravacoes", () => {
  const montar = () => {
    const app = express();
    app.use(limitarGravacoes({ quantidade: 2, porMinuto: 1 }));
    app.post("/x", (_req, res) => void res.json({ ok: true }));
    app.get("/x", (_req, res) => void res.json({ ok: true }));
    return app;
  };

  beforeEach(() => vi.mocked(getSessionUser).mockResolvedValue({ id: "u1" } as never));

  test("a terceira gravação seguida volta 429 com Retry-After", async () => {
    const app = montar();
    expect((await request(app).post("/x")).status).toBe(200);
    expect((await request(app).post("/x")).status).toBe(200);
    const r = await request(app).post("/x");
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toMatch(/^\d+$/);
    expect(r.body.message).toMatch(/Aguarde/);
  });

  test("leituras nunca são limitadas", async () => {
    const app = montar();
    for (let i = 0; i < 5; i += 1) expect((await request(app).get("/x")).status).toBe(200);
  });

  test("usuários diferentes não dividem o limite", async () => {
    const app = montar();
    vi.mocked(getSessionUser).mockResolvedValue({ id: "a" } as never);
    await request(app).post("/x"); await request(app).post("/x");
    vi.mocked(getSessionUser).mockResolvedValue({ id: "b" } as never);
    expect((await request(app).post("/x")).status).toBe(200);
  });
});
