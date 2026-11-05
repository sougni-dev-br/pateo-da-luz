import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import {
  obterCancelamentos, obterCardapio, obterConsumo, obterDemanda, obterDescontos, obterItensCancelados, obterMargem, obterMargemBebidas, obterMargemBuffet, obterMetas, obterPerdas, obterResumo, obterVendasPorPessoa, salvarCustoBuffet, salvarMeta, UNIDADES_DE_CONSUMO, vincularBebidaAoInsumo, vincularProdutoAoPrato
} from "./agile-analise.service.js";
import { INDICADORES_DE_META } from "./agile-analise-metas.report.js";

export const agileAnaliseRouter = Router();

const MAX_DIAS = 366;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD");

const periodoSchema = z
  .object({ inicio: dataIso, fim: dataIso })
  .superRefine((p, ctx) => {
    const de = Date.parse(`${p.inicio}T00:00:00.000Z`);
    const ate = Date.parse(`${p.fim}T00:00:00.000Z`);
    // "2026-02-30" pode virar 02/03 em vez de falhar: confere a data de ida e volta.
    const existe = !Number.isNaN(de) && !Number.isNaN(ate)
      && new Date(de).toISOString().slice(0, 10) === p.inicio
      && new Date(ate).toISOString().slice(0, 10) === p.fim;
    if (!existe) {
      ctx.addIssue({ code: "custom", message: "data inexistente" });
    } else if (ate < de) {
      ctx.addIssue({ code: "custom", message: "o fim não pode ser anterior ao início" });
    } else if ((ate - de) / UM_DIA_MS + 1 > MAX_DIAS) {
      ctx.addIssue({ code: "custom", message: `o período máximo é de ${MAX_DIAS} dias` });
    }
  });

// Ranking de funcionario e dado sensivel: modulo proprio no controle de acesso
// ("analise-salao"), que nasce desmarcado. O requireMenuAccess global ja barra pelo
// caminho; esta checagem repete na rota para que um erro de mapeamento nao abra a tela.
async function exigirAnaliseSalao(request: Request, response: Response, next: NextFunction) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessão obrigatória." });
    return;
  }
  if (!(await userHasPermission(user as SessionUser, "analise-salao", "view"))) {
    response.status(403).json({ message: "Usuário sem permissão para a análise do salão." });
    return;
  }
  next();
}

// A margem mostra custo de ficha, custo de compra de insumo e o custo do buffet: visibilidade de custo e permissao propria
// ("inventory-costs", a mesma do Estoque e do Desperdicio), nao cargo. Vale para ler E para gravar vinculos e custos.
// Roda depois de exigirAnaliseSalao, que ja garante a sessao.
async function exigirCustos(request: Request, response: Response, next: NextFunction) {
  const user = await getSessionUser(request);
  if (!user || !(await userHasPermission(user as SessionUser, "inventory-costs", "view"))) {
    response.status(403).json({ message: "Usuário sem permissão para ver custos." });
    return;
  }
  next();
}

function lerPeriodo(request: Request, response: Response) {
  const parsed = periodoSchema.safeParse(request.query);
  if (!parsed.success) {
    const problema = parsed.error.issues[0];
    const campo = problema?.path.join(".");
    response.status(400).json({ message: `Período inválido${campo ? ` (${campo})` : ""}: ${problema?.message ?? "confira início e fim"}` });
    return null;
  }
  return parsed.data;
}

agileAnaliseRouter.get("/cancelamentos", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterCancelamentos(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de cancelamentos do salão", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de cancelamentos." });
  }
});

agileAnaliseRouter.get("/vendas-por-pessoa", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterVendasPorPessoa(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de vendas por pessoa", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de vendas por pessoa." });
  }
});

agileAnaliseRouter.get("/itens-cancelados", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterItensCancelados(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de itens cancelados", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de itens cancelados." });
  }
});

agileAnaliseRouter.get("/descontos", exigirAnaliseSalao, async (request, response) => {
  const periodo = lerPeriodo(request, response);
  if (!periodo) return;
  try {
    response.json(await obterDescontos(periodo));
  } catch (error: unknown) {
    console.error("Falha ao montar o relatório de descontos", error);
    response.status(500).json({ message: "Não foi possível gerar o relatório de descontos." });
  }
});

