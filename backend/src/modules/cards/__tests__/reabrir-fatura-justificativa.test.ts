import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Reabrir uma fatura fechada cancela o titulo dela no Contas a pagar e mexe em dois meses. So com
// justificativa escrita, que fica na auditoria e nas observacoes da fatura; nunca com parcela baixada.

const tx = {
  paymentInstallment: { findMany: vi.fn(), updateMany: vi.fn() },
  creditCardStatement: { update: vi.fn() },
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCardStatement: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
const auditLog = vi.fn(async () => undefined);
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", name: "Rafael", role: "ADMIN" })), requireAdmin: vi.fn(),
  auditLog: (...a: unknown[]) => (auditLog as (...x: unknown[]) => unknown)(...a), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const fatura = (status = "CLOSED") => ({
  id: "s1", creditCardId: "c1", status, generatedPurchaseId: "t1", notes: null,
  closingDate: new Date(2026, 7, 5), dueDate: new Date(2026, 7, 18),
  creditCard: { finais: [] }, finalTotals: [], adjustments: [], items: [],
});
const reabrir = (corpo: object = { justificativa: "Valor da compra diferente do cobrado pelo banco" }) =>
  request(app).post("/cards/statements/s1/reopen").send(corpo);

beforeEach(() => {
  vi.clearAllMocks();
  db.creditCardStatement.findUnique.mockResolvedValue(fatura());
  tx.paymentInstallment.findMany.mockResolvedValue([{ id: "pi1", status: "OPEN", paidDate: null }]);
  tx.paymentInstallment.updateMany.mockResolvedValue({ count: 1 });
});

describe("reabrir fatura exige justificativa", () => {
  test("sem justificativa: 400 e nada muda", async () => {
    const r = await reabrir({});
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/justificativa/i);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("justificativa curta ou so espacos: 400", async () => {
    expect((await reabrir({ justificativa: "erro" })).status).toBe(400);
    expect((await reabrir({ justificativa: "          " })).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("com justificativa: reabre, cancela o titulo e guarda o motivo na auditoria e nas observacoes", async () => {
    const r = await reabrir();
    expect(r.status).toBe(200);
    expect(tx.paymentInstallment.updateMany).toHaveBeenCalled();
    const dados = tx.creditCardStatement.update.mock.calls[0][0].data;
    expect(dados.status).toBe("OPEN");
    expect(dados.notes).toContain("Valor da compra diferente do cobrado pelo banco");
    expect(dados.notes).toContain("Rafael");
    const registro = auditLog.mock.calls[0][0] as { newValue: { justificativa: string } };
    expect(registro.newValue.justificativa).toBe("Valor da compra diferente do cobrado pelo banco");
  });

  test("as observacoes anteriores da fatura sao preservadas", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue({ ...fatura(), notes: "Conferida com o extrato" });
    await reabrir();
    expect(tx.creditCardStatement.update.mock.calls[0][0].data.notes).toContain("Conferida com o extrato");
  });

  test("parcela ja baixada: 409 mesmo com justificativa", async () => {
    tx.paymentInstallment.findMany.mockResolvedValue([{ id: "pi1", status: "PAID", paidDate: new Date() }]);
    const r = await reabrir();
    expect(r.status).toBe(409);
    expect(tx.creditCardStatement.update).not.toHaveBeenCalled();
  });

  test("fatura aberta nao pode ser reaberta", async () => {
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("OPEN"));
    expect((await reabrir()).status).toBe(400);
  });
});
