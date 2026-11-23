import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { edicaoSchema, gastosSchema, novoCenarioSchema, ordenadas, premissasSchema, previaSchema } from "./planejamento-cenario-schema.js";
import { GRUPOS_DE_GASTO, linhasPadrao, montarResultado, type LinhaDeGasto } from "./planejamento-gastos.js";
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

const COM_GASTOS = { gastos: { orderBy: [{ ordem: "asc" }, { createdAt: "asc" }] } } satisfies Prisma.PlanejamentoCenarioInclude;
type Cenario = Prisma.PlanejamentoCenarioGetPayload<{ include: typeof COM_GASTOS }>;

function premissasDe(c: Cenario): PremissasDoMes[] {
  const lidas = premissasSchema.safeParse(c.premissas);
  return lidas.success ? ordenadas(lidas.data) : premissasNeutras();
}

// Linha gravada fora do formato (edição manual no banco) não some da tela: é normalizada, para o próximo salvamento
// não apagá-la sem ninguém ver.
function normalizarLinha(g: { grupo: string; nome: string; modo: string; valores: unknown }): LinhaDeGasto {
  const lida = gastosSchema.safeParse([{ grupo: g.grupo, nome: g.nome, modo: g.modo, valores: g.valores }]);
  if (lida.success) return lida.data[0];
  const bruto = Array.isArray(g.valores) ? g.valores : [];
  const modo = g.modo === "PERCENTUAL" ? "PERCENTUAL" : "FIXO";
  const teto = modo === "FIXO" ? 1_000_000_000 : 1;
  return {
    grupo: (GRUPOS_DE_GASTO as readonly string[]).includes(g.grupo) ? (g.grupo as LinhaDeGasto["grupo"]) : "OUTROS",
    nome: g.nome.slice(0, 60),
    modo,
    valores: Array.from({ length: 12 }, (_, i) => {
      const n = Number(bruto[i]);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), teto) : 0;
    })
  };
}

const gastosDe = (c: Cenario): LinhaDeGasto[] => c.gastos.map(normalizarLinha);

const servicoDe = (c: Cenario) => (c.servicoPercentual === null ? null : Number(c.servicoPercentual));
const resumo = (c: Pick<Cenario, "id" | "ano" | "anoBase" | "nome" | "updatedAt">) => ({ id: c.id, ano: c.ano, anoBase: c.anoBase, nome: c.nome, atualizadoEm: c.updatedAt.toISOString() });
const estadoGravado = (c: Cenario) => ({ ...resumo(c), premissas: premissasDe(c), gastos: gastosDe(c), servicoPercentual: servicoDe(c) });

async function comProjecao(c: Cenario) {
  const premissas = premissasDe(c);
  const gastos = gastosDe(c);
  const servicoPercentual = servicoDe(c);
  const projecao = await carregarProjecao(c.anoBase, premissas);
  return { ...resumo(c), premissas, gastos, servicoPercentual, projecao, resultado: montarResultado(projecao, gastos, servicoPercentual) };
}

const linhasParaGravar = (gastos: readonly LinhaDeGasto[]) => gastos.map((g, ordem) => ({ grupo: g.grupo, nome: g.nome, modo: g.modo, valores: g.valores, ordem }));

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
  const cenario = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id }, include: COM_GASTOS });
  if (!cenario) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  response.json(await comProjecao(cenario));
});

// Prévia: calcula sem gravar, para a tela mostrar o resultado enquanto as premissas e os gastos são digitados.
planningRouter.post("/projecao", async (request, response) => {
  const dados = previaSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const projecao = await carregarProjecao(dados.data.anoBase, ordenadas(dados.data.premissas));
  response.json({ projecao, resultado: montarResultado(projecao, dados.data.gastos, dados.data.servicoPercentual) });
});

planningRouter.post("/cenarios", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = novoCenarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const { ano, anoBase, nome, premissas, gastos, servicoPercentual } = dados.data;
  try {
    const criado = await prisma.planejamentoCenario.create({
      data: {
        ano,
        anoBase,
        nome,
        premissas: ordenadas(premissas ?? premissasNeutras()),
        servicoPercentual: servicoPercentual ?? null,
        createdById: user.id,
        gastos: { create: linhasParaGravar(gastos ?? linhasPadrao()) }
      },
      include: COM_GASTOS
    });
    await auditLog({ userId: user.id, action: "CREATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: criado.id, newValue: estadoGravado(criado), ...auditMeta(request) });
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
  const atual = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id }, include: COM_GASTOS });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  if (dados.data.anoBase >= atual.ano) return void response.status(400).json({ message: "O ano-base precisa ser anterior ao ano projetado." });

  try {
    // Trava otimista: só grava se ninguém salvou depois da leitura que a tela fez. Cenário e linhas de gasto
    // vão na mesma transação, para não ficar um cenário novo com gastos velhos.
    const gravou = await prisma.$transaction(async (tx) => {
      const gravados = await tx.planejamentoCenario.updateMany({
        where: { id: atual.id, updatedAt: new Date(dados.data.atualizadoEm) },
        data: { nome: dados.data.nome, anoBase: dados.data.anoBase, premissas: ordenadas(dados.data.premissas), servicoPercentual: dados.data.servicoPercentual }
      });
      if (gravados.count === 0) return false;
      await tx.planejamentoGastoLinha.deleteMany({ where: { cenarioId: atual.id } });
      await tx.planejamentoGastoLinha.createMany({ data: linhasParaGravar(dados.data.gastos).map((linha) => ({ ...linha, cenarioId: atual.id })) });
      return true;
    });
    if (!gravou) return void response.status(409).json({ message: MENSAGEM_DE_CONCORRENCIA });
  } catch (e) {
    if (isUniqueViolation(e)) return void response.status(409).json({ message: MENSAGEM_NOME_REPETIDO });
    throw e;
  }
  const nova = await prisma.planejamentoCenario.findUniqueOrThrow({ where: { id: atual.id }, include: COM_GASTOS });
  await auditLog({ userId: user.id, action: "UPDATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: estadoGravado(atual), newValue: estadoGravado(nova), ...auditMeta(request) });
  response.json(await comProjecao(nova));
});

planningRouter.delete("/cenarios/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id }, include: COM_GASTOS });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  await prisma.planejamentoCenario.delete({ where: { id: atual.id } });
  await auditLog({ userId: user.id, action: "DELETE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: estadoGravado(atual), ...auditMeta(request) });
  response.json({ ok: true });
});
