import { beforeEach, expect, test, vi } from "vitest";

// Valores e nomes fictícios. Exercita os caminhos de gravação com uma transação simulada.

const tx = {
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  installmentPlan: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  purchase: { create: vi.fn() },
  purchaseItem: { create: vi.fn() },
  paymentInstallment: { create: vi.fn() },
  supplier: { findUnique: vi.fn() },
  company: { findFirst: vi.fn() },
  product: { findUnique: vi.fn() },
  paymentMethod: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() }
};

vi.mock("../../../config/database.js", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    $queryRaw: vi.fn(),
    installmentPlan: { findUnique: vi.fn() },
    purchase: { findFirst: vi.fn() }
  }
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../../cards/cards.service.js", () => ({ getNextPurchaseNumber: vi.fn(async () => "CMP-2026-000001") }));

import { prisma } from "../../../config/database.js";
import { cancelarParcelamento, criarParcelamento, renegociarParcelamento } from "../parcelamento.service.js";

const entrada = { supplierId: "s1", companyId: "c1", productId: "p1", description: "Acordo fictício", total: 300, quantidade: 3, primeiroVencimento: "2026-11-10" };
const produtoOk = { id: "p1", name: "CONDOMINIO", unit: "UN", unitMeasureId: null, isActive: true, controlsStock: false, dreCategoryId: "d1", dreCategory: { dreGroup: "LOCACAO" } };

beforeEach(() => {
  vi.clearAllMocks();
  tx.installmentPlan.findFirst.mockResolvedValue(null);
  tx.installmentPlan.create.mockResolvedValue({ id: "pl1" });
  tx.purchase.create.mockImplementation(async () => ({ id: `pu${tx.purchase.create.mock.calls.length}` }));
  tx.supplier.findUnique.mockResolvedValue({ id: "s1" });
  tx.company.findFirst.mockResolvedValue({ id: "c1" });
  tx.product.findUnique.mockResolvedValue(produtoOk);
  tx.paymentMethod.findUnique.mockResolvedValue(null);
});

test("cria o plano e uma compra com item e parcela para cada vencimento", async () => {
  const r = await criarParcelamento(entrada, "u1");
  expect(r.planId).toBe("pl1");
  expect(tx.purchase.create).toHaveBeenCalledTimes(3);
  expect(tx.purchaseItem.create).toHaveBeenCalledTimes(3);
  expect(tx.paymentInstallment.create).toHaveBeenCalledTimes(3);
  const competencias = tx.purchase.create.mock.calls.map((c) => [c[0].data.competenceMonth, c[0].data.competenceYear]);
  expect(competencias).toEqual([[11, 2026], [12, 2026], [1, 2027]]);
  expect(tx.purchase.create.mock.calls[0][0].data.installmentPlanId).toBe("pl1");
});

test("recusa parcelamento repetido nos últimos minutos", async () => {
  tx.installmentPlan.findFirst.mockResolvedValue({ id: "plX" });
  await expect(criarParcelamento(entrada, "u1")).rejects.toMatchObject({ status: 409 });
  expect(tx.purchase.create).not.toHaveBeenCalled();
});

test.each([
  ["estoque", { controlsStock: true }],
  ["CMV", { dreCategory: { dreGroup: "CMV_COMPRAS" } }],
  ["categoria", { dreCategoryId: null, dreCategory: null }],
  ["inativo", { isActive: false }]
])("recusa produto inválido (%s) sem gravar compras", async (_nome, mudanca) => {
  tx.product.findUnique.mockResolvedValue({ ...produtoOk, ...mudanca });
  await expect(criarParcelamento(entrada, "u1")).rejects.toThrow();
  expect(tx.purchase.create).not.toHaveBeenCalled();
});

