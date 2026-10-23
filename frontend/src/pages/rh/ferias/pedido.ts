// O pedido do colaborador ao lado do que a empresa quer (a programação) e do prazo limite.
import type { ListaFerias, PeriodoFerias, ProgramacaoFerias, SolicitacaoFerias } from "../../../api/client";
import { diasEntre } from "./eixoDoTempo";
import { dataBr, plural } from "./feriasFormato";

export type SituacaoDoPedido = "AGUARDANDO" | "ATENDIDO" | "DIFERENTE";

export type ComparacaoDoPedido = {
  situacao: SituacaoDoPedido;
  /** A parte da programação mais próxima do pedido, quando a empresa já escolheu datas. */
  programacao: ProgramacaoFerias | null;
  /** Dias entre o início pedido e o programado (positivo = a empresa quer depois). */
  diferencaEmDias: number | null;
  /** O pedido termina depois do fim do prazo: se atendido como está, as férias vencem. */
  passaDoPrazo: boolean;
};

const comData = (g: ProgramacaoFerias): g is ProgramacaoFerias & { gozoInicio: string } => g.gozoInicio !== null && g.status === "PROGRAMADA";

/**
 * Compara o pedido do colaborador com o que a empresa programou no mesmo período:
 * atendido (mesmo início e mesmos dias), diferente (a empresa escolheu outra data) ou aguardando (ainda sem programação).
 */
export function compararPedido(periodo: PeriodoFerias): ComparacaoDoPedido | null {
  const pedido = periodo.solicitacao;
  if (!pedido) return null;
  const programadas = periodo.programacoes.filter(comData);
  const igual = programadas.find((g) => g.gozoInicio === pedido.inicio && g.dias === pedido.dias);
  const maisPerto = igual ?? [...programadas].sort((a, b) => Math.abs(diasEntre(pedido.inicio, a.gozoInicio)) - Math.abs(diasEntre(pedido.inicio, b.gozoInicio)))[0] ?? null;
  return {
    situacao: igual ? "ATENDIDO" : maisPerto ? "DIFERENTE" : "AGUARDANDO",
    programacao: maisPerto,
    diferencaEmDias: maisPerto ? diasEntre(pedido.inicio, maisPerto.gozoInicio as string) : null,
    passaDoPrazo: pedido.fim > periodo.fimConcessivo,
  };
}

export const ROTULO_DA_SITUACAO_DO_PEDIDO: Record<SituacaoDoPedido, string> = {
  AGUARDANDO: "Pedido aguardando a empresa",
  ATENDIDO: "Pedido atendido",
  DIFERENTE: "Empresa quer outra data",
};

/** "Pediu 14/12 a 28/12 · 15 dias + abono de 10" — o mesmo estilo do resumo da programação. */
export function resumoDoPedido(p: Pick<SolicitacaoFerias, "inicio" | "fim" | "dias" | "diasAbono">): string {
  const abono = p.diasAbono > 0 ? ` + abono de ${p.diasAbono}` : "";
  return `${dataBr(p.inicio)} a ${dataBr(p.fim)} · ${p.dias} ${plural(p.dias, "dia", "dias")}${abono}`;
}

/** Quanto a empresa se afastou do pedido, em palavras ("1 dia depois", "3 dias antes"); vazio quando o início é o mesmo. */
export function diferencaEmPalavras(dias: number | null): string {
  if (dias === null || dias === 0) return "";
  const n = Math.abs(dias);
  return `${n} ${plural(n, "dia", "dias")} ${dias > 0 ? "depois" : "antes"} do pedido`;
}

/** Pedidos que a empresa ainda não respondeu com uma programação (o que sobra para decidir). */
export function pedidosAguardando(lista: ListaFerias): number {
  return lista.pessoas.reduce((n, p) => n + p.periodos.filter((per) => compararPedido(per)?.situacao === "AGUARDANDO").length, 0);
}
