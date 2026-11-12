import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { syncCardStatementItemsForPurchase, DeslocamentoDeFaturaError } = await import("../cards.service.js");

// Editar uma compra existente nao pode empurrar as parcelas para outro mes: se alguma fatura do
// caminho esta fechada, a edicao e recusada (antes as parcelas iam silenciosamente para o mes seguinte).

const cartao = { id: "c1", name: "Cartao", bankName: "B", last4Digits: "1111", closingDay: 5, dueDay: 18 };

function tx(statusDaFatura: Record<string, string>) {
  return {
    creditCardStatementItem: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), create: vi.fn() },
    creditCardFinal: { findFirst: vi.fn(async () => null) },
    creditCard: { findUnique: vi.fn(async () => cartao) },
    creditCardStatement: {
      findFirst: vi.fn(async ({ where }: { where: { competenceMonth: number } }) => {
        const status = statusDaFatura[String(where.competenceMonth)];
        return status ? { id: `s${where.competenceMonth}`, status, competenceYear: 2026, competenceMonth: where.competenceMonth } : null;
      }),
      create: vi.fn(async ({ data }: { data: { id: string } }) => data),
      findUnique: vi.fn(async () => null),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(),
  };
}

const entrada = {
  purchaseId: "p1", cardId: "c1", purchaseDate: new Date(2026, 6, 31), description: "NF", supplierName: "Loja",
  totalAmount: 3398, numberOfInstallments: 6,
};

describe("sync da compra no cartao ao editar", () => {
  it("recusa em vez de deslocar quando a fatura do caminho esta fechada", async () => {
    const t = tx({ "8": "CLOSED" });
    await expect(
      syncCardStatementItemsForPurchase(t as never, { ...entrada, recusarDeslocamento: true })
    ).rejects.toBeInstanceOf(DeslocamentoDeFaturaError);
    expect(t.creditCardStatementItem.create).not.toHaveBeenCalled();
  });

  it("sem fatura fechada no caminho, grava normalmente", async () => {
    const t = tx({});
    await syncCardStatementItemsForPurchase(t as never, { ...entrada, recusarDeslocamento: true });
    expect(t.creditCardStatementItem.create).toHaveBeenCalledTimes(6);
  });

  it("compra nova (sem a opcao) continua indo para a proxima fatura aberta", async () => {
    const t = tx({ "8": "CLOSED" });
    await syncCardStatementItemsForPurchase(t as never, entrada);
    expect(t.creditCardStatementItem.create).toHaveBeenCalledTimes(6);
  });
});
