import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { edicaoSchema, novoCenarioSchema, ordenadas, premissasSchema, previaSchema } from "./planejamento-cenario-schema.js";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";
import { premissasNeutras, type PremissasDoMes } from "./planejamento-projecao.js";
import { carregarComparativo, carregarProjecao } from "./planejamento.service.js";

// Planejamento (comparativo e cenários de projeção do Salão). O acesso vem do módulo "planning"
// (ver / lançar / editar / excluir), aplicado pelo middleware de permissões por prefixo de rota.
export const planningRouter = Router();

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const MENSAGEM_NOME_REPETIDO = "Já existe um cenário com esse nome neste ano.";
const MENSAGEM_NAO_ENCONTRADO = "Cenário não encontrado.";
const MENSAGEM_DE_CONCORRENCIA = "Este cenário mudou enquanto você mexia nele. Atualize a tela e confira.";

const consultaDoComparativo = z.object({
  anoBase: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO),
  anoComparado: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO)
});

planningRouter.get("/comparativo", async (request, response) => {
  const consulta = consultaDoComparativo.safeParse({
    anoBase: request.query.anoBase ?? new Date().getFullYear() - 1,
    anoComparado: request.query.anoComparado ?? new Date().getFullYear()
  });
  if (!consulta.success) {
    response.status(400).json({ message: "Informe anos válidos entre 2020 e 2100." });
    return;
  }
  const { anoBase, anoComparado } = consulta.data;
  if (anoBase === anoComparado) {
    response.status(400).json({ message: "Escolha dois anos diferentes para comparar." });
    return;
  }
  response.json(await carregarComparativo(anoBase, anoComparado));
});

// ── Cenários de projeção ────────────────────────────────────────────────────

type Cenario = Prisma.PlanejamentoCenarioGetPayload<Record<string, never>>;

function premissasDe(c: Cenario): PremissasDoMes[] {
  const lidas = premissasSchema.safeParse(c.premissas);
  return lidas.success ? ordenadas(lidas.data) : premissasNeutras();
}

const resumo = (c: Cenario) => ({ id: c.id, ano: c.ano, anoBase: c.anoBase, nome: c.nome, atualizadoEm: c.updatedAt.toISOString() });

async function comProjecao(c: Cenario) {
  const premissas = premissasDe(c);
  return { ...resumo(c), premissas, projecao: await carregarProjecao(c.anoBase, premissas) };
}

function mensagemDoZod(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}

async function usuario(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (!user) response.status(401).json({ message: "Sessao obrigatoria." });
  return user;
}

planningRouter.get("/cenarios", async (request, response) => {
  const ano = z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO).safeParse(request.query.ano);
  const lista = await prisma.planejamentoCenario.findMany({
    where: ano.success ? { ano: ano.data } : undefined,
    orderBy: [{ ano: "desc" }, { nome: "asc" }]
  });
  response.json(lista.map(resumo));
});

planningRouter.get("/cenarios/:id", async (request, response) => {
  const cenario = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id } });
  if (!cenario) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  response.json(await comProjecao(cenario));
});

// Prévia: calcula sem gravar, para a tela mostrar o resultado enquanto as premissas são digitadas.
planningRouter.post("/projecao", async (request, response) => {
  const dados = previaSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  response.json(await carregarProjecao(dados.data.anoBase, ordenadas(dados.data.premissas)));
});

planningRouter.post("/cenarios", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = novoCenarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const { ano, anoBase, nome, premissas } = dados.data;
  try {
    const criado = await prisma.planejamentoCenario.create({
      data: { ano, anoBase, nome, premissas: ordenadas(premissas ?? premissasNeutras()), createdById: user.id }
    });
    await auditLog({ userId: user.id, action: "CREATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: criado.id, newValue: resumo(criado), ...auditMeta(request) });
    response.status(201).json(await comProjecao(criado));
  } catch (e) {
    if (isUniqueViolation(e)) return void response.status(409).json({ message: MENSAGEM_NOME_REPETIDO });
    throw e;
  }
});

planningRouter.put("/cenarios/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = edicaoSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const atual = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  if (dados.data.anoBase >= atual.ano) return void response.status(400).json({ message: "O ano-base precisa ser anterior ao ano projetado." });

  try {
    // Trava otimista: só grava se ninguém salvou depois da leitura que a tela fez.
    const gravados = await prisma.planejamentoCenario.updateMany({
      where: { id: atual.id, updatedAt: new Date(dados.data.atualizadoEm) },
      data: { nome: dados.data.nome, anoBase: dados.data.anoBase, premissas: ordenadas(dados.data.premissas) }
    });
    if (gravados.count === 0) return void response.status(409).json({ message: MENSAGEM_DE_CONCORRENCIA });
  } catch (e) {
    if (isUniqueViolation(e)) return void response.status(409).json({ message: MENSAGEM_NOME_REPETIDO });
    throw e;
  }
  const nova = await prisma.planejamentoCenario.findUniqueOrThrow({ where: { id: atual.id } });
  await auditLog({ userId: user.id, action: "UPDATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: { ...resumo(atual), premissas: premissasDe(atual) }, newValue: { ...resumo(nova), premissas: premissasDe(nova) }, ...auditMeta(request) });
  response.json(await comProjecao(nova));
});

planningRouter.delete("/cenarios/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id } });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  await prisma.planejamentoCenario.delete({ where: { id: atual.id } });
  await auditLog({ userId: user.id, action: "DELETE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: { ...resumo(atual), premissas: premissasDe(atual) }, ...auditMeta(request) });
  response.json({ ok: true });
});
