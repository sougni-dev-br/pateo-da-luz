import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { edicaoSchema, novoCenarioSchema, ordenadas, previaSchema } from "./planejamento-cenario-schema.js";
import { caixaPadrao, montarCaixa } from "./planejamento-caixa.js";
import { linhasPadrao, montarResultado, type LinhaDeGasto } from "./planejamento-gastos.js";
import { AVISO_CAIXA, AVISO_GASTOS, AVISO_PREMISSAS, lerCaixa, lerLinha, lerPremissas } from "./planejamento-leitura.js";
import { ANO_MAXIMO, ANO_MINIMO } from "./planejamento-limites.js";
import { premissasNeutras } from "./planejamento-projecao.js";
import { carregarRealizadoDeCaixa } from "./planejamento-realizado-caixa.service.js";
import { carregarComparativo, carregarProjecao, carregarRealizado } from "./planejamento.service.js";

// Planejamento (comparativo e cenários de projeção do Salão). O acesso vem do módulo "planning"
// (ver / lançar / editar / excluir), aplicado pelo middleware de permissões por prefixo de rota.
export const planningRouter = Router();

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const MENSAGEM_NOME_REPETIDO = "Já existe um cenário com esse nome neste ano.";
const MENSAGEM_NAO_ENCONTRADO = "Cenário não encontrado.";
// Padrão do Prisma (2 s de espera, 5 s de execução) é curto para apagar e recriar 40 linhas num banco ocupado.
const TRANSACAO_DO_CENARIO = { maxWait: 10_000, timeout: 15_000 };
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

// Leitura tolerante: o que está gravado fora do formato é trocado pelo padrão para a tela abrir, mas isso vira AVISO
// (e log com o id), porque o próximo salvamento apagaria o original.
function leituraDe(c: Cenario) {
  const premissas = lerPremissas(c.premissas);
  const caixa = lerCaixa(c.caixa);
  const linhas = c.gastos.map(lerLinha);
  const avisos: string[] = [];
  if (premissas.reparado) avisos.push(AVISO_PREMISSAS);
  if (caixa.reparado) avisos.push(AVISO_CAIXA);
  if (linhas.some((l) => l.reparado)) avisos.push(AVISO_GASTOS);
  if (avisos.length > 0) console.error(`[planejamento] cenário ${c.id} com dados gravados fora do formato: ${avisos.join(" | ")}`);
  return { premissas: premissas.valor, caixaPremissas: caixa.valor, gastos: linhas.map((l) => l.valor), avisos };
}

const servicoDe = (c: Cenario) => (c.servicoPercentual === null ? null : Number(c.servicoPercentual));
const resumo = (c: Pick<Cenario, "id" | "ano" | "anoBase" | "nome" | "updatedAt">) => ({ id: c.id, ano: c.ano, anoBase: c.anoBase, nome: c.nome, atualizadoEm: c.updatedAt.toISOString() });
// Estado já normalizado (o que a tela passa a mostrar) para o "depois" da auditoria.
const estadoGravado = (c: Cenario) => {
  const { premissas, caixaPremissas, gastos } = leituraDe(c);
  return { ...resumo(c), premissas, gastos, servicoPercentual: servicoDe(c), caixaPremissas };
};
// O "antes" da auditoria é o JSON BRUTO do banco: se a leitura o consertou, o original ainda fica registrado.
const estadoBruto = (c: Cenario) => ({
  ...resumo(c),
  premissas: c.premissas,
  gastos: c.gastos.map((g) => ({ grupo: g.grupo, nome: g.nome, modo: g.modo, valores: g.valores, pagoNoMes: Number(g.pagoNoMes) })),
  servicoPercentual: servicoDe(c),
  caixaPremissas: c.caixa
});

// A gravação já foi confirmada: falha ao registrar a auditoria não pode virar 500 e fazer a pessoa repetir o que já valeu.
async function registrarAuditoria(id: string, dados: Parameters<typeof auditLog>[0]) {
  try {
    await auditLog(dados);
  } catch (e) {
    console.error(`[planejamento] auditoria não gravada para o cenário ${id}`, e);
  }
}

async function comProjecao(c: Cenario) {
  const { premissas, gastos, caixaPremissas, avisos } = leituraDe(c);
  const servicoPercentual = servicoDe(c);
  const projecao = await carregarProjecao(c.anoBase, premissas);
  const resultado = montarResultado(projecao, gastos, servicoPercentual);
  return { ...resumo(c), premissas, gastos, servicoPercentual, caixaPremissas, projecao, resultado, caixa: montarCaixa(projecao, resultado, gastos, caixaPremissas), avisos };
}

const linhasParaGravar = (gastos: readonly LinhaDeGasto[]) => gastos.map((g, ordem) => ({ grupo: g.grupo, nome: g.nome, modo: g.modo, valores: g.valores, pagoNoMes: g.pagoNoMes ?? 1, ordem }));

function mensagemDoZod(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? "Dados inválidos.";
}

async function usuario(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (!user) response.status(401).json({ message: "Sessao obrigatoria." });
  return user;
}

