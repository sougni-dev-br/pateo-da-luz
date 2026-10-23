/**
 * Faturamento por canal do dashboard.
 *
 * O card de faturamento mostrava só o total do mês: com a Keeta ou a 99Food paradas, o número
 * caía sem dizer quem tinha ficado de fora. Aqui o total é aberto nos canais da tabela de
 * cobertura (Salão, 99Food, iFood, Keeta) com o dia do último lançamento de cada um.
 *
 * Conta pura, sem banco: recebe as somas já agrupadas e a cobertura (revenue-coverage.ts).
 */

import { canalDaLinha, CANAIS_DE_COBERTURA, type CoberturaDoCanal, type SituacaoDoCanal } from "../monthly/revenue-coverage.js";

/** Linhas que não são de nenhum dos quatro canais (ex.: evento ou lançamento sem plataforma). */
export const CANAL_OUTROS = "Outros";

export type SomaPorOrigem = {
  channel: string;
  sourcePlatform: string | null;
  grossAmount: number;
  netAmount: number;
  count: number;
  /** Último dia lançado até hoje, YYYY-MM-DD; null se só há lançamento com data futura. */
  ultimoDia: string | null;
  /** Lançamento com data depois de hoje (importação mensal gravada no último dia do mês). */
  diaFuturo: string | null;
};

export type CanalDoDashboard = {
  canal: string;
  grossAmount: number;
  netAmount: number;
  /** Fatia do líquido total; null quando o total é zero. */
  sharePercent: number | null;
  count: number;
  ultimoDia: string | null;
  /** Dia em que um lançamento mensal parcial foi gravado, quando ainda é futuro. */
  diaFuturo: string | null;
  /** Só no mês corrente: o canal está em dia ou parou de lançar. Null em mês passado. */
  situacao: SituacaoDoCanal | null;
  diasDesdeUltimo: number | null;
};

const maisRecente = (a: string | null, b: string | null): string | null => (a && b ? (a > b ? a : b) : a ?? b);

export function montarFaturamentoPorCanal(
  somas: SomaPorOrigem[],
  /** Cobertura do mês corrente; null para mês passado ou futuro (sem "atraso" a cobrar). */
  cobertura: CoberturaDoCanal[] | null
): CanalDoDashboard[] {
  const ordem: string[] = [...CANAIS_DE_COBERTURA, CANAL_OUTROS];
  const acumulado = new Map<string, Omit<CanalDoDashboard, "sharePercent" | "situacao" | "diasDesdeUltimo">>();
  for (const canal of ordem) {
    acumulado.set(canal, { canal, grossAmount: 0, netAmount: 0, count: 0, ultimoDia: null, diaFuturo: null });
  }

  for (const soma of somas) {
    const canal = canalDaLinha({ date: "", channel: soma.channel, sourcePlatform: soma.sourcePlatform }) ?? CANAL_OUTROS;
    const atual = acumulado.get(canal)!;
    atual.grossAmount += soma.grossAmount;
    atual.netAmount += soma.netAmount;
    atual.count += soma.count;
    atual.ultimoDia = maisRecente(atual.ultimoDia, soma.ultimoDia);
    atual.diaFuturo = maisRecente(atual.diaFuturo, soma.diaFuturo);
  }

  const totalLiquido = [...acumulado.values()].reduce((soma, c) => soma + c.netAmount, 0);
  const porCanal = new Map((cobertura ?? []).map((c) => [c.canal as string, c]));

  return ordem
    .map((canal) => acumulado.get(canal)!)
    // Os quatro canais aparecem sempre (canal sem lançamento é o que se quer ver); "Outros" só com valor.
    .filter((c) => c.canal !== CANAL_OUTROS || c.count > 0)
    .map((c) => {
      const cob = porCanal.get(c.canal);
      return {
        ...c,
        sharePercent: totalLiquido > 0 ? (c.netAmount / totalLiquido) * 100 : null,
        situacao: cob?.situacao ?? null,
        diasDesdeUltimo: cob?.diasDesdeUltimo ?? null
      };
    });
}
