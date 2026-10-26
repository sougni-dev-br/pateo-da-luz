import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { syncCardStatementItemForPurchase, syncCardStatementItemsForPurchase, removeCardStatementItemsForPurchase, reabrirSeDivergir } =
  await import("../cards.service.js");

// Editar uma compra apaga e recria a linha dela na fatura. O cartão (físico ou virtual) que o
// Eli já classificou não pode se perder: o fake abaixo guarda as linhas de verdade, então a ORDEM
// das chamadas (ler, apagar, recriar) é exercitada, como na rota de edição.

type Linha = { id: string; purchaseId: string; statementId: string; cardFinalId: string | null; installment: number | null; value: number };

const cartao = { id: "c1", name: "Conta", bankName: "Banco", last4Digits: "0000", closingDay: 10, dueDay: 20 };

function fakeTx(opts: { linhas?: Linha[]; finaisValidos?: string[]; statusDaFatura?: string; totalDeclarado?: number } = {}) {
  const linhas: Linha[] = [...(opts.linhas ?? [])];
  const finaisValidos = new Set(opts.finaisValidos ?? ["f1", "f2"]);
  const fatura = { id: "s1", status: opts.statusDaFatura ?? "OPEN" };
  const tx = {
    linhas,
    creditCardStatementItem: {
      findMany: vi.fn(async ({ where }: { where: { purchaseId: string } }) =>
        linhas
          .filter((l) => l.purchaseId === where.purchaseId)
          .sort((a, b) => (a.installment ?? 0) - (b.installment ?? 0))
          .map((l) => ({ statementId: l.statementId, cardFinalId: l.cardFinalId, installment: l.installment }))),
      deleteMany: vi.fn(async ({ where }: { where: { purchaseId: string } }) => {
        const antes = linhas.length;
        for (let i = linhas.length - 1; i >= 0; i--) if (linhas[i].purchaseId === where.purchaseId) linhas.splice(i, 1);
        return { count: antes - linhas.length };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        linhas.push({
          id: String(data.id), purchaseId: String(data.purchaseId), statementId: String(data.statementId),
          cardFinalId: (data.cardFinalId as string | null) ?? null, installment: (data.installment as number | null) ?? null,
          value: Number(String(data.value)),
        });
        return { id: String(data.id) };
      }),
    },
    creditCardFinal: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (finaisValidos.has(where.id) ? { id: where.id } : null)),
    },
    creditCardStatement: {
      findFirst: vi.fn(async () => fatura),
      create: vi.fn(async () => fatura),
      update: vi.fn(async () => fatura),
      findUnique: vi.fn(async () => ({
        ...fatura,
        creditCard: { finais: [{ id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true }, { id: "f2", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL", isActive: true }] },
        finalTotals: opts.totalDeclarado == null ? [] : [{ cardFinalId: "f2", statedAmount: opts.totalDeclarado }],
        items: linhas.map((l) => ({ cardFinalId: l.cardFinalId, value: l.value })),
      })),
    },
    creditCard: { findUnique: vi.fn(async () => cartao) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      String(strings[0]).includes("FROM \"CreditCard\"") ? [cartao] : [{ total: linhas.reduce((t, l) => t + l.value, 0) }]
    ),
  };
  return tx;
}

const entrada = {
  purchaseId: "p1", cardId: "c1", purchaseDate: new Date(2026, 8, 5), description: "Compra", supplierName: "Loja", value: 10,
};
const linhaVirtual: Linha = { id: "l1", purchaseId: "p1", statementId: "s1", cardFinalId: "f2", installment: null, value: 10 };

describe("editar a compra mantém o cartão vinculado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fluxo da rota de edição: remover, depois recriar com o final devolvido pela remoção", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual] });
    const removido = await removeCardStatementItemsForPurchase("p1", tx as never);
    expect(removido.cardFinalId).toBe("f2");
    expect(tx.linhas).toHaveLength(0);
    await syncCardStatementItemForPurchase(tx as never, { ...entrada, cardFinalId: removido.cardFinalId });
    expect(tx.linhas[0].cardFinalId).toBe("f2");
  });

  it("sem linha anterior a remoção devolve 'não definido'", async () => {
    const tx = fakeTx();
    expect((await removeCardStatementItemsForPurchase("p1", tx as never)).cardFinalId).toBeNull();
  });

  it("o sync sozinho também preserva (lê antes de apagar)", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual] });
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.linhas[0].cardFinalId).toBe("f2");
  });

  it("compra nova entra como 'não definido'", async () => {
    const tx = fakeTx();
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.linhas[0].cardFinalId).toBeNull();
  });

  it("final que não vale mais (inativo ou de outro cartão) volta a 'não definido'", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual], finaisValidos: [] });
    await syncCardStatementItemForPurchase(tx as never, entrada);
    expect(tx.linhas[0].cardFinalId).toBeNull();
  });

  it("o cartão escolhido no lançamento vence o da linha anterior", async () => {
    const tx = fakeTx({ linhas: [{ ...linhaVirtual, cardFinalId: "f2" }] });
    await syncCardStatementItemForPurchase(tx as never, { ...entrada, cardFinalId: "f1" });
    expect(tx.linhas[0].cardFinalId).toBe("f1");
  });

  it("compra parcelada: cada parcela volta para o cartão em que estava", async () => {
    const tx = fakeTx({
      linhas: [
        { id: "a", purchaseId: "p1", statementId: "s1", cardFinalId: "f1", installment: 1, value: 10 },
        { id: "b", purchaseId: "p1", statementId: "s1", cardFinalId: "f2", installment: 2, value: 10 },
      ],
    });
    await syncCardStatementItemsForPurchase(tx as never, {
      purchaseId: "p1", cardId: "c1", purchaseDate: new Date(2026, 8, 5), description: "Compra", supplierName: "Loja",
      totalAmount: 20, numberOfInstallments: 2,
    });
    expect(tx.linhas.map((l) => [l.installment, l.cardFinalId])).toEqual([[1, "f1"], [2, "f2"]]);
  });
});

describe("editar a compra reabre a fatura conferida que deixou de bater com o extrato", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fatura conferida cujo total do virtual deixou de bater volta para Aberta", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual], statusDaFatura: "CHECKED", totalDeclarado: 10 });
    await syncCardStatementItemForPurchase(tx as never, { ...entrada, value: 25 });
    expect(tx.creditCardStatement.update.mock.calls.some((c) => (c[0] as { data: { status?: string } }).data.status === "OPEN")).toBe(true);
  });

  it("quando o total ainda bate, a fatura continua conferida", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual], statusDaFatura: "CHECKED", totalDeclarado: 10 });
    expect(await reabrirSeDivergir(tx as never, "s1")).toBe(false);
  });

  it("sem total do extrato informado nada muda", async () => {
    const tx = fakeTx({ linhas: [linhaVirtual], statusDaFatura: "CHECKED" });
    expect(await reabrirSeDivergir(tx as never, "s1")).toBe(false);
  });

  it("fatura aberta ou fechada não é mexida", async () => {
    for (const status of ["OPEN", "CLOSED", "PAID"]) {
      const tx = fakeTx({ linhas: [linhaVirtual], statusDaFatura: status, totalDeclarado: 999 });
      expect(await reabrirSeDivergir(tx as never, "s1")).toBe(false);
    }
  });
});
