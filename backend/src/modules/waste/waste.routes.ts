import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { todayInSaoPaulo } from "../buffet-plates/buffet-prints.routes.js";
import { escolherCusto, type CandidatosDoCusto } from "../inventory/custo-inventario.js";
import { normalizarUnidade, type UnitConversion } from "../../shared/unidades/conversao.js";
import { SELECT_DE_UNIDADES, conversoesDoInsumo, textoDaEmbalagem, unidadeDoInsumo } from "../../shared/unidades/insumo.js";
import {
  SETOR_PRATO_PRONTO,
  WASTE_REASONS,
  calcularValor,
  converterQuantidade,
  resumirDesperdicio,
  rotuloDoMotivo,
  somarDias,
  validarLancamento,
} from "./waste.js";
import { INCLUDE_DA_LISTA, INCLUDE_DO_ITEM, linhaDoResumo, nomeDoItem, nomesDosSetores, type EntradaDaLista } from "./waste.service.js";
import { carregarDetalhe } from "../dishes/dish-detail.js";
import { listActivePhones } from "../notifications/recipients.service.js";
import { avisarSePassouDoLimite } from "./waste-alert.service.js";
import { wastePhotoRouter } from "./waste-photo.routes.js";
import { LIMITE_DE_LANCAMENTOS, limitarGravacoes } from "./waste-limite.js";
import { chaveDoNome, validarPratoNovo } from "./waste-ficha.js";
import { analisePeriodo } from "./waste-analise.service.js";

// Desperdício de insumo. Decomposição do CMV: não baixa InventoryStock, não entra no DRE
// e não toca período financeiro (ver waste.ts). Quem lança vê quantidades; o valor em R$
// só sai para quem tem "inventory-costs", como nas movimentações do estoque.
export const wasteRouter = Router();

// Quem grava (lançar, cancelar, configurar) tem um ritmo máximo por usuário; ler nunca é limitado.
wasteRouter.use(limitarGravacoes(LIMITE_DE_LANCAMENTOS));

// Foto do lançamento: /waste/:id/photo (tem o limite próprio, mais apertado).
wasteRouter.use(wastePhotoRouter);

const MAX_LISTADOS = 500;
// Uma a mais do que se mostra: é assim que se sabe se a lista foi cortada (exatamente 500 não é corte).
const MAX_PRODUTOS_NA_BUSCA = 20;
const MAX_PERIODO_DIAS = 366;

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dateOnly = (dia: string) => new Date(`${dia}T00:00:00.000Z`);
const diaDe = (d: Date) => d.toISOString().slice(0, 10);
// Date.parse recusa "2026-13-01"; toISOString nele estouraria RangeError (500) em vez de 400.
const isRealDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && diaDe(dateOnly(s)) === s;

async function custoVisivel(user: { id: string; role: string }) {
  return userHasPermission(user as never, "inventory-costs", "view");
}

/**
 * Custo por unidade de estoque no dia do desperdício: última compra confirmada até a data
 * e, na falta dela, a última base oficial. Mesma fonte da conferência do inventário — nunca
 * o custo médio do saldo, que mistura todas as compras do ano.
 *
 * Só vale compra cuja quantidade está na MESMA unidade do desperdício: o custo é total/quantidade,
 * e quantidade em caixa (ou em grama) dividiria o total por um número que não é o da unidade do
 * lançamento (R$ 113 por saco de 800 viraria o preço de 1 unidade). Sem par, fica sem custo.
 */
