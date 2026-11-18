// Custo por kg de um prato do buffet, a partir da ficha técnica ligada a ele, e o valor do dia de pesagem.
// Funções puras, sem banco. O custo da ficha é o de hoje (custo médio atual dos ingredientes).

import { normalizarUnidade } from "../../shared/unidades/conversao.js";
import type { ItemSummary } from "./buffet-weighing-summary.js";

export type FichaParaCusto = {
  id: string;
  name: string;
  yieldUnit: string;
  /** Custo de uma unidade de rendimento (1 kg, ou 1 porção). */
  custoPorcao: number;
  custoIncompleto: boolean;
  portionWeightG: number | null;
  fichaPendente: boolean;
};

export type EstadoDoCusto = "SEM_FICHA" | "PENDENTE" | "INCOMPLETA" | "SEM_PESO" | "OK";

export type CustoDoPrato = {
  state: EstadoDoCusto;
  dishId: string | null;
  dishName: string | null;
  /** R$ por kg; só existe quando state = OK. */
  costPerKg: number | null;
  /** Texto para a tela dizer o que falta. */
  reason: string | null;
};

const semCusto = (state: EstadoDoCusto, ficha: FichaParaCusto | null, reason: string): CustoDoPrato => ({
  state, dishId: ficha?.id ?? null, dishName: ficha?.name ?? null, costPerKg: null, reason,
});

/**
 * KG vale como está; G vira kg; porção (UN) só converte se a ficha diz quanto pesa a porção.
 * Ficha pendente, incompleta ou sem peso não vira custo parcial: fica "sem custo" e a tela diz o motivo —
 * um custo menor que o real esconderia justamente o prato caro.
 */
export function custoDoPrato(ficha: FichaParaCusto | null): CustoDoPrato {
  if (!ficha) return semCusto("SEM_FICHA", null, "Prato sem ficha técnica ligada.");
  if (ficha.fichaPendente) return semCusto("PENDENTE", ficha, "A ficha ainda não foi montada.");
  if (ficha.custoIncompleto || !(ficha.custoPorcao > 0)) {
    return semCusto("INCOMPLETA", ficha, "A ficha tem ingrediente sem custo ou sem conversão de unidade.");
  }
  const unidade = normalizarUnidade(ficha.yieldUnit);
  let porKg: number | null = null;
  if (unidade === "KG") porKg = ficha.custoPorcao;
  else if (unidade === "G") porKg = ficha.custoPorcao * 1000;
  else if (ficha.portionWeightG && ficha.portionWeightG > 0) porKg = ficha.custoPorcao / (ficha.portionWeightG / 1000);
  if (porKg === null) {
    return semCusto("SEM_PESO", ficha, `A ficha rende em ${ficha.yieldUnit.toLowerCase()} e não informa o peso da porção: ajuste o rendimento para kg.`);
  }
  return { state: "OK", dishId: ficha.id, dishName: ficha.name, costPerKg: porKg, reason: null };
}

export type ValorDoPrato = { itemId: string; producedCost: number | null; leftoverCost: number | null; consumedCost: number | null };

export type ValorDoDia = {
  items: ValorDoPrato[];
  producedCost: number;
  leftoverCost: number;
  consumedCost: number;
  /** Pratos pesados com custo conhecido, e o total de pratos pesados: o total do dia só soma os que têm custo. */
  itemsWithCost: number;
  itemsTotal: number;
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const emReais = (g: number, porKg: number) => (g / 1000) * porKg;

export function valorizarDia(items: ItemSummary[], custos: Map<string, CustoDoPrato>): ValorDoDia {
  let produced = 0;
  let leftover = 0;
  let consumed = 0;
  let comCusto = 0;
  const valores = items.map((i): ValorDoPrato => {
    const porKg = custos.get(i.itemId)?.costPerKg ?? null;
    if (porKg === null) return { itemId: i.itemId, producedCost: null, leftoverCost: null, consumedCost: null };
    comCusto += 1;
    const p = emReais(i.producedG, porKg);
    const s = emReais(i.leftoverG, porKg);
    const c = i.consumedG === null ? null : emReais(i.consumedG, porKg);
    produced += p;
    leftover += s;
    consumed += c ?? 0;
    return { itemId: i.itemId, producedCost: centavos(p), leftoverCost: centavos(s), consumedCost: c === null ? null : centavos(c) };
  });
  return {
    items: valores, producedCost: centavos(produced), leftoverCost: centavos(leftover), consumedCost: centavos(consumed),
    itemsWithCost: comCusto, itemsTotal: items.length,
  };
}
