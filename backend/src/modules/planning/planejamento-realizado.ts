/**
 * Realizado do ano-base por grupo de gasto (Planejamento > Cenários, Fase 3b): o que o DRE já apurou, reagrupado
 * nos grupos de gasto do cenário, para sugerir os valores em vez de digitar. Só entram meses ENCERRADOS: o mês
 * corrente está parcial e distorceria a média.
 *
 * O DRE é da empresa toda (as empresas são uma operação só), enquanto a projeção é do Salão: o gasto é o custo
 * da casa inteira contra a venda do Salão, o mesmo que a planilha do Marcos faz.
 */

import type { GrupoDeGasto } from "./planejamento-gastos.js";
import { GRUPOS_DE_GASTO } from "./planejamento-gastos.js";

/** Grupo do DRE → grupo de gasto do cenário. null = fora (CMV é premissa à parte; deduções são da receita). */
export const GRUPO_DO_DRE: Record<string, GrupoDeGasto | null> = {
  LOCACAO: "OCUPACAO",
  TARIFAS_PUBLICAS: "TARIFAS_PUBLICAS",
  PESSOAL: "FOLHA",
  VALE_TRANSPORTE: "FOLHA",
  IMPOSTOS: "TRIBUTOS",
  TARIFAS_BANCARIAS: "TARIFAS_BANCARIAS",
  DESPESAS_GERAIS: "OUTROS",
  DESPESAS_OPERACIONAIS: "OUTROS",
  PLANEJAMENTO: "OUTROS",
  CMV_COMPRAS: null,
  DEDUCOES: null
};

/** Grupos de gasto sem correspondente no DRE: o realizado fica em branco e a pessoa digita. */
const GRUPOS_COM_ORIGEM_NO_DRE = new Set<GrupoDeGasto>(Object.values(GRUPO_DO_DRE).filter((g): g is GrupoDeGasto => g !== null));

export type MesDoDre = { mes: number; gastosPorGrupo: Record<string, number>; receitaBruta: number };

export type RealizadoDoGrupo = {
  grupo: GrupoDeGasto;
  origemNoDre: boolean;
  /** R$ do mês; null nos meses ainda não encerrados. */
  valoresPorMes: (number | null)[];
  /** Média por mês dos meses considerados; null se nenhum serve. */
  media: number | null;
  mesesConsiderados: number[];
  /** Meses encerrados com valor zero no grupo: provável lançamento que falta. */
  mesesSemLancamento: number[];
  /** Soma dos meses considerados ÷ receita bruta deles (para as linhas em % das vendas). */
  percentualDaReceita: number | null;
};

export type Realizado = { ano: number; mesesEncerrados: number[]; grupos: RealizadoDoGrupo[] };

const arredondar = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Meses do ano já fechados, dado o "AAAA-MM-DD" de hoje: todos se o ano passou, nenhum se for futuro. */
export function mesesEncerradosDoAno(ano: number, hojeIso: string): number[] {
  const anoAtual = Number(hojeIso.slice(0, 4));
  const mesAtual = Number(hojeIso.slice(5, 7));
  const ultimo = ano < anoAtual ? 12 : ano === anoAtual ? mesAtual - 1 : 0;
  return Array.from({ length: Math.max(ultimo, 0) }, (_, i) => i + 1);
}

export function montarRealizado(ano: number, meses: readonly MesDoDre[], mesesEncerrados: readonly number[], ignorarMesesSemLancamento: boolean): Realizado {
  const encerrados = new Set(mesesEncerrados);
  const porMes = new Map(meses.map((m) => [m.mes, m]));

  const grupos = GRUPOS_DE_GASTO.map((grupo): RealizadoDoGrupo => {
    const valoresPorMes: (number | null)[] = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      if (!encerrados.has(mes)) return null;
      const dre = porMes.get(mes);
      if (!dre) return null;
      const total = Object.entries(dre.gastosPorGrupo).reduce((s, [g, v]) => s + (GRUPO_DO_DRE[g] === grupo ? v : 0), 0);
      return arredondar(total);
    });

    const origemNoDre = GRUPOS_COM_ORIGEM_NO_DRE.has(grupo);
    const mesesComDado = valoresPorMes.flatMap((v, i) => (v === null ? [] : [i + 1]));
    const mesesSemLancamento = origemNoDre ? mesesComDado.filter((m) => valoresPorMes[m - 1] === 0) : [];
    const mesesConsiderados = origemNoDre ? (ignorarMesesSemLancamento ? mesesComDado.filter((m) => (valoresPorMes[m - 1] ?? 0) > 0) : mesesComDado) : [];

    const soma = mesesConsiderados.reduce((s, m) => s + (valoresPorMes[m - 1] ?? 0), 0);
    const receita = mesesConsiderados.reduce((s, m) => s + (porMes.get(m)?.receitaBruta ?? 0), 0);
    return {
      grupo,
      origemNoDre,
      valoresPorMes,
      media: mesesConsiderados.length > 0 ? arredondar(soma / mesesConsiderados.length) : null,
      mesesConsiderados,
      mesesSemLancamento,
      percentualDaReceita: mesesConsiderados.length > 0 && receita > 0 ? arredondar(soma / receita, 4) : null
    };
  });

  return { ano, mesesEncerrados: [...mesesEncerrados], grupos };
}
