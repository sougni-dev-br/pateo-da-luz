import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { linhasForaDoDre } = await import("../cards.service.js");

// O titulo da fatura nao entra no DRE: a despesa ja esta nos itens das compras
// de cada linha. Linha sem compra ativa com itens nao tem onde aparecer — se a
// fatura fechasse assim, o gasto sairia do caixa e sumiria do resultado.

const compra = (status: string, itens: number) => ({ status, _count: { items: itens } });

describe("linhas da fatura que ficariam fora do DRE", () => {
  it("aceita fatura em que toda linha tem compra ativa com itens", () => {
    const linhas = [
      { description: "Mercado", value: 120, purchaseId: "a", purchase: compra("ACTIVE", 4) },
      { description: "Feira", value: 80, purchaseId: "b", purchase: compra("ACTIVE", 1) },
    ];
    expect(linhasForaDoDre(linhas)).toEqual([]);
  });

  it("acusa a linha lancada a mao, sem compra", () => {
    const linhas = [
      { description: "Mercado", value: 120, purchaseId: "a", purchase: compra("ACTIVE", 4) },
      { description: "Anuidade", value: 33.33, purchaseId: null, purchase: null },
    ];
    expect(linhasForaDoDre(linhas)).toEqual([{ description: "Anuidade", value: 33.33 }]);
  });

  it("acusa a linha cuja compra foi cancelada", () => {
    const linhas = [{ description: "Devolvida", value: 50, purchaseId: "c", purchase: compra("CANCELLED", 2) }];
    expect(linhasForaDoDre(linhas)).toEqual([{ description: "Devolvida", value: 50 }]);
  });

  it("acusa a linha cuja compra nao tem item", () => {
    const linhas = [{ description: "Importada", value: 75.5, purchaseId: "d", purchase: compra("ACTIVE", 0) }];
    expect(linhasForaDoDre(linhas)).toEqual([{ description: "Importada", value: 75.5 }]);
  });

  it("fatura vazia nao tem pendencia", () => {
    expect(linhasForaDoDre([])).toEqual([]);
  });
});
