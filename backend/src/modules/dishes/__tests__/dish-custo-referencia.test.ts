import { describe, expect, it, vi } from "vitest";
import { carregarReferenciaDosItens, itemComReferencia } from "../dish-custo-referencia.js";
import type { CustoDeReferencia } from "../../inventory/custo-de-referencia.js";
import type { ProdutoDoItem } from "../dish-itens.js";

const produto = (id: string, custo: number | null, extra: Partial<ProdutoDoItem> = {}): ProdutoDoItem => ({
  id, name: id, unit: "UN", inventoryStock: custo == null ? null : { averageCost: custo, currentQuantity: 5 }, conversions: [], ...extra
});
const ref = (valor: number): CustoDeReferencia => ({ valor, fonte: "COMPRAS_DO_PERIODO", detalhe: null, revisar: null });

describe("carregarReferenciaDosItens", () => {
  it("desligada: nao consulta nada", async () => {
    const carregar = vi.fn();
    const r = await carregarReferenciaDosItens([{ product: produto("a", 1) }], false, carregar);
    expect(r.size).toBe(0);
    expect(carregar).not.toHaveBeenCalled();
  });

  it("ligada: consulta so produtos comprados (ignora ficha de producao e item sem produto)", async () => {
    const carregar = vi.fn(async () => new Map([["a", ref(2)]]));
    const itens = [{ product: produto("a", 1) }, { product: produto("f", 3, { ehFicha: true }) }, { product: null }];
    await carregarReferenciaDosItens(itens, true, carregar);
    expect(carregar).toHaveBeenCalledWith(["a"]);
  });
});

describe("itemComReferencia", () => {
  it("troca o custo medio pelo de referencia, sem mutar o original, mantendo o saldo", () => {
    const original = { quantity: 1, product: produto("guardanapo", 490.72) };
    const trocado = itemComReferencia(original, new Map([["guardanapo", ref(8.18)]]));
    expect(trocado.product?.inventoryStock).toEqual({ averageCost: 8.18, currentQuantity: 5 });
    expect(original.product.inventoryStock?.averageCost).toBe(490.72);
  });

  it("sem referencia, ficha de producao ou sem produto: devolve o mesmo item", () => {
    const item = { product: produto("a", 1) };
    expect(itemComReferencia(item, new Map())).toBe(item);
    const ficha = { product: produto("f", 3, { ehFicha: true }) };
    expect(itemComReferencia(ficha, new Map([["f", ref(9)]]))).toBe(ficha);
    const vazio = { product: null };
    expect(itemComReferencia(vazio, new Map())).toBe(vazio);
  });
});
