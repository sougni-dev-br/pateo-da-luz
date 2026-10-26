import "express-async-errors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));
vi.mock("../../security/security-utils.js", () => ({
  requireMenuPermission: vi.fn(),
  auditLog: vi.fn(),
  requestIp: vi.fn(() => "127.0.0.1")
}));
vi.mock("../receivable.service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../receivable.service.js")>();
  return {
    ...original,
    listReceivables: vi.fn(),
    summarizeReceivables: vi.fn(),
    getReceivable: vi.fn(),
    createReceivable: vi.fn(),
    markReceived: vi.fn(),
    reverseReceipt: vi.fn(),
    cancelReceivable: vi.fn()
  };
});

import { auditLog, requireMenuPermission } from "../../security/security-utils.js";
import { resolvePermissionContext } from "../../security/menu-permissions.js";
import * as servico from "../receivable.service.js";
import { hojeSaoPaulo, somarDias } from "../receivable.datas.js";
import { receivableRouter } from "../receivable.routes.js";

const svc = vi.mocked(servico);
const app = express();
app.use(express.json());
app.use("/receivables", receivableRouter);

// Como no app real: erro não previsto cai no tratador global (aqui, um que não ecoa a mensagem).
const appComTratador = express();
appComTratador.use(express.json());
appComTratador.use("/receivables", receivableRouter);
appComTratador.use((_e: unknown, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
  res.status(500).json({ message: "Erro interno." });
});

const view = { id: "r1", status: "RECEIVED", paidAmount: 100 } as never;
const baixa = { receivedDate: hojeSaoPaulo(), paidAmount: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMenuPermission).mockResolvedValue({ id: "u1" } as never);
});

describe("acesso", () => {
  test("sem permissão nada é executado", async () => {
    vi.mocked(requireMenuPermission).mockImplementation(async (_req, res) => {
      res.status(403).json({ message: "negado" });
      return null;
    });

    const respostas = await Promise.all([
      request(app).get("/receivables"),
      request(app).get("/receivables/summary"),
      request(app).get("/receivables/r1"),
      request(app).post("/receivables/r1/receive").send(baixa),
      request(app).post("/receivables/r1/cancel").send({ reason: "teste" }),
      request(app).post("/receivables/r1/receipts/x/reverse").send({ reason: "teste" })
    ]);

    expect(respostas.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(svc.markReceived).not.toHaveBeenCalled();
    expect(svc.cancelReceivable).not.toHaveBeenCalled();
    expect(svc.reverseReceipt).not.toHaveBeenCalled();
  });

  test("o middleware global mapeia cada rota para a ação certa do módulo receivables", async () => {
    const acao = async (method: string, path: string) => {
      const ctx = await resolvePermissionContext({ method, path } as never);
      return ctx && `${ctx.menuId}:${ctx.action}`;
    };
    expect(await acao("GET", "/receivables")).toBe("receivables:view");
    expect(await acao("GET", "/receivables/summary")).toBe("receivables:view");
    expect(await acao("POST", "/receivables")).toBe("receivables:create");
    expect(await acao("POST", "/receivables/r1/receive")).toBe("receivables:create");
    expect(await acao("POST", "/receivables/r1/cancel")).toBe("receivables:delete");
    // desfazer um recebimento pede a mesma força de quem exclui
    expect(await acao("POST", "/receivables/r1/receipts/x1/reverse")).toBe("receivables:delete");
  });
});

describe("listagem", () => {
  test("devolve a lista e o total no cabeçalho", async () => {
    svc.listReceivables.mockResolvedValue({ rows: [{ id: "r1" }] as never, total: 42 });
    const r = await request(app).get("/receivables?status=PENDING&limit=10");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: "r1" }]);
    expect(r.headers["x-total-count"]).toBe("42");
    expect(svc.listReceivables).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING", limit: 10, offset: 0 }));
  });

  test("data inválida vira 400 com mensagem, não erro interno", async () => {
    const r = await request(app).get("/receivables?startDate=aaaaaaaa");
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/data inválida/);
    expect(svc.listReceivables).not.toHaveBeenCalled();
  });

  test("/summary não é confundido com um id", async () => {
    svc.summarizeReceivables.mockResolvedValue({ today: "2026-10-23" } as never);
    const r = await request(app).get("/receivables/summary");
    expect(r.body).toEqual({ today: "2026-10-23" });
    expect(svc.getReceivable).not.toHaveBeenCalled();
  });

  test("detalhe de conta inexistente é 404 com mensagem", async () => {
    svc.getReceivable.mockRejectedValue(new servico.ReceivableError("Conta a receber não encontrada.", 404));
    const r = await request(app).get("/receivables/nao-existe");
    expect(r.status).toBe(404);
    expect(r.body.message).toBe("Conta a receber não encontrada.");
  });
});