// Realizado do ano-base por grupo de gasto, vindo do DRE. Quem aplica é quem edita o cenário (exige "editar" em
// Planejamento, ver menu-permissions.ts) E precisa poder ver o DRE: o módulo não abre números que a pessoa não vê lá.
planningRouter.get("/realizado", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const ano = z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO).safeParse(request.query.ano);
  if (!ano.success) return void response.status(400).json({ message: "Informe um ano válido entre 2020 e 2100." });
  if (!(await userHasPermission(user as SessionUser, "dre", "view"))) {
    return void response.status(403).json({ message: "Para preencher pelo realizado, você precisa de acesso ao DRE Gerencial." });
  }
  const ignorar = String(request.query.ignorarSemLancamento ?? "true") !== "false";
  response.json(await carregarRealizado(ano.data, ignorar));
});

// Realizado de CAIXA do ano-base (mix de pagamento, prazo das compras, % pago no mês, herdado). Mesma regra do realizado
// de gastos: exige editar em Planejamento e ver o DRE, porque devolve agregados financeiros da casa.
planningRouter.get("/realizado-caixa", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const anos = z
    .object({ ano: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO), anoCenario: z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO) })
    .safeParse({ ano: request.query.ano, anoCenario: request.query.anoCenario });
  if (!anos.success) return void response.status(400).json({ message: "Informe o ano-base e o ano do cenário (entre 2020 e 2100)." });
  if (!(await userHasPermission(user as SessionUser, "dre", "view"))) {
    return void response.status(403).json({ message: "Para preencher pelo realizado, você precisa de acesso ao DRE Gerencial." });
  }
  response.json(await carregarRealizadoDeCaixa(anos.data.ano, anos.data.anoCenario));
});

planningRouter.get("/cenarios", async (request, response) => {
  const informouAno = request.query.ano !== undefined;
  const ano = z.coerce.number().int().min(ANO_MINIMO).max(ANO_MAXIMO).safeParse(request.query.ano);
  if (informouAno && !ano.success) return void response.status(400).json({ message: "Informe um ano válido entre 2020 e 2100." });
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
  const resultado = montarResultado(projecao, dados.data.gastos, dados.data.servicoPercentual);
  response.json({ projecao, resultado, caixa: montarCaixa(projecao, resultado, dados.data.gastos, dados.data.caixa ?? caixaPadrao()) });
});

planningRouter.post("/cenarios", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const dados = novoCenarioSchema.safeParse(request.body);
  if (!dados.success) return void response.status(400).json({ message: mensagemDoZod(dados.error) });
  const { ano, anoBase, nome, premissas, gastos, servicoPercentual, caixa } = dados.data;
  try {
    const criado = await prisma.planejamentoCenario.create({
      data: {
        ano,
        anoBase,
        nome,
        premissas: ordenadas(premissas ?? premissasNeutras()),
        servicoPercentual: servicoPercentual ?? null,
        caixa: caixa ?? caixaPadrao(),
        createdById: user.id,
        gastos: { create: linhasParaGravar(gastos ?? linhasPadrao()) }
      },
      include: COM_GASTOS
    });
    await registrarAuditoria(criado.id, { userId: user.id, action: "CREATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: criado.id, newValue: estadoGravado(criado), ...auditMeta(request) });
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
        data: { nome: dados.data.nome, anoBase: dados.data.anoBase, premissas: ordenadas(dados.data.premissas), servicoPercentual: dados.data.servicoPercentual, caixa: dados.data.caixa }
      });
      if (gravados.count === 0) return false;
      await tx.planejamentoGastoLinha.deleteMany({ where: { cenarioId: atual.id } });
      await tx.planejamentoGastoLinha.createMany({ data: linhasParaGravar(dados.data.gastos).map((linha) => ({ ...linha, cenarioId: atual.id })) });
      return true;
    }, TRANSACAO_DO_CENARIO);
    if (!gravou) return void response.status(409).json({ message: MENSAGEM_DE_CONCORRENCIA });
  } catch (e) {
    if (isUniqueViolation(e)) return void response.status(409).json({ message: MENSAGEM_NOME_REPETIDO });
    throw e;
  }
  const nova = await prisma.planejamentoCenario.findUniqueOrThrow({ where: { id: atual.id }, include: COM_GASTOS });
  await registrarAuditoria(atual.id, { userId: user.id, action: "UPDATE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: estadoBruto(atual), newValue: estadoGravado(nova), ...auditMeta(request) });
  response.json(await comProjecao(nova));
});

planningRouter.delete("/cenarios/:id", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  const atual = await prisma.planejamentoCenario.findUnique({ where: { id: request.params.id }, include: COM_GASTOS });
  if (!atual) return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
  try {
    await prisma.planejamentoCenario.delete({ where: { id: atual.id } });
  } catch (e) {
    // Outra pessoa apagou entre a leitura e a exclusão: para quem pediu, o cenário já não existe.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return void response.status(404).json({ message: MENSAGEM_NAO_ENCONTRADO });
    throw e;
  }
  await registrarAuditoria(atual.id, { userId: user.id, action: "DELETE_PLANNING_SCENARIO", entity: "PlanejamentoCenario", entityId: atual.id, previousValue: estadoBruto(atual), ...auditMeta(request) });
  response.json({ ok: true });
});
