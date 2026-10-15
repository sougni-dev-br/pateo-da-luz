import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { z } from "zod";
import { calculateDishCost } from "./dish-cost.js";
import { parseBody } from "../../shared/validate-body.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { linhasDeConversaoInformada, normalizarUnidade } from "../../shared/unidades/conversao.js";
import { carregarDetalhe, categoriaResumida, conversoesDaFicha, separarItensPorCardapio, textoDaEmbalagemInferida, toCostItem } from "./dish-detail.js";
import { carregarCustosDeReferencia, custoDaFichaPelaReferencia, type CustoDeReferencia } from "../inventory/custo-de-referencia.js";
import { anexarFichas,primeiroProblemaDeFicha, resolverFichas, sugerirFichasDeProducao } from "./dish-fichas-de-producao.js";
import { concluirFichaDoPrato } from "../waste/waste-ficha.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { MENUS, registrarRotasDeCategoria } from "./dish-categories.js";
import { registrarRevisao } from "./dish-revisions.js";
import { registrarRotasDeListagem } from "./dish-listings.js";
import { registrarRotaDeRazaoLiquida } from "./dish-net-ratios.js";

export const dishesRouter = Router();

/**
 * Texto vazio e null viram "ausente"; string aparada e numero passam; qualquer outra coisa
 * (true, [], {}) vira NaN e e recusada. z.coerce sozinho transformava "  " em 0 e true em 1.
 */
const numeroOuAusente = (valor: unknown): unknown => {
  if (valor == null) return null;
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") return valor.trim() === "" ? null : valor.trim();
  return Number.NaN;
};

const precoOpcional = z.preprocess(
  numeroOuAusente,
  z.coerce.number({ invalid_type_error: "preco de venda invalido" }).min(0, "preco de venda nao pode ser negativo").max(99_999_999, "preco de venda alto demais").nullable()
);

const rendimento = z.preprocess(
  (valor) => numeroOuAusente(valor) ?? 1,
  z.coerce.number({ invalid_type_error: "rendimento invalido" }).gt(0, "rendimento deve ser maior que zero").max(99_999, "rendimento alto demais")
);

/** Campo opcional que, ausente no corpo, NÃO mexe no valor gravado (undefined); vazio ou null limpa; senão é o número. */
const numeroOpcionalQueNaoApagaAoOmitir = (mensagem: string, maximo: number, inteiro = false) =>
  z.preprocess(
    (valor) => (valor === undefined ? undefined : numeroOuAusente(valor)),
    (inteiro ? z.coerce.number({ invalid_type_error: mensagem }).int(mensagem) : z.coerce.number({ invalid_type_error: mensagem }))
      .gt(0, mensagem)
      .max(maximo, mensagem)
      .nullable()
      .optional()
  );

const textoOpcional = z.string().trim().nullish().transform((valor) => valor || null);

const MAXIMO_DE_INGREDIENTES = 300;

const dishItemsSchema = z.array(
  z.object({
    // Ingrediente: um produto comprado OU outra ficha (de producao), nunca os dois.
    productId: z.string().trim().nullish().transform((valor) => valor || null),
    componentDishId: z.string().trim().nullish().transform((valor) => valor || null),
    quantity: z.coerce.number().positive("quantidade deve ser maior que zero"),
    unit: z.string().trim().min(1, "unidade obrigatoria"),
    wasteFactor: z.coerce.number().min(0, "perda nao pode ser negativa").max(1, "perda deve ser uma fracao entre 0 e 1").optional(),
    notes: z.string().trim().max(500, "observacao do ingrediente longa demais").nullable().optional()
  }).refine((item) => Boolean(item.productId) !== Boolean(item.componentDishId), {
    message: "cada ingrediente e um produto ou uma ficha de producao (um dos dois)"
  }),
).max(MAXIMO_DE_INGREDIENTES, `no maximo ${MAXIMO_DE_INGREDIENTES} ingredientes por ficha`);

const dishBodySchema = z.object({
  name: z.string({ required_error: "Nome do prato é obrigatório." }).trim().min(1, "Nome do prato é obrigatório."),
  code: textoOpcional,
  categoryId: textoOpcional,
  salePriceDefault: precoOpcional,
  yieldQty: rendimento,
  yieldUnit: z.string().trim().nullish().transform((valor) => valor || "UN"),
  /** Peso de cada porção, em gramas. */
  portionWeightG: numeroOpcionalQueNaoApagaAoOmitir("peso da porcao invalido (em gramas, maior que zero)", 100_000),
  /** Validade de uso do preparo, em dias. */
  shelfLifeDays: numeroOpcionalQueNaoApagaAoOmitir("validade invalida (em dias inteiros, maior que zero)", 3650, true),
  notes: textoOpcional,
  isActive: z.boolean().optional(),
  /** Ficha de producao (nao vendida, so ingrediente de outras fichas). Ausente = nao mexe no que esta gravado. */
  fichaDeProducao: z.boolean().optional(),
  menu: z.enum(MENUS).optional(),
  /** Outro cardápio onde o mesmo prato também é vendido; vazio = só no principal. */
  alsoMenu: z.enum(MENUS).nullish(),
  alsoCategoryId: textoOpcional,
  items: dishItemsSchema.optional(),
  /** Quantidades do OUTRO cardápio (o delivery) do prato vendido nos dois: a do a la carte não vale para o delivery. */
  alsoItems: dishItemsSchema.optional()
});

