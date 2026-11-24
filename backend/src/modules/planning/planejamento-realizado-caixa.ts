/**
 * Realizado de CAIXA do ano-base (Planejamento > Cenários, Fase 3c-2): o que o ERP já sabe sobre quando o dinheiro entra
 * e sai, para sugerir as premissas de caixa em vez de supor.
 *
 *   mix de pagamento   = vendas do Salão por forma de pagamento (dinheiro, PIX, débito, crédito, voucher)
 *   prazo das compras  = média, ponderada pelo valor, dos dias entre a compra e o pagamento
 *   % pago no mês      = quanto de cada grupo de gasto foi pago no próprio mês de competência
 *   herdado            = o que já está lançado com vencimento em jan–mar do ano do cenário
 *
 * O PRAZO e a TAXA de recebimento das maquininhas não existem no ERP: continuam à mão.
 */

import { FORMAS_DE_RECEBIMENTO, PRAZO_MAXIMO_EM_DIAS, type FormaDeRecebimento } from "./planejamento-caixa.js";
import type { GrupoDeGasto } from "./planejamento-gastos.js";

export type TotaisPorForma = Record<FormaDeRecebimento, number>;
export type PagamentoPorDefasagem = { grupo: GrupoDeGasto; /** meses entre a competência e o pagamento (≤0 = no mês) */ defasagem: number; total: number };

export type PagoNoMesRealizado = {
  grupo: GrupoDeGasto;
  /** Fração paga no próprio mês (ou antes); null = sem pagamento no período para medir. */
  pagoNoMes: number | null;
  mesSeguinte: number | null;
  /** Dois meses ou mais depois: o modelo manda esse resto para o mês seguinte. */
  depois: number | null;
  /** R$ pagos que sustentam a medida. */
  base: number;
};

export type MixRealizado = { formas: TotaisPorForma; /** R$ de vendas que sustentam o mix */ base: number };

export type RealizadoDeCaixa = {
  ano: number;
  /** Meses de competência usados para medir prazo de pagamento: só os já "maduros" (pagamento já aconteceu). */
  mesesParaPrazo: number[];
  mix: MixRealizado | null;
  comprasPrazoDias: number | null;
  /** Parte do valor das compras com itens que entrou na medida do prazo (as pagas por ciclo/cartão ficam de fora). */
  comprasCobertura: number | null;
  pagoNoMes: PagoNoMesRealizado[];
  herdado: { entradas: number[]; saidas: number[] };
  avisos: string[];
};

const arredondar = (n: number, casas = 4): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Mix em fração, com quatro casas e soma EXATA de 100% (o resto do arredondamento vai para a maior parcela): o cenário
 * recusa um mix que não fecha. Sem venda paga no período, não há mix.
 */
export function montarMix(totais: TotaisPorForma): MixRealizado | null {
  const base = FORMAS_DE_RECEBIMENTO.reduce((s, f) => s + Math.max(0, totais[f] ?? 0), 0);
  if (base <= 0) return null;
  const formas = Object.fromEntries(FORMAS_DE_RECEBIMENTO.map((f) => [f, arredondar(Math.max(0, totais[f] ?? 0) / base)])) as TotaisPorForma;
  const resto = arredondar(1 - FORMAS_DE_RECEBIMENTO.reduce((s, f) => s + formas[f], 0));
  if (resto !== 0) {
    const maior = FORMAS_DE_RECEBIMENTO.reduce((m, f) => (formas[f] > formas[m] ? f : m), FORMAS_DE_RECEBIMENTO[0]);
    formas[maior] = arredondar(formas[maior] + resto);
  }
  return { formas, base: arredondar(base, 2) };
}

/** Agrupa os pagamentos por grupo de gasto e mede a parte paga no mês, no seguinte e depois. */
export function montarPagoNoMes(linhas: readonly PagamentoPorDefasagem[]): PagoNoMesRealizado[] {
  const porGrupo = new Map<GrupoDeGasto, { noMes: number; seguinte: number; depois: number }>();
  for (const l of linhas) {
    if (!(l.total > 0)) continue;
    const g = porGrupo.get(l.grupo) ?? { noMes: 0, seguinte: 0, depois: 0 };
    if (l.defasagem <= 0) g.noMes += l.total;
    else if (l.defasagem === 1) g.seguinte += l.total;
    else g.depois += l.total;
    porGrupo.set(l.grupo, g);
  }
  return [...porGrupo.entries()].map(([grupo, g]) => {
    const base = g.noMes + g.seguinte + g.depois;
    return {
      grupo,
      pagoNoMes: arredondar(g.noMes / base),
      mesSeguinte: arredondar(g.seguinte / base),
      depois: arredondar(g.depois / base),
      base: arredondar(base, 2)
    };
  });
}

/** Cobertura = valor medido ÷ valor total das compras com itens, em fração; null sem total. */
export function coberturaDoPrazo(medido: number, total: number): number | null {
  return total > 0 ? arredondar(Math.min(medido / total, 1)) : null;
}

/** Prazo médio em dias, ponderado pelo valor pago, arredondado e dentro do limite do cenário. */
export function prazoMedioDasCompras(somaDiasPonderada: number, totalPago: number): number | null {
  if (!(totalPago > 0)) return null;
  const dias = Math.round(somaDiasPonderada / totalPago);
  return Math.min(Math.max(dias, 0), PRAZO_MAXIMO_EM_DIAS);
}

/**
 * Meses de competência do ano-base cujo pagamento já pode ter acontecido: de um ano passado, todos; do ano corrente,
 * só até dois meses antes do atual (o mês anterior ainda tem contas por pagar, o que faria o "no mês" parecer maior).
 */
export function mesesMadurosParaPrazo(ano: number, hojeIso: string): number[] {
  const hoje = Number(hojeIso.slice(0, 4)) * 12 + Number(hojeIso.slice(5, 7));
  // Maduro = competência de pelo menos dois meses atrás, contados em meses corridos (vale na virada de ano também).
  return Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => hoje - (ano * 12 + m) >= 2);
}
