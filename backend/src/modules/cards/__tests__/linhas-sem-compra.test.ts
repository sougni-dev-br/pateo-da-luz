import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { linhasSemCompraAtiva } = await import("../cards.service.js");

// O titulo da fatura nao entra no DRE: a despesa ja esta nas compras de cada
// linha. Linha sem compra ativa nao tem onde aparecer — se a fatura fechasse
// assim, o gasto pagaria no caixa e sumiria do resultado.

describe("linhas da fatura sem compra ativa", () => {
  it("aceita fatura em que toda linha tem compra ativa", () => {
    const linhas = [
      { description: "Mercado", value: 120, purchaseId: "a", purchase: { status: "ACTIVE" } },
      { description: "Feira", value: 80, purchaseId: "b", purchase: { status: "ACTIVE" } },
    ];
    expect(linhasSemCompraAtiva(linhas)).toEqual([]);
  });

  it("acusa a linha lancada a mao, sem compra", () => {
    const linhas = [
      { description: "Mercado", value: 120, purchaseId: "a", purchase: { status: "ACTIVE" } },
      { description: "Anuidade", value: 33.33, purchaseId: null, purchase: null },
    ];
    expect(linhasSemCompraAtiva(linhas)).toEqual([{ description: "Anuidade", value: 33.33 }]);
  });

  it("acusa a linha cuja compra foi cancelada", () => {
    const linhas = [
      { description: "Devolvida", value: 50, purchaseId: "c", purchase: { status: "CANCELLED" } },
    ];
    expect(linhasSemCompraAtiva(linhas)).toEqual([{ description: "Devolvida", value: 50 }]);
  });

  it("fatura vazia nao tem pendencia", () => {
    expect(linhasSemCompraAtiva([])).toEqual([]);
  });
});