/** Retrato dos ingredientes de uma ficha (todos os cardápios), para saber se uma gravação mudou a receita de verdade. */
async function assinaturaDaFicha(client: Pick<typeof prisma, "dishItem">, dishId: string): Promise<string> {
  const itens = await client.dishItem.findMany({
    where: { dishId },
    select: { menu: true, productId: true, componentDishId: true, quantity: true, unit: true, wasteFactor: true }
  });
  return JSON.stringify(
    itens
      .map((item) => [item.menu, item.productId ?? "", item.componentDishId ?? "", Number(item.quantity), normalizarUnidade(item.unit), Number(item.wasteFactor)])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}

/** Problema de ficha achado na revalidação dentro da transação (o que outra gravação fez enquanto esta rodava). */
class ProblemaDeFicha extends Error {}

// Duas gravações que juntas fechariam um ciclo (A em B e B em A) passam cada uma na validação isolada: a trava as enfileira
// e a segunda revalida já vendo o que a primeira gravou.
const TRAVA_DE_FICHAS = 7311001;

async function revalidarFichasNaTransacao(
  tx: Prisma.TransactionClient,
  dishId: string | null,
  itens: Array<{ productId?: string | null; componentDishId?: string | null; unit: string }>,
  serProducao: boolean,
  mudancaDeTipo: { eraProducao: boolean; serProducao: boolean; ehDeBuffet: boolean } | null
) {
  const mudou = mudancaDeTipo != null && mudancaDeTipo.eraProducao !== mudancaDeTipo.serProducao;
  if (!mudou && !itens.some((item) => item.componentDishId)) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_DE_FICHAS})`;
  const problema = (mudou && dishId ? await impedimentoDeMudarDeTipo(tx, dishId, mudancaDeTipo.eraProducao, mudancaDeTipo.serProducao, mudancaDeTipo.ehDeBuffet) : null)
    ?? (await primeiroProblemaDeFicha(tx, dishId, itens, serProducao));
  if (problema) throw new ProblemaDeFicha(problema);
}

const ehCodigoDuplicado = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const ehRegistroInexistente = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

/** Chave estrangeira: categoria ou produto apagado depois que a tela carregou. */
const ehReferenciaInvalida = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

/**
 * Number(item.quantity) virava NaN em silencio e productId inexistente so
 * aparecia como erro de chave estrangeira depois do delete dos itens antigos.
 */
async function primeiroProdutoInvalido(items: Array<{ productId?: string | null }>) {
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return null;

  const encontrados = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const existe = new Set(encontrados.map((p) => p.id));
  const ausente = ids.find((id) => !existe.has(id));
  return ausente ? `Produto do ingrediente nao encontrado: ${ausente}` : null;
}

/**
 * O custo medio do estoque e expresso em "stockUnit" quando ele existe; caindo
 * para "unit" quando o produto ainda nao tem unidade de estoque definida.
 */
type ItemValidado = z.infer<typeof dishItemsSchema>[number];

function itemParaGravar(dishId: string, item: ItemValidado, index: number, menu: string) {
  return {
    id: crypto.randomUUID(),
    dishId,
    menu,
    productId: item.productId,
    componentDishId: item.componentDishId,
    quantity: item.quantity,
    unit: item.unit,
    wasteFactor: item.wasteFactor ?? 0,
    notes: item.notes || null,
    sortOrder: index
  };
}

dishesRouter.use(async (request, response, next) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  next();
});

// ──────────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────────

registrarRotasDeCategoria(dishesRouter);
// Lojas e preços por canal: /delivery-stores precisa vir antes de GET /:id.
registrarRotasDeListagem(dishesRouter);
// Quanto do preço de tabela da 99 chega ao caixa (para o CMV sobre o líquido); também antes de GET /:id.
registrarRotaDeRazaoLiquida(dishesRouter);

// ──────────────────────────────────────────────
// DISHES
// ──────────────────────────────────────────────

dishesRouter.get("/", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const categoryId = String(request.query.categoryId ?? "").trim() || undefined;
  const showInactive = String(request.query.showInactive ?? "") === "true";
  // Sem ?tipo a lista é só de pratos vendidos: CMV por canal, margem e cardápios não enxergam ficha de produção.
  const producao = String(request.query.tipo ?? "") === "producao";

  const dishes = await prisma.dish.findMany({
    where: {
      // Preparação de buffet criada pelo desperdício não é prato de cardápio: tem a aba própria (/buffet).
      fichaDeBuffet: false,
      fichaDeProducao: producao,
      isActive: showInactive ? undefined : true,
      ...(categoryId ? { OR: [{ categoryId }, { alsoCategoryId: categoryId }] } : {}),
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {})
    },
    include: {
      category: { include: { parent: { select: { id: true, name: true } } } },
      alsoCategory: { include: { parent: { select: { id: true, name: true } } } },
      listings: { where: { isActive: true }, select: { price: true, channel: true, deliveryStoreId: true, deliveryStore: { select: { nickname: true } } } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
              stockUnit: true,
              inventoryStock: { select: { averageCost: true } },
              conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
            }
          }
        },
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }]
  });

  // Ingrediente pode ser outra ficha (de produção): uma leitura só resolve as de todos os pratos da lista.
  const comProduto = new Map((await anexarFichas(prisma, dishes.flatMap((dish) => dish.items))).map((item) => [item.id, item]));

  const result = dishes.map((dish) => {
    const salePrice = dish.salePriceDefault ? Number(dish.salePriceDefault) : null;
    const { principais, doOutro } = separarItensPorCardapio({ menu: dish.menu, alsoMenu: dish.alsoMenu, items: dish.items.map((item) => comProduto.get(item.id)!) });
    const custo = calculateDishCost({
      yieldQty: Number(dish.yieldQty),
      salePrice,
      items: principais.map((item) => toCostItem(item))
    });
    // O outro cardápio (delivery) tem as próprias quantidades; sem elas o CMV de lá não pode sair da ficha do a la carte.
    const custoDoOutro = calculateDishCost({
      yieldQty: Number(dish.yieldQty),
      salePrice: null,
      items: doOutro.map((item) => toCostItem(item))
    });
    const cost = custo.totalCost;
    const margemBruta = custo.margemBruta;
    const cmvPercentual = custo.cmvPercentual;
    const precosNosCanais = dish.listings.map((listing) => Number(listing.price));

    return {
      id: dish.id,
      code: dish.code,
      name: dish.name,
      menu: dish.menu,
      category: categoriaResumida(dish.category),
      alsoMenu: dish.alsoMenu,
      alsoCategory: categoriaResumida(dish.alsoCategory),
      salePriceDefault: salePrice,
      yieldQty: Number(dish.yieldQty),
      yieldUnit: dish.yieldUnit,
      portionWeightG: dish.portionWeightG == null ? null : Number(dish.portionWeightG),
      shelfLifeDays: dish.shelfLifeDays,
      notes: dish.notes,
      isActive: dish.isActive,
      fichaDeProducao: dish.fichaDeProducao,
      conferidaEm: dish.fichaConferidaEm,
      itemsCount: principais.length,
      alsoItemsCount: doOutro.length,
      alsoCustoPorcao: custoDoOutro.costPerServing,
      alsoCustoIncompleto: custoDoOutro.hasUnresolvedUnit || custoDoOutro.hasMissingCost,
      listingsCount: precosNosCanais.length,
      listingPriceMin: precosNosCanais.length ? Math.min(...precosNosCanais) : null,
      listingPriceMax: precosNosCanais.length ? Math.max(...precosNosCanais) : null,
      // O preço em cada loja: a tela de CMV por canal calcula o CMV de cada prato em cada lugar.
      canais: dish.listings.map((listing) => ({
        channel: listing.channel,
        deliveryStoreId: listing.deliveryStoreId,
        storeName: listing.deliveryStore?.nickname ?? null,
        price: Number(listing.price)
      })),
      calculatedCost: cost,
      custoPorcao: custo.costPerServing,
      margemBruta,
      cmvPercentual,
      custoIncompleto: custo.hasUnresolvedUnit || custo.hasMissingCost,
      createdAt: dish.createdAt,
      updatedAt: dish.updatedAt
    };
  });

  response.json(result);
});

// Preparações do buffet criadas pelo lançamento de desperdício (o purê, uma guarnição). Ficam fora da lista de pratos
// (não são vendidas) e vêm aqui: as que aguardam ficha primeiro, com o que mais saiu na frente, para o responsável
// cobrar da equipe o que falta pelo que mais pesa; depois as que já têm ficha.
dishesRouter.get("/buffet", async (_request, response) => {
  const pratos = await prisma.dish.findMany({
    where: { fichaDeBuffet: true },
    select: { id: true, name: true, yieldUnit: true, fichaPendente: true, pendenteDesde: true, pendentePorId: true, pendenteObservacao: true, fichaConcluidaEm: true },
    orderBy: { name: "asc" }
  });
  const ids = pratos.map((p) => p.id);
  const idsDePessoas = [...new Set(pratos.map((p) => p.pendentePorId).filter((id): id is string => Boolean(id)))];
  const [perdas, pessoas] = await Promise.all([
    ids.length
      ? prisma.wasteEntry.groupBy({ by: ["dishId"], where: { dishId: { in: ids }, cancelledAt: null }, _count: { _all: true }, _sum: { quantity: true }, _max: { occurredOn: true } })
      : Promise.resolve([]),
    idsDePessoas.length ? prisma.user.findMany({ where: { id: { in: idsDePessoas } }, select: { id: true, name: true } }) : Promise.resolve([])
  ]);
  const perdaDe = new Map(perdas.map((g) => [g.dishId, g]));
  const nomeDe = new Map(pessoas.map((u) => [u.id, u.name]));
  const lista = pratos.map((p) => {
    const g = perdaDe.get(p.id);
    return {
      id: p.id,
      name: p.name,
      unit: p.yieldUnit,
      pending: p.fichaPendente,
      pendingSince: p.pendenteDesde,
      completedAt: p.fichaConcluidaEm,
      requestedBy: p.pendentePorId ? nomeDe.get(p.pendentePorId) ?? null : null,
      notes: p.pendenteObservacao,
      wasteEntries: g?._count._all ?? 0,
      wasteQuantity: g?._sum.quantity == null ? 0 : Number(g._sum.quantity),
      lastWasteOn: g?._max.occurredOn ?? null
    };
  });
  lista.sort((a, b) => Number(b.pending) - Number(a.pending) || b.wasteEntries - a.wasteEntries || a.name.localeCompare(b.name, "pt-BR"));
  response.json(lista);
});

// Fichas que podem entrar como ingrediente de outra (ficha dentro de ficha). Voltam no formato da busca de produtos, para a
// tela tratar as duas coisas igual: a unidade é a de rendimento da ficha e o "custo" é o de uma unidade de rendimento.
dishesRouter.get("/fichas/search", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const excluir = String(request.query.exclude ?? "").trim();
  const fichas = await prisma.dish.findMany({
    where: {
      fichaDeProducao: true,
      fichaDeBuffet: false,
      isActive: true,
      items: { some: {} },
      ...(excluir ? { id: { not: excluir } } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {})
    },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 12
  });
  const resolvidas = await resolverFichas(prisma, fichas.map((f) => f.id));
  response.json(fichas.map(({ id }) => {
    const ficha = resolvidas.get(id)!;
    return {
      id: ficha.id,
      externalCode: ficha.code,
      name: ficha.name,
      unit: ficha.yieldUnit,
      averageCost: ficha.custoPorUnidade ?? 0,
      conversions: [],
      embalagemInferida: null,
      kind: "FICHA" as const,
      incompleta: ficha.incompleta,
      motivo: ficha.motivo
    };
  }));
});

// A cozinha conferiu a ficha (ingredientes e quantidades batem com o que se faz de verdade). Todas começam sem conferir; mudar a
// receita volta a deixá-la sem conferir.
dishesRouter.post("/:id/conferir", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const id = request.params.id;
  const prato = await prisma.dish.findUnique({ where: { id }, select: { id: true } });
  if (!prato) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }
  if ((await prisma.dishItem.count({ where: { dishId: id } })) === 0) {
    response.status(400).json({ message: "A ficha ainda não tem ingredientes: preencha antes de marcar como conferida." });
    return;
  }
  const agora = new Date();
  await prisma.dish.update({ where: { id: id }, data: { fichaConferidaEm: agora, fichaConferidaPorId: user.id } });
  await auditLog({ userId: user.id, action: "UPDATE", entity: "Dish", entityId: id, newValue: { fichaConferidaEm: agora } });
  response.json({ ok: true, conferidaEm: agora });
});

dishesRouter.delete("/:id/conferir", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    await prisma.dish.update({ where: { id: request.params.id }, data: { fichaConferidaEm: null, fichaConferidaPorId: null } });
  } catch (error) {
    if (responderErroDeGravacao(error, null, response)) return;
    throw error;
  }
  await auditLog({ userId: user.id, action: "UPDATE", entity: "Dish", entityId: request.params.id, newValue: { fichaConferidaEm: null } });
  response.json({ ok: true });
});

dishesRouter.get("/:id", async (request, response) => {
  const detalhe = await carregarDetalhe(prisma, request.params.id);
  if (!detalhe) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }
  const conferidor = detalhe.conferidaPorId ? await prisma.user.findUnique({ where: { id: detalhe.conferidaPorId }, select: { name: true } }) : null;
  const comConferencia = { ...detalhe, conferidaPor: conferidor?.name ?? null };
  // Ficha de produção: quem a usa como ingrediente. Mudar o rendimento dela muda o custo de todos eles.
  if (detalhe.fichaDeProducao) {
    const usos = await prisma.dishItem.findMany({ where: { componentDishId: detalhe.id }, select: { dish: { select: { id: true, name: true } } } });
    const unicos = new Map(usos.map((uso) => [uso.dish.id, uso.dish.name]));
    response.json({ ...comConferencia, usadaEm: [...unicos].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) });
    return;
  }
  response.json(comConferencia);
});

/**
 * Erro de negocio conhecido (codigo repetido, prato inexistente) vira resposta
 * legivel; o resto continua sendo 500 para nao esconder falha de verdade.
 */
function responderErroDeGravacao(error: unknown, codigo: string | null, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (error instanceof ProblemaDeFicha) {
    response.status(400).json({ message: error.message });
    return true;
  }
  if (ehCodigoDuplicado(error)) {
    response.status(409).json({ message: `Já existe um prato com o código "${codigo ?? ""}".` });
    return true;
  }
  if (ehRegistroInexistente(error)) {
    response.status(404).json({ message: "Prato não encontrado." });
    return true;
  }
  if (ehReferenciaInvalida(error)) {
    response.status(400).json({ message: "A categoria ou um dos produtos da ficha não existe mais. Recarregue a tela e tente de novo." });
    return true;
  }
  return false;
}

/**
 * A categoria precisa existir e ser do mesmo cardápio do prato: salão e delivery são cardápios
 * separados, e uma categoria "Pizzas" do delivery não pode abrigar prato do salão.
 */
async function categoriaIncompativel(client: Pick<typeof prisma, "dishCategory">, categoryId: string | null, menu: string): Promise<string | null> {
  if (!categoryId) return null;
  const categoria = await client.dishCategory.findUnique({ where: { id: categoryId }, select: { name: true, menu: true } });
  if (!categoria) return "A categoria escolhida não existe mais.";
  if (categoria.menu !== menu) {
    return `A categoria "${categoria.name}" é do ${categoria.menu === "DELIVERY" ? "delivery" : "cardápio do salão"}, e o prato é do ${menu === "DELIVERY" ? "delivery" : "cardápio do salão"}.`;
  }
  return null;
}

/**
 * Prato nos dois cardápios: o segundo tem que ser o OUTRO cardápio, e a categoria dele, do mesmo cardápio.
 * Sem segundo cardápio não há segunda categoria (nada fica pendurado).
 */
async function validarSegundoCardapio(
  client: Pick<typeof prisma, "dishCategory">,
  menu: string,
  alsoMenu: string | null,
  alsoCategoryId: string | null
): Promise<{ erro: string } | { alsoMenu: string | null; alsoCategoryId: string | null }> {
  if (!alsoMenu) return { alsoMenu: null, alsoCategoryId: null };
  if (alsoMenu === menu) return { erro: "O prato já é deste cardápio: escolha o outro para vendê-lo nos dois." };
  const ruim = await categoriaIncompativel(client, alsoCategoryId, alsoMenu);
  return ruim ? { erro: ruim } : { alsoMenu, alsoCategoryId };
}

/**
 * Prato vendido nos dois cardápios: o salão é o principal e o delivery tem as próprias quantidades, que são obrigatórias —
 * as da ficha do a la carte não valem para ele. Devolve a mensagem de erro, ou null quando está tudo certo.
 */
function exigirQuantidadesDoOutro(menu: string, alsoMenu: string, quantidadesDoOutro: number): string | null {
  if (menu !== "CARDAPIO") return "O prato vendido nos dois cardápios tem o cardápio do salão como principal.";
  if (quantidadesDoOutro === 0) {
    return `Informe as quantidades do ${alsoMenu === "DELIVERY" ? "delivery" : "salão"}: as do a la carte não valem para ele.`;
  }
  return null;
}

/** A ficha de um prato que muda de cardápio principal vai junto; se o cardápio de destino já tem ficha, ela é a que vale. */
async function moverFichaParaOCardapio(tx: Pick<typeof prisma, "dishItem">, dishId: string, de: string, para: string) {
  if (de === para) return;
  const jaTem = await tx.dishItem.count({ where: { dishId, menu: para } });
  if (jaTem === 0) await tx.dishItem.updateMany({ where: { dishId, menu: de }, data: { menu: para } });
}

/**
 * Trocar o tipo da ficha só vale quando nada depende dele: a ficha de produção que já é ingrediente de outras não vira prato
 * vendido (elas ficariam apontando para um prato), e o prato com preço nos canais não vira ficha de produção (o preço sumiria).
 */
async function impedimentoDeMudarDeTipo(client: Pick<typeof prisma, "dishItem" | "dishListing" | "agileProdutoPrato">, dishId: string, eraProducao: boolean, serProducao: boolean, ehDeBuffet = false): Promise<string | null> {
  if (eraProducao === serProducao) return null;
  if (serProducao && ehDeBuffet) return "Preparação do buffet criada pelo desperdício não vira ficha de produção: ela já tem a aba própria.";
  if (eraProducao) {
    const usos = await client.dishItem.count({ where: { componentDishId: dishId } });
    return usos > 0 ? `Esta ficha de produção é ingrediente de ${usos} ${usos === 1 ? "item de outra ficha" : "itens de outras fichas"}: tire-a de lá antes de torná-la um prato vendido.` : null;
  }
  const [precos, vinculos] = await Promise.all([
    client.dishListing.count({ where: { dishId } }),
    client.agileProdutoPrato.count({ where: { dishId } })
  ]);
  if (precos > 0) return "Este prato tem preço nos canais de venda: tire os preços antes de torná-lo uma ficha de produção.";
  if (vinculos > 0) return "Este prato está ligado a um produto do PDV: desfaça a ligação antes de torná-lo uma ficha de produção.";
  return null;
}

// Os ingredientes do prato que são uma ficha de produção copiada na mão (a massa do nhoque dividida por 12): a tela oferece
// trocá-los pela ficha. Só sugere; quem decide e grava é quem edita a ficha.
dishesRouter.get("/:id/sugestoes-de-ficha", async (request, response) => {
  const prato = await prisma.dish.findUnique({ where: { id: request.params.id }, select: { id: true, menu: true, items: { select: { id: true, menu: true, productId: true, componentDishId: true, quantity: true, unit: true } } } });
  if (!prato) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }
  const itens = prato.items.filter((item) => item.menu === prato.menu).map((item) => ({ id: item.id, productId: item.productId, componentDishId: item.componentDishId, quantity: Number(item.quantity), unit: item.unit }));

  // Só serve de candidata a ficha cujos ingredientes são todos produtos que o prato também usa: o banco já descarta o resto.
  const produtosDoPrato = [...new Set(itens.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (produtosDoPrato.length === 0) {
    response.json([]);
    return;
  }
  const outras = await prisma.dish.findMany({
    where: { id: { not: prato.id }, fichaDeProducao: true, isActive: true, items: { some: {}, every: { productId: { in: produtosDoPrato } } } },
    take: 200,
    select: { id: true, name: true, menu: true, yieldQty: true, yieldUnit: true, items: { select: { menu: true, productId: true, quantity: true, unit: true } } }
  });
  const candidatas = outras
    .map((ficha) => ({
      id: ficha.id,
      name: ficha.name,
      yieldQty: Number(ficha.yieldQty),
      yieldUnit: ficha.yieldUnit,
      items: ficha.items.filter((item) => item.menu === ficha.menu).map((item) => ({ productId: item.productId, quantity: Number(item.quantity), unit: item.unit }))
    }))
    // Ficha que já usa outra ficha não entra: a comparação é de produto com produto.
    .filter((ficha) => ficha.items.every((item) => item.productId));
  const sugestoes = sugerirFichasDeProducao({ id: prato.id, items: itens }, candidatas);
  // O custo da ficha de baixo vai junto: a tela prevê o custo da linha nova antes de a pessoa aceitar a troca.
  const fichas = sugestoes.length > 0 ? await resolverFichas(prisma, sugestoes.map((sugestao) => sugestao.componentDishId)) : new Map();
  response.json(sugestoes.map((sugestao) => {
    const ficha = fichas.get(sugestao.componentDishId);
    return { ...sugestao, unitCost: ficha?.custoPorUnidade ?? 0, incompleta: ficha?.incompleta ?? true, motivo: ficha?.motivo ?? null };
  }));
});

dishesRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  // Tudo e validado antes de gravar: antes, o prato era criado e so depois os
  // ingredientes eram conferidos, deixando um prato vazio quando algum falhava.
  const body = parseBody(dishBodySchema, request.body, response);
  if (!body) return;

  const items = body.items ?? [];
  const invalido = (await primeiroProdutoInvalido(items)) ?? (await primeiroProblemaDeFicha(prisma, null, [...items, ...(body.alsoItems ?? [])]));
  if (invalido) {
    response.status(400).json({ message: invalido });
    return;
  }

  // Ficha de produção não é vendida: sem preço, categoria nem segundo cardápio, mesmo que a tela mande.
  const producao = body.fichaDeProducao === true;
  const menu = body.menu ?? "CARDAPIO";
  const categoryId = producao ? null : body.categoryId;
  const categoriaRuim = await categoriaIncompativel(prisma, categoryId, menu);
  if (categoriaRuim) {
    response.status(400).json({ message: categoriaRuim });
    return;
  }

  const segundo = await validarSegundoCardapio(prisma, menu, producao ? null : body.alsoMenu ?? null, producao ? null : body.alsoCategoryId);
  if ("erro" in segundo) {
    response.status(400).json({ message: segundo.erro });
    return;
  }

  // Vendido nos dois: as quantidades do delivery são obrigatórias (as do a la carte não valem para ele).
  const alsoItems = producao ? [] : body.alsoItems ?? [];
  const exigencia = segundo.alsoMenu ? exigirQuantidadesDoOutro(menu, segundo.alsoMenu, alsoItems.length) : null;
  if (exigencia) {
    response.status(400).json({ message: exigencia });
    return;
  }
  const invalidoNoOutro = await primeiroProdutoInvalido(alsoItems);
  if (invalidoNoOutro) {
    response.status(400).json({ message: invalidoNoOutro });
    return;
  }

  const id = crypto.randomUUID();
  try {
    const dish = await prisma.$transaction(async (tx) => {
      await revalidarFichasNaTransacao(tx, null, [...items, ...alsoItems], producao, null);
      const created = await tx.dish.create({
        data: {
          id,
          name: body.name,
          code: body.code,
          menu,
          alsoMenu: segundo.alsoMenu,
          alsoCategoryId: segundo.alsoCategoryId,
          categoryId,
          salePriceDefault: producao ? null : body.salePriceDefault,
          fichaDeProducao: producao,
          yieldQty: body.yieldQty,
          yieldUnit: body.yieldUnit,
          portionWeightG: body.portionWeightG ?? null,
          shelfLifeDays: body.shelfLifeDays ?? null,
          notes: body.notes
        }
      });

      const paraGravar = [
        ...items.map((item, index) => itemParaGravar(id, item, index, menu)),
        ...(segundo.alsoMenu ? alsoItems.map((item, index) => itemParaGravar(id, item, index, segundo.alsoMenu as string)) : [])
      ];
      if (paraGravar.length > 0) {
        await tx.dishItem.createMany({ data: paraGravar });
      }

      // Cada gravacao deixa uma versao no historico, na mesma transacao: ficha e historico nunca divergem.
      const detalhe = await carregarDetalhe(tx, id);
      if (detalhe) await registrarRevisao(tx, { detalhe, action: "CRIADA", user });
      return created;
    });

    await auditLog({ userId: user.id, action: "CREATE", entity: "Dish", entityId: dish.id, newValue: dish });
    response.json({ id: dish.id });
  } catch (error) {
    if (!responderErroDeGravacao(error, body.code, response)) throw error;
  }
});

dishesRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const body = parseBody(dishBodySchema, request.body, response);
  if (!body) return;

  const itensEnviados = [...(body.items ?? []), ...(body.alsoItems ?? [])];
  const invalido = body.items || body.alsoItems
    ? (await primeiroProdutoInvalido(itensEnviados)) ?? (await primeiroProblemaDeFicha(prisma, request.params.id, itensEnviados))
    : null;
  if (invalido) {
    response.status(400).json({ message: invalido });
    return;
  }

  const id = request.params.id;
  const atual = await prisma.dish.findUnique({ where: { id }, select: { menu: true, alsoMenu: true, alsoCategoryId: true, fichaDeProducao: true, fichaDeBuffet: true, yieldUnit: true, yieldQty: true } });
  if (!atual) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }
  // Quem não envia o tipo (tela antiga em cache) não muda o que está gravado.
  const producao = body.fichaDeProducao ?? atual.fichaDeProducao;
  // A unidade de rendimento é a unidade em que os pratos usam a ficha: trocá-la deixaria todos sem conversão.
  if (atual.fichaDeProducao && normalizarUnidade(body.yieldUnit) !== normalizarUnidade(atual.yieldUnit)) {
    const usos = await prisma.dishItem.count({ where: { componentDishId: id } });
    if (usos > 0) {
      response.status(400).json({ message: `Esta ficha de produção é ingrediente de ${usos} ${usos === 1 ? "item de outra ficha" : "itens de outras fichas"}, em ${normalizarUnidade(atual.yieldUnit)}: não dá para trocar a unidade de rendimento. Tire-a de lá antes.` });
      return;
    }
  }
  const mudancaDeTipo = await impedimentoDeMudarDeTipo(prisma, id, atual.fichaDeProducao, producao, atual.fichaDeBuffet);
  if (mudancaDeTipo) {
    response.status(400).json({ message: mudancaDeTipo });
    return;
  }
  const invalidoNoOutro = body.alsoItems ? await primeiroProdutoInvalido(body.alsoItems) : null;
  if (invalidoNoOutro) {
    response.status(400).json({ message: invalidoNoOutro });
    return;
  }
  const menu = body.menu ?? atual.menu;
  const categoryId = producao ? null : body.categoryId;
  const categoriaRuim = await categoriaIncompativel(prisma, categoryId, menu);
  if (categoriaRuim) {
    response.status(400).json({ message: categoriaRuim });
    return;
  }
  // Quem não envia "alsoMenu" (tela antiga em cache, outra integração) não quer mexer nele: o segundo cardápio fica como está.
  // Só o null explícito o remove. Se o principal passou a ser o cardápio do segundo, o segundo deixa de existir.
  const omitido = body.alsoMenu === undefined;
  const alsoMenuPedido = producao ? null : omitido ? (atual.alsoMenu && atual.alsoMenu !== menu ? atual.alsoMenu : null) : (body.alsoMenu ?? null);
  const alsoCategoriaPedida = producao ? null : omitido && body.alsoCategoryId == null ? atual.alsoCategoryId : (body.alsoCategoryId ?? null);
  const segundo = await validarSegundoCardapio(prisma, menu, alsoMenuPedido, alsoCategoriaPedida);
  if ("erro" in segundo) {
    response.status(400).json({ message: segundo.erro });
    return;
  }

  // Vendido nos dois: as quantidades do delivery são obrigatórias, enviadas agora ou já gravadas.
  if (segundo.alsoMenu) {
    const jaGravadas = body.alsoItems ? body.alsoItems.length : await prisma.dishItem.count({ where: { dishId: id, menu: segundo.alsoMenu } });
    const exigencia = exigirQuantidadesDoOutro(menu, segundo.alsoMenu, jaGravadas);
    if (exigencia) {
      response.status(400).json({ message: exigencia });
      return;
    }
  }

  try {
    // Prato, ingredientes e versao do historico na mesma transacao: o delete seguido de create sem
    // transacao deixava a ficha permanentemente sem ingredientes se o create falhasse no meio.
    const dish = await prisma.$transaction(async (tx) => {
      await revalidarFichasNaTransacao(tx, id, itensEnviados, producao, { eraProducao: atual.fichaDeProducao, serProducao: producao, ehDeBuffet: atual.fichaDeBuffet });
      const assinaturaAntes = await assinaturaDaFicha(tx, id);
      const atualizado = await tx.dish.update({
        where: { id },
        data: {
          name: body.name,
          code: body.code,
          menu,
          alsoMenu: segundo.alsoMenu,
          alsoCategoryId: segundo.alsoCategoryId,
          categoryId,
          salePriceDefault: producao ? null : body.salePriceDefault,
          fichaDeProducao: producao,
          yieldQty: body.yieldQty,
          yieldUnit: body.yieldUnit,
          portionWeightG: body.portionWeightG,
          shelfLifeDays: body.shelfLifeDays,
          notes: body.notes,
          isActive: body.isActive !== false
        }
      });

      // Mudou o cardápio principal sem mandar a lista nova: a ficha acompanha o prato (só se o novo cardápio ainda não tem ficha).
      if (!body.items && menu !== atual.menu) await moverFichaParaOCardapio(tx, id, atual.menu, menu);

      // Cada cardápio tem a sua lista: regrava só a que veio. As quantidades do outro cardápio ficam guardadas
      // mesmo que o prato deixe de ser vendido lá (voltam se ele voltar), mas só contam enquanto o segundo cardápio existe.
      if (body.items) {
        await tx.dishItem.deleteMany({ where: { dishId: id, menu } });
        if (body.items.length > 0) {
          await tx.dishItem.createMany({ data: body.items.map((item, index) => itemParaGravar(id, item, index, menu)) });
        }
      }
      if (body.alsoItems && segundo.alsoMenu) {
        await tx.dishItem.deleteMany({ where: { dishId: id, menu: segundo.alsoMenu } });
        if (body.alsoItems.length > 0) {
          await tx.dishItem.createMany({ data: body.alsoItems.map((item, index) => itemParaGravar(id, item, index, segundo.alsoMenu as string)) });
        }
      }

      // Mudou a receita (ingredientes, quantidades, perda) ou o rendimento: a conferência da cozinha não vale mais para o que está gravado.
      const mudouRendimento = Number(atual.yieldQty) !== body.yieldQty || normalizarUnidade(atual.yieldUnit) !== normalizarUnidade(body.yieldUnit);
      if (mudouRendimento || (await assinaturaDaFicha(tx, id)) !== assinaturaAntes) {
        await tx.dish.update({ where: { id }, data: { fichaConferidaEm: null, fichaConferidaPorId: null } });
      }

      const detalhe = await carregarDetalhe(tx, id);
      if (detalhe) await registrarRevisao(tx, { detalhe, action: "ALTERADA", user });
      return atualizado;
    });

    await auditLog({ userId: user.id, action: "UPDATE", entity: "Dish", entityId: dish.id, newValue: dish });
    // Ficha completa: o desperdício lançado sem valor passa a valer e, se aguardava a ficha, a pendência sai. A ficha já está
    // gravada; se isto falhar, vai para o log e o próximo salvamento tenta de novo.
    const desperdicio = await concluirFichaDoPrato(prisma, dish.id).catch((falha) => {
      console.error("[fichas] conclusão da ficha para o desperdício falhou:", falha instanceof Error ? falha.message : falha);
      return null;
    });
    response.json({ id: dish.id, ...(desperdicio?.completa ? { desperdicio } : {}) });
  } catch (error) {
    if (!responderErroDeGravacao(error, body.code, response)) throw error;
  }
});

const loteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, "escolha ao menos um prato").max(500, "no máximo 500 pratos por vez"),
  menu: z.enum(MENUS).optional(),
  /** null tira da categoria; ausente deixa como está. */
  categoryId: z.string().trim().min(1).nullable().optional(),
  /** Também vender no outro cardápio: o cardápio escolhido vira o segundo de cada prato; null tira do segundo cardápio. */
  alsoMenu: z.enum(MENUS).nullable().optional(),
  /** Categoria no segundo cardápio (precisa ser dele); null limpa. */
  alsoCategoryId: z.string().trim().min(1).nullable().optional()
});

/**
 * Organiza vários pratos de uma vez — o jeito de arrumar os ~200 importados da 99, que chegaram sem
 * categoria: escolhe os pratos, escolhe o cardápio e/ou a categoria. Não mexe em ingrediente nem preço,
 * por isso não gera versão no histórico (fica na auditoria).
 */
dishesRouter.post("/bulk", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const body = parseBody(loteSchema, request.body, response);
  if (!body) return;
  if (body.menu === undefined && body.categoryId === undefined && body.alsoMenu === undefined && body.alsoCategoryId === undefined) {
    response.status(400).json({ message: "Escolha o cardápio, a categoria ou onde mais vender para aplicar." });
    return;
  }
  if (body.alsoCategoryId && !body.alsoMenu) {
    response.status(400).json({ message: "Escolha o outro cardápio para usar a categoria dele." });
    return;
  }

  const ids = [...new Set(body.ids)];
  const pratos = await prisma.dish.findMany({ where: { id: { in: ids } }, select: { id: true, menu: true, categoryId: true, alsoMenu: true, alsoCategoryId: true, fichaDeProducao: true } });
  if (pratos.length !== ids.length) {
    response.status(404).json({ message: "Algum prato escolhido não existe mais. Atualize a lista." });
    return;
  }

  if (pratos.some((prato) => prato.fichaDeProducao)) {
    response.status(400).json({ message: "Ficha de produção não tem cardápio nem categoria: tire-a da seleção." });
    return;
  }

  const categoria = body.categoryId
    ? await prisma.dishCategory.findUnique({ where: { id: body.categoryId }, select: { id: true, menu: true, name: true } })
    : null;
  if (body.categoryId && !categoria) {
    response.status(400).json({ message: "A categoria escolhida não existe mais." });
    return;
  }

  // Cardápio final de cada prato; a categoria nova só vale para quem termina no mesmo cardápio dela.
  if (categoria) {
    const incompativeis = pratos.filter((prato) => (body.menu ?? prato.menu) !== categoria.menu).length;
    if (incompativeis > 0) {
      response.status(400).json({
        message: `${incompativeis} prato${incompativeis === 1 ? "" : "s"} não ${incompativeis === 1 ? "é" : "são"} do cardápio da categoria "${categoria.name}". Escolha também o cardápio ou separe a seleção.`
      });
      return;
    }
  }

  // A categoria do segundo cardápio tem que ser daquele cardápio.
  if (body.alsoMenu && body.alsoCategoryId) {
    const ruim = await categoriaIncompativel(prisma, body.alsoCategoryId, body.alsoMenu);
    if (ruim) {
      response.status(400).json({ message: ruim });
      return;
    }
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const dados: { menu?: string; categoryId?: string | null } = {};
    if (body.menu !== undefined) dados.menu = body.menu;
    if (body.categoryId !== undefined) dados.categoryId = body.categoryId;
    const atualizados = Object.keys(dados).length > 0
      ? await tx.dish.updateMany({ where: { id: { in: ids } }, data: dados })
      : { count: ids.length };

    // O prato que passa a ser principal no cardápio em que já era vendido "também" deixa de ter segundo cardápio.
    if (body.menu !== undefined) {
      for (const prato of pratos) {
        // Se o cardápio antigo continua como segundo, a ficha dele é a do segundo cardápio e fica onde está.
        if (prato.menu !== body.menu && body.alsoMenu !== prato.menu) await moverFichaParaOCardapio(tx, prato.id, prato.menu, body.menu);
      }
      await tx.dish.updateMany({ where: { id: { in: ids }, alsoMenu: body.menu }, data: { alsoMenu: null, alsoCategoryId: null } });
    }

    // Mudou o cardápio sem escolher categoria: quem tinha categoria do outro cardápio fica sem ela.
    let categoriasLimpas = 0;
    if (body.menu !== undefined && body.categoryId === undefined) {
      const limpas = await tx.dish.updateMany({
        where: { id: { in: ids }, category: { is: { menu: { not: body.menu } } } },
        data: { categoryId: null }
      });
      categoriasLimpas = limpas.count;
    }

    // Também vender no outro cardápio. O prato que já é principal naquele cardápio não tem "outro": fica de fora e é contado.
    // O prato vendido nos dois tem sempre o salão como principal e o delivery como segundo cardápio.
    let nosDois = 0;
    let jaNoCardapio = 0;
    let semQuantidadesNoDelivery = 0;
    if (body.alsoMenu === null) {
      await tx.dish.updateMany({ where: { id: { in: ids } }, data: { alsoMenu: null, alsoCategoryId: null } });
    } else if (body.alsoMenu) {
      const alvo = body.alsoMenu;
      const finalDe = (prato: (typeof pratos)[number]) => body.menu ?? prato.menu;
      const elegiveis = pratos.filter((prato) => finalDe(prato) !== alvo);
      nosDois = elegiveis.length;
      jaNoCardapio = ids.length - elegiveis.length;

      for (const prato of elegiveis) {
        if (alvo === "DELIVERY") {
          // Principal salão, segundo delivery: a categoria do segundo só vale se for do delivery.
          const categoriaDoSegundo = body.alsoCategoryId !== undefined ? body.alsoCategoryId : prato.alsoMenu === "DELIVERY" ? prato.alsoCategoryId : null;
          await tx.dish.update({ where: { id: prato.id }, data: { alsoMenu: "DELIVERY", alsoCategoryId: categoriaDoSegundo } });
        } else {
          // Prato do delivery que também sai no salão: o salão vira o principal e o delivery (com a categoria e as quantidades
          // que ele já tinha) vira o segundo cardápio. A categoria escolhida é a do salão.
          const categoriaDoSalao = body.alsoCategoryId !== undefined ? body.alsoCategoryId : null;
          await tx.dish.update({
            where: { id: prato.id },
            data: { menu: "CARDAPIO", categoryId: categoriaDoSalao, alsoMenu: "DELIVERY", alsoCategoryId: prato.menu === "DELIVERY" ? prato.categoryId : null }
          });
        }
      }

      // As quantidades do a la carte não valem para o delivery: quem ainda não tem as do delivery precisa informá-las.
      if (elegiveis.length > 0) {
        const comQuantidades = await tx.dishItem.groupBy({ by: ["dishId"], where: { dishId: { in: elegiveis.map((prato) => prato.id) }, menu: "DELIVERY" } });
        semQuantidadesNoDelivery = elegiveis.length - comQuantidades.length;
      }
    }

    return { atualizados: atualizados.count, categoriasLimpas, nosDois, jaNoCardapio, semQuantidadesNoDelivery };
  });

  await auditLog({ userId: user.id, action: "BULK_UPDATE", entity: "Dish", newValue: { ids: ids.length, menu: body.menu, categoryId: body.categoryId, alsoMenu: body.alsoMenu, alsoCategoryId: body.alsoCategoryId } });
  response.json(resultado);
});

/** Versões da ficha, da mais nova para a mais antiga. */
dishesRouter.get("/:id/revisions", async (request, response) => {
  const existe = await prisma.dish.findUnique({ where: { id: request.params.id }, select: { id: true } });
  if (!existe) {
    response.status(404).json({ message: "Prato não encontrado." });
    return;
  }
  const rows = await prisma.dishRevision.findMany({
    where: { dishId: request.params.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  response.json(rows.map((row) => ({
    id: row.id,
    action: row.action,
    userName: row.userName,
    createdAt: row.createdAt,
    costPerServing: row.costPerServing == null ? null : Number(row.costPerServing),
    salePrice: row.salePrice == null ? null : Number(row.salePrice),
    cmvPercent: row.cmvPercent == null ? null : Number(row.cmvPercent),
    snapshot: row.snapshot
  })));
});

// Product search with average cost (for ingredient picker)
dishesRouter.get("/products/search", async (request, response) => {
  const search = String(request.query.search ?? "").trim();
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      // A tela promete "nome ou código": a busca antes olhava só o nome.
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { externalCode: { contains: search, mode: "insensitive" } }] } : {})
    },
    select: {
      id: true,
      externalCode: true,
      name: true,
      unit: true,
      stockUnit: true,
      inventoryStock: { select: { averageCost: true } },
      conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
    },
    orderBy: { name: "asc" },
    take: 20
  });

  // stockUnit e conversions vao junto para a tela conseguir prever o custo do
  // ingrediente antes de salvar. O calculo que vale continua sendo o do
  // backend, em dish-cost.ts.
  const referencia = custoDaFichaPelaReferencia() ? await carregarCustosDeReferencia(products.map((p) => p.id)) : new Map<string, CustoDeReferencia>();
  response.json(products.map((p) => ({
    id: p.id,
    externalCode: p.externalCode,
    name: p.name,
    unit: p.stockUnit || p.unit,
    averageCost: referencia.get(p.id)?.valor ?? Number(p.inventoryStock?.averageCost ?? 0),
    conversions: conversoesDaFicha(p),
    embalagemInferida: textoDaEmbalagemInferida(p)
  })));
});

const conversaoInformadaSchema = z.object({
  unit: z.string().trim().min(1, "informe a unidade"),
  amount: z.coerce.number({ invalid_type_error: "informe quanto vale" }).positive("a quantidade deve ser maior que zero").max(1_000_000, "quantidade alta demais"),
  /** Confirmacao de quem viu o aviso de que ja existe conversao cadastrada. */
  replace: z.boolean().optional()
});

/** Diferenca relativa abaixo disto e arredondamento, nao conversao diferente. */
const TOLERANCIA_DA_CONVERSAO = 0.005;

/**
 * "1 UN = 1.200 G": quem monta a ficha informa como o produto e de fato, ali mesmo, sem sair da
 * tela. Vira conversao do produto — vale para as outras fichas e tambem para a conversao de compras
 * e contagem do estoque, que le a mesma tabela — e passa a ter prioridade sobre a leitura do nome.
 *
 * Se o produto ja tem conversao cadastrada na mesma grandeza e o valor novo diverge, responde 409
 * em vez de sobrescrever em silencio; so troca com `replace: true`. Ao gravar, remove as linhas
 * antigas da grandeza (inclusive grafias como GR/UND), para nao sobrar duplicata que o calculo
 * leria no lugar da nova.
 */
dishesRouter.post("/products/:productId/conversions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const body = parseBody(conversaoInformadaSchema, request.body, response);
  if (!body) return;

  const produto = await prisma.product.findUnique({
    where: { id: request.params.productId },
    select: { id: true, name: true, unit: true, stockUnit: true }
  });
  if (!produto) {
    response.status(404).json({ message: "Produto não encontrado." });
    return;
  }

  const base = normalizarUnidade(produto.stockUnit || produto.unit);
  const linhas = linhasDeConversaoInformada(base, body.unit, body.amount);
  if (!linhas) {
    response.status(400).json({
      message: "Informe g, kg, ml ou l (de outra grandeza que a unidade do produto) e uma quantidade que caiba no cadastro."
    });
    return;
  }

  const medidas = new Set(linhas.map((linha) => linha.toUnit));
  const existentes = await prisma.productUnitConversion.findMany({
    where: { productId: produto.id },
    select: { id: true, fromUnit: true, toUnit: true, factor: true, isActive: true }
  });
  const daGrandeza = existentes.filter((linha) => {
    const de = normalizarUnidade(linha.fromUnit);
    const para = normalizarUnidade(linha.toUnit);
    return (de === base && medidas.has(para)) || (para === base && medidas.has(de));
  });

  const divergentes = daGrandeza.filter((linha) => {
    if (!linha.isActive) return false;
    const fator = Number(linha.factor);
    const emMedida = normalizarUnidade(linha.fromUnit) === base ? fator : 1 / fator;
    const medida = normalizarUnidade(linha.fromUnit) === base ? normalizarUnidade(linha.toUnit) : normalizarUnidade(linha.fromUnit);
    const esperado = linhas.find((l) => l.toUnit === medida)?.factor;
    return esperado != null && Math.abs(emMedida - esperado) / esperado > TOLERANCIA_DA_CONVERSAO;
  });
  if (divergentes.length > 0 && !body.replace) {
    const atual = divergentes
      .map((linha) => `1 ${normalizarUnidade(linha.fromUnit)} = ${Number(linha.factor).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${normalizarUnidade(linha.toUnit)}`)
      .join("; ");
    response.status(409).json({
      message: `Este produto já tem conversão cadastrada (${atual}). Trocar muda também como as compras e a contagem do estoque convertem. Confirme para substituir.`
    });
    return;
  }

  await prisma.$transaction([
    prisma.productUnitConversion.deleteMany({ where: { id: { in: daGrandeza.map((linha) => linha.id) } } }),
    prisma.productUnitConversion.createMany({
      data: linhas.map((linha) => ({
        id: crypto.randomUUID(),
        productId: produto.id,
        fromUnit: linha.fromUnit,
        toUnit: linha.toUnit,
        factor: linha.factor,
        notes: "Informada na ficha técnica"
      }))
    })
  ]);

  const cadastradas = await prisma.productUnitConversion.findMany({
    where: { productId: produto.id, isActive: true },
    select: { fromUnit: true, toUnit: true, factor: true }
  });
  const completo = { ...produto, conversions: cadastradas };

  await auditLog({
    userId: user.id,
    action: "UPSERT_CONVERSION",
    entity: "Product",
    entityId: produto.id,
    previousValue: daGrandeza.length > 0 ? daGrandeza : undefined,
    newValue: { unit: body.unit, amount: body.amount }
  });
  response.json({ conversions: conversoesDaFicha(completo), embalagemInferida: textoDaEmbalagemInferida(completo) });
});

async function alterarSituacao(
  request: { params: { id: string }; headers: Record<string, unknown> },
  response: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
  ativo: boolean
) {
  const user = await requireRole(request as never, response as never, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  // Ficha de produção que é ingrediente de outra não sai de cena em silêncio: o custo dos pratos que a usam dependem dela.
  if (!ativo) {
    const usos = await prisma.dishItem.count({ where: { componentDishId: request.params.id } });
    if (usos > 0) {
      response.status(400).json({ message: `Esta ficha de produção é ingrediente de ${usos} ${usos === 1 ? "item de outra ficha" : "itens de outras fichas"}: tire-a de lá antes de inativá-la.` });
      return;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.dish.update({ where: { id: request.params.id }, data: { isActive: ativo } });
      const detalhe = await carregarDetalhe(tx, request.params.id);
      if (detalhe) await registrarRevisao(tx, { detalhe, action: ativo ? "REATIVADA" : "INATIVADA", user });
    });
  } catch (error) {
    if (responderErroDeGravacao(error, null, response)) return;
    throw error;
  }

  await auditLog({ userId: user.id, action: ativo ? "REACTIVATE" : "DELETE", entity: "Dish", entityId: request.params.id });
  response.json({ ok: true });
}

dishesRouter.delete("/:id", (request, response) => alterarSituacao(request, response, false));

// Inativar nao era reversivel pela tela: o prato so aparecia com "mostrar inativos"
// e nao havia como voltar.
dishesRouter.post("/:id/reactivate", (request, response) => alterarSituacao(request, response, true));
