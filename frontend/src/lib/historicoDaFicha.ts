// Histórico da ficha: o que mudou de uma versão para a seguinte, em frases que a cozinha entende,
// e a evolução do custo por porção. A comparação é por produto — nome de ingrediente não é chave.

import type { DishRevision, DishRevisionSnapshot } from "../api/client";
import { caminhoDaCategoria, ROTULO_DO_CARDAPIO } from "./categoriasDasFichas";
import { formatarQuantidade } from "./fichaTecnica";

type ItemDaVersao = DishRevisionSnapshot["items"][number];

const MAXIMO_DE_FRASES = 8;

const dinheiro = (valor: number | null) =>
  valor == null ? "sem preço" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const percentualDaPerda = (fracao: number) => `${Math.round(fracao * 10_000) / 100}%`;
const quantidade = (item: Pick<ItemDaVersao, "quantity" | "unit">) => `${formatarQuantidade(item.quantity)} ${item.unit}`;

/** Mesma chave para o mesmo produto, mesmo que ele apareça duas vezes na ficha. */
function indexar(itens: ItemDaVersao[]): Map<string, ItemDaVersao> {
  const vistos = new Map<string, number>();
  const mapa = new Map<string, ItemDaVersao>();
  for (const item of itens) {
    const ocorrencia = (vistos.get(item.productId) ?? 0) + 1;
    vistos.set(item.productId, ocorrencia);
    mapa.set(`${item.productId}#${ocorrencia}`, item);
  }
  return mapa;
}

/**
 * As diferenças entre duas versões. `anterior` nulo = primeira versão. Devolve no máximo 8 frases,
 * com "e mais N mudanças" no fim, para a linha do tempo não virar um relatório.
 */
export function descreverMudancas(anterior: DishRevisionSnapshot | null, atual: DishRevisionSnapshot): string[] {
  if (!anterior) {
    const n = atual.items.length;
    return [n === 0 ? "Prato criado, ainda sem ingredientes" : `Ficha criada com ${n} ingrediente${n === 1 ? "" : "s"}`];
  }

  const frases: string[] = [];

  if (anterior.name !== atual.name) frases.push(`Nome: “${anterior.name}” → “${atual.name}”`);
  if (anterior.menu !== atual.menu) frases.push(`Cardápio: ${ROTULO_DO_CARDAPIO[anterior.menu]} → ${ROTULO_DO_CARDAPIO[atual.menu]}`);

  const caminhoAntes = caminhoDaCategoria(anterior.category);
  const caminhoDepois = caminhoDaCategoria(atual.category);
  if (caminhoAntes !== caminhoDepois) frases.push(`Categoria: ${caminhoAntes} → ${caminhoDepois}`);

  if (anterior.salePriceDefault !== atual.salePriceDefault) {
    frases.push(`Preço de venda: ${dinheiro(anterior.salePriceDefault)} → ${dinheiro(atual.salePriceDefault)}`);
  }
  if (anterior.yieldQty !== atual.yieldQty || anterior.yieldUnit !== atual.yieldUnit) {
    frases.push(`Rendimento: ${formatarQuantidade(anterior.yieldQty)} ${anterior.yieldUnit} → ${formatarQuantidade(atual.yieldQty)} ${atual.yieldUnit}`);
  }

  const antes = indexar(anterior.items);
  const depois = indexar(atual.items);
  for (const [chave, item] of depois) {
    const velho = antes.get(chave);
    if (!velho) {
      frases.push(`+ ${item.productName}: ${quantidade(item)}`);
      continue;
    }
    if (velho.quantity !== item.quantity || velho.unit !== item.unit) {
      frases.push(`${item.productName}: ${quantidade(velho)} → ${quantidade(item)}`);
    }
    if (velho.wasteFactor !== item.wasteFactor) {
      frases.push(`${item.productName}: perda ${percentualDaPerda(velho.wasteFactor)} → ${percentualDaPerda(item.wasteFactor)}`);
    }
  }
  for (const [chave, item] of antes) {
    if (!depois.has(chave)) frases.push(`− ${item.productName} saiu da ficha`);
  }

  if ((anterior.notes ?? "") !== (atual.notes ?? "")) frases.push("Observações alteradas");
  if (anterior.isActive !== atual.isActive) frases.push(atual.isActive ? "Prato reativado" : "Prato inativado");

  if (frases.length === 0) return ["Gravada sem mudanças na ficha"];
  if (frases.length <= MAXIMO_DE_FRASES) return frases;
  return [...frases.slice(0, MAXIMO_DE_FRASES), `e mais ${frases.length - MAXIMO_DE_FRASES} mudança${frases.length - MAXIMO_DE_FRASES === 1 ? "" : "s"}`];
}

export type EntradaDoHistorico = {
  revisao: DishRevision;
  mudancas: string[];
  /** Variação do custo por porção contra a versão anterior; null na primeira ou sem custo comparável. */
  variacaoDoCusto: number | null;
};

/**
 * Transforma as versões (da mais nova para a mais antiga, como a API entrega) na linha do tempo da
 * tela: cada entrada com o que mudou e quanto o custo por porção variou.
 */
export function montarLinhaDoTempo(revisoes: DishRevision[]): EntradaDoHistorico[] {
  return revisoes.map((revisao, indice) => {
    const anterior = revisoes[indice + 1] ?? null;
    const custoAntes = anterior?.costPerServing ?? null;
    const custoAgora = revisao.costPerServing;
    const comparavel = custoAntes != null && custoAgora != null && !anterior!.snapshot.custoIncompleto && !revisao.snapshot.custoIncompleto;
    return {
      revisao,
      mudancas: descreverMudancas(anterior?.snapshot ?? null, revisao.snapshot),
      variacaoDoCusto: comparavel ? custoAgora - custoAntes : null
    };
  });
}

export type PontoDoCusto = { quando: string; custo: number; parcial: boolean };

/** Custo por porção ao longo do tempo, do mais antigo para o mais novo, para o gráfico. */
export function serieDoCusto(revisoes: DishRevision[]): PontoDoCusto[] {
  return [...revisoes]
    .reverse()
    .filter((revisao) => revisao.costPerServing != null && revisao.snapshot.items.length > 0)
    .map((revisao) => ({ quando: revisao.createdAt, custo: revisao.costPerServing as number, parcial: revisao.snapshot.custoIncompleto }));
}
