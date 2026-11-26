import type { PlanejamentoComentario, PlanejamentoComparativo } from "../../../api/client";
import { pontosDaVariacao, textoDaVariacao } from "../formato";
import { emMil, textoEmReais } from "../Reais";
import { grandezaDaMetrica, pontoDoComentario, type PontoDeComentario } from "./ponto";

// "Número da época": o que o ponto mostrava quando o comentário foi escrito, e se o número de hoje se afastou dele.

/** Diferença (em pontos percentuais, já arredondados como na tela) a partir da qual o aviso "o número mudou" aparece. */
export const MUDANCA_RELEVANTE_PP = 0.5;

const TURNO = { TOTAL: "total", ALMOCO: "almoco", JANTAR: "jantar" } as const;

/** A variação de hoje no ponto (fração), pelo comparativo carregado na tela. */
export function variacaoAtualDoPonto(dados: PlanejamentoComparativo, ponto: PontoDeComentario): number | null {
  const fonte = ponto.mes === null ? dados.acumulado : dados.meses.find((m) => m.mes === ponto.mes);
  return fonte?.variacao[grandezaDaMetrica(ponto.metrica)][TURNO[ponto.turno]] ?? null;
}

function valorCurto(metrica: PlanejamentoComentario["metrica"], valor: number): string {
  if (metrica === "CLIENTES") return `${valor.toLocaleString("pt-BR")} clientes`;
  if (metrica === "TICKET") return textoEmReais(valor, 2);
  return `R$ ${emMil(valor)}`;
}

/** "(R$ 216 mil contra R$ 341 mil)": o ano comparado primeiro. Some com "ocultar valores" quando é dinheiro. */
function parentese(c: PlanejamentoComentario, oculto: boolean): string {
  const { valorBase, valorComparado } = c.epoca;
  if (valorBase === null || valorComparado === null) return "";
  if (oculto && c.metrica !== "CLIENTES") return "";
  return `${valorCurto(c.metrica, valorComparado)} contra ${valorCurto(c.metrica, valorBase)}`;
}

/** "escrito quando estava −36,7% (R$ 216 mil contra R$ 341 mil)"; null se o ponto não tinha número. */
export function textoDaEpoca(c: PlanejamentoComentario, oculto: boolean): string | null {
  const valores = parentese(c, oculto);
  if (c.epoca.variacao === null) return valores ? `escrito quando estava ${valores}` : null;
  return `escrito quando estava ${textoDaVariacao(c.epoca.variacao)}${valores ? ` (${valores})` : ""}`;
}

/**
 * "o número mudou desde então: hoje −30,1%", só se a comparação da tela é a mesma de quando o comentário foi escrito
 * (mesmo ano-base) e a variação se afastou ao menos MUDANCA_RELEVANTE_PP pontos.
 */
export function avisoDeMudanca(c: PlanejamentoComentario, dados: PlanejamentoComparativo): string | null {
  if (c.epoca.variacao === null || c.anoBase !== dados.anoBase) return null;
  const hoje = variacaoAtualDoPonto(dados, pontoDoComentario(c));
  if (hoje === null) return null;
  const diferenca = Math.abs(pontosDaVariacao(hoje) - pontosDaVariacao(c.epoca.variacao));
  return diferenca + 1e-9 >= MUDANCA_RELEVANTE_PP ? `o número mudou desde então: hoje ${textoDaVariacao(hoje)}` : null;
}
