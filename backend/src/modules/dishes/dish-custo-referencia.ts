// Troca o custo medio do estoque pelo custo de referencia (compras na unidade de
// contagem) nos ingredientes de uma ficha, quando a chave CUSTO_FICHA_FONTE=referencia
// esta ligada. Desligada, nada muda e nenhuma consulta extra e feita.
//
// Ficha de producao (ficha dentro de ficha) nao entra: o custo dela ja vem da propria ficha.

import { carregarCustosDeReferencia, custoDaFichaPelaReferencia, type CustoDeReferencia } from "../inventory/custo-de-referencia.js";
import type { ProdutoDoItem } from "./dish-itens.js";

export type CarregadorDeReferencia = (productIds: readonly string[]) => Promise<Map<string, CustoDeReferencia>>;

type ComProduto = { product: ProdutoDoItem | null };

/** Custo de referencia dos produtos comprados entre os itens; vazio com a chave desligada. */
export async function carregarReferenciaDosItens(
  itens: readonly ComProduto[],
  ligado: boolean = custoDaFichaPelaReferencia(),
  carregar: CarregadorDeReferencia = carregarCustosDeReferencia
): Promise<Map<string, CustoDeReferencia>> {
  if (!ligado) return new Map();
  const ids = itens.flatMap((i) => (i.product?.id && !i.product.ehFicha ? [i.product.id] : []));
  return ids.length ? carregar(ids) : new Map();
}

/** O mesmo item, com o custo do produto trocado pelo de referencia (sem mexer no original). */
export function itemComReferencia<T extends ComProduto>(item: T, referencia: ReadonlyMap<string, CustoDeReferencia>): T {
  const produto = item.product;
  if (!produto?.id || produto.ehFicha) return item;
  const custo = referencia.get(produto.id);
  if (!custo) return item;
  return {
    ...item,
    product: { ...produto, inventoryStock: { currentQuantity: produto.inventoryStock?.currentQuantity ?? null, averageCost: custo.valor } }
  };
}