// Visao de decisao: o que mudou, quando vendemos e onde perdemos dinheiro.
const ROTAS_DE_VISAO = [
  { caminho: "/resumo", obter: obterResumo, rotulo: "o resumo do salão" },
  { caminho: "/demanda", obter: obterDemanda, rotulo: "a análise de demanda do salão" },
  { caminho: "/cardapio", obter: obterCardapio, rotulo: "a análise do cardápio do salão" },
  { caminho: "/margem", obter: obterMargem, rotulo: "a margem por prato do salão", custo: true },
  { caminho: "/margem-bebidas", obter: obterMargemBebidas, rotulo: "a margem das bebidas do salão", custo: true },
  { caminho: "/margem-buffet", obter: obterMargemBuffet, rotulo: "a margem do buffet do salão", custo: true },
  { caminho: "/perdas", obter: obterPerdas, rotulo: "a análise de perdas do salão" },
  // Sem valores de custo: so quantidades de insumo e cobertura. Basta ver a analise.
  { caminho: "/consumo", obter: obterConsumo, rotulo: "o consumo teórico de insumos do salão" }
] as const;

for (const { caminho, obter, rotulo, ...resto } of ROTAS_DE_VISAO) {
  const guardas = "custo" in resto ? [exigirAnaliseSalao, exigirCustos] : [exigirAnaliseSalao];
  agileAnaliseRouter.get(caminho, ...guardas, async (request, response) => {
    const periodo = lerPeriodo(request, response);
    if (!periodo) return;
    try {
      response.json(await obter(periodo));
    } catch (error: unknown) {
      console.error(`Falha ao montar ${rotulo}`, error);
      response.status(500).json({ message: `Não foi possível gerar ${rotulo}.` });
    }
  });
}

// Metas mensais. Ler exige a permissao de ver a analise; gravar exige a de editar.
const mesSchema = z.object({ ano: z.coerce.number().int().min(2020).max(2100), mes: z.coerce.number().int().min(1).max(12) });
const LIMITE_DA_META = { faturamento: 100_000_000, pessoas: 1_000_000, ticketPessoa: 10_000, perdaPct: 1 } as const;
const metaSchema = mesSchema.extend({
  indicador: z.enum(INDICADORES_DE_META),
  // null apaga a meta.
  valor: z.number().finite().positive().nullable()
}).superRefine((m, ctx) => {
  if (m.valor !== null && m.valor > LIMITE_DA_META[m.indicador]) ctx.addIssue({ code: "custom", path: ["valor"], message: "valor acima do limite aceito" });
});

agileAnaliseRouter.get("/metas", exigirAnaliseSalao, async (request, response) => {
  const parsed = mesSchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Mês inválido: informe ano e mês." });
    return;
  }
  try {
    response.json(await obterMetas(parsed.data.ano, parsed.data.mes));
  } catch (error: unknown) {
    console.error("Falha ao montar as metas do salão", error);
    response.status(500).json({ message: "Não foi possível gerar as metas do salão." });
  }
});

agileAnaliseRouter.put("/metas", exigirAnaliseSalao, async (request, response) => {
  const user = await getSessionUser(request);
  if (!user || !(await userHasPermission(user as SessionUser, "analise-salao", "edit"))) {
    response.status(403).json({ message: "Usuário sem permissão para editar as metas do salão." });
    return;
  }
  const parsed = metaSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: `Meta inválida: ${parsed.error.issues[0]?.message ?? "confira os campos"}.` });
    return;
  }
  try {
    const { ano, mes, indicador, valor } = parsed.data;
    await salvarMeta(ano, mes, indicador, valor, user.id);
    response.json(await obterMetas(ano, mes));
  } catch (error: unknown) {
    console.error("Falha ao salvar a meta do salão", error);
    response.status(500).json({ message: "Não foi possível salvar a meta." });
  }
});

// Vinculo produto do PDV <-> prato da ficha do salao. Gravar exige a permissao de editar.
const vinculoSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  nome: z.string().trim().min(1).max(200),
  // null desfaz o vinculo.
  pratoId: z.string().trim().min(1).max(60).nullable()
});

