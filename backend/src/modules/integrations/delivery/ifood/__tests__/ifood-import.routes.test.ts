import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas de importação do iFood: o que importa aqui é a regra de acesso e o contrato de erro.
// Serviços e banco são de mentira.
vi.mock("../../../../security/security-utils.js", () => ({
  requireRole: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"), auditLog: vi.fn(), getSessionUser: vi.fn()
}));
vi.mock("../ifood.service.js", () => ({
  createStore: vi.fn(), getPeriodSummary: vi.fn(), getStatus: vi.fn(), listStores: vi.fn(), runMockSync: vi.fn(),
  runSmartSync: vi.fn(), saveCredential: vi.fn(), updateStore: vi.fn()
}));
vi.mock("../ifood-insights.service.js", () => ({ getPainelDonoInsights: vi.fn() }));
vi.mock("../ifood-http-client.js", () => ({ testIfoodConnection: vi.fn() }));
vi.mock("../ifood-conciliacao-import.service.js", () => ({
  confirmarImportacaoIfood: vi.fn(),
  preverImportacaoIfood: vi.fn()
}));

import { requireRole } from "../../../../security/security-utils.js";
import { ErroDeImportacao } from "../../keeta/erro-de-importacao.js";
import { ifoodDeliveryRouter } from "../ifood.routes.js";
import { confirmarImportacaoIfood, preverImportacaoIfood } from "../ifood-conciliacao-import.service.js";

const app = express();
app.use(express.json());
app.use("/integrations/delivery/ifood", ifoodDeliveryRouter);

const permitir = () => vi.mocked(requireRole).mockResolvedValue({ id: "u1" } as never);
const negar = () =>
  vi.mocked(requireRole).mockImplementation((async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(403).json({ message: "Sem permissão" });
    return null;
  }) as never);

const enviar = (rota: "preview" | "confirm", bytes: Buffer = Buffer.from("x"), nome = "c.xlsx") =>
  request(app).post(`/integrations/delivery/ifood/import/${rota}`).attach("file", bytes, nome);

beforeEach(() => {
  vi.clearAllMocks();
  permitir();
});

describe("POST /import/preview e /import/confirm", () => {
  test("sem papel de escrita: 403 e o serviço nem é chamado", async () => {
    negar();
    const r = await enviar("preview");
    expect(r.status).toBe(403);
    expect(preverImportacaoIfood).not.toHaveBeenCalled();
    expect((await enviar("confirm")).status).toBe(403);
    expect(confirmarImportacaoIfood).not.toHaveBeenCalled();
  });

  test("sem arquivo: 400 com mensagem clara", async () => {
    const r = await request(app).post("/integrations/delivery/ifood/import/preview");
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Arquivo não enviado.");
  });

  test("prévia devolve o que o serviço calculou e passa nome do arquivo", async () => {
    vi.mocked(preverImportacaoIfood).mockResolvedValue({ arquivo: "c.xlsx", erros: [] } as never);
    const r = await enviar("preview");
    expect(r.status).toBe(200);
    expect(r.body.arquivo).toBe("c.xlsx");
    expect(vi.mocked(preverImportacaoIfood).mock.calls[0]![1]).toBe("c.xlsx");
  });

  test("confirmação repassa usuário e a confirmação dos alertas só quando vier exatamente 'true'", async () => {
    vi.mocked(confirmarImportacaoIfood).mockResolvedValue({ gravados: 1 } as never);
    await request(app).post("/integrations/delivery/ifood/import/confirm").field("confirmouAlertas", "true").attach("file", Buffer.from("x"), "c.xlsx");
    expect(vi.mocked(confirmarImportacaoIfood).mock.calls[0]![2]).toMatchObject({ userId: "u1", confirmouAlertas: true });

    await request(app).post("/integrations/delivery/ifood/import/confirm").field("confirmouAlertas", "false").attach("file", Buffer.from("x"), "c.xlsx");
    expect(vi.mocked(confirmarImportacaoIfood).mock.calls[1]![2]).toMatchObject({ confirmouAlertas: false });

    await enviar("confirm");
    expect(vi.mocked(confirmarImportacaoIfood).mock.calls[2]![2]).toMatchObject({ confirmouAlertas: false });
  });

  test("erro escrito para o usuário sai como 400 com a mensagem dele", async () => {
    vi.mocked(preverImportacaoIfood).mockRejectedValue(new ErroDeImportacao("Use o arquivo .xlsx do Relatório de Conciliação."));
    const r = await enviar("preview");
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Use o arquivo .xlsx do Relatório de Conciliação.");
  });

  test("falha inesperada (banco, timeout) é 500 com mensagem genérica, sem vazar o erro", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(confirmarImportacaoIfood).mockRejectedValue(new Error("P2002 Unique constraint failed on the fields: (`id`)"));
    const r = await enviar("confirm");
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/Nada foi gravado/);
    expect(JSON.stringify(r.body)).not.toMatch(/P2002|constraint/);
    log.mockRestore();
  });

  test("arquivo maior que 5 MB é recusado com mensagem amigável, sem chamar o serviço", async () => {
    const grande = Buffer.alloc(5 * 1024 * 1024 + 10, 1);
    const r = await enviar("preview", grande);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/5 MB/);
    expect(preverImportacaoIfood).not.toHaveBeenCalled();
  });

  test("campo extra no formulário é recusado em vez de cair no handler global", async () => {
    const r = await request(app)
      .post("/integrations/delivery/ifood/import/preview")
      .field("a", "1").field("b", "2")
      .attach("file", Buffer.from("x"), "c.xlsx");
    expect(r.status).toBe(400);
    expect(preverImportacaoIfood).not.toHaveBeenCalled();
  });
});