describe("registrar recebimento", () => {
  test("registra, devolve a conta e grava a auditoria com quem fez", async () => {
    svc.markReceived.mockResolvedValue({ view, antes: { status: "OPEN", paidAmount: null }, receiptId: "rc1" });

    const r = await request(app).post("/receivables/r1/receive").send({ ...baixa, paymentMethod: "  PIX " });

    expect(r.status).toBe(200);
    expect(svc.markReceived).toHaveBeenCalledWith("r1", expect.objectContaining({ paidAmount: 100, paymentMethod: "PIX" }), "u1");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", action: "RECEIVE_RECEIVABLE", entity: "Receivable", entityId: "r1",
      previousValue: { status: "OPEN", paidAmount: null },
      newValue: expect.objectContaining({ receiptId: "rc1", amount: 100, status: "RECEIVED" })
    }));
  });

  test.each([
    [{ paidAmount: 0 }, /maior que zero/],
    [{ paidAmount: -5 }, /maior que zero/],
    [{ paidAmount: "abc" }, /inválido/],
    [{ paidAmount: 10.123 }, /2 casas/],
    [{ receivedDate: "aaaaaaaa" }, /data inválida/],
    [{ receivedDate: "2026-02-31" }, /data inválida/],
    [{ receivedDate: somarDias(hojeSaoPaulo(), 1) }, /não pode ser futura/]
  ])("recusa %j antes de tocar no banco", async (patch, mensagem) => {
    const r = await request(app).post("/receivables/r1/receive").send({ ...baixa, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(mensagem);
    expect(svc.markReceived).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("regra de negócio do serviço chega como 409 e não grava auditoria", async () => {
    svc.markReceived.mockRejectedValue(new servico.ReceivableError("Esta conta já foi recebida.", 409));
    const r = await request(app).post("/receivables/r1/receive").send(baixa);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("Esta conta já foi recebida.");
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("erro inesperado segue para o tratador global e não vira 4xx com texto interno", async () => {
    svc.markReceived.mockRejectedValue(new Error("connection string postgres://segredo"));
    const r = await request(appComTratador).post("/receivables/r1/receive").send(baixa);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("segredo");
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("cancelar e estornar", () => {
  test("cancelar exige motivo", async () => {
    for (const corpo of [{}, { reason: "" }, { reason: "ab" }, { reason: "   " }]) {
      const r = await request(app).post("/receivables/r1/cancel").send(corpo);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/motivo/);
    }
    expect(svc.cancelReceivable).not.toHaveBeenCalled();
  });

  test("cancelar audita o motivo", async () => {
    svc.cancelReceivable.mockResolvedValue({ view: { id: "r1", status: "CANCELLED" } as never, antes: { status: "OPEN", paidAmount: null } });
    const r = await request(app).post("/receivables/r1/cancel").send({ reason: " evento desmarcado " });
    expect(r.status).toBe(200);
    expect(svc.cancelReceivable).toHaveBeenCalledWith("r1", "evento desmarcado", "u1");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CANCEL_RECEIVABLE", newValue: { status: "CANCELLED", reason: "evento desmarcado" } }));
  });

  test("conta com recebimento: o serviço recusa e a mensagem chega à tela", async () => {
    svc.cancelReceivable.mockRejectedValue(new servico.ReceivableError("Estorne o recebimento antes de cancelar.", 409));
    const r = await request(app).post("/receivables/r1/cancel").send({ reason: "teste" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Estorne/);
  });

  test("estornar exige motivo e audita", async () => {
    expect((await request(app).post("/receivables/r1/receipts/rc1/reverse").send({})).status).toBe(400);

    svc.reverseReceipt.mockResolvedValue({ view: { id: "r1", status: "OPEN", paidAmount: null } as never, antes: { status: "RECEIVED", paidAmount: 100 }, receiptId: "rc1" });
    const r = await request(app).post("/receivables/r1/receipts/rc1/reverse").send({ reason: "valor errado" });

    expect(r.status).toBe(200);
    expect(svc.reverseReceipt).toHaveBeenCalledWith("r1", "rc1", "valor errado", "u1");
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "REVERSE_RECEIVABLE_RECEIPT", previousValue: { status: "RECEIVED", paidAmount: 100 },
      newValue: expect.objectContaining({ receiptId: "rc1", reason: "valor errado", status: "OPEN" })
    }));
  });
});

describe("criar", () => {
  const nova = {
    sourceType: "EVENT", description: "Evento exemplo", expectedDate: "2026-11-10",
    grossAmount: 1000, fees: 100, netAmount: 900, customerName: "Cliente Exemplo"
  };

  test("cria, audita e responde 201", async () => {
    svc.createReceivable.mockResolvedValue({ id: "r9" } as never);
    const r = await request(app).post("/receivables").send(nova);
    expect(r.status).toBe(201);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE_RECEIVABLE", entityId: "r9" }));
  });

  test.each([
    [{ sourceType: "IFOOD_SETTLEMENT" }, /não são lançados à mão/],
    [{ netAmount: 950 }, /bruto menos as taxas/],
    [{ netAmount: 0, grossAmount: 100, fees: 100 }, /maior que zero/],
    [{ expectedDate: "10/11/2026" }, /data inválida/],
    [{ description: "   " }, /descrição obrigatória/],
    [{ installmentNumber: 3, totalInstallments: 2 }, /maior que o total/],
    [{ installmentNumber: 1 }, /juntos/]
  ])("recusa %j", async (patch, mensagem) => {
    const r = await request(app).post("/receivables").send({ ...nova, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(mensagem);
    expect(svc.createReceivable).not.toHaveBeenCalled();
  });
});
