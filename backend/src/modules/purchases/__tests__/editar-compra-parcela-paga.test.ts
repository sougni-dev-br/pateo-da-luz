import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, expect, test, vi } from "vitest";

// Editar a compra apagava as parcelas e recriava todas como OPEN (a tela sempre
// manda status OPEN): a baixa sumia e a conta voltava para "em aberto". A rota
// agora mantem a parcela paga quando a edicao nao mexe na cobranca e recusa
// (409, sem gravar nada) quando mexe.

vi.mock("../../../config/database.js", () => ({
  prisma: { $queryRaw: vi.fn(), $transaction: vi.fn(), company: { findFirst: vi.fn() } },
}));
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", name: "Admin", role: "ADMIN" })), requireAdmin: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
  auditLog: vi.fn(), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(), assertPeriodWritableForRange: vi.fn() }));
vi.mock("../../payroll/extras-payables.js", () => ({ extrasParaPayables: vi.fn(async () => []), extrasParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../../payroll/folha-lote-payables.js", () => ({ lotesParaPayables: vi.fn(async () => []), lotesParaPayablesPdf: vi.fn(async () => []) }));
vi.mock("../payables-financial-pdf.js", () => ({ createPayablesFinancialPdf: vi.fn(async () => Buffer.from("%PDF")) }));
vi.mock("../../inventory/inventory.routes.js", () => ({ gravarConversaoDoItemDeCompra: vi.fn(), recordPurchaseInventoryEntry: vi.fn() }));
vi.mock("../../cards/cards.service.js", () => ({
  removeCardStatementItemsForPurchase: vi.fn(), syncCardStatementItemForPurchase: vi.fn(), syncCardStatementItemsForPurchase: vi.fn(),
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

type Parcela = { dueDate: Date; amount: string; status: string; paidDate: Date | null };
const DIA = new Date("2026-09-01T00:00:00.000Z");
const PAGA: Parcela = { dueDate: DIA, amount: "100.00", status: "PAID", paidDate: DIA };
const ABERTA: Parcela = { ...PAGA, status: "OPEN", paidDate: null };

const tx = {
  $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  purchase: { update: vi.fn() },
  purchaseItem: { create: vi.fn(async () => ({ id: "i1" })), deleteMany: vi.fn() },
  paymentInstallment: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

function banco(parcelas: Parcela[], billingMode = "DIRECT") {
  const responder = async (...c: unknown[]) => {
    const s = sqlDe(c);
    if (s.includes('FOR UPDATE')) return parcelas;
    if (s.includes('FROM "Purchase" p')) {
      return [{ id: "p1", status: "ACTIVE", supplierId: "s1", purchaseDate: "2026-09-01", receivedAt: null, purchaseNumber: "1" }];
    }
    if (s.includes('FROM "PaymentInstallment" pi')) return parcelas;
    if (s.includes('"billingMode"')) return [{ billingMode }];
    if (s.includes('SELECT "type" FROM "PaymentMethod"')) return [{ type: "BOLETO" }];
    return [];
  };
  db.$queryRaw.mockImplementation(responder);
  tx.$queryRaw.mockImplementation(responder);
}

const corpo = (total: number) => ({
  purchaseDate: "2026-09-01", invoiceNumber: "NF1", companyId: "c1",
  paymentMethodId: "pm1", paymentMethod: "BOLETO",
  items: [{ productId: "prod1", rawProductName: "Aluguel", unit: "UN", quantity: 1, unitPrice: total, totalPrice: total }],
  installments: [{ installment: 1, dueDate: "2026-09-01", amount: total, paymentMethodId: "pm1", paymentMethodName: "BOLETO", status: "OPEN" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: "c1" });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
});

test("nota paga editada sem mexer na cobranca: a baixa e mantida", async () => {
  banco([PAGA]);
  const r = await request(app).put("/purchases/p1").send(corpo(100));
  expect(r.status).toBe(200);
  expect(tx.paymentInstallment.deleteMany).not.toHaveBeenCalled();
  expect(tx.paymentInstallment.createMany).not.toHaveBeenCalled();
  expect(tx.purchase.update).toHaveBeenCalled();
});

test("nota paga com valor alterado: 409 e nada e gravado", async () => {
  banco([PAGA]);
  const r = await request(app).put("/purchases/p1").send(corpo(200));
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/Estorne o pagamento/);
  expect(tx.purchase.update).not.toHaveBeenCalled();
  expect(tx.paymentInstallment.deleteMany).not.toHaveBeenCalled();
  expect(tx.purchaseItem.deleteMany).not.toHaveBeenCalled();
});

test("nota paga com vencimento alterado: 409", async () => {
  banco([PAGA]);
  const body = corpo(100);
  body.installments[0].dueDate = "2026-10-01";
  const r = await request(app).put("/purchases/p1").send(body);
  expect(r.status).toBe(409);
  expect(tx.paymentInstallment.deleteMany).not.toHaveBeenCalled();
});

test("nota em aberto continua sendo recriada normalmente", async () => {
  banco([ABERTA]);
  const r = await request(app).put("/purchases/p1").send(corpo(200));
  expect(r.status).toBe(200);
  expect(tx.paymentInstallment.deleteMany).toHaveBeenCalled();
  expect(tx.paymentInstallment.createMany).toHaveBeenCalled();
});

test("nota paga com forma de pagamento trocada: a parcela acompanha, sem recriar", async () => {
  banco([PAGA]);
  const body = { ...corpo(100), paymentMethodId: "pm2", paymentMethod: "PIX" };
  const r = await request(app).put("/purchases/p1").send(body);
  expect(r.status).toBe(200);
  expect(tx.paymentInstallment.deleteMany).not.toHaveBeenCalled();
  expect(tx.paymentInstallment.updateMany).toHaveBeenCalledWith({
    where: { purchaseId: "p1", status: { not: "CANCELLED" } },
    data: { paymentMethodId: "pm2", paymentMethodName: "PIX" },
  });
});

test("nota paga movida para fornecedor de ciclo (chamada direta na API): 409, nao cobra duas vezes", async () => {
  banco([PAGA], "CYCLE");
  const r = await request(app).put("/purchases/p1").send(corpo(100));
  expect(r.status).toBe(409);
  expect(tx.purchase.update).not.toHaveBeenCalled();
});

test("parcela cancelada reenviada pela tela nao bloqueia a edicao", async () => {
  const cancelada: Parcela = { dueDate: new Date("2026-08-01T00:00:00.000Z"), amount: "50.00", status: "CANCELLED", paidDate: null };
  banco([cancelada, PAGA]);
  const body = corpo(100);
  body.installments.unshift({ installment: 1, dueDate: "2026-08-01", amount: 50, paymentMethodId: "pm1", paymentMethodName: "BOLETO", status: "CANCELLED" });
  // O total das parcelas enviadas precisa bater com os itens: a cancelada nao entra na conta da tela.
  const r = await request(app).put("/purchases/p1").send({ ...body, installments: body.installments.slice(1) });
  expect(r.status).toBe(200);
  expect(tx.paymentInstallment.deleteMany).not.toHaveBeenCalled();
});