async function custoDoProduto(productId: string, dia: string, unidade: string | null) {
  const [row] = await prisma.$queryRaw<Array<{ ultima: Prisma.Decimal | null; ultimaData: Date | null; base: Prisma.Decimal | null; baseAno: number | null; baseMes: number | null }>>`
    SELECT ultima.custo AS ultima, ultima.dia AS "ultimaData", base."unitCost" AS base, base.ano AS "baseAno", base.mes AS "baseMes"
    FROM (SELECT 1) x
    LEFT JOIN LATERAL (
      SELECT pi."totalPrice" / NULLIF(COALESCE(pi."convertedQuantity", pi."quantity"), 0) AS custo,
             COALESCE(p."receivedAt", p."purchaseDate") AS dia
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      WHERE pi."productId" = ${productId}
        AND p."status" = 'ACTIVE' AND p."workflowStatus" = 'confirmed'
        AND pi."totalPrice" > 0 AND COALESCE(pi."convertedQuantity", pi."quantity") > 0
        AND pi."conversionMissing" = false
        AND (
          (pi."convertedUnit" IS NOT NULL AND UPPER(pi."convertedUnit") = UPPER(${unidade ?? ""}))
          OR (pi."convertedUnit" IS NULL AND (pi."unit" IS NULL OR UPPER(pi."unit") = UPPER(${unidade ?? ""})))
        )
        AND COALESCE(p."receivedAt", p."purchaseDate")::date <= ${dia}::date
      ORDER BY COALESCE(p."receivedAt", p."purchaseDate") DESC, p."createdAt" DESC
      LIMIT 1
    ) ultima ON true
    LEFT JOIN LATERAL (
      SELECT si."unitCost", s."competenceYear" AS ano, s."competenceMonth" AS mes
      FROM "InventorySnapshotItem" si
      JOIN "InventorySnapshot" s ON s."id" = si."snapshotId"
      WHERE si."productId" = ${productId} AND si."unitCost" > 0
        AND s."status" <> 'CANCELLED' AND s."countDate"::date <= ${dia}::date
      ORDER BY s."countDate" DESC, si."unitCost" DESC
      LIMIT 1
    ) base ON true
  `;
  const numero = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
  const candidatos: CandidatosDoCusto = {
    periodo: null,
    ultimaCompra: { valor: numero(row?.ultima), data: row?.ultimaData ?? null },
    base: { valor: numero(row?.base), ano: row?.baseAno ?? null, mes: row?.baseMes ?? null },
    informado: null,
  };
  return escolherCusto(candidatos);
}

type Periodo = { from: string; to: string };

function lerPeriodo(query: Request["query"]): Periodo | { erro: string } {
  const hoje = todayInSaoPaulo();
  const to = typeof query.to === "string" && query.to ? query.to : hoje;
  const from = typeof query.from === "string" && query.from ? query.from : somarDias(to, -29);
  if (!isRealDay(from) || !isRealDay(to)) return { erro: "Período inválido." };
  if (from > to) return { erro: "A data inicial é depois da final." };
  if (to > somarDias(hoje, 1)) return { erro: "Período inválido." };
  if (dateOnly(to).getTime() - dateOnly(from).getTime() > MAX_PERIODO_DIAS * 86_400_000) {
    return { erro: `O período pode ter no máximo ${MAX_PERIODO_DIAS} dias.` };
  }
  return { from, to };
}

function serializar(entrada: EntradaDaLista, setores: Map<string, string>, comCusto: boolean) {
  return {
    id: entrada.id,
    kind: entrada.dishId ? "PRATO" : "INSUMO",
    productId: entrada.productId,
    dishId: entrada.dishId,
    productName: nomeDoItem(entrada),
    productCode: entrada.product?.externalCode ?? entrada.dish?.code ?? null,
    quantity: Number(entrada.quantity),
    unit: entrada.unit,
    // O que foi digitado, quando diferente da unidade do estoque (500 G para 0,1 UN).
    enteredQuantity: entrada.enteredQuantity == null ? null : Number(entrada.enteredQuantity),
    enteredUnit: entrada.enteredUnit,
    reason: entrada.reason,
    reasonLabel: rotuloDoMotivo(entrada.reason),
    occurredOn: diaDe(entrada.occurredOn),
    sectorName: entrada.sectorId ? setores.get(entrada.sectorId) ?? null : entrada.dishId ? SETOR_PRATO_PRONTO : null,
    notes: entrada.notes,
    registeredById: entrada.registeredById,
    createdAt: entrada.createdAt,
    cancelledAt: entrada.cancelledAt,
    cancelReason: entrada.cancelReason,
    hasPhoto: Boolean(entrada.photo),
    // Não é valor: só diz se o lançamento ficou sem custo (não entra no total nem no aviso do dia).
    hasCost: entrada.totalCost != null,
    ...(comCusto
      ? { unitCost: entrada.unitCost == null ? null : Number(entrada.unitCost), totalCost: entrada.totalCost == null ? null : Number(entrada.totalCost), costSource: entrada.costSource }
      : {}),
  };
}


type ItemDoLancamento = { unit: string | null; sectorId: string | null; unitCost: number | null; costSource: string | null; conversions: UnitConversion[] };

