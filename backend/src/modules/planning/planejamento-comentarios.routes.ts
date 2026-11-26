import { Router } from "express";
import { Prisma, type PlanejamentoComentario } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { userHasPermission } from "../security/menu-permissions.js";
import type { SessionUser } from "../security/security-utils.js";
import { auditMeta, mensagemDoZod, registrarAuditoria, usuario } from "./planejamento-rotas-comum.js";
import { MAXIMO_POR_ANO, MAXIMO_POR_PONTO, consultaDeComentariosSchema, edicaoComentarioSchema, novoComentarioSchema } from "./planejamento-comentarios-schema.js";

// Comentários explicativos do Comparativo. Permissão: GET = ver; POST/PATCH/DELETE = editar (exceção em menu-permissions.ts).
// Cada pessoa edita e apaga os próprios; apagar o de outra pessoa exige "admin" do módulo (conferido aqui).
export const planejamentoComentariosRouter = Router();

const CONTEXTO = "COMPARATIVO";
const ENTIDADE = "PlanejamentoComentario";
const ROTULO = "comentário";
const MENSAGEM_NAO_ENCONTRADO = "Comentário não encontrado.";
const MENSAGEM_DE_CONCORRENCIA = "Este comentário mudou enquanto você mexia nele. Atualize a tela e confira.";
const MENSAGEM_SO_O_AUTOR_EDITA = "Só quem escreveu o comentário pode editá-lo.";
const MENSAGEM_SEM_PODER_DE_APAGAR = "Só quem escreveu o comentário, ou um administrador do Planejamento, pode apagá-lo.";
const MENSAGEM_LIMITE_PONTO = `Este ponto já tem ${MAXIMO_POR_PONTO} comentários. Apague algum antes de adicionar outro.`;
const MENSAGEM_LIMITE_ANO = `Este ano já tem ${MAXIMO_POR_ANO} comentários. Apague algum antes de adicionar outro.`;

class LimiteDeComentarios extends Error {}

const paraResposta = (c: PlanejamentoComentario, userId: string, podeModerar: boolean) => ({
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
  podeEditar: c.autorId === userId,
  podeApagar: c.autorId === userId || podeModerar
});

const podeModerar = (user: SessionUser) => userHasPermission(user, "planning", "admin");

planejamentoComentariosRouter.get("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const consulta = consultaDeComentariosSchema.safeParse(request.query);
  if (!consulta.success) return void response.status(400).json({ message: "Informe o ano comparado (entre 2020 e 2100)." });
  // O ano-base não restringe: o comentário vale em qualquer comparação com esse ano comparado/mês.
  const lista = await prisma.planejamentoComentario.findMany({
    where: { contexto: CONTEXTO, anoComparado: consulta.data.anoComparado },
    orderBy: [{ mes: { sort: "asc", nulls: "first" } }, { metrica: "asc" }, { turno: "asc" }, { createdAt: "asc" }]
  });
  const moderador = await podeModerar(user as SessionUser);
  response.json({ comentarios: lista.map((c) => paraResposta(c, user.id, moderador)) });
});

// Confere os limites e grava na mesma transação; o lock por ano comparado impede dois POSTs simultâneos de furarem o limite.
async function criarRespeitandoLimites(dados: ReturnType<typeof novoComentarioSchema.parse>, user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`planejamento-comentario:${dados.anoComparado}`}))`;
    const doAno = await tx.planejamentoComentario.count({ where: { contexto: CONTEXTO, anoComparado: dados.anoComparado } });
    if (doAno >= MAXIMO_POR_ANO) throw new LimiteDeComentarios(MENSAGEM_LIMITE_ANO);
    const ponto = { contexto: CONTEXTO, anoComparado: dados.anoComparado, mes: dados.mes, metrica: dados.metrica, turno: dados.turno };
    if ((await tx.planejamentoComentario.count({ where: ponto })) >= MAXIMO_POR_PONTO) throw new LimiteDeComentarios(MENSAGEM_LIMITE_PONTO);
    return tx.planejamentoComentario.create({ data: { ...dados, contexto: CONTEXTO, autorId: user.id, autorNome: user.name } });
  });
}

planejamentoComentariosRouter.post("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = novoComentarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  let criado: PlanejamentoComentario;
  try {
    criado = await criarRespeitandoLimites(dados.data, user as SessionUser);
  } catch (e) {
    if (e instanceof LimiteDeComentarios) return void response.status(409).json({ message: e.message });
    throw e;
  }
  await registrarAuditoria(criado.id, { userId: user.id, action: "CREATE_PLANNING_COMMENT", entity: ENTIDADE, entityId: criado.id, newValue: criado, ...auditMeta(request) }, ROTULO);
  response.status(201).json(paraResposta(criado, user.id, await podeModerar(user as SessionUser)));
});

planejamentoComentariosRouter.patch("/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = edicaoComentarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const atual = await prisma.planejamentoComentario.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  if (atual.autorId !== user.id) return void response.status(403).json({ message: MENSAGEM_SO_O_AUTOR_EDITA });
  const { texto, naImpressao, atualizadoEm } = dados.data;
  const gravados = await prisma.planejamentoComentario.updateMany({
    where: { id: atual.id, autorId: user.id, updatedAt: new Date(atualizadoEm) },
    data: { ...(texto !== undefined && { texto }), ...(naImpressao !== undefined && { naImpressao }), editadoEm: new Date() }
  });
  if (gravados.count === 0) {
    // Entre a leitura e a gravação o comentário sumiu (404) ou mudou (409).
    const aindaExiste = await prisma.planejamentoComentario.findUnique({ where: { id: atual.id } });
    return void response.status(aindaExiste ? 409 : 404).json({ message: aindaExiste ? MENSAGEM_DE_CONCORRENCIA : MENSAGEM_NAO_ENCONTRADO });
  }
  const nova = await prisma.planejamentoComentario.findUniqueOrThrow({ where: { id: atual.id } });
  await registrarAuditoria(atual.id, { userId: user.id, action: "UPDATE_PLANNING_COMMENT", entity: ENTIDADE, entityId: atual.id, previousValue: atual, newValue: nova, ...auditMeta(request) }, ROTULO);
  response.json(paraResposta(nova, user.id, await podeModerar(user as SessionUser)));
});

planejamentoComentariosRouter.delete("/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoComentario.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  const moderacao = atual.autorId !== user.id;
  if (moderacao && !(await podeModerar(user as SessionUser))) return void response.status(403).json({ message: MENSAGEM_SEM_PODER_DE_APAGAR });
  try {
    await prisma.planejamentoComentario.delete({ where: { id: atual.id } });
  } catch (e) {
    // Outra pessoa apagou entre a leitura e a exclusão: para quem pediu, o comentário já não existe.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
    throw e;
  }
  const newValue = moderacao ? { moderado: true, autorOriginal: { id: atual.autorId, nome: atual.autorNome } } : undefined;
  await registrarAuditoria(atual.id, { userId: user.id, action: "DELETE_PLANNING_COMMENT", entity: ENTIDADE, entityId: atual.id, previousValue: atual, newValue, ...auditMeta(request) }, ROTULO);
  response.json({ ok: true });
});