agileAnaliseRouter.put("/margem/vinculo", exigirAnaliseSalao, exigirCustos, async (request, response) => {
  const user = await getSessionUser(request);
  if (!user || !(await userHasPermission(user as SessionUser, "analise-salao", "edit"))) {
    response.status(403).json({ message: "Usuário sem permissão para editar vínculos da margem." });
    return;
  }
  const parsed = vinculoSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Vínculo inválido: informe o código e o nome do produto e o prato (ou null para desfazer)." });
    return;
  }
  try {
    const { codigo, nome, pratoId } = parsed.data;
    const resultado = await vincularProdutoAoPrato(codigo, nome, pratoId, user.id);
    if (resultado === "prato-invalido") {
      response.status(400).json({ message: "Prato inválido: escolha um prato ativo do cardápio do salão." });
      return;
    }
    response.json({ ok: true });
  } catch (error: unknown) {
    console.error("Falha ao salvar o vínculo produto-prato", error);
    response.status(500).json({ message: "Não foi possível salvar o vínculo." });
  }
});

// Vinculo bebida do PDV <-> insumo comprado (e quanto uma venda consome). Gravar exige a permissao de editar.
const vinculoBebidaSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  nome: z.string().trim().min(1).max(200),
  // null desfaz o vinculo.
  insumoId: z.string().trim().min(1).max(60).nullable(),
  // Mínimo do que a coluna Decimal(12,4) guarda: abaixo disso viraria zero.
  quantidade: z.number().finite().min(0.0001).max(100_000).default(1),
  unidade: z.enum(UNIDADES_DE_CONSUMO).default("UN")
});

agileAnaliseRouter.put("/margem-bebidas/vinculo", exigirAnaliseSalao, exigirCustos, async (request, response) => {
  const user = await getSessionUser(request);
  if (!user || !(await userHasPermission(user as SessionUser, "analise-salao", "edit"))) {
    response.status(403).json({ message: "Usuário sem permissão para editar vínculos da margem." });
    return;
  }
  const parsed = vinculoBebidaSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Vínculo inválido: informe o código e o nome da bebida, o insumo (ou null para desfazer), a quantidade (maior que zero) e a unidade (UN, ML, L, G ou KG)." });
    return;
  }
  try {
    const { codigo, nome, insumoId, quantidade, unidade } = parsed.data;
    const resultado = await vincularBebidaAoInsumo(codigo, nome, insumoId, quantidade, unidade, user.id);
    if (resultado === "insumo-invalido") {
      response.status(400).json({ message: "Insumo inválido: escolha um insumo ativo e com custo médio no estoque." });
      return;
    }
    if (resultado === "unidade-invalida") {
      response.status(400).json({ message: `Não há conversão de ${unidade} para a unidade de estoque deste insumo. Escolha outra unidade ou cadastre a conversão no produto.` });
      return;
    }
    response.json({ ok: true });
  } catch (error: unknown) {
    console.error("Falha ao salvar o vínculo bebida-insumo", error);
    response.status(500).json({ message: "Não foi possível salvar o vínculo." });
  }
});

// Custo de comida por pessoa do buffet, por mes (null apaga). Ler vem junto com /margem-buffet; gravar exige editar.
const LIMITE_DO_CUSTO_DO_BUFFET = 10_000;
const custoBuffetSchema = mesSchema.extend({ valor: z.number().finite().positive().max(LIMITE_DO_CUSTO_DO_BUFFET).nullable() });

agileAnaliseRouter.put("/margem-buffet/custo", exigirAnaliseSalao, exigirCustos, async (request, response) => {
  const user = await getSessionUser(request);
  if (!user || !(await userHasPermission(user as SessionUser, "analise-salao", "edit"))) {
    response.status(403).json({ message: "Usuário sem permissão para informar o custo do buffet." });
    return;
  }
  const parsed = custoBuffetSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: `Custo inválido: informe o mês e um valor maior que zero e até R$ ${LIMITE_DO_CUSTO_DO_BUFFET.toLocaleString("pt-BR")} por pessoa (ou null para apagar).` });
    return;
  }
  try {
    const { ano, mes, valor } = parsed.data;
    await salvarCustoBuffet(ano, mes, valor, user.id);
    response.json({ ok: true });
  } catch (error: unknown) {
    console.error("Falha ao salvar o custo do buffet", error);
    response.status(500).json({ message: "Não foi possível salvar o custo." });
  }
});
