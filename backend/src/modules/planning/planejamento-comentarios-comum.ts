import type { Prisma, PlanejamentoComentario } from "@prisma/client";
import { userHasPermission } from "../security/menu-permissions.js";
import type { SessionUser } from "../security/security-utils.js";
import { MAXIMO_POR_ANO, MAXIMO_POR_PONTO } from "./planejamento-comentarios-schema.js";
import { podeApagar } from "./planejamento-comentarios-regras.js";

// Peças comuns às rotas de comentários (lista/escrita e lixeira).

export const CONTEXTO = "COMPARATIVO";
export const ENTIDADE = "PlanejamentoComentario";
export const ROTULO = "comentário";
export const MENSAGEM_NAO_ENCONTRADO = "Comentário não encontrado.";
/** Filtro do caso comum: a tela, a impressão e os limites só enxergam o que não está na lixeira. */
export const NAO_APAGADO = { apagadoEm: null } as const;

const MENSAGEM_LIMITE_PONTO = `Este ponto já tem ${MAXIMO_POR_PONTO} comentários. Apague algum antes de adicionar outro.`;
const MENSAGEM_LIMITE_ANO = `Este ano já tem ${MAXIMO_POR_ANO} comentários. Apague algum antes de adicionar outro.`;

export class LimiteDeComentarios extends Error {}

export const podeModerar = (user: SessionUser) => userHasPermission(user, "planning", "admin");

const numero = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

export const paraResposta = (c: PlanejamentoComentario, userId: string, moderador: boolean, agora = new Date()) => ({
  id: c.id,
  anoBase: c.anoBase,
  anoComparado: c.anoComparado,
  mes: c.mes,
  metrica: c.metrica,
  turno: c.turno,
  texto: c.texto,
  naImpressao: c.naImpressao,
  autorId: c.autorId,
  autorNome: c.autorNome,
  criadoEm: c.createdAt.toISOString(),
  editadoEm: c.editadoEm?.toISOString() ?? null,
  atualizadoEm: c.updatedAt.toISOString(),
  /** Número do ponto quando o comentário foi escrito (nulo se o ponto não tinha número). */
  epoca: { valorBase: numero(c.valorBase), valorComparado: numero(c.valorComparado), variacao: numero(c.variacao) },
  podeEditar: c.autorId === userId,
  podeApagar: podeApagar(c, userId, moderador, agora)
});

type Ponto = { anoComparado: number; mes: number | null; metrica: string; turno: string };

/**
 * Confere os limites (só os não apagados contam) com o lock por ano comparado já tomado: dois POSTs ou restaurações
 * simultâneos não furam o limite. Chamar dentro de uma transação.
 */
export async function conferirLimites(tx: Prisma.TransactionClient, ponto: Ponto): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`planejamento-comentario:${ponto.anoComparado}`}))`;
  const doAno = await tx.planejamentoComentario.count({ where: { contexto: CONTEXTO, anoComparado: ponto.anoComparado, ...NAO_APAGADO } });
  if (doAno >= MAXIMO_POR_ANO) throw new LimiteDeComentarios(MENSAGEM_LIMITE_ANO);
  const doPonto = { contexto: CONTEXTO, anoComparado: ponto.anoComparado, mes: ponto.mes, metrica: ponto.metrica, turno: ponto.turno, ...NAO_APAGADO };
  if ((await tx.planejamentoComentario.count({ where: doPonto })) >= MAXIMO_POR_PONTO) throw new LimiteDeComentarios(MENSAGEM_LIMITE_PONTO);
}
