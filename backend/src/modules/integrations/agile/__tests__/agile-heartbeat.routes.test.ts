import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Heartbeat do agente do PDV. Banco de mentira: o que importa aqui e a regra.
vi.mock("../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileAgentHeartbeat: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn()
  };
  return { prisma };
});
vi.mock("../../../security/security-utils.js", () => ({
  requireRole: vi.fn(), auditLog: vi.fn(), getSessionUser: vi.fn(), requestIp: vi.fn(() => "127.0.0.1")
}));
vi.mock("../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../../config/database.js";
import { requireRole } from "../../../security/security-utils.js";
import { agileIntegrationRouter } from "../agile-sync.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const TOKEN = "t".repeat(64);
const app = express();
app.use(express.json());
app.use("/integrations/agile", agileIntegrationRouter);

const corpoOk = {
  status: "ok",
  mensagem: null,
  periodoInicio: "2026-10-08",
  periodoFim: "2026-10-13",
  batchId: "b-1",
  diasImportados: 6,
  totalBruto: 12345.67,
  duracaoMs: 8400,
  agenteVersion: "1.4.0",
  agenteHost: "PDVTOUCH",
  ocorridoEm: "2026-10-13T15:00:00.000Z"
};
const post = (body: unknown, token: string | null = TOKEN) => {
  const r = request(app).post("/integrations/agile/heartbeat");
  return (token === null ? r : r.set("X-Agile-Token", token)).send(body as object);
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGILE_INGEST_TOKEN = TOKEN;
  db.agileAgentHeartbeat.findUnique.mockResolvedValue(null);
  db.agileAgentHeartbeat.upsert.mockResolvedValue({});
});

