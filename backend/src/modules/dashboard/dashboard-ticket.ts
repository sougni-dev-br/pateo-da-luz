/**
 * Ticket médio do dashboard.
 *
 * O ticket era bruto de TODOS os canais ÷ tickets de todos os canais. O delivery entra
 * com um ticket por pedido e sem "pessoas atendidas", então:
 *   - "por mesa" virava uma média de mesa com pedido de entrega, bem abaixo do ticket
 *     do salão sozinho;
 *   - "por pessoa" dividia o bruto do delivery por pessoas que só existem no salão
 *     (a conta chegava a dar menos de uma pessoa por mesa).
 * A variação contra o mês anterior saía muito positiva com o ticket do salão estável.
 *
 * Ticket de mesa e de pessoa é conceito de salão: as duas contas usam só o canal Salão, sobre o
 * faturamento LÍQUIDO (sem serviço e deduções) — mesma base do ticket por canal da tela Faturamento.
 */

export type BaseTicketSalao = {
  netAmount: number;
  tickets: number;
  peopleServed: number;
};

export type TicketsSalao = {
  perTable: number;
  perPerson: number;
};

const razao = (valor: number, divisor: number): number => (divisor > 0 ? valor / divisor : 0);

export function calcularTicketsSalao(base: BaseTicketSalao): TicketsSalao {
  return {
    perTable: razao(base.netAmount, base.tickets),
    perPerson: razao(base.netAmount, base.peopleServed),
  };
}

/** Variação percentual; sem base anterior não há comparação. */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  return anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
}
