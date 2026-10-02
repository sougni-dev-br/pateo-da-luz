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

// Rótulos de RESCISAO já usados pela pessoa na competência, vivos E excluídos: a chave
// única (pessoa + tipo + competência + rótulo) não olha deletedAt. Com eles, o rótulo
// novo sai livre (rotuloLivre) — excluir e lançar de novo não bate na chave.
export async function rotulosDeRescisaoNoMes(
  tx: Prisma.TransactionClient, employeeId: string, competenceYear: number, competenceMonth: number,
): Promise<string[]> {
  const itens = await tx.payrollItem.findMany({
    where: { employeeId, type: "RESCISAO", competenceYear, competenceMonth },
    select: { periodLabel: true },
  });
  return (itens ?? []).map((i) => i.periodLabel).filter((l): l is string => typeof l === "string");
}

// Chave única violada (Prisma P2002): mesmo com o rótulo livre, duas gravações ao mesmo
// tempo podem disputar o mesmo rótulo. Vira 409 com mensagem, não 500.
export function ehChaveUnicaDuplicada(err: unknown): boolean {
  return err != null && typeof err === "object" && (err as { code?: unknown }).code === "P2002";
}
export const MSG_ROTULO_OCUPADO = "Já existe um lançamento de rescisão com o mesmo rótulo nesta competência (outra gravação ao mesmo tempo?). Recarregue a tela e tente de novo.";
