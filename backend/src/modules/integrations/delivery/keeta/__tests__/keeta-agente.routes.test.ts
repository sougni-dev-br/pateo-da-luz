import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Agente da Keeta (máquina, não usuário). Banco e importação de mentira: o que importa é a regra
// de acesso e o contrato entre o agente e o ERP.
vi.mock("../../../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    agileAgentHeartbeat: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn()
  };
  return { prisma };
});
vi.mock("../../../../security/security-utils.js", () => ({
  requireRole: vi.fn(), auditLog: vi.fn(), getSessionUser: vi.fn(), requestIp: vi.fn(() => "127.0.0.1")
}));
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../keeta-import.service.js", () => ({
  confirmarImportacaoKeeta: vi.fn(),
  preverImportacaoKeeta: vi.fn()
}));

import { prisma } from "../../../../../config/database.js";
import { requireRole } from "../../../../security/security-utils.js";
import { ErroDeImportacao } from "../erro-de-importacao.js";
import { keetaAgenteRouter } from "../keeta-agente.routes.js";
import { confirmarImportacaoKeeta } from "../keeta-import.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const TOKEN = "k".repeat(64);
const app = express();
app.use(express.json());
app.use("/integrations/keeta-agente", keetaAgenteRouter);

const heartbeatOk = {
  status: "ok",
  mensagem: null,
  periodoInicio: "2026-10-01",
  periodoFim: "2026-10-18",
  batchId: "b-1",
  diasImportados: 18,
  totalBruto: 9000.5,
  duracaoMs: 21000,
  agenteVersion: "0.1.0",
  agenteHost: "PDVTOUCH",
  ocorridoEm: "2026-10-19T12:00:00.000Z"
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KEETA_INGEST_TOKEN = TOKEN;
  db.agileAgentHeartbeat.findUnique.mockResolvedValue(null);
  db.agileAgentHeartbeat.upsert.mockResolvedValue({});
});

const enviarArquivo = (token: string | null = TOKEN) => {
  const r = request(app).post("/integrations/keeta-agente/sync");
  return (token === null ? r : r.set("X-Keeta-Token", token)).attach("file", Buffer.from("conteudo"), "relatorio.xlsx");
};

describe("POST /integrations/keeta-agente/sync", () => {
  test("sem token: 401 e a importação nem é chamada", async () => {
    const r = await enviarArquivo(null);
    expect(r.status).toBe(401);
    expect(confirmarImportacaoKeeta).not.toHaveBeenCalled();
  });

  test("token do Agile não vale para a Keeta", async () => {
    const r = request(app).post("/integrations/keeta-agente/sync").set("X-Agile-Token", TOKEN).attach("file", Buffer.from("x"), "a.xlsx");
    expect((await r).status).toBe(401);
    expect(confirmarImportacaoKeeta).not.toHaveBeenCalled();
  });

  test("servidor sem KEETA_INGEST_TOKEN configurado: 503", async () => {
    delete process.env.KEETA_INGEST_TOKEN;
    expect((await enviarArquivo()).status).toBe(503);
  });

  test("com token: importa o arquivo como máquina (sem usuário) e devolve o resumo", async () => {
    vi.mocked(confirmarImportacaoKeeta).mockResolvedValue({
      arquivo: "relatorio.xlsx", erros: [], avisos: ["aviso"], plano: [], mesesTravados: [],
      totais: { criar: 18, alterar: 0, igual: 0, conflito: 0, travado: 0 }, gravados: 18
    });
    const r = await enviarArquivo();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ gravados: 18, avisos: ["aviso"], totais: { criar: 18 } });
    expect(vi.mocked(confirmarImportacaoKeeta).mock.calls[0]?.[2]).toMatchObject({ userId: null });
  });

  test("arquivo inválido volta 400 com a mensagem controlada", async () => {
    vi.mocked(confirmarImportacaoKeeta).mockRejectedValue(new ErroDeImportacao("O arquivo não é um .xlsx válido."));
    const r = await enviarArquivo();
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("O arquivo não é um .xlsx válido.");
  });

  test("falha interna volta 500 sem detalhe: o agente tenta de novo na próxima execução", async () => {
    vi.mocked(confirmarImportacaoKeeta).mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const r = await enviarArquivo();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("10.0.0.5");
  });

  test("sem arquivo: 400", async () => {
    const r = await request(app).post("/integrations/keeta-agente/sync").set("X-Keeta-Token", TOKEN);
    expect(r.status).toBe(400);
  });
});

describe("POST /integrations/keeta-agente/heartbeat", () => {
  test("sem token: 401 e nada gravado", async () => {
    const r = await request(app).post("/integrations/keeta-agente/heartbeat").send(heartbeatOk);
    expect(r.status).toBe(401);
    expect(db.agileAgentHeartbeat.upsert).not.toHaveBeenCalled();
  });

  test("grava o heartbeat na linha da Keeta, sem mexer na do Agile", async () => {
    const r = await request(app).post("/integrations/keeta-agente/heartbeat").set("X-Keeta-Token", TOKEN).send(heartbeatOk);
    expect(r.status).toBe(200);
    const chamada = db.agileAgentHeartbeat.upsert.mock.calls[0][0];
    expect(chamada.where.sourcePlatform_agenteHost).toEqual({ sourcePlatform: "KEETA", agenteHost: "PDVTOUCH" });
    expect(chamada.create.sourcePlatform).toBe("KEETA");
  });

  test("login necessário chega como erro com mensagem e aparece no status", async () => {
    const corpo = { ...heartbeatOk, status: "erro", mensagem: "Keeta pediu login de novo" };
    const r = await request(app).post("/integrations/keeta-agente/heartbeat").set("X-Keeta-Token", TOKEN).send(corpo);
    expect(r.status).toBe(200);
    expect(db.agileAgentHeartbeat.upsert.mock.calls[0][0].create.ultimaMensagem).toBe("Keeta pediu login de novo");
  });

  test("corpo inválido: 400", async () => {
    const r = await request(app).post("/integrations/keeta-agente/heartbeat").set("X-Keeta-Token", TOKEN).send({ status: "talvez" });
    expect(r.status).toBe(400);
  });
});

describe("GET /integrations/keeta-agente/status", () => {
  test("exige sessão de usuário: o token da máquina não vale aqui", async () => {
    // Como o requireRole real: sem sessão válida, responde 401 e devolve null.
    vi.mocked(requireRole).mockImplementation((async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
      res.status(401).json({ message: "Sessao obrigatoria." });
      return null;
    }) as never);
    const r = await request(app).get("/integrations/keeta-agente/status").set("X-Keeta-Token", TOKEN);
    expect(db.agileAgentHeartbeat.findFirst).not.toHaveBeenCalled();
    expect(r.status).toBe(401);
  });

  test("com sessão, consulta só a linha da Keeta", async () => {
    vi.mocked(requireRole).mockResolvedValue({ id: "u1" } as never);
    db.agileAgentHeartbeat.findFirst.mockResolvedValue(null);
    const r = await request(app).get("/integrations/keeta-agente/status");
    expect(r.status).toBe(200);
    expect(db.agileAgentHeartbeat.findFirst.mock.calls[0][0].where).toEqual({ sourcePlatform: "KEETA" });
    expect(r.body.estado).toBe("aguardando");
  });
});
