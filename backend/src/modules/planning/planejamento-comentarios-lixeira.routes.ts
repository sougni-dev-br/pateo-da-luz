import { Router, type Request, type Response } from "express";
import type { PlanejamentoComentario } from "@prisma/client";
import { prisma } from "../../config/database.js";
import type { SessionUser } from "../security/security-utils.js";
import { auditMeta, registrarAuditoria, usuario } from "./planejamento-rotas-comum.js";
import { consultaDeComentariosSchema } from "./planejamento-comentarios-schema.js";
import { CONTEXTO, ENTIDADE, LimiteDeComentarios, MENSAGEM_NAO_ENCONTRADO, NAO_APAGADO, ROTULO, conferirLimites, paraResposta, podeModerar } from "./planejamento-comentarios-comum.js";
import { podeRestaurar } from "./planejamento-comentarios-regras.js";

// Lixeira dos comentários: apagar só marca quem e quando (a linha fica); restaurar devolve ao ponto. GET /lixeira só
// para quem administra o Planejamento. POST/DELETE exigem "editar" pela exceção de /planning/comentarios em menu-permissions.ts.
export const planejamentoComentariosLixeiraRouter = Router();

const MENSAGEM_SEM_PODER_DE_APAGAR = "Só quem escreveu o comentário, ou um administrador do Planejamento, pode apagá-lo.";
const MENSAGEM_PRAZO_DO_AUTOR = "Depois de 24 horas, só quem administra o Planejamento pode apagar este comentário.";
const MENSAGEM_SEM_PODER_DE_RESTAURAR = "Só quem apagou pode desfazer, e só nos primeiros 10 minutos. Depois disso, peça a um administrador do Planejamento.";
const MENSAGEM_NAO_ESTA_NA_LIXEIRA = "Este comentário não está na lixeira.";
const MENSAGEM_SO_ADMIN_VE_LIXEIRA = "Só quem administra o Planejamento vê a lixeira dos comentários.";

const apagadoPor = (c: PlanejamentoComentario) => ({ id: c.apagadoPorId, nome: c.apagadoPorNome });

planejamentoComentariosLixeiraRouter.get("/lixeira", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  if (!(await podeModerar(user as SessionUser))) return void response.status(403).json({ message: MENSAGEM_SO_ADMIN_VE_LIXEIRA });
  const consulta = consultaDeComentariosSchema.safeParse(request.query);
  if (!consulta.success) return void response.status(400).json({ message: "Informe o ano comparado (entre 2020 e 2100)." });
  const lista = await prisma.planejamentoComentario.findMany({
    where: { contexto: CONTEXTO, anoComparado: consulta.data.anoComparado, apagadoEm: { not: null } },
    orderBy: [{ apagadoEm: "desc" }]
  });
  response.json({
    comentarios: lista.map((c) => ({ ...paraResposta(c, user.id, true), apagadoEm: c.apagadoEm?.toISOString() ?? null, apagadoPorNome: c.apagadoPorNome }))
  });
});

/** 403 com o motivo certo, ou null se pode apagar. O autor tem 24 horas; o administrador, sempre. */
async function motivoParaNaoApagar(atual: PlanejamentoComentario, user: SessionUser): Promise<string | null> {
  const moderador = await podeModerar(user);
  if (moderador) return null;
  if (atual.autorId !== user.id) return MENSAGEM_SEM_PODER_DE_APAGAR;
  return paraResposta(atual, user.id, false).podeApagar ? null : MENSAGEM_PRAZO_DO_AUTOR;
}

planejamentoComentariosLixeiraRouter.delete("/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoComentario.findUnique({ where: { id: request.params.id } });
  if (!atual || atual.apagadoEm) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  const motivo = await motivoParaNaoApagar(atual, user as SessionUser);
  if (motivo) return void response.status(403).json({ message: motivo });
  const apagadoEm = new Date();
  // Só marca se ainda não estava apagado: duas pessoas apagando juntas não sobrescrevem quem apagou primeiro.
  const marcados = await prisma.planejamentoComentario.updateMany({
    where: { id: atual.id, ...NAO_APAGADO },
    data: { apagadoEm, apagadoPorId: user.id, apagadoPorNome: user.name }
  });
  if (marcados.count === 0) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  const moderacao = atual.autorId !== user.id;
  const newValue = {
    apagadoEm: apagadoEm.toISOString(),
    apagadoPor: { id: user.id, nome: user.name },
    ...(moderacao && { moderado: true, autorOriginal: { id: atual.autorId, nome: atual.autorNome } })
  };
  await registrarAuditoria(atual.id, { userId: user.id, action: "DELETE_PLANNING_COMMENT", entity: ENTIDADE, entityId: atual.id, previousValue: atual, newValue, ...auditMeta(request) }, ROTULO);
  response.json({ ok: true, apagadoEm: newValue.apagadoEm });
});

async function restaurar(atual: PlanejamentoComentario) {
  return prisma.$transaction(async (tx) => {
    await conferirLimites(tx, atual);
    const devolvidos = await tx.planejamentoComentario.updateMany({
      where: { id: atual.id, apagadoEm: { not: null } },
      data: { apagadoEm: null, apagadoPorId: null, apagadoPorNome: null }
    });
    return devolvidos.count === 0 ? null : tx.planejamentoComentario.findUniqueOrThrow({ where: { id: atual.id } });
  });
}

async function responderRestauracao(request: Request, response: Response, user: SessionUser, atual: PlanejamentoComentario) {
  let restaurado: PlanejamentoComentario | null;
  try {
    restaurado = await restaurar(atual);
  } catch (e) {
    if (e instanceof LimiteDeComentarios) return void response.status(409).json({ message: e.message });
    throw e;
  }
  // Outra pessoa restaurou entre a leitura e a gravação.
  if (!restaurado) return void response.status(409).json({ message: MENSAGEM_NAO_ESTA_NA_LIXEIRA });
  const previousValue = { apagadoEm: atual.apagadoEm?.toISOString() ?? null, apagadoPor: apagadoPor(atual) };
  await registrarAuditoria(atual.id, { userId: user.id, action: "RESTORE_PLANNING_COMMENT", entity: ENTIDADE, entityId: atual.id, previousValue, newValue: restaurado, ...auditMeta(request) }, ROTULO);
  response.json(paraResposta(restaurado, user.id, await podeModerar(user)));
}

planejamentoComentariosLixeiraRouter.post("/:id/restaurar", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoComentario.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  if (!atual.apagadoEm) return void response.status(409).json({ message: MENSAGEM_NAO_ESTA_NA_LIXEIRA });
  if (!podeRestaurar(atual, user.id, await podeModerar(user as SessionUser), new Date())) {
    return void response.status(403).json({ message: MENSAGEM_SEM_PODER_DE_RESTAURAR });
  }
  await responderRestauracao(request, response, user as SessionUser, atual);
});
