// Trava e recusa comuns a tudo que cria, ajusta, exclui ou restaura uma rescisão
// (Folha e RH → Rescisões).
import type { Prisma } from "@prisma/client";

// Recusa com status HTTP, lançada de dentro de uma transação para desfazê-la inteira.
export class RecusaRescisao extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// Uma rescisão por funcionário de cada vez: lançar, ajustar, excluir e restaurar
// esperam umas pelas outras (trava da transação, solta no commit/rollback).
export async function travarRescisao(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rescisao:${employeeId}`}))`;
}
