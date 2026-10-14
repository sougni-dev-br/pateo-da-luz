// O que o cálculo de custo precisa de cada ingrediente de uma ficha. Fica separado de dish-detail para que a
// ficha de produção (ficha dentro de ficha) possa usar as mesmas peças sem importação circular.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CostItemInput } from "./dish-cost.js";
import { conversoesDoProduto, embalagemDoNome, normalizarUnidade } from "../../shared/unidades/conversao.js";

/** Cliente do Prisma ou o de dentro de uma transacao: a mesma leitura serve aos dois. */
export type ClienteDoBanco = Prisma.TransactionClient | PrismaClient;

type Numero = Prisma.Decimal | number;

/**
 * O ingrediente como o cálculo o enxerga: um produto comprado, ou uma ficha de produção que se comporta como um
 * (a unidade é a de rendimento dela e o "custo médio" é o custo de uma unidade de rendimento).
 */
export type ProdutoDoItem = {
  id?: string;
  externalCode?: string | null;
  name: string;
  unit: string | null;
  stockUnit?: string | null;
  inventoryStock: { averageCost: Numero | null; currentQuantity?: Numero | null } | null;
  conversions: Array<{ fromUnit: string; toUnit: string; factor: Numero }>;
  /** Marca a ficha de produção: nada de conversão lida do nome, e a mensagem de "sem custo" é própria. */
  ehFicha?: boolean;
  semCustoMotivo?: string;
};

export type ItemComProduto = {
  quantity: Numero;
  unit: string;
  wasteFactor: Numero;
  product: ProdutoDoItem;
};

/**
 * O custo medio do estoque e expresso em "stockUnit" quando ele existe; caindo
 * para "unit" quando o produto ainda nao tem unidade de estoque definida.
 */
export type ProdutoParaConversao = ProdutoDoItem;

/**
 * Conversoes que valem na ficha: as cadastradas no produto mais, quando o estoque conta em
 * UN/pacote/caixa, o peso ou volume lido do NOME ("FARINHA TRIGO 5KG"). Assim a receita
 * pode ser lancada em g/ml. A mesma lista vai para a tela (previa de custo) e para o calculo.
 * Ficha de produção não lê peso do nome: "Molho 500g" não quer dizer que 1 porção pesa 500 g.
 */
export function conversoesDaFicha(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions" | "ehFicha">) {
  if (produto.ehFicha) return [];
  const cadastradas = produto.conversions.map((c) => ({
    fromUnit: c.fromUnit,
    toUnit: c.toUnit,
    factor: Number(c.factor)
  }));
  return conversoesDoProduto(produto.name, produto.stockUnit || produto.unit, cadastradas);
}

/** "1 UN = 5 KG (lido do nome)" quando a conversao e inferida; null quando nao ha. */
export function textoDaEmbalagemInferida(produto: Pick<ProdutoParaConversao, "name" | "unit" | "stockUnit" | "conversions" | "ehFicha">): string | null {
  const conversoes = conversoesDaFicha(produto);
  if (!conversoes.some((c) => c.inferida)) return null;
  const embalagem = embalagemDoNome(produto.name);
  const base = normalizarUnidade(produto.stockUnit || produto.unit);
  return embalagem ? `1 ${base} = ${embalagem.quantidade.toLocaleString("pt-BR")} ${embalagem.unidade} (lido do nome do produto)` : null;
}

export function toCostItem(item: ItemComProduto): CostItemInput {
  return {
    quantity: Number(item.quantity),
    unit: item.unit,
    wasteFactor: Number(item.wasteFactor),
    product: {
      unit: item.product.stockUnit || item.product.unit,
      averageCost: item.product.inventoryStock?.averageCost == null
        ? null
        : Number(item.product.inventoryStock.averageCost),
      conversions: conversoesDaFicha(item.product),
      semCustoMotivo: item.product.semCustoMotivo
    }
  };
}

/** Itens do cardapio principal do prato e, se ele e vendido em dois, os do outro cardapio. Item de outro cardapio qualquer e ignorado. */
export function separarItensPorCardapio<T extends { menu: string }>(dish: { menu: string; alsoMenu: string | null; items: T[] }) {
  return {
    principais: dish.items.filter((item) => item.menu === dish.menu),
    doOutro: dish.alsoMenu && dish.alsoMenu !== dish.menu ? dish.items.filter((item) => item.menu === dish.alsoMenu) : []
  };
}
