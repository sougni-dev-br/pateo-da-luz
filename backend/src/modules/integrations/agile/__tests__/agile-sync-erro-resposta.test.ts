import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O /sync responde ao AGENTE da maquina do PDV. Quando algo falha por dentro (banco fora,
// timeout), o agente so precisa saber que deve tentar de novo: o detalhe tecnico (host e porta
// do banco, por exemplo) fica no log do servidor e nao vai para o log da maquina do caixa.
vi.mock("../agile-sync.service.js", () => ({ importAgileSync: vi.fn(), getAgileSyncStatus: vi.fn() }));
vi.mock("../agile-heartbeat.service.js", () => ({ registrarHeartbeat: vi.fn(), obterSaudeAgente: vi.fn() }));
vi.mock("../../../security/security-utils.js", () => ({ requireRole: vi.fn(), getSessionUser: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn() }));

import { agileIntegrationRouter } from "../agile-sync.routes.js";
import { importAgileSync } from "../agile-sync.service.js";

const TOKEN = "t".repeat(64);
const app = express();
app.use(express.json());
app.use("/integrations/agile", agileIntegrationRouter);

const corpo = { periodoInicio: "2026-10-01", periodoFim: "2026-10-01", vendas: [], pagamentos: [], itens: [] };
const enviar = () => request(app).post("/integrations/agile/sync").set("X-Agile-Token", TOKEN).send(corpo);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGILE_INGEST_TOKEN = TOKEN;
});

describe("POST /integrations/agile/sync — erro interno", () => {
  test("falha de banco: 500 generico, sem host nem porta do banco, e o detalhe vai para o log", async () => {
    vi.mocked(importAgileSync).mockRejectedValue(new Error("Can't reach database server at dpg-abc123-a:5432"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviar();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/dpg-|5432|database server/);
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message).toMatch(/tente novamente/i);
    expect(log).toHaveBeenCalled(); // o detalhe fica no servidor
    log.mockRestore();
  });

  test("erro que nao e Error (string solta) tambem sai generico", async () => {
    vi.mocked(importAgileSync).mockRejectedValue("falha estranha");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await enviar();
    log.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/tente novamente/i);
  });

  test("sucesso continua devolvendo o relatorio", async () => {
    vi.mocked(importAgileSync).mockResolvedValue({ batchId: "b", diasImportados: 1 } as never);
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(r.body.batchId).toBe("b");
  });

  test("payload invalido continua 400 com os detalhes (esses nao vazam nada interno)", async () => {
    const r = await request(app).post("/integrations/agile/sync").set("X-Agile-Token", TOKEN).send({ periodoInicio: "x" });
    expect(r.status).toBe(400);
    expect(r.body.errors).toBeTruthy();
  });
});
