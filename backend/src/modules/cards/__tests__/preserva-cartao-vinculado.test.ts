import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { syncCardStatementItemForPurchase, syncCardStatementItemsForPurchase } = await import("../cards.service.js");

// Editar uma compra apaga e recria a linha dela na fatura. O cartão (físico ou
// virtual) que o Eli já classificou não pode se perder nesse caminho.

const cartao = { id: "c1", name: "Conta", bankName: "Banco", last4Digits: "0000", closingDay: 10, dueDay: 20 };
const fatura = { id: "s1", status: "OPEN" };

function fakeTx(anteriores: Array<{ cardFinalId: string | null }>, finalValido: boolean) {
  return {
    creditCardStatementItem: {
      findMany: vi.fn(async () => anteriores),
      deleteMany: vi.fn(async () => ({ count: anteriores.length })),
      create: vi.fn(async () => ({ id: "novo" })),
    },
    creditCardFinal: { findFirst: vi.fn(async () => (finalValido ? { id: "f1" } : null)) },
    creditCardStatement: { findFirst: vi.fn(async () => fatura), update: vi.fn(), create: vi.fn() },
    creditCard: { findUnique: vi.fn(async () => cartao) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      String(strings[0]).includes("FROM \"CreditCard\"") ? [cartao] : [{ total: 10 }]
    ),
  };
}

const entrada = {
  purchaseId: "p1",
  cardId: "c1",
  purchaseDate: new Date(2026, 8, 5),
  description: "Compra",
  supplierName: "Loja",
  value: 10,
};

describe("recriar a linha da fatura mantém o cartão vinculado", () => {
  let tx: ReturnType<typeof fakeTx>;
  beforeEach(() => vi.clearAllMocks());

  it("compra à vista: a nova linha herda o final da anterior", async () => {
    tx = fakeTx([{ cardFinalId: "f1" }], true);
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.creditCardStatementItem.create.mock.calls[0][0].data.cardFinalId).toBe("f1");
  });

  it("compra nova, sem linha anterior, entra como 'não definido'", async () => {
    tx = fakeTx([], true);
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.creditCardStatementItem.create.mock.calls[0][0].data.cardFinalId).toBeNull();
  });

  it("se o final não pertence mais ao cartão da compra, volta a 'não definido'", async () => {
    tx = fakeTx([{ cardFinalId: "f1" }], false);
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.creditCardStatementItem.create.mock.calls[0][0].data.cardFinalId).toBeNull();
  });

  it("compra parcelada: todas as parcelas herdam o final", async () => {
    tx = fakeTx([{ cardFinalId: "f1" }, { cardFinalId: "f1" }], true);
    await syncCardStatementItemsForPurchase(tx as never, {
      purchaseId: "p1",
      cardId: "c1",
      purchaseDate: new Date(2026, 8, 5),
      description: "Compra",
      supplierName: "Loja",
      totalAmount: 20,
      numberOfInstallments: 2,
    });
    const finais = tx.creditCardStatementItem.create.mock.calls.map((c) => c[0].data.cardFinalId);
    expect(finais).toEqual(["f1", "f1"]);
  });
});