test("recusa fornecedor ou empresa inexistente", async () => {
  tx.supplier.findUnique.mockResolvedValue(null);
  await expect(criarParcelamento(entrada, "u1")).rejects.toMatchObject({ status: 404 });
  tx.supplier.findUnique.mockResolvedValue({ id: "s1" });
  tx.company.findFirst.mockResolvedValue(null);
  await expect(criarParcelamento(entrada, "u1")).rejects.toThrow(/empresa/i);
});

test("recusa descrição e observações longas demais", async () => {
  await expect(criarParcelamento({ ...entrada, description: "x".repeat(121) }, "u1")).rejects.toThrow(/120/);
  await expect(criarParcelamento({ ...entrada, notes: "x".repeat(501) }, "u1")).rejects.toThrow(/500/);
});

const linha = (over: Record<string, unknown>) => ({ purchaseId: "a", numero: 1, installmentId: "i1", status: "OPEN", purchaseStatus: "ACTIVE", amount: "100", paidAmount: null, dueDate: new Date(2026, 10, 10), paidDate: null, ...over });

test("renegociar cancela só as abertas, cria o novo plano e marca o antigo", async () => {
  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl0", status: "ACTIVE", supplierId: "s1", companyId: "c1", productId: "p1", description: "Acordo fictício" } as never);
  vi.mocked(prisma.purchase.findFirst).mockResolvedValue({ paymentMethodId: null } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([linha({ purchaseId: "a", status: "PAID", paidAmount: "100" }), linha({ purchaseId: "b", numero: 2 }), linha({ purchaseId: "c", numero: 3, dueDate: new Date(2026, 11, 10) })]);
  tx.$queryRaw.mockResolvedValue([{ purchaseId: "a", status: "PAID" }, { purchaseId: "b", status: "OPEN" }, { purchaseId: "c", status: "OPEN" }]);
  const r = await renegociarParcelamento("pl0", { quantidade: 2, primeiroVencimento: "2027-02-05", motivo: "novo acordo" }, "u1");
  expect(r.saldoAnterior).toBe(200);
  expect(r.parcelasCanceladas).toBe(2);
  expect(tx.purchase.create).toHaveBeenCalledTimes(2);
  expect(tx.installmentPlan.update).toHaveBeenCalledWith({ where: { id: "pl0" }, data: { status: "RENEGOTIATED" } });
});

test("renegociar para se uma parcela foi baixada no meio-tempo", async () => {
  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl0", status: "ACTIVE", supplierId: "s1", companyId: "c1", productId: "p1", description: "x" } as never);
  vi.mocked(prisma.purchase.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([linha({ purchaseId: "b" })]);
  tx.$queryRaw.mockResolvedValue([{ purchaseId: "b", status: "PAID" }]);
  await expect(renegociarParcelamento("pl0", { quantidade: 1, primeiroVencimento: "2027-02-05", motivo: "novo" }, "u1")).rejects.toMatchObject({ status: 409 });
  expect(tx.purchase.create).not.toHaveBeenCalled();
  expect(tx.installmentPlan.update).not.toHaveBeenCalled();
});

test("cancelar para se uma parcela foi baixada no meio-tempo e cancela quando está tudo aberto", async () => {
  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl0", status: "ACTIVE" } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([linha({ purchaseId: "b" })]);
  tx.$queryRaw.mockResolvedValue([{ purchaseId: "b", status: "PAID" }]);
  await expect(cancelarParcelamento("pl0", "engano", "u1")).rejects.toMatchObject({ status: 409 });
  expect(tx.installmentPlan.update).not.toHaveBeenCalled();

  tx.$queryRaw.mockResolvedValue([{ purchaseId: "b", status: "OPEN" }]);
  const r = await cancelarParcelamento("pl0", "engano", "u1");
  expect(r).toEqual({ parcelasCanceladas: 1, parcelasPagasMantidas: 0 });
  expect(tx.installmentPlan.update).toHaveBeenCalledWith({ where: { id: "pl0" }, data: { status: "CANCELLED" } });
});
