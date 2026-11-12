import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, expect, test, vi } from "vitest";

// Editar uma compra de cartao apaga e recria as parcelas dela nas faturas. Numa fatura fechada ou
// paga isso empurrava as parcelas para o mes seguinte sem aviso e deixava o titulo do Contas a pagar
// com o valor antigo. Agora a edicao e recusada: reabra a fatura (com justificativa) antes.

vi.mock("../../../config/database.js", () => ({
  prisma: { $queryRaw: vi.fn(), $transaction: vi.fn(), company: { findFirst: vi.fn() } },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", name: "Admin", role: "ADMIN" })), requireAdmin: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
  auditLog: vi.fn(async () => undefined), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(), assertPeriodWritableForRange: vi.fn() }));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../payables-financial-pdf.js", () => ({ createPayablesFinancialPdf: vi.fn(async () => Buffer.from("%PDF")) }));
vi.mock("../../inventory/inventory.routes.js", () => ({ gravarConversaoDoItemDeCompra: vi.fn(), recordPurchaseInventoryEntry: vi.fn() }));
const { DeslocamentoMock, sincronizar } = vi.hoisted(() => ({
  DeslocamentoMock: class extends Error {},
  sincronizar: vi.fn(),
}));
vi.mock("../../cards/cards.service.js", () => ({
  DeslocamentoDeFaturaError: DeslocamentoMock,
  removeCardStatementItemsForPurchase: vi.fn(async () => ({ cardFinalId: null })), syncCardStatementItemForPurchase: vi.fn(),
  syncCardStatementItemsForPurchase: (...a: unknown[]) => sincronizar(...a),
}));
vi.mock("../../suppliers/supplier-billing-cycle.service.js", () => ({
  addPurchaseToCycle: vi.fn(), findOrCreateOpenCycle: vi.fn(async () => "cy1"), updatePurchaseInCycle: vi.fn(async () => ({ blocked: false })),
}));
vi.mock("../../reimbursements/reimbursement.service.js", () => ({
  fornecedorDoFuncionario: vi.fn(), reabrirReembolsoDoAgregador: vi.fn(), retirarCompraCancelada: vi.fn(),
  sincronizarCompraNoReembolso: vi.fn(), validarQuemPagou: vi.fn(),
}));
vi.mock("../purchase-duplicate-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../purchase-duplicate-utils.js")>()),
  findPurchaseReferenceMatches: vi.fn(async () => ({ activeDuplicate: null, cancelledDuplicate: null })),
}));

import { prisma } from "../../../config/database.js";
import { purchaseRouter } from "../purchase.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/purchases", purchaseRouter);

const sqlDe = (c: unknown[]) => Prisma.sql(c[0] as TemplateStringsArray, ...(c.slice(1) as Prisma.Sql[])).sql;

const tx = {
  $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  purchase: { update: vi.fn() },
  purchaseItem: { create: vi.fn(async () => ({ id: "i1" })), deleteMany: vi.fn() },
  paymentInstallment: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

function banco(faturas: Array<{ status: string }>) {
  const responder = async (...c: unknown[]) => {
    const s = sqlDe(c);
    if (s.includes('FROM "CreditCardStatementItem"')) {
      return faturas.map((f) => ({ ...f, competenceYear: 2026, competenceMonth: 8, cardName: "Cartao da loja" }));
    }
    if (s.includes('FOR UPDATE')) return [];
    if (s.includes('FROM "Purchase" p')) {
      return [{ id: "p1", status: "ACTIVE", supplierId: "s1", purchaseDate: "2026-07-31", receivedAt: null, purchaseNumber: "1" }];
    }
    if (s.includes('FROM "PaymentInstallment" pi')) return [];
    if (s.includes('"billingMode"')) return [{ billingMode: "DIRECT" }];
    if (s.includes('SELECT "type" FROM "PaymentMethod"')) return [{ type: "CREDIT_CARD" }];
    return [];
  };
  db.$queryRaw.mockImplementation(responder);
  tx.$queryRaw.mockImplementation(responder);
}

const corpo = (total: number) => ({
  purchaseDate: "2026-07-31", invoiceNumber: "NF1", companyId: "c1",
  paymentMethodId: "pm1", paymentMethod: "CREDIT_CARD", creditCardId: "card1", numberOfInstallments: 6,
  items: [{ productId: "prod1", rawProductName: "Equipamento", unit: "UN", quantity: 1, unitPrice: total, totalPrice: total }],
  installments: [{ installment: 1, dueDate: "2026-08-18", amount: total, paymentMethodId: "pm1", paymentMethodName: "CREDIT_CARD", status: "OPEN" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: "c1" });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
});

test("compra com parcela em fatura fechada: edicao recusada e nada e gravado", async () => {
  banco([{ status: "CLOSED" }]);
  const r = await request(app).put("/purchases/p1").send(corpo(3398));
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/[Rr]eabra a fatura/);
  expect(r.body.message).toMatch(/08\/2026/);
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(tx.purchase.update).not.toHaveBeenCalled();
});

test("compra com parcela em fatura paga: edicao recusada com aviso de pagamento", async () => {
  banco([{ status: "PAID" }]);
  const r = await request(app).put("/purchases/p1").send(corpo(3398));
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/paga/);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test("compra so em faturas abertas continua editavel e pede para nao deslocar parcelas", async () => {
  banco([]);
  const r = await request(app).put("/purchases/p1").send(corpo(3398));
  expect(r.status).not.toBe(409);
  expect(sincronizar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recusarDeslocamento: true }));
});

test("fatura fechada mais adiante no caminho das parcelas: 409 em vez de empurrar para o mes seguinte", async () => {
  banco([]);
  sincronizar.mockRejectedValueOnce(new DeslocamentoMock("deslocaria parcelas"));
  const r = await request(app).put("/purchases/p1").send(corpo(3398));
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/deslocaria/);
});
