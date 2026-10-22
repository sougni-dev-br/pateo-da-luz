// Como o histórico do fechamento aparece em tela.
//
// O backend devolve o fato bruto (quem, quando, qual chave, qual texto); aqui ele
// vira uma linha legível. Remover uma justificativa ou conferência e reabrir o mês
// ganham tom de alerta: são os eventos que desfazem o que sustentava o fechamento
// e que, sem o histórico, não deixariam rastro nenhum.

import type { EventoDoHistorico, MonthlyClosureState } from "../api/client";
import { dataComHora, nomeDaJustificativa } from "./fechamento-resumo";
import { ehConferencia } from "./fechamento-pendencias";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const rotuloDoMes = (ano: number, mes: number): string => `${MESES[mes - 1]} / ${ano}`;

export type TomDoEvento = "positivo" | "neutro" | "alerta";

export type EventoDescrito = {
  rotulo: string;
  /** O que foi afetado (cartão, imposto…). Nulo em travar/reabrir. */
  alvo: string | null;
  texto: string | null;
  tom: TomDoEvento;
  por: string;
  quando: string;
};

export function descreverEvento(
  evento: EventoDoHistorico,
  state: Pick<MonthlyClosureState, "cards" | "requiredSuppliers">
): EventoDescrito {
  const conferencia = evento.blockKey !== null && ehConferencia(evento.blockKey);
  const alvo = evento.blockKey ? nomeDaJustificativa(evento.blockKey, state) : null;
  const base = { por: evento.porNome ?? "—", quando: dataComHora(evento.em), texto: evento.texto };

  switch (evento.acao) {
    case "JUSTIFICOU":
      return { ...base, rotulo: conferencia ? "Conferência registrada" : "Justificativa registrada", alvo, tom: "neutro" };
    case "REMOVEU_JUSTIFICATIVA":
      return { ...base, rotulo: conferencia ? "Conferência removida" : "Justificativa removida", alvo, tom: "alerta" };
    case "TRAVOU":
      return { ...base, rotulo: "Mês travado", alvo: null, tom: "positivo" };
    case "REABRIU":
      return { ...base, rotulo: "Mês reaberto", alvo: null, tom: "alerta" };
  }
}