async function itemDoInsumo(productId: string, dia: string): Promise<ItemDoLancamento | { erro: string }> {
  const produto = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true, inventorySectorId: true, ...SELECT_DE_UNIDADES },
  });
  if (!produto || !produto.isActive) return { erro: "Produto não encontrado ou inativo." };
  const unidade = unidadeDoInsumo(produto);
  const custo = await custoDoProduto(productId, dia, unidade);
  return {
    unit: unidade,
    conversions: conversoesDoInsumo(produto),
    sectorId: produto.inventorySectorId,
    unitCost: custo?.valor ?? null,
    costSource: custo ? (custo.detalhe ? `${custo.fonte}: ${custo.detalhe}` : custo.fonte) : null,
  };
}

/**
 * Prato pronto vale ao custo da ficha técnica, por unidade de rendimento (o KG de um prato de
 * buffet, a porção de um à la carte). Ficha com ingrediente sem custo ou sem conversão não vira
 * valor parcial: fica sem custo, como o insumo sem compra.
 */
async function itemDoPrato(dishId: string): Promise<ItemDoLancamento | { erro: string }> {
  const prato = await carregarDetalhe(prisma, dishId);
  // Preparação de buffet criada pelo desperdício nasce inativa (não é vendida) e mesmo assim se lança.
  const origem = prato ? await prisma.dish.findUnique({ where: { id: dishId }, select: { fichaDeBuffet: true } }) : null;
  if (!prato || !(prato.isActive || origem?.fichaDeBuffet)) return { erro: "Prato não encontrado ou inativo." };
  const custoCompleto = !prato.custoIncompleto && prato.custoPorcao > 0;
  return {
    unit: prato.yieldUnit,
    // Prato converte só por física (g↔kg, ml↔l): o rendimento da ficha já está em uma dessas ou em porção.
    conversions: [],
    sectorId: null,
    unitCost: custoCompleto ? prato.custoPorcao : null,
    costSource: custoCompleto ? "FICHA_TECNICA" : null,
  };
}

// Busca de prato pronto (sobra de buffet, prato devolvido): fichas técnicas ativas.
wasteRouter.get("/dishes", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const search = String(request.query.search ?? "").trim().slice(0, 80);
  if (search.length < 2) return void response.json([]);

  const pratos = await prisma.dish.findMany({
    where: {
      AND: [
        { OR: [{ isActive: true }, { fichaDeBuffet: true }] },
        { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }] },
      ],
    },
    select: { id: true, name: true, code: true, yieldUnit: true, fichaPendente: true, category: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: MAX_PRODUTOS_NA_BUSCA,
  });
  response.json(pratos.map((p) => ({ id: p.id, name: p.name, code: p.code, unit: p.yieldUnit, sectorName: p.category?.name ?? SETOR_PRATO_PRONTO, conversions: [], embalagemInferida: null, pendente: p.fichaPendente })));
});

/** Todos os nomes de prato (ativos ou não): a conferência de duplicidade não pode deixar passar o "Purê" que já espera ficha. */
async function pratoComEsteNome(nome: string) {
  const chave = chaveDoNome(nome);
  const todos = await prisma.dish.findMany({ select: { id: true, name: true, yieldUnit: true, fichaPendente: true } });
  return todos.find((p) => chaveDoNome(p.name) === chave) ?? null;
}

const dicaDoPrato = (p: { id: string; name: string; yieldUnit: string; fichaPendente: boolean }) => ({
  id: p.id, name: p.name, code: null, unit: p.yieldUnit, sectorName: SETOR_PRATO_PRONTO, conversions: [], embalagemInferida: null, pendente: p.fichaPendente,
});

// Itens do buffet (a lista das plaquinhas) que ainda não são prato: o jeito de cadastrar "Purê de batata" sem digitar o nome errado.
wasteRouter.get("/dishes/suggestions", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const search = String(request.query.search ?? "").trim().slice(0, 80);
  if (search.length < 2) return void response.json([]);

  const [itens, pratos] = await Promise.all([
    prisma.buffetPlateItem.findMany({
      where: { isActive: true, namePt: { contains: search, mode: "insensitive" } },
      select: { namePt: true, category: true },
      orderBy: { namePt: "asc" },
      take: 30,
    }),
    prisma.dish.findMany({ select: { name: true } }),
  ]);
  const jaExistem = new Set(pratos.map((p) => chaveDoNome(p.name)));
  response.json(itens.filter((i) => !jaExistem.has(chaveDoNome(i.namePt))).slice(0, 8).map((i) => ({ name: i.namePt, category: i.category })));
});

