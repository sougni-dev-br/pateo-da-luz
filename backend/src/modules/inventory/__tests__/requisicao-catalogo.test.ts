import { describe, expect, test } from "vitest";
import { itemDoCatalogo, type ProdutoDoCatalogo } from "../requisicao-catalogo.js";

const produto = (extra: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo => ({
  id: "p1",
  externalCode: "327",
  name: "ALFACE AMERICANA",
  unit: "KG",
  unitMeasure: null,
  conversions: [],
  inventorySectorId: "s1",
  ...extra
});

describe("itemDoCatalogo", () => {
  test("leva o saldo e o setor do produto", () => {
    const item = itemDoCatalogo(produto(), 44);
    expect(item).toMatchObject({ id: "p1", code: "327", unit: "KG", sectorId: "s1", balance: 44 });
  });

  test("sem registro de saldo vale zero, como a validação do servidor", () => {
    expect(itemDoCatalogo(produto(), undefined).balance).toBe(0);
  });

  test("usa a unidade de medida cadastrada antes do texto livre", () => {
    expect(itemDoCatalogo(produto({ unit: "Kg", unitMeasure: { code: "KG" } }), 1).unit).toBe("KG");
  });

  test("inclui as conversões cadastradas do produto", () => {
    const item = itemDoCatalogo(produto({ unit: "UN", conversions: [{ fromUnit: "CX", toUnit: "UN", factor: 12 }] }), 3);
    expect(item.conversions).toEqual([{ fromUnit: "CX", toUnit: "UN", factor: 12 }]);
  });

  test("lê a embalagem escrita no nome do produto quando o estoque conta em unidade", () => {
    const item = itemDoCatalogo(produto({ name: "ARROZ 5KG", unit: "UN" }), 2);
    expect(item.embalagemInferida).toContain("5");
    expect(item.conversions.some((c) => c.inferida)).toBe(true);
  });
});
