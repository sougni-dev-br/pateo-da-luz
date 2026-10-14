import type { AnaliseIndicadorDeMeta, AnaliseMetaIndicador } from "../../api/client";
import { inteiro, percentual } from "./formato";

// Cada indicador tem a sua unidade. `curto` tira o "pessoas" e o "R$" repetido de frases que já
// dizem de que se trata.
// `reais` vem de useFormato() para respeitar o botão "ocultar valores".
export function formatarValor(indicador: AnaliseIndicadorDeMeta, valor: number, reais: (n: number) => string, curto = false): string {
  if (indicador === "perdaPct") return percentual(valor, 1);
  if (indicador === "pessoas") return curto ? inteiro(valor) : `${inteiro(valor)} pessoas`;
  return reais(valor);
}

type Selo = { texto: string; tom: "neutral" | "success" | "warning" | "danger" | "info" };

// Sempre texto + cor: a cor sozinha não diz se o mês está bem.
export function seloDaSituacao(i: AnaliseMetaIndicador): Selo {
  const soma = i.indicador === "faturamento" || i.indicador === "pessoas";
  switch (i.situacao) {
    case "sem-meta": return { texto: "Sem meta", tom: "neutral" };
    case "sem-dado": return { texto: "Sem dados suficientes", tom: "neutral" };
    case "atingida": return { texto: soma ? "Meta batida" : "Dentro da meta", tom: "success" };
    case "no-ritmo": return { texto: soma ? "No ritmo" : "No alvo", tom: "success" };
    case "abaixo": return { texto: soma ? "Abaixo do ritmo" : "Fora do alvo", tom: "warning" };
  }
}
