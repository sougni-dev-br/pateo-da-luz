import { describe, expect, it } from "vitest";
import type { ItemDaPosicao } from "../../../api/client";
import { resumirPorSetor, resumirPosicao } from "../inventario/posicao-resumo";

const item = (p: Partial<ItemDaPosicao>): ItemDaPosicao => ({
  productId: "p", productCode: null, productName: "x", unit: "UN", sectorName: null, categoryName: null,
  quantidade: null, contadoEm: null, inventarioCodigo: null, custoUnitario: null, valor: null,
  comprasDesde: 0, valorComprasDesde: 0, ...p
});

describe("resumirPosicao", () => {
  it("soma o valor contado e calcula o teto com as compras depois da contagem", () => {
    const r = resumirPosicao([
      item({ quantidade: 2, valor: 100, contadoEm: "2026-09-30", valorComprasDesde: 30 }),
      item({ quantidade: 1, valor: 50, contadoEm: "2026-10-05" }),
      item({ valorComprasDesde: 20 })
    ]);
    expect(r).toMatchObject({ valor: 150, contados: 2, valorCompras: 50, teto: 200, maisRecente: "2026-10-05" });
  });

  it("ignora valor nulo de item contado sem custo", () => {
    expect(resumirPosicao([item({ quantidade: 3, valor: null })]).valor).toBe(0);
  });

  it("devolve zeros sem itens", () => {
    expect(resumirPosicao([])).toEqual({ valor: 0, contados: 0, valorCompras: 0, teto: 0, maisRecente: null });
  });
});

describe("resumirPorSetor", () => {
  it("agrupa por setor com valor e data da contagem de cada um, do maior valor ao menor", () => {
    const r = resumirPorSetor([
      item({ sectorName: "Bar", quantidade: 1, valor: 40, contadoEm: "2026-10-10" }),
      item({ sectorName: "Cozinha", quantidade: 1, valor: 300, contadoEm: "2026-10-02" }),
      item({ sectorName: "Cozinha", quantidade: 1, valor: 100, contadoEm: "2026-10-03" }),
      item({ sectorName: "Cozinha" }),
      item({ sectorName: null })
    ]);
    expect(r.map((s) => s.setor)).toEqual(["Cozinha", "Bar", "Sem setor"]);
    expect(r[0]).toEqual({ setor: "Cozinha", valor: 400, contados: 2, total: 3, maisRecente: "2026-10-03" });
    expect(r[1].maisRecente).toBe("2026-10-10");
  });
});
