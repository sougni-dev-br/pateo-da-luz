// Travas compartilhadas do Ponto: o Ponto, a Escala e o Afastamento mexem na mesma tabela
// (EmployeeScheduleDay) e precisam respeitar o mesmo fechamento e a mesma ordem de trava.

import type { Prisma } from "@prisma/client";

type Cliente = Prisma.TransactionClient;

/** Marca nas anotações (notes) de um dia da Escala que foi gravado pelo Ponto. */
export const MARCA_DO_PONTO = "ponto";

/** Anotação de um dia gravado pelo Ponto, com o tipo que ele tinha antes (para poder desfazer). */
export const notaDoPonto = (antes: string | null): string => (antes ? `${MARCA_DO_PONTO} antes:${antes}` : MARCA_DO_PONTO);

export const foiGravadoPeloPonto = (notes: string | null | undefined): boolean => (notes ?? "").startsWith(MARCA_DO_PONTO);

/** Tipo que o dia tinha antes de o Ponto mexer nele ("TURNO", "EVENTO"), ou null se não havia marca. */
export function tipoAnteriorDoPonto(notes: string | null | undefined): string | null {
  return /(?:^|\s)antes:(\w+)/.exec(notes ?? "")?.[1] ?? null;
}

// Mesma chave para Ponto, Escala e Afastamento: nenhum deles grava no mês enquanto outro fecha, reabre ou lança.
const NAMESPACE_TRAVA = 7_300_000_000;
export const chaveTravaMes = (year: number, month: number): number => NAMESPACE_TRAVA + year * 100 + month;

export async function travarMeses(tx: Cliente, chaves: number[]): Promise<void> {
  for (const chave of [...new Set(chaves)].sort((a, b) => a - b)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(chave)})`;
  }
}

/** Meses (ano/mês) que o intervalo de datas toca. */
export function mesesDoIntervalo(inicio: Date, fim: Date): Array<{ year: number; month: number }> {
  const meses: Array<{ year: number; month: number }> = [];
  let ano = inicio.getUTCFullYear();
  let mes = inicio.getUTCMonth() + 1;
  const ultimo = fim.getUTCFullYear() * 12 + fim.getUTCMonth();
  while (ano * 12 + (mes - 1) <= ultimo) {
    meses.push({ year: ano, month: mes });
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

export class PontoFechadoError extends Error {
  constructor(readonly year: number, readonly month: number) {
    super(`O ponto de ${String(month).padStart(2, "0")}/${year} já está fechado (RH → Ponto). Reabra o ponto do mês antes de mudar a escala.`);
  }
}

/** Lança PontoFechadoError se algum mês do intervalo já tem o ponto fechado (de qualquer pessoa, ou só da indicada). */
export async function exigirPontoAberto(
  cliente: { pontoFechamento: { findFirst: Cliente["pontoFechamento"]["findFirst"] } },
  inicio: Date,
  fim: Date,
  employeeId?: string,
): Promise<void> {
  for (const { year, month } of mesesDoIntervalo(inicio, fim)) {
    const fechado = await cliente.pontoFechamento.findFirst({
      where: { year, month, status: "FECHADO", ...(employeeId ? { employeeId } : {}) },
      select: { id: true },
    });
    if (fechado) throw new PontoFechadoError(year, month);
  }
}
