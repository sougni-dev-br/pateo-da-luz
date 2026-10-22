import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { guardarSnapshotDasLinhas, reconstruirLinhasDaCompra } = await import("../cards.service.js");

// Cancelar e restaurar (ou revincular) uma compra parcelada no cartão tem que devolver as
// N parcelas, cada uma no seu cartão físico/virtual, e não uma linha só com o total.

type Linha = {
  id: string; purchaseId: string; statementId: string; cardFinalId: string | null; installment: number | null;
  totalInstallments: number | null; value: number; description: string; categoryName: string | null;
  notes: string | null; smallExpenseTypeId: string | null;
};

const cartao = { id: "c1", name: "Conta", bankName: "Banco", last4Digits: "0000", closingDay: 10, dueDay: 20 };
const linha = (o: Partial<Linha>): Linha => ({
  id: "l", purchaseId: "p1", statementId: "s1", cardFinalId: null, installment: null, totalInstallments: null, value: 0,
  description: "NF 10 — Loja", categoryName: "Embalagem", notes: "Cartao de credito", smallExpenseTypeId: null, ...o,
});

function fakeTx(linhas: Linha[]) {
  const estado: Linha[] = [...linhas];
  const gravados: string[] = [];
  const tx = {
    estado,
    gravados,
    creditCardStatementItem: {
      findMany: vi.fn(async ({ where }: { where: { purchaseId: string } }) =>
        estado.filter((l) => l.purchaseId === where.purchaseId).sort((a, b) => (a.installment ?? 0) - (b.installment ?? 0))),
      deleteMany: vi.fn(async ({ where }: { where: { purchaseId: string } }) => {
        for (let i = estado.length - 1; i >= 0; i--) if (estado[i].purchaseId === where.purchaseId) estado.splice(i, 1);
        return { count: 0 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        estado.push(linha({
          id: String(data.id), statementId: String(data.statementId), cardFinalId: (data.cardFinalId as string | null) ?? null,
          installment: (data.installment as number | null) ?? null, totalInstallments: (data.totalInstallments as number | null) ?? null,
          value: Number(String(data.value)), description: String(data.description), categoryName: (data.categoryName as string | null) ?? null,
        }));
        return { id: String(data.id) };
      }),
    },
    creditCardFinal: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (["f1", "f2"].includes(where.id) ? { id: where.id } : null)) },
    creditCardStatement: {
      findFirst: vi.fn(async () => ({ id: "s1", status: "OPEN" })),
      create: vi.fn(async () => ({ id: "s1", status: "OPEN" })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
    creditCard: { findUnique: vi.fn(async () => cartao) },
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...valores: unknown[]) => { gravados.push(...valores.map(String)); return 1; }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      String(strings[0]).includes("FROM \"CreditCard\"") ? [cartao] : [{ total: estado.reduce((t, l) => t + l.value, 0) }]),
  };
  return tx;
}

const compra = {
  id: "p1", purchaseDate: new Date(2026, 8, 5), creditCardId: "c1", totalAmount: 900, supplierName: "Loja",
  invoiceNumber: "10", purchaseNumber: "CMP-1", smallExpenseTypeId: null, smallExpenseResponsibleName: null, smallExpenseNotes: null,
  rawRow: null as unknown,
};

describe("guardarSnapshotDasLinhas (ao cancelar)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda número de parcelas, descrição e o cartão de cada parcela na compra", async () => {
    const tx = fakeTx([
      linha({ id: "a", installment: 1, totalInstallments: 3, cardFinalId: "f1", value: 300 }),
      linha({ id: "b", installment: 2, totalInstallments: 3, cardFinalId: "f2", value: 300 }),
      linha({ id: "c", installment: 3, totalInstallments: 3, cardFinalId: null, value: 300 }),
    ]);
    await guardarSnapshotDasLinhas(tx as never, "p1");
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const json = JSON.parse(tx.gravados.find((v) => v.startsWith("{")) as string);
    expect(json).toMatchObject({ parcelas: 3, tipo: "NORMAL", descricao: "NF 10 — Loja", finaisPorParcela: { "1": "f1", "2": "f2" } });
  });

  it("compra sem linha na fatura não grava nada", async () => {
    const tx = fakeTx([]);
    await guardarSnapshotDasLinhas(tx as never, "p1");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("pequeno gasto é marcado como tal", async () => {
    const tx = fakeTx([linha({ value: 40, smallExpenseTypeId: "t1" })]);
    await guardarSnapshotDasLinhas(tx as never, "p1");
    expect(JSON.parse(tx.gravados.find((v) => v.startsWith("{")) as string).tipo).toBe("PEQUENO_GASTO");
  });
});

describe("reconstruirLinhasDaCompra (restaurar e revincular)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restaurar: volta as 3 parcelas, cada uma no seu cartão, a partir do que foi guardado ao cancelar", async () => {
    const tx = fakeTx([]);
    await reconstruirLinhasDaCompra(tx as never, {
      ...compra,
      rawRow: { cartaoSnapshot: { parcelas: 3, tipo: "NORMAL", descricao: "NF 10 — Loja", categoryName: "Embalagem", notes: "Cartao de credito", finaisPorParcela: { "1": "f1", "2": "f2" } } },
    });
    expect(tx.estado.map((l) => [l.installment, l.value, l.cardFinalId])).toEqual([[1, 300, "f1"], [2, 300, "f2"], [3, 300, null]]);
    expect(tx.estado[0].description).toBe("NF 10 — Loja");
  });

  it("revincular: compra que já tem parcelas na fatura continua com as parcelas", async () => {
    const tx = fakeTx([
      linha({ id: "a", installment: 1, totalInstallments: 3, cardFinalId: "f1", value: 300 }),
      linha({ id: "b", installment: 2, totalInstallments: 3, cardFinalId: "f2", value: 300 }),
      linha({ id: "c", installment: 3, totalInstallments: 3, value: 300 }),
    ]);
    await reconstruirLinhasDaCompra(tx as never, compra);
    expect(tx.estado.map((l) => [l.installment, l.value, l.cardFinalId])).toEqual([[1, 300, "f1"], [2, 300, "f2"], [3, 300, null]]);
  });

  it("compra à vista restaurada volta como uma linha, com a descrição original", async () => {
    const tx = fakeTx([]);
    await reconstruirLinhasDaCompra(tx as never, {
      ...compra, totalAmount: 120,
      rawRow: { cartaoSnapshot: { parcelas: 1, tipo: "NORMAL", descricao: "NF 10 — Loja", categoryName: null, notes: null, finaisPorParcela: { "1": "f2" } } },
    });
    expect(tx.estado).toHaveLength(1);
    expect(tx.estado[0]).toMatchObject({ value: 120, description: "NF 10 — Loja", cardFinalId: "f2" });
  });

  it("sem nada guardado (cancelada antes desta correção) cai no comportamento antigo: uma linha", async () => {
    const tx = fakeTx([]);
    await reconstruirLinhasDaCompra(tx as never, compra);
    expect(tx.estado).toHaveLength(1);
    expect(tx.estado[0].value).toBe(900);
  });

  it("pequeno gasto no cartão continua sendo uma linha", async () => {
    const tx = fakeTx([]);
    await reconstruirLinhasDaCompra(tx as never, {
      ...compra, totalAmount: 40, smallExpenseTypeId: "t1",
      rawRow: { cartaoSnapshot: { parcelas: 1, tipo: "PEQUENO_GASTO", descricao: "Gasto", categoryName: null, notes: null, finaisPorParcela: {} } },
    });
    expect(tx.estado).toHaveLength(1);
  });
});
