import type { Prisma } from "@prisma/client";

// Uma escrita de folha por pessoa de cada vez: dois lançamentos simultâneos passariam
// os dois pela checagem e criariam o par duplicado. A trava solta no commit/rollback.
export async function travarFolhaDaPessoa(tx: Prisma.TransactionClient, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`folha:${employeeId}`}))`;
}
