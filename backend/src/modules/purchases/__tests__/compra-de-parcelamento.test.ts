import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, expect, test, vi } from "vitest";

// Dados fictícios. Parcela de parcelamento em lote não se edita, cancela nem restaura como compra
// comum: renegociar/cancelar é pelo parcelamento, e juros ou desconto entram na baixa.

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
  guardarSnapshotDasLinhas: vi.fn(), reconstruirLinhasDaCompra: vi.fn(),
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

function banco(noParcelamento: boolean) {
  db.$queryRaw.mockImplementation(async (...c: unknown[]) => {
    const s = sqlDe(c);
    if (s.includes('FROM "InstallmentPlan" ip')) {
      return noParcelamento ? [{ planId: "pl1", description: "Acordo fictício", numero: 2, total: 12 }] : [];
    }
    if (s.includes('FROM "Purchase" p') || s.includes('SELECT * FROM "Purchase"')) {
      return [{ id: "p1", status: "ACTIVE", supplierId: "s1", purchaseDate: "2026-09-01", receivedAt: null, purchaseNumber: "1" }];
    }
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findFirst.mockResolvedValue({ id: "c1" });
});

test.each([
  ["put", "/purchases/p1", /editar/],
  ["patch", "/purchases/p1/cancel", /cancelar/],
  ["patch", "/purchases/p1/restore", /restaurar/]
] as const)("%s %s: parcela de parcelamento recebe 409 e nada é gravado", async (metodo, caminho, acao) => {
  banco(true);
  const r = await request(app)[metodo](caminho).send({ reason: "teste" });
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/Parcela 2\/12 do parcelamento "Acordo fictício"/);
  expect(r.body.message).toMatch(acao);
  expect(r.body.message).toMatch(/Financeiro > Parcelamentos/);
  expect(r.body.message).toMatch(/Juros, multa ou desconto entram na baixa/);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test("compra comum não é bloqueada pela regra (segue para as validações normais)", async () => {
  banco(false);
  const r = await request(app).patch("/purchases/p1/cancel").send({});
  // Sem motivo, a rota normal recusa com 400 — prova que passou pelo bloqueio sem dar 409.
  expect(r.status).toBe(400);
  expect(r.body.message).toMatch(/Motivo/i);
});
