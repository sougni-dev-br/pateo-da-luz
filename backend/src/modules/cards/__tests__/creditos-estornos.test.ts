import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O banco lança na fatura um estorno de compra que não existe no ERP (a compra foi cancelada).
// O crédito entra no total, no subtotal do cartão e no valor a pagar; não entra no DRE nem no CMV.

const tx = {
  creditCardStatementAdjustment: { create: vi.fn(), delete: vi.fn() },
  creditCardStatement: { update: vi.fn(), findUnique: vi.fn(async () => null) },
  $queryRaw: vi.fn(async () => [{ total: -155.1 }]),
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCardStatement: { findUnique: vi.fn(), update: vi.fn() },
    creditCardFinal: { findUnique: vi.fn() },
    creditCardStatementAdjustment: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
const auditLog = vi.fn();
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: (...a: unknown[]) => auditLog(...a), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const fatura = (status = "OPEN") => ({ id: "s1", creditCardId: "c1", status });

beforeEach(() => {
  vi.clearAllMocks();
  db.creditCardStatement.findUnique.mockResolvedValue(fatura());
  db.creditCardFinal.findUnique.mockResolvedValue({ id: "f2", creditCardId: "c1" });
  tx.creditCardStatementAdjustment.create.mockResolvedValue({ id: "a1" });
});

describe("lançar crédito ou estorno na fatura", () => {
  test("estorno é guardado com valor negativo e o total da fatura é recalculado", async () => {
    const r = await request(app).post("/cards/statements/s1/adjustments").send({ tipo: "ESTORNO", description: "Estorno compra cancelada", valor: "155,10", cardFinalId: "f2" });
    expect(r.status).toBe(201);
    const dados = tx.creditCardStatementAdjustment.create.mock.calls[0][0].data;
    expect(Number(dados.amount.toString())).toBe(-155.1);
    expect(dados).toMatchObject({ statementId: "s1", cardFinalId: "f2", kind: "ESTORNO", description: "Estorno compra cancelada", createdByUserId: "u1" });
    expect(tx.creditCardStatement.update).toHaveBeenCalled();
    expect(auditLog.mock.calls[0][0]).toMatchObject({ action: "CREATE_CREDIT_CARD_STATEMENT_ADJUSTMENT" });
  });

  test("cobrança já estornada aumenta a fatura (valor positivo)", async () => {
    await request(app).post("/cards/statements/s1/adjustments").send({ tipo: "COBRANCA_ESTORNADA", description: "Cobrança estornada em agosto", valor: 155.1 });
    expect(Number(tx.creditCardStatementAdjustment.create.mock.calls[0][0].data.amount.toString())).toBe(155.1);
  });

  test("o cartão é opcional (crédito geral da fatura)", async () => {
    const r = await request(app).post("/cards/statements/s1/adjustments").send({ tipo: "ESTORNO", description: "Estorno", valor: "10" });
    expect(r.status).toBe(201);
    expect(tx.creditCardStatementAdjustment.create.mock.calls[0][0].data.cardFinalId).toBeNull();
  });

  test("fatura fechada, paga ou cancelada não recebe lançamento", async () => {
    for (const status of ["CLOSED", "PAID", "CANCELLED"]) {
      db.creditCardStatement.findUnique.mockResolvedValue(fatura(status));
      const r = await request(app).post("/cards/statements/s1/adjustments").send({ tipo: "ESTORNO", description: "Estorno", valor: "10" });
      expect(r.status).toBe(409);
    }
    expect(tx.creditCardStatementAdjustment.create).not.toHaveBeenCalled();
  });

  test("recusa cartão de outra conta, valor inválido, tipo e descrição ausentes", async () => {
    db.creditCardFinal.findUnique.mockResolvedValue({ id: "f9", creditCardId: "outra" });
    expect((await request(app).post("/cards/statements/s1/adjustments").send({ tipo: "ESTORNO", description: "x", valor: "10", cardFinalId: "f9" })).status).toBe(400);
    for (const corpo of [
      { tipo: "ESTORNO", description: "x", valor: "0" },
      { tipo: "ESTORNO", description: "x", valor: "-5" },
      { tipo: "ESTORNO", description: "x", valor: "abc" },
      { tipo: "ESTORNO", description: "x", valor: "99999999999" },
      { tipo: "OUTRO", description: "x", valor: "10" },
      { tipo: "ESTORNO", description: "  ", valor: "10" },
    ]) {
      expect((await request(app).post("/cards/statements/s1/adjustments").send(corpo)).status).toBe(400);
    }
    expect(tx.creditCardStatementAdjustment.create).not.toHaveBeenCalled();
  });
});

describe("remover crédito ou estorno", () => {
  test("remove e recalcula o total", async () => {
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "s1", amount: "-155.10" });
    const r = await request(app).delete("/cards/statements/s1/adjustments/a1");
    expect(r.status).toBe(200);
    expect(tx.creditCardStatementAdjustment.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(tx.creditCardStatement.update).toHaveBeenCalled();
    expect(auditLog.mock.calls[0][0]).toMatchObject({ action: "DELETE_CREDIT_CARD_STATEMENT_ADJUSTMENT" });
  });

  test("o lançamento precisa ser da fatura da URL e a fatura estar aberta", async () => {
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "outra" });
    expect((await request(app).delete("/cards/statements/s1/adjustments/a1")).status).toBe(404);
    db.creditCardStatementAdjustment.findUnique.mockResolvedValue({ id: "a1", statementId: "s1" });
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("CLOSED"));
    expect((await request(app).delete("/cards/statements/s1/adjustments/a1")).status).toBe(409);
    expect(tx.creditCardStatementAdjustment.delete).not.toHaveBeenCalled();
  });
});

