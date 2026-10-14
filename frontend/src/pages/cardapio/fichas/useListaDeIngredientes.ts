import { useCallback, useEffect, useMemo, useState } from "react";
import type { DishProductSearchResult } from "../../../api/client";
import { chaveDoIngrediente, converterAoTrocarUnidade, unidadePadrao, type ItemDaFicha } from "../../../lib/fichaTecnica";

let sequenciaDeLinhas = 0;
export const novoIdDeLinha = () => `novo-${Date.now()}-${++sequenciaDeLinhas}`;

/**
 * Uma lista de ingredientes de ficha (a do a la carte ou a do delivery): adicionar, alterar, remover e o foco na linha
 * recém-adicionada. O prato vendido nos dois cardápios tem duas — a quantidade de um não vale para o outro.
 */
export function useListaDeIngredientes(inicial: ItemDaFicha[]) {
  const [itens, setItens] = useState<ItemDaFicha[]>(inicial);
  const [focoNaLinha, setFocoNaLinha] = useState<string | null>(null);

  // Ingrediente recém-adicionado: o cursor vai direto para a quantidade.
  useEffect(() => {
    if (!focoNaLinha) return;
    const campo = document.getElementById(`ft-qtd-${focoNaLinha}`) as HTMLInputElement | null;
    campo?.focus();
    campo?.select();
    setFocoNaLinha(null);
  }, [focoNaLinha, itens]);

  const adicionar = useCallback((produto: DishProductSearchResult) => {
    const tempId = novoIdDeLinha();
    // Ficha de produção como ingrediente: 1 unidade de rendimento dela (1 porção da massa) é o ponto de partida.
    const ehFicha = produto.kind === "FICHA";
    setItens((anterior) => [
      ...anterior,
      {
        tempId,
        productId: ehFicha ? "" : produto.id,
        componentDishId: ehFicha ? produto.id : null,
        ehFicha,
        motivoDaFicha: ehFicha ? produto.motivo ?? null : null,
        productName: produto.name,
        quantity: ehFicha ? "1" : "",
        unit: unidadePadrao(produto.unit, produto.conversions ?? []),
        wasteFactor: "0",
        unitCost: produto.averageCost,
        productUnit: produto.unit,
        conversions: produto.conversions ?? [],
        embalagemInferida: produto.embalagemInferida ?? null,
        notes: ""
      }
    ]);
    setFocoNaLinha(tempId);
  }, []);

  const alterar = useCallback((tempId: string, campo: "quantity" | "unit" | "wasteFactor", valor: string) => {
    setItens((anterior) => anterior.map((item) => {
      if (item.tempId !== tempId) return item;
      if (campo === "unit") {
        // Trocar a unidade traz a quantidade junto (170 G → 0,17 KG) quando há conversão conhecida.
        const convertida = converterAoTrocarUnidade(item, valor);
        return convertida
          ? { ...item, unit: valor, quantity: convertida.quantity, avisoDeConversao: convertida.aviso }
          : { ...item, unit: valor, avisoDeConversao: null };
      }
      return campo === "quantity" ? { ...item, quantity: valor, avisoDeConversao: null } : { ...item, [campo]: valor };
    }));
  }, []);

  const remover = useCallback((tempId: string) => {
    setItens((anterior) => anterior.filter((item) => item.tempId !== tempId));
  }, []);

  const idsNaFicha = useMemo(() => new Set(itens.map(chaveDoIngrediente)), [itens]);
  const repetidos = useMemo(() => {
    const contagem = new Map<string, number>();
    itens.forEach((item) => contagem.set(chaveDoIngrediente(item), (contagem.get(chaveDoIngrediente(item)) ?? 0) + 1));
    return contagem;
  }, [itens]);

  return { itens, setItens, adicionar, alterar, remover, idsNaFicha, repetidos };
}