describe("POST /integrations/agile/heartbeat — autenticacao e validacao", () => {
  test("sem token: 401 e nada gravado", async () => {
    const r = await post(corpoOk, null);
    expect(r.status).toBe(401);
    expect(db.agileAgentHeartbeat.upsert).not.toHaveBeenCalled();
  });

  test("token errado: 401", async () => {
    const r = await post(corpoOk, "x".repeat(64));
    expect(r.status).toBe(401);
    expect(db.agileAgentHeartbeat.upsert).not.toHaveBeenCalled();
  });

  test("servidor sem AGILE_INGEST_TOKEN configurado: 503, igual ao /sync", async () => {
    delete process.env.AGILE_INGEST_TOKEN;
    expect((await post(corpoOk)).status).toBe(503);
  });

  test.each(["status", "periodoInicio", "periodoFim", "duracaoMs", "agenteHost", "ocorridoEm"])(
    "campo obrigatorio ausente (%s): 400 com { erro }",
    async (campo) => {
      const corpo: Record<string, unknown> = { ...corpoOk };
      delete corpo[campo];
      const r = await post(corpo);
      expect(r.status).toBe(400);
      expect(typeof r.body.erro).toBe("string");
      expect(db.agileAgentHeartbeat.upsert).not.toHaveBeenCalled();
    }
  );

  test("status fora do enum: 400", async () => {
    const r = await post({ ...corpoOk, status: "talvez" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toBeTruthy();
  });

  test("mensagem acima de 500 caracteres: 400", async () => {
    expect((await post({ ...corpoOk, status: "erro", mensagem: "x".repeat(501) })).status).toBe(400);
    expect((await post({ ...corpoOk, status: "erro", mensagem: "x".repeat(500) })).status).toBe(200);
  });

  test("data fora de YYYY-MM-DD e ocorridoEm que nao e ISO: 400", async () => {
    expect((await post({ ...corpoOk, periodoFim: "13/10/2026" })).status).toBe(400);
    expect((await post({ ...corpoOk, ocorridoEm: "ontem" })).status).toBe(400);
  });

  test("agenteHost vazio: 400 (e a chave do registro)", async () => {
    expect((await post({ ...corpoOk, agenteHost: "  " })).status).toBe(400);
  });
});

describe("POST /integrations/agile/heartbeat — gravacao", () => {
  test("primeiro heartbeat ok: devolve recebidoEm e cria o registro com hora do SERVIDOR", async () => {
    const antes = Date.now();
    const r = await post(corpoOk);
    expect(r.status).toBe(200);
    expect(Date.parse(r.body.recebidoEm)).toBeGreaterThanOrEqual(antes);

    const args = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ sourcePlatform_agenteHost: { sourcePlatform: "AGILE_PDV", agenteHost: "PDVTOUCH" } });
    expect(args.create).toMatchObject({
      sourcePlatform: "AGILE_PDV", agenteHost: "PDVTOUCH", ultimoStatus: "ok",
      ultimoOkBatchId: "b-1", ultimoOkPeriodoFim: "2026-10-13", agenteVersion: "1.4.0"
    });
    // O relogio da PDV pode estar errado: ultimoOkEm e ultimoHeartbeatEm sao do servidor.
    expect(args.create.ultimoHeartbeatEm.getTime()).toBeGreaterThanOrEqual(antes);
    expect(args.create.ultimoOkEm.getTime()).toBeGreaterThanOrEqual(antes);
    expect(args.create.ultimoOkOcorridoEm).toEqual(new Date("2026-10-13T15:00:00.000Z"));
  });

  test("erro nao toca nos campos de ultimo OK", async () => {
    db.agileAgentHeartbeat.findUnique.mockResolvedValue({
      ultimoOkEm: new Date("2026-10-13T10:00:00Z"), ultimoOkOcorridoEm: new Date("2026-10-13T10:00:00Z")
    });
    const r = await post({ ...corpoOk, status: "erro", mensagem: "login recusado", batchId: null });
    expect(r.status).toBe(200);
    const { update, create } = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ ultimoStatus: "erro", ultimaMensagem: "login recusado" });
    for (const campo of ["ultimoOkEm", "ultimoOkBatchId", "ultimoOkPeriodoFim", "ultimoOkOcorridoEm"]) {
      expect(update).not.toHaveProperty(campo);
      expect(create).not.toHaveProperty(campo);
    }
  });

  test("ok limpa a mensagem de erro anterior", async () => {
    await post(corpoOk);
    expect(db.agileAgentHeartbeat.upsert.mock.calls[0][0].update.ultimaMensagem).toBeNull();
  });

  test("heartbeat ok ANTERIOR ao ja guardado nao recua ultimoOkEm", async () => {
    db.agileAgentHeartbeat.findUnique.mockResolvedValue({
      ultimoOkEm: new Date("2026-10-13T15:30:00Z"), ultimoOkOcorridoEm: new Date("2026-10-13T15:30:00Z")
    });
    const r = await post({ ...corpoOk, ocorridoEm: "2026-10-13T14:00:00.000Z" });
    expect(r.status).toBe(200);
    const { update } = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(update.ultimoStatus).toBe("ok");
    for (const campo of ["ultimoOkEm", "ultimoOkBatchId", "ultimoOkPeriodoFim", "ultimoOkOcorridoEm"]) {
      expect(update).not.toHaveProperty(campo);
    }
  });

  test("heartbeat ok MAIS NOVO avanca ultimoOkEm", async () => {
    db.agileAgentHeartbeat.findUnique.mockResolvedValue({
      ultimoOkEm: new Date("2026-10-13T10:00:00Z"), ultimoOkOcorridoEm: new Date("2026-10-13T10:00:00Z")
    });
    await post(corpoOk);
    const { update } = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(update.ultimoOkEm).toBeInstanceOf(Date);
    expect(update.ultimoOkBatchId).toBe("b-1");
    expect(update.ultimoOkOcorridoEm).toEqual(new Date("2026-10-13T15:00:00.000Z"));
  });

  test("relogio da PDV no futuro e limitado: nao congela o ultimo OK", async () => {
    const limite = Date.now() + 6 * 60 * 1000;
    await post({ ...corpoOk, ocorridoEm: "2099-01-01T00:00:00.000Z" });
    const { create } = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(create.ultimoOkOcorridoEm.getTime()).toBeLessThanOrEqual(limite);
    expect(create.ultimoOkEm).toBeInstanceOf(Date);
  });

  test("campos de texto livre tem tamanho maximo (batchId, agenteVersion)", async () => {
    expect((await post({ ...corpoOk, batchId: "b".repeat(101) })).status).toBe(400);
    expect((await post({ ...corpoOk, agenteVersion: "v".repeat(51) })).status).toBe(400);
  });

  test("falha do banco: 500 com { erro } (o agente ignora, mas o log precisa)", async () => {
    db.agileAgentHeartbeat.upsert.mockRejectedValue(new Error("db fora"));
    const r = await post(corpoOk);
    expect(r.status).toBe(500);
    expect(typeof r.body.erro).toBe("string");
  });
});

describe("GET /integrations/agile/status — campo agente", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue({ id: "u1" } as never);
    db.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
  });

  test("devolve a saude do agente avaliada pelo servidor", async () => {
    const agora = Date.now();
    db.agileAgentHeartbeat.findFirst.mockResolvedValue({
      ultimoStatus: "ok", ultimaMensagem: null, ultimoHeartbeatEm: new Date(agora - 3600_000),
      ultimoOkEm: new Date(agora - 60 * 3600_000), ultimoOkPeriodoFim: "2026-10-10"
    });
    const r = await request(app).get("/integrations/agile/status");
    expect(r.status).toBe(200);
    expect(r.body.agente.estado).toBe("critico");
    expect(r.body.agente.alertas[0].nivel).toBe("critico");
    expect(r.body.agente.ultimoOkPeriodoFim).toBe("2026-10-10");
  });

  test("sem nenhum heartbeat: informativo 'aguardando'", async () => {
    db.agileAgentHeartbeat.findFirst.mockResolvedValue(null);
    const r = await request(app).get("/integrations/agile/status");
    expect(r.body.agente.estado).toBe("aguardando");
  });

  test("tabela de heartbeat inexistente nao derruba o /status inteiro", async () => {
    db.agileAgentHeartbeat.findFirst.mockRejectedValue(new Error("P2021 tabela nao existe"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get("/integrations/agile/status");
    spy.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.agente).toBeUndefined();
    expect(r.body).toHaveProperty("totalRegistrosSalaoAgile", 0);
  });
});
