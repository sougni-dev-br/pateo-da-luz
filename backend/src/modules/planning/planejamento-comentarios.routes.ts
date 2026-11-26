import { Router } from "express";
import type { PlanejamentoComentario } from "@prisma/client";
import { prisma } from "../../config/database.js";
import type { SessionUser } from "../security/security-utils.js";
import { auditMeta, mensagemDoZod, registrarAuditoria, usuario } from "./planejamento-rotas-comum.js";
import { consultaDeComentariosSchema, edicaoComentarioSchema, novoComentarioSchema } from "./planejamento-comentarios-schema.js";
import { CONTEXTO, ENTIDADE, LimiteDeComentarios, MENSAGEM_NAO_ENCONTRADO, NAO_APAGADO, ROTULO, conferirLimites, paraResposta, podeModerar } from "./planejamento-comentarios-comum.js";
import { SEM_NUMERO, numeroDoPonto, type NumeroDaEpoca } from "./planejamento-comentarios-regras.js";
import { planejamentoComentariosLixeiraRouter } from "./planejamento-comentarios-lixeira.routes.js";
import { carregarComparativo } from "./planejamento.service.js";

// Comentários explicativos do Comparativo. Permissão: GET = ver; POST/PATCH/DELETE = editar (exceção em menu-permissions.ts).
// Cada pessoa edita os próprios e apaga os próprios por 24 horas; apagar o de outra pessoa (ou depois do prazo) exige
// "admin" do módulo. Apagar só manda para a lixeira (planejamento-comentarios-lixeira.routes.ts).
export const planejamentoComentariosRouter = Router();
planejamentoComentariosRouter.use(planejamentoComentariosLixeiraRouter);

const MENSAGEM_DE_CONCORRENCIA = "Este comentário mudou enquanto você mexia nele. Atualize a tela e confira.";
const MENSAGEM_SO_O_AUTOR_EDITA = "Só quem escreveu o comentário pode editá-lo.";

planejamentoComentariosRouter.get("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const consulta = consultaDeComentariosSchema.safeParse(request.query);
  if (!consulta.success) return void response.status(400).json({ message: "Informe o ano comparado (entre 2020 e 2100)." });
  // O ano-base não restringe: o comentário vale em qualquer comparação com esse ano comparado/mês.
  const lista = await prisma.planejamentoComentario.findMany({
    where: { contexto: CONTEXTO, anoComparado: consulta.data.anoComparado, ...NAO_APAGADO },
    orderBy: [{ mes: { sort: "asc", nulls: "first" } }, { metrica: "asc" }, { turno: "asc" }, { createdAt: "asc" }]
  });
  const moderador = await podeModerar(user as SessionUser);
  // `podeModerar` diz à tela se mostra a lixeira e o "Apagar" dos comentários alheios.
  response.json({ comentarios: lista.map((c) => paraResposta(c, user.id, moderador)), podeModerar: moderador });
});

/**
 * O número do ponto agora, calculado pelo mesmo comparativo da tela (anoBase × anoComparado do comentário). Se o cálculo
 * falhar, o comentário é gravado assim mesmo, sem número: explicar o ponto vale mais que guardar o número.
 */
async function numeroDaEpoca(dados: ReturnType<typeof novoComentarioSchema.parse>): Promise<NumeroDaEpoca> {
  try {
    return numeroDoPonto(await carregarComparativo(dados.anoBase, dados.anoComparado), dados);
  } catch (e) {
    console.error("[planejamento] número da época não calculado; comentário gravado sem número", e);
    return SEM_NUMERO;
  }
}

async function criarRespeitandoLimites(dados: ReturnType<typeof novoComentarioSchema.parse>, user: SessionUser, epoca: NumeroDaEpoca) {
  return prisma.$transaction(async (tx) => {
    await conferirLimites(tx, dados);
    return tx.planejamentoComentario.create({ data: { ...dados, ...epoca, contexto: CONTEXTO, autorId: user.id, autorNome: user.name } });
  });
}

planejamentoComentariosRouter.post("/", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = novoComentarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  let criado: PlanejamentoComentario;
  try {
    criado = await criarRespeitandoLimites(dados.data, user as SessionUser, await numeroDaEpoca(dados.data));
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
  if (!atual || atual.apagadoEm) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  if (atual.autorId !== user.id) return void response.status(403).json({ message: MENSAGEM_SO_O_AUTOR_EDITA });
  const { texto, naImpressao, atualizadoEm } = dados.data;
  const gravados = await prisma.planejamentoComentario.updateMany({
    where: { id: atual.id, autorId: user.id, updatedAt: new Date(atualizadoEm), ...NAO_APAGADO },
    data: { ...(texto !== undefined && { texto }), ...(naImpressao !== undefined && { naImpressao }), editadoEm: new Date() }
  });
  if (gravados.count === 0) {
    // Entre a leitura e a gravação o comentário sumiu (404) ou mudou (409).
    const aindaExiste = await prisma.planejamentoComentario.findFirst({ where: { id: atual.id, ...NAO_APAGADO } });
    return void response.status(aindaExiste ? 409 : 404).json({ message: aindaExiste ? MENSAGEM_DE_CONCORRENCIA : MENSAGEM_NAO_ENCONTRADO });
  }
  const nova = await prisma.planejamentoComentario.findUniqueOrThrow({ where: { id: atual.id } });
  await registrarAuditoria(atual.id, { userId: user.id, action: "UPDATE_PLANNING_COMMENT", entity: ENTIDADE, entityId: atual.id, previousValue: atual, newValue: nova, ...auditMeta(request) }, ROTULO);
  response.json(paraResposta(nova, user.id, await podeModerar(user as SessionUser)));
});
