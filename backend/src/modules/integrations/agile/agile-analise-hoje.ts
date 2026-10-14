import type { Periodo } from "./agile-analise.report.js";

// O dia em andamento fica de fora das análises: com só o almoço lançado, "hoje" entra como um dia
// fraco e derruba médias por dia, comparações e a folga de capacidade, gerando alerta falso. O
// "hoje" é o do restaurante (São Paulo), não o do servidor, que roda em UTC.
const UM_DIA_MS = 24 * 60 * 60 * 1000;

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

const diaAnterior = (iso: string) => new Date(Date.parse(`${iso}T00:00:00.000Z`) - UM_DIA_MS).toISOString().slice(0, 10);

export type PeriodoSemHoje = {
  // O período efetivamente analisado (o pedido, quando não sobra nenhum dia fechado).
  periodo: Periodo;
  // O pedido incluía hoje (ou o futuro) e ele foi cortado.
  hojeFicouDeFora: boolean;
  // Não sobrou nenhum dia fechado: não há o que consultar.
  vazio: boolean;
};

export function descontarHoje(periodo: Periodo, hoje: string): PeriodoSemHoje {
  if (periodo.fim < hoje) return { periodo, hojeFicouDeFora: false, vazio: false };
  const ontem = diaAnterior(hoje);
  // Sem dia fechado: devolve o periodo PEDIDO (a tela mostra "0 de N dias" do que o usuario escolheu).
  if (periodo.inicio > ontem) return { periodo, hojeFicouDeFora: true, vazio: true };
  return { periodo: { inicio: periodo.inicio, fim: ontem }, hojeFicouDeFora: true, vazio: false };
}