describe("total da fatura no extrato do banco", () => {
  test("grava o total que o banco informa", async () => {
    const r = await request(app).put("/cards/statements/s1/extract-total").send({ valor: "8.189,62" });
    expect(r.status).toBe(200);
    expect(Number(db.creditCardStatement.update.mock.calls[0][0].data.statedTotalAmount.toString())).toBe(8189.62);
  });

  test("vazio apaga; fatura fechada não aceita", async () => {
    await request(app).put("/cards/statements/s1/extract-total").send({ valor: "" });
    expect(db.creditCardStatement.update.mock.calls[0][0].data.statedTotalAmount).toBeNull();
    db.creditCardStatement.findUnique.mockResolvedValue(fatura("PAID"));
    expect((await request(app).put("/cards/statements/s1/extract-total").send({ valor: "10" })).status).toBe(409);
  });
});

describe("o crédito conta no subtotal do cartão e na conferência", () => {
  test("fatura conferida continua conferida quando itens + crédito batem com o extrato do cartão", async () => {
    const { reabrirSeDivergir } = await import("../cards.service.js");
    const fake = {
      creditCardStatement: {
        update: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "s1", status: "CHECKED",
          creditCard: { finais: [{ id: "f2", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL", isActive: true }] },
          finalTotals: [{ cardFinalId: "f2", statedAmount: "100.00" }],
          items: [{ cardFinalId: "f2", value: "155.10" }],
          adjustments: [{ cardFinalId: "f2", amount: "-55.10" }],
        })),
      },
    };
    expect(await reabrirSeDivergir(fake as never, "s1")).toBe(false);
    expect(fake.creditCardStatement.update).not.toHaveBeenCalled();
  });

  test("sem o crédito o mesmo extrato divergiria e a fatura volta para Aberta", async () => {
    const { reabrirSeDivergir } = await import("../cards.service.js");
    const fake = {
      creditCardStatement: {
        update: vi.fn(),
        findUnique: vi.fn(async () => ({
          id: "s1", status: "CHECKED",
          creditCard: { finais: [{ id: "f2", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL", isActive: true }] },
          finalTotals: [{ cardFinalId: "f2", statedAmount: "100.00" }],
          items: [{ cardFinalId: "f2", value: "155.10" }],
          adjustments: [],
        })),
      },
    };
    expect(await reabrirSeDivergir(fake as never, "s1")).toBe(true);
  });
});