// Prato que não existe: nasce aqui, inativo, aguardando a ficha técnica. O lançamento segue normalmente (sem valor) e
// passa a valer quando a ficha for concluída. Quem lança diz o nome, a unidade e, se souber, o que leva.
wasteRouter.post("/dishes", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const validado = validarPratoNovo(request.body ?? {});
  if (!validado.ok) return void response.status(400).json({ message: validado.erro });
  const { name, unit, observacao } = validado.valor;

  const igual = await pratoComEsteNome(name);
  if (igual) {
    return void response.status(409).json({
      message: igual.fichaPendente ? `"${igual.name}" já foi cadastrado e aguarda a ficha técnica.` : `Já existe um prato chamado "${igual.name}".`,
      existing: dicaDoPrato(igual),
    });
  }

  const criado = await prisma.dish.create({
    data: {
      name,
      yieldQty: 1,
      yieldUnit: unit,
      isActive: false,
      fichaDeBuffet: true,
      fichaPendente: true,
      pendenteDesde: new Date(),
      pendentePorId: user.id,
      pendenteObservacao: observacao,
    },
    select: { id: true, name: true, yieldUnit: true, fichaPendente: true },
  });
  try {
    await auditLog({ userId: user.id, action: "CREATE_PENDING_DISH", entity: "Dish", entityId: criado.id, newValue: { name, unit, observacao }, ...auditMeta(request) });
  } catch (falha) {
    console.error("[desperdicio] auditoria do prato pendente falhou:", falha instanceof Error ? falha.message : falha);
  }
  response.status(201).json(dicaDoPrato(criado));
});

// Busca de produto para o lançamento rápido: não exige acesso ao módulo Produtos.
wasteRouter.get("/products", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const search = String(request.query.search ?? "").trim().slice(0, 80);
  if (search.length < 2) return void response.json([]);

  const produtos = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [{ name: { contains: search, mode: "insensitive" } }, { externalCode: { contains: search, mode: "insensitive" } }],
    },
    select: { id: true, externalCode: true, inventorySector: { select: { name: true } }, ...SELECT_DE_UNIDADES },
    orderBy: { name: "asc" },
    take: MAX_PRODUTOS_NA_BUSCA,
  });
  response.json(produtos.map((p) => {
    const conversoes = conversoesDoInsumo(p);
    return {
      id: p.id,
      name: p.name,
      code: p.externalCode,
      unit: unidadeDoInsumo(p),
      sectorName: p.inventorySector?.name ?? null,
      // As mesmas conversões da ficha técnica: a tela oferece só as unidades que convertem.
      conversions: conversoes,
      embalagemInferida: textoDaEmbalagem(p, conversoes),
    };
  }));
});

wasteRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const validado = validarLancamento(request.body ?? {}, todayInSaoPaulo());
  if (!validado.ok) return void response.status(400).json({ message: validado.erro });
  const { productId, dishId, quantity: digitada, unit: unidadeDigitada, perUnit, reason, occurredOn, notes } = validado.valor;

  // O custo é do servidor: o cliente não manda valor, e quem lança pode nem ter permissão de ver custo.
  const item = dishId ? await itemDoPrato(dishId) : await itemDoInsumo(productId!, occurredOn);
  if ("erro" in item) return void response.status(404).json({ message: item.erro });

  // A pessoa digita em g, ml, kg...; o servidor guarda na unidade do estoque (a da conferência e do custo),
  // com a mesma regra da ficha técnica, e mantém o que foi digitado para mostrar e auditar.
  const conversao = converterQuantidade(digitada, unidadeDigitada, item.unit, item.conversions, perUnit);
  if (!conversao.ok) return void response.status(400).json({ message: conversao.erro });
  const quantity = conversao.quantidade;
  const informouOutraUnidade = unidadeDigitada != null && normalizarUnidade(unidadeDigitada) !== normalizarUnidade(item.unit);
  const id = crypto.randomUUID();

  // O que a resposta precisa e pode falhar sai ANTES de gravar: erro depois do create faria a pessoa
  // repetir um lançamento que já existe.
  const comCusto = await custoVisivel(user);

  const criada = await prisma.wasteEntry.create({
    data: {
      id,
      productId,
      dishId,
      quantity,
      unit: item.unit,
      enteredQuantity: informouOutraUnidade ? digitada : null,
      enteredUnit: informouOutraUnidade ? unidadeDigitada : null,
      reason,
      occurredOn: dateOnly(occurredOn),
      sectorId: item.sectorId,
      unitCost: item.unitCost,
      totalCost: calcularValor(quantity, item.unitCost),
      costSource: item.costSource,
      notes,
      registeredById: user.id,
    },
    include: INCLUDE_DA_LISTA,
  });

  // A auditoria é rastro, não condição do registro: se ela falhar, o lançamento (já gravado) é entregue
  // e a falha vai para o log, em vez de um 500 que convida a lançar de novo.
  try {
    await auditLog({ userId: user.id, action: "CREATE_WASTE_ENTRY", entity: "WasteEntry", entityId: id, newValue: { productId, dishId, quantity, unit: item.unit, enteredQuantity: informouOutraUnidade ? digitada : null, enteredUnit: informouOutraUnidade ? unidadeDigitada : null, ...(conversao.usouPesoInformado ? { pesoInformado: perUnit } : {}), reason, occurredOn, notes }, ...auditMeta(request) });
  } catch (falha) {
    console.error("[desperdicio] auditoria do lançamento falhou:", falha instanceof Error ? falha.message : falha);
  }
  const setores = await nomesDosSetores([criada.sectorId]).catch(() => new Map<string, string>());
  response.status(201).json(serializar(criada, setores, comCusto));

  // Depois da resposta e sem esperar: o aviso por WhatsApp nunca atrasa nem derruba o registro.
  const hoje = todayInSaoPaulo();
  if (occurredOn === hoje && criada.totalCost != null) {
    avisarSePassouDoLimite(occurredOn, hoje)
      .then((resultado) => { if (resultado === "SEM_DESTINATARIO") console.warn("[desperdicio] limite do dia atingido, mas o aviso por WhatsApp não chegou a ninguém (sem destinatário ativo ou WhatsApp desconectado)."); })
      .catch((falha) => console.error("[desperdicio] aviso por WhatsApp falhou:", falha instanceof Error ? falha.message : falha));
  }
});

// ── Configuração do aviso ──
// Só administra quem tem "admin" no módulo (regra em menu-permissions: /waste/settings). A leitura
// também: o limite em R$ não é para quem só lança.

wasteRouter.get("/settings", async (_request, response) => {
  const [config, destinatarios] = await Promise.all([prisma.wasteSettings.findUnique({ where: { id: "singleton" } }), listActivePhones()]);
  response.json({
    dailyAlertValue: config?.dailyAlertValue == null ? null : Number(config.dailyAlertValue),
    activeRecipients: destinatarios.length,
  });
});

const MAX_LIMITE_DO_ALERTA = 1_000_000;

wasteRouter.put("/settings", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const bruto = request.body?.dailyAlertValue;
  const texto = bruto == null ? "" : String(bruto).trim().replace(",", ".");
  const valor = texto === "" ? null : Number(texto);
  // Confere depois de arredondar para centavos: 0,004 vira 0,00 e quebraria o CHECK do banco.
  const limite = valor === null || !Number.isFinite(valor) ? null : Math.round(valor * 100) / 100;
  if (valor !== null && (limite === null || limite <= 0 || limite > MAX_LIMITE_DO_ALERTA)) {
    return void response.status(400).json({ message: "Informe um limite maior que zero, ou deixe vazio para desligar o aviso." });
  }

  const anterior = await prisma.wasteSettings.findUnique({ where: { id: "singleton" } });
  const salvo = await prisma.wasteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", dailyAlertValue: limite },
    update: { dailyAlertValue: limite },
  });
  await auditLog({
    userId: user.id, action: "UPDATE_WASTE_SETTINGS", entity: "WasteSettings", entityId: "singleton",
    previousValue: anterior ? { dailyAlertValue: anterior.dailyAlertValue == null ? null : Number(anterior.dailyAlertValue) } : null,
    newValue: { dailyAlertValue: limite }, ...auditMeta(request),
  });
  response.json({ dailyAlertValue: salvo.dailyAlertValue == null ? null : Number(salvo.dailyAlertValue) });
});

