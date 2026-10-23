import { beforeEach, expect, test, vi } from "vitest";

// Valores e nomes fictícios. Garante que nada é gravado quando um mês de competência
// está travado e que renegociar/cancelar respeitam a situação do plano.

vi.mock("../../../config/database.js", () => ({
  prisma: { $transaction: vi.fn(), $queryRaw: vi.fn(), installmentPlan: { findUnique: vi.fn() } }
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../../cards/cards.service.js", () => ({ getNextPurchaseNumber: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { cancelarParcelamento, criarParcelamento, ParcelamentoError, renegociarParcelamento } from "../parcelamento.service.js";

const base = { supplierId: "s1", companyId: "c1", productId: "p1", description: "Acordo fictício", total: 300, quantidade: 3, primeiroVencimento: "2026-11-10" };

beforeEach(() => {
  vi.clearAllMocks();
});

test("período travado em qualquer parcela bloqueia o lote inteiro sem gravar", async () => {
  vi.mocked(assertPeriodWritableForDate).mockImplementation(async (d: Date) => {
    if (d.getMonth() === 11) throw new Error("Mês travado");
  });
  await expect(criarParcelamento(base, "u1")).rejects.toThrow(/12\/2026/);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test("confere cada mês de competência uma única vez", async () => {
  vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockResolvedValue({ planId: "pl1", compras: [] });
  await criarParcelamento({ ...base, quantidade: 3 }, "u1");
  expect(assertPeriodWritableForDate).toHaveBeenCalledTimes(3);
});

test("recusa entrada sem fornecedor ou descrição", async () => {
  await expect(criarParcelamento({ ...base, supplierId: "" }, "u1")).rejects.toBeInstanceOf(ParcelamentoError);
  await expect(criarParcelamento({ ...base, description: "  " }, "u1")).rejects.toBeInstanceOf(ParcelamentoError);
});

test("recusa parcelas informadas que não somam o total", async () => {
  await expect(criarParcelamento({
    ...base, quantidade: 2, primeiroVencimento: undefined,
    informadas: [{ valor: 100, vencimento: "2026-11-10" }, { valor: 100, vencimento: "2026-12-10" }]
  }, "u1")).rejects.toThrow(/soma/i);
});

test("renegociar exige motivo e plano ativo com parcelas abertas", async () => {
  await expect(renegociarParcelamento("pl1", { quantidade: 2, primeiroVencimento: "2027-01-10", motivo: " " }, "u1")).rejects.toThrow(/motivo/i);

  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl1", status: "CANCELLED" } as never);
  await expect(renegociarParcelamento("pl1", { quantidade: 2, primeiroVencimento: "2027-01-10", motivo: "acordo novo" }, "u1")).rejects.toMatchObject({ status: 409 });

  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl1", status: "ACTIVE" } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ purchaseId: "a", status: "PAID", purchaseStatus: "ACTIVE", amount: "100", paidAmount: "100", dueDate: new Date(2026, 10, 10), paidDate: new Date(), numero: 1, installmentId: "i1" }]);
  await expect(renegociarParcelamento("pl1", { quantidade: 2, primeiroVencimento: "2027-01-10", motivo: "acordo novo" }, "u1")).rejects.toThrow(/em aberto/i);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test("cancelar exige motivo e plano ativo", async () => {
  await expect(cancelarParcelamento("pl1", "", "u1")).rejects.toThrow(/motivo/i);
  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue({ id: "pl1", status: "RENEGOTIATED" } as never);
  await expect(cancelarParcelamento("pl1", "engano", "u1")).rejects.toMatchObject({ status: 409 });
});

test("recusa vencimento com ano absurdo sem gravar", async () => {
  await expect(criarParcelamento({ ...base, primeiroVencimento: "2062-01-10" }, "u1")).rejects.toThrow(/fora do intervalo/);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
