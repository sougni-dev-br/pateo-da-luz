import { describe, expect, it } from "vitest";
import { compararPrecos, type LinhaDePreco } from "../price-comparison.js";

function linha(parcial: Partial<LinhaDePreco> & Pick<LinhaDePreco, "date" | "supplierName">): LinhaDePreco {
  return {
    unit: "KG",
    unitPrice: 10,
    quantity: 1,
    convertedUnit: null,
    convertedUnitPrice: null,
    convertedQuantity: null,
    ...parcial
  };
}

describe("compararPrecos", () => {
  it("devolve vazio quando nao ha compra", () => {
    const r = compararPrecos([]);
    expect(r.unit).toBeNull();
    expect(r.suppliers).toEqual([]);
  });

  it("usa o preco convertido quando existe, para comparar na mesma unidade", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unit: "CX", unitPrice: 120, convertedUnit: "KG", convertedUnitPrice: 12 }),
      linha({ date: "2026-10-05", supplierName: "B", unit: "KG", unitPrice: 11 })
    ]);
    expect(r.unit).toBe("KG");
    expect(r.suppliers.map((s) => [s.supplierName, s.lastPrice])).toEqual([["B", 11], ["A", 12]]);
  });

  it("marca o fornecedor mais barato pelo ultimo preco", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unitPrice: 12 }),
      linha({ date: "2026-10-08", supplierName: "B", unitPrice: 9 })
    ]);
    expect(r.suppliers[0]).toMatchObject({ supplierName: "B", isCheapest: true });
    expect(r.suppliers[1]).toMatchObject({ supplierName: "A", isCheapest: false });
  });

  it("agrega minimo, media e quantidade de compras por fornecedor", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unitPrice: 12 }),
      linha({ date: "2026-09-10", supplierName: "A", unitPrice: 8 })
    ]);
    expect(r.suppliers[0]).toMatchObject({ lastPrice: 12, minPrice: 8, avgPrice: 10, purchases: 2, lastDate: "2026-10-10" });
  });

  it("ignora linhas em outra unidade que a da compra mais recente e conta quantas foram", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unit: "KG", unitPrice: 10 }),
      linha({ date: "2026-09-10", supplierName: "A", unit: "CX", unitPrice: 200 })
    ]);
    expect(r.unit).toBe("KG");
    expect(r.suppliers[0].purchases).toBe(1);
    expect(r.ignoredOtherUnit).toBe(1);
  });

  it("usa a unidade mais frequente, nao a da ultima compra", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unit: "CX", unitPrice: 200 }),
      linha({ date: "2026-10-05", supplierName: "A", unit: "KG", unitPrice: 10 }),
      linha({ date: "2026-10-01", supplierName: "B", unit: "KG", unitPrice: 11 })
    ]);
    expect(r.unit).toBe("KG");
    expect(r.ignoredOtherUnit).toBe(1);
  });

  it("ignora preco zerado ou invalido", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unitPrice: 0 }),
      linha({ date: "2026-10-09", supplierName: "A", unitPrice: 10 })
    ]);
    expect(r.suppliers[0].purchases).toBe(1);
    expect(r.suppliers[0].lastPrice).toBe(10);
  });

  it("devolve a serie recente de precos de cada fornecedor, da mais antiga para a mais nova", () => {
    const r = compararPrecos([
      linha({ date: "2026-10-10", supplierName: "A", unitPrice: 12 }),
      linha({ date: "2026-09-10", supplierName: "A", unitPrice: 8 }),
      linha({ date: "2026-08-10", supplierName: "A", unitPrice: 9 })
    ]);
    expect(r.suppliers[0].recent).toEqual([9, 8, 12]);
  });

  it("limita a serie recente as 8 compras mais novas", () => {
    const linhas = Array.from({ length: 12 }, (_, i) =>
      linha({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, supplierName: "A", unitPrice: i + 1 })
    );
    const r = compararPrecos(linhas);
    expect(r.suppliers[0].recent).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  describe("leitura para quem compra", () => {
    const HOJE = new Date("2026-10-15T12:00:00Z");
    const opcoes = { today: HOJE };

    it("conta ha quantos dias foi a ultima compra de cada fornecedor", () => {
      const r = compararPrecos([linha({ date: "2026-10-05", supplierName: "A" })], opcoes);
      expect(r.suppliers[0].daysSinceLast).toBe(10);
    });

    it("marca preco velho depois de 45 dias", () => {
      const r = compararPrecos([
        linha({ date: "2026-10-10", supplierName: "A", unitPrice: 12 }),
        linha({ date: "2026-08-20", supplierName: "B", unitPrice: 9 })
      ], opcoes);
      const b = r.suppliers.find((s) => s.supplierName === "B");
      const a = r.suppliers.find((s) => s.supplierName === "A");
      expect(b).toMatchObject({ daysSinceLast: 56, isStale: true });
      expect(a).toMatchObject({ daysSinceLast: 5, isStale: false });
    });

    it("mostra quanto o fornecedor mudou o preco desde a compra anterior dele", () => {
      const r = compararPrecos([
        linha({ date: "2026-10-10", supplierName: "A", unitPrice: 13 }),
        linha({ date: "2026-09-10", supplierName: "A", unitPrice: 10 }),
        linha({ date: "2026-09-12", supplierName: "B", unitPrice: 9 })
      ], opcoes);
      const a = r.suppliers.find((s) => s.supplierName === "A");
      const b = r.suppliers.find((s) => s.supplierName === "B");
      expect(a).toMatchObject({ previousPrice: 10, changePercent: 30 });
      expect(b).toMatchObject({ previousPrice: null, changePercent: null });
    });

    it("devolve a quantidade da ultima compra na unidade comparavel", () => {
      const r = compararPrecos([
        linha({ date: "2026-10-10", supplierName: "A", unit: "CX", quantity: 2, unitPrice: 120, convertedUnit: "KG", convertedQuantity: 20, convertedUnitPrice: 12 }),
        linha({ date: "2026-10-01", supplierName: "A", unit: "KG", quantity: 5, unitPrice: 12 })
      ], opcoes);
      expect(r.suppliers[0].lastQuantity).toBe(20);
    });

    describe("economia", () => {
      it("soma o que se pagou acima do menor preco atual nos ultimos 90 dias", () => {
        const r = compararPrecos([
          linha({ date: "2026-10-10", supplierName: "A", unitPrice: 10, quantity: 5 }),
          linha({ date: "2026-10-05", supplierName: "B", unitPrice: 13, quantity: 10 })
        ], opcoes);
        expect(r.savings).toMatchObject({ windowDays: 90, amount: 30, spent: 180, percent: 16.7, purchases: 1 });
      });

      it("ignora compras fora da janela de 90 dias", () => {
        const r = compararPrecos([
          linha({ date: "2026-10-10", supplierName: "A", unitPrice: 10, quantity: 5 }),
          linha({ date: "2026-06-01", supplierName: "B", unitPrice: 13, quantity: 10 })
        ], opcoes);
        expect(r.savings).toBeNull();
      });

      it("nao estima economia quando o menor preco e velho", () => {
        const r = compararPrecos([
          linha({ date: "2026-08-01", supplierName: "A", unitPrice: 10, quantity: 5 }),
          linha({ date: "2026-10-05", supplierName: "B", unitPrice: 13, quantity: 10 })
        ], opcoes);
        expect(r.savings).toBeNull();
      });

      it("e nulo quando ninguem pagou acima do menor preco", () => {
        const r = compararPrecos([
          linha({ date: "2026-10-10", supplierName: "A", unitPrice: 10, quantity: 5 }),
          linha({ date: "2026-10-05", supplierName: "A", unitPrice: 10, quantity: 5 })
        ], opcoes);
        expect(r.savings).toBeNull();
      });

      it("usa a quantidade convertida quando ha conversao", () => {
        const r = compararPrecos([
          linha({ date: "2026-10-10", supplierName: "A", unitPrice: 10, quantity: 5 }),
          linha({ date: "2026-10-05", supplierName: "B", unit: "CX", quantity: 1, unitPrice: 130, convertedUnit: "KG", convertedQuantity: 10, convertedUnitPrice: 13 })
        ], opcoes);
        expect(r.savings?.amount).toBe(30);
      });
    });
  });
});
