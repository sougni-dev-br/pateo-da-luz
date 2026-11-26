import type { Comparativo, Turnos } from "./planejamento-comparativo.js";

// Regras puras dos comentários do Comparativo: prazos de apagar/restaurar e o número do ponto na hora em que se escreve.

/** O autor apaga o próprio comentário só até 24 horas depois de criado; depois, só quem administra o Planejamento. */
export const PRAZO_DO_AUTOR_MS = 24 * 60 * 60 * 1000;
/** Quem apagou consegue restaurar (o "Desfazer") até 10 minutos depois; o administrador restaura a qualquer tempo. */
export const PRAZO_DO_DESFAZER_MS = 10 * 60 * 1000;

type Metrica = "VENDAS" | "CLIENTES" | "TICKET";
type Turno = "TOTAL" | "ALMOCO" | "JANTAR";
export type PontoDoComparativo = { mes: number | null; metrica: Metrica; turno: Turno };
export type NumeroDaEpoca = { valorBase: number | null; valorComparado: number | null; variacao: number | null };

export const SEM_NUMERO: NumeroDaEpoca = { valorBase: null, valorComparado: null, variacao: null };

const GRANDEZA: Record<Metrica, "vendas" | "clientes" | "ticket"> = { VENDAS: "vendas", CLIENTES: "clientes", TICKET: "ticket" };
const TURNO: Record<Turno, keyof Turnos> = { TOTAL: "total", ALMOCO: "almoco", JANTAR: "jantar" };

/**
 * O número que a tela mostrava no ponto: o mês só tem número se for comparável (dado nos dois anos, encerrado, completo);
 * o ano inteiro é o acumulado, que só existe com ao menos um mês comparado. Sem número, tudo nulo.
 */
export function numeroDoPonto(comparativo: Comparativo, ponto: PontoDoComparativo): NumeroDaEpoca {
  const g = GRANDEZA[ponto.metrica];
  const t = TURNO[ponto.turno];
  const fonte = ponto.mes === null
    ? (comparativo.acumulado.mesesComparados.length > 0 ? comparativo.acumulado : null)
    : (comparativo.meses.find((m) => m.mes === ponto.mes && m.comparavel) ?? null);
  if (!fonte) return SEM_NUMERO;
  return { valorBase: fonte.base[g][t], valorComparado: fonte.comparado[g][t], variacao: fonte.variacao[g][t] };
}

export function podeApagar(c: { autorId: string; createdAt: Date }, userId: string, moderador: boolean, agora: Date): boolean {
  if (moderador) return true;
  return c.autorId === userId && agora.getTime() - c.createdAt.getTime() <= PRAZO_DO_AUTOR_MS;
}

export function podeRestaurar(c: { apagadoEm: Date | null; apagadoPorId: string | null }, userId: string, moderador: boolean, agora: Date): boolean {
  if (!c.apagadoEm) return false;
  if (moderador) return true;
  return c.apagadoPorId === userId && agora.getTime() - c.apagadoEm.getTime() <= PRAZO_DO_DESFAZER_MS;
}
