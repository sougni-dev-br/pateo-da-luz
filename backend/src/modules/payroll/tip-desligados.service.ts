import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { nomeCompleto } from "./nomes.js";
import { registrarHistorico } from "./tip-historico.service.js";
import {
  type DesligadoComParticipa, desligadosParaLimpar as filtrarLimpaveis, motivoDaLimpeza,
} from "./tip-desligados.js";

type Db = Pick<Prisma.TransactionClient, "employee" | "tipPeriod">;

// Desligados com "Participa da gorjeta" marcado cujo ciclo da saída já foi fechado.
export async function desligadosParaLimpar(db: Db = prisma): Promise<DesligadoComParticipa[]> {
  const candidatos = await db.employee.findMany({
    where: { deletedAt: null, isActive: false, participaGorjeta: true, terminationDate: { not: null } },
    select: { id: true, firstName: true, lastName: true, displayName: true, terminationDate: true },
  });
  if (candidatos.length === 0) return [];
  const periodos = await db.tipPeriod.findMany({ select: { periodStart: true, periodEnd: true, status: true } });
  return filtrarLimpaveis(
    candidatos.map((c) => ({ employeeId: c.id, nome: nomeCompleto(c), terminationDate: c.terminationDate as Date })),
    periodos.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd, status: p.status as "OPEN" | "CLOSED" })),
  ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Tira a marca "Participa da gorjeta" de quem já saiu e já fechou o ciclo da saída. Grava o
// histórico da mudança (vale desde a saída) como qualquer troca de situação na gorjeta.
// A elegibilidade é lida DENTRO da transação (um ciclo reaberto no meio do clique não passa) e
// só vale para os ids que a tela mostrou, se vierem; a data da saída conferida no UPDATE impede
// limpar quem foi reativado e desligado de novo no intervalo.
export async function limparParticipaDeDesligados(usuario: { id: string }, employeeIds?: readonly string[]): Promise<DesligadoComParticipa[]> {
  return prisma.$transaction(async (tx) => {
    const elegiveis = await desligadosParaLimpar(tx);
    const alvo = employeeIds ? elegiveis.filter((p) => employeeIds.includes(p.employeeId)) : elegiveis;
    const limpos: DesligadoComParticipa[] = [];
    for (const p of alvo) {
      const { count } = await tx.employee.updateMany({
        where: { id: p.employeeId, isActive: false, participaGorjeta: true, deletedAt: null, terminationDate: p.terminationDate },
        data: { participaGorjeta: false, updatedById: usuario.id },
      });
      if (count === 0) continue;
      await registrarHistorico(tx, p.employeeId, p.terminationDate, usuario.id, motivoDaLimpeza(p.terminationDate));
      limpos.push(p);
    }
    return limpos;
  });
}
