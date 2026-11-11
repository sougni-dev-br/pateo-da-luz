import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// O valor a pagar da fatura (título) é a soma das compras menos os créditos/estornos.

const tx = {
  creditCardStatement: { update: vi.fn() },
  purchase: { update: vi.fn() },
  paymentInstallment: { updateMany: vi.fn() },
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCardStatement: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
const criarTitulo = vi.fn();
vi.mock("../cards.service.js", async (original) => ({
  ...(await original<typeof import("../cards.service.js")>()),
  createCardStatementPurchase: (...a: unknown[]) => criarTitulo(...a),
}));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const cartao = { id: "c1", name: "Cartão", bankName: "Banco", last4Digits: "1111", closingDay: 5, dueDay: 18, finais: [] };
const item = (value: string) => ({ description: "Compra", value, cardFinalId: null, purchaseId: "p", purchase: { status: "ACTIVE", _count: { items: 1 } } });

beforeEach(() => {
  vi.clearAllMocks();
  db.creditCardStatement.findUnique.mockResolvedValue({
    id: "s1", creditCardId: "c1", status: "OPEN", generatedPurchaseId: null, closingDate: new Date(2026, 7, 5), dueDate: new Date(2026, 7, 18),
    creditCard: cartao, finalTotals: [], items: [item("8000.00"), item("344.72")],
    adjustments: [{ cardFinalId: null, amount: "-155.10" }],
  });
});

describe("fechar a fatura", () => {
  test("o título nasce com compras menos crédito/estorno", async () => {
    const r = await request(app).post("/cards/statements/s1/close").send({});
    expect(r.status).toBe(200);
    expect(tx.creditCardStatement.update.mock.calls[0][0].data.totalAmount.toString()).toBe("8189.62");
    expect(criarTitulo.mock.calls[0][1].totalAmount).toBeCloseTo(8189.62, 2);
  });
});
