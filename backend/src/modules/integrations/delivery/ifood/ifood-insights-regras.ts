// Regras do Painel do dono do iFood que dependem de o dado ser DIÁRIO ou MENSAL.
//
// Sem integração, o iFood entra pela receita importada do portal: uma linha por
// loja por mês (ver ifood-receita.ts). Isso quebra três coisas que assumem dia a
// dia: o gráfico por dia da semana (jogaria o mês inteiro num único dia), a
// projeção de fechamento (não há dia parcial para projetar) e o alerta "caiu vs
// mês anterior" (em mês em curso compara mês parcial com mês cheio).

import type { IfoodPeriodSummary } from "./ifood.types.js";

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const round2 = (valor: number) => Math.round(valor * 100) / 100;

/** `true` quando alguma loja com dado real vem só do consolidado mensal do portal. */
export function dadosSaoMensais(resumos: IfoodPeriodSummary[]): boolean {
  return resumos.some((resumo) => !resumo.isMock && resumo.granularidade === "mensal");
}

export type Projecao = {
  grossAmount: number;
  netAmount: number;
  daysElapsed: number;
  daysRemaining: number;
  note: string;
};

export function montarProjecao(input: {
  mensal: boolean;
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  grossAmount: number;
  netAmount: number;
}): Projecao {
  const base = {
    grossAmount: round2(input.grossAmount),
    netAmount: round2(input.netAmount),
    daysElapsed: input.daysElapsed,
    daysRemaining: input.daysInMonth - input.daysElapsed
  };
  if (input.mensal) {
    return {
      ...base,
      note: input.isCurrentMonth
        ? "Dados mensais do portal, parciais até a última coleta: não há projeção de fechamento."
        : "Dados mensais do portal — valores refletem o total do período."
    };
  }
  return {
    ...base,
    note: input.isCurrentMonth
      ? `Projeção com base em ${input.daysElapsed} dia(s) do ranking histórico do mês.`
      : "Mês fechado — valores refletem o total do período."
  };
}

export type LinhaSemana = { dow: number; label: string; avgNet: number; avgOrders: number };

/** Sete linhas zeradas: com dado mensal não existe média por dia da semana. */
export function semanaSemDados(): LinhaSemana[] {
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ dow, label: WEEKDAY_LABELS[dow]!, avgNet: 0, avgOrders: 0 }));
}

/**
 * "Caiu vs mês anterior" só vale com o mês fechado. Em mês em curso o atual é
 * parcial e a queda é artefato da comparação, não da loja.
 */
export function podeAlertarQueda(isCurrentMonth: boolean): boolean {
  return !isCurrentMonth;
}