wasteRouter.get("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const periodo = lerPeriodo(request.query);
  if ("erro" in periodo) return void response.status(400).json({ message: periodo.erro });

  const reason = typeof request.query.reason === "string" ? request.query.reason : "";
  const productId = typeof request.query.productId === "string" ? request.query.productId : "";
  if (reason && !WASTE_REASONS.some((r) => r.value === reason)) return void response.status(400).json({ message: "Motivo inválido." });

  const entradas = await prisma.wasteEntry.findMany({
    where: {
      occurredOn: { gte: dateOnly(periodo.from), lte: dateOnly(periodo.to) },
      ...(reason ? { reason: reason as never } : {}),
      ...(productId ? { productId } : {}),
    },
    include: INCLUDE_DA_LISTA,
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    take: MAX_LISTADOS + 1,
  });
  const cortada = entradas.length > MAX_LISTADOS;
  if (cortada) entradas.pop();
  const setores = await nomesDosSetores(entradas.map((e) => e.sectorId));
  const comCusto = await custoVisivel(user);
  response.json({ from: periodo.from, to: periodo.to, truncated: cortada, items: entradas.map((e) => serializar(e, setores, comCusto)) });
});

wasteRouter.get("/summary", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const periodo = lerPeriodo(request.query);
  if ("erro" in periodo) return void response.status(400).json({ message: periodo.erro });

  const entradas = await prisma.wasteEntry.findMany({
    where: { occurredOn: { gte: dateOnly(periodo.from), lte: dateOnly(periodo.to) }, cancelledAt: null },
    include: INCLUDE_DO_ITEM,
  });
  const comCusto = await custoVisivel(user);
  const setores = await nomesDosSetores(entradas.map((e) => e.sectorId));
  const linhas = entradas.map((e) => linhaDoResumo(e, setores, comCusto));
  const resumo = resumirDesperdicio(linhas);

  // Sem permissão de custo o resumo mostra só contagens; "valor" some em vez de virar R$ 0,00.
  const semValor = <T extends { valor: number }>(grupos: T[]) => grupos.map((g) => ({ ...g, valor: null, semCusto: 0 }));
  response.json(comCusto
    ? { from: periodo.from, to: periodo.to, ...resumo }
    : {
        from: periodo.from,
        to: periodo.to,
        total: { lancamentos: resumo.total.lancamentos, valor: null, semCusto: 0 },
        porMotivo: semValor(resumo.porMotivo),
        porSetor: semValor(resumo.porSetor),
        porProduto: semValor(resumo.porProduto),
      });
});

// Leitura analítica (comparação com o período anterior, tendência, reincidência, qualidade do registro).
// Valor e faturamento só saem para quem tem "inventory-costs"; os demais veem contagens.
wasteRouter.get("/analysis", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const periodo = lerPeriodo(request.query);
  if ("erro" in periodo) return void response.status(400).json({ message: periodo.erro });

  response.json(await analisePeriodo(periodo.from, periodo.to, await custoVisivel(user)));
});

// Cancelar pede "excluir" (rota /cancel): quem lançou errado não apaga o próprio rastro.
wasteRouter.post("/:id/cancel", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const motivo = String(request.body?.reason ?? "").trim().replace(/\s+/g, " ");
  if (motivo.length < 3) return void response.status(400).json({ message: "Informe o motivo do cancelamento." });
  if (motivo.length > 300) return void response.status(400).json({ message: "Motivo do cancelamento muito longo." });

  const atual = await prisma.wasteEntry.findUnique({ where: { id: request.params.id }, select: { id: true, cancelledAt: true } });
  if (!atual) return void response.status(404).json({ message: "Lançamento não encontrado." });
  if (atual.cancelledAt) return void response.status(409).json({ message: "Este lançamento já foi cancelado." });

  // O filtro cancelledAt: null fecha a corrida entre dois cancelamentos simultâneos.
  const { count } = await prisma.wasteEntry.updateMany({
    where: { id: atual.id, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelledById: user.id, cancelReason: motivo },
  });
  if (count === 0) return void response.status(409).json({ message: "Este lançamento já foi cancelado." });

  await auditLog({ userId: user.id, action: "CANCEL_WASTE_ENTRY", entity: "WasteEntry", entityId: atual.id, newValue: { reason: motivo }, ...auditMeta(request) });
  response.json({ ok: true });
});

