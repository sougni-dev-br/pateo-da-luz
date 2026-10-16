import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { parseBody } from "../../shared/validate-body.js";
import { requestIp, requireRole } from "../security/security-utils.js";
import { PRODUCT_NATURES, type ProductNatureValue } from "./product-nature.js";
import { productListWhere } from "./product-list-filter.js";
import {
  desfazerEhSeguro,
  planejarLote,
  type ContextoDoLote,
  type EstadoDoLote,
  type ProdutoDoLote
} from "./product-bulk.js";

export const productBulkRouter = Router();

/** Teto do lote: um filtro mais largo que isso é amplo demais para conferir o resumo com calma. */
const LIMITE_DO_LOTE = 2000;
const AMOSTRA_DO_RESUMO = 8;
const ACAO_LOTE = "BULK_UPDATE_PRODUCTS";
const ACAO_DESFAZER = "UNDO_BULK_UPDATE_PRODUCTS";

const idNaoVazio = z.string().trim().min(1);

const mudancasSchema = z
  .object({
    categoryId: idNaoVazio.optional(),
    subcategoryId: idNaoVazio.nullable().optional(),
    inventorySectorId: idNaoVazio.nullable().optional(),
    nature: z.enum(PRODUCT_NATURES).optional(),
    controlsStock: z.boolean().optional(),
    isActive: z.boolean().optional()
  })
  .strict()
  .refine((mudancas) => Object.values(mudancas).some((valor) => valor !== undefined), { message: "Escolha ao menos uma mudança." });

const loteSchema = z
  .object({
    ids: z.array(idNaoVazio).min(1).max(LIMITE_DO_LOTE).optional(),
    filtro: z.record(z.unknown()).optional(),
    mudancas: mudancasSchema,
    aplicar: z.boolean().optional()
  })
  .refine((corpo) => (corpo.ids === undefined) !== (corpo.filtro === undefined), {
    message: "Informe os produtos escolhidos (ids) ou o filtro, não os dois."
  });

const SELECT_DO_LOTE = {
  id: true,
  name: true,
  externalCode: true,
  categoryId: true,
  subcategoryId: true,
  inventorySectorId: true,
  nature: true,
  controlsStock: true,
  isActive: true
} as const;

async function carregarContexto(): Promise<ContextoDoLote> {
  const [categorias, subcategorias, setores] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, nature: true } }),
    prisma.subcategory.findMany({ select: { id: true, name: true, categoryId: true } }),
    prisma.inventorySector.findMany({ select: { id: true, name: true, isActive: true } })
  ]);
  return {
    categorias: new Map(categorias.map((c) => [c.id, c])),
    subcategorias: new Map(subcategorias.map((s) => [s.id, s])),
    setores: new Map(setores.map((s) => [s.id, s]))
  };
}

function estadoDe(produto: ProdutoDoLote): EstadoDoLote {
  return {
    categoryId: produto.categoryId,
    subcategoryId: produto.subcategoryId,
    inventorySectorId: produto.inventorySectorId,
    nature: produto.nature,
    controlsStock: produto.controlsStock,
    isActive: produto.isActive
  };
}

function dadosDoPrisma(patch: Partial<EstadoDoLote>): Prisma.ProductUncheckedUpdateManyInput {
  const dados: Prisma.ProductUncheckedUpdateManyInput = {};
  if (patch.categoryId !== undefined) dados.categoryId = patch.categoryId;
  if (patch.subcategoryId !== undefined) dados.subcategoryId = patch.subcategoryId;
  if (patch.inventorySectorId !== undefined) dados.inventorySectorId = patch.inventorySectorId;
  if (patch.nature !== undefined) dados.nature = patch.nature as ProductNatureValue | null;
  if (patch.controlsStock !== undefined) dados.controlsStock = patch.controlsStock;
  if (patch.isActive !== undefined) dados.isActive = patch.isActive;
  return dados;
}

/** Produtos com o mesmo patch (ou o mesmo estado a restaurar) viram uma única atualização. */
function agruparPorPatch<T extends { id: string }>(itens: T[], chave: (item: T) => unknown): Array<{ dados: unknown; ids: string[] }> {
  const grupos = new Map<string, { dados: unknown; ids: string[] }>();
  for (const item of itens) {
    const dados = chave(item);
    const id = JSON.stringify(dados);
    const grupo = grupos.get(id) ?? { dados, ids: [] };
    grupo.ids.push(item.id);
    grupos.set(id, grupo);
  }
  return [...grupos.values()];
}

productBulkRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const corpo = parseBody(loteSchema, request.body, response);
  if (!corpo) return;

  let produtos: ProdutoDoLote[];
  if (corpo.ids) {
    produtos = await prisma.product.findMany({ where: { id: { in: corpo.ids } }, select: SELECT_DO_LOTE });
  } else {
    const where = productListWhere(corpo.filtro ?? {});
    const total = await prisma.product.count({ where });
    if (total > LIMITE_DO_LOTE) {
      response.status(400).json({ message: `O filtro pega ${total} produtos; o limite do lote é ${LIMITE_DO_LOTE}. Refine o filtro.` });
      return;
    }
    produtos = await prisma.product.findMany({ where, select: SELECT_DO_LOTE, orderBy: { name: "asc" } });
  }
  if (produtos.length === 0) {
    response.status(400).json({ message: "Nenhum produto encontrado para o lote." });
    return;
  }

  const plano = planejarLote(produtos, corpo.mudancas, await carregarContexto());
  const resumo = {
    total: produtos.length,
    alterar: plano.alterar.length,
    semMudanca: plano.semMudanca,
    recusados: plano.recusados.length,
    recusadosPorMotivo: plano.recusadosPorMotivo,
    contagens: plano.contagens,
    avisos: plano.avisos,
    amostra: plano.alterar.slice(0, AMOSTRA_DO_RESUMO).map((item) => item.name)
  };

  if (!corpo.aplicar) {
    response.json({ aplicado: false, ...resumo });
    return;
  }
  if (plano.alterar.length === 0) {
    response.json({ aplicado: true, loteId: null, ...resumo });
    return;
  }

  const loteId = crypto.randomUUID();
  await prisma.$transaction(async (tx) => {
    for (const grupo of agruparPorPatch(plano.alterar, (item) => item.patch)) {
      await tx.product.updateMany({ where: { id: { in: grupo.ids } }, data: dadosDoPrisma(grupo.dados as Partial<EstadoDoLote>) });
    }
    await tx.auditLog.create({
      data: {
        id: loteId,
        userId: user.id,
        action: ACAO_LOTE,
        entity: "Product",
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? ""),
        previousValue: { produtos: plano.alterar.map((item) => ({ id: item.id, antes: item.antes, depois: item.depois })) } as unknown as Prisma.InputJsonValue,
        newValue: { mudancas: corpo.mudancas, alterados: plano.alterar.length, contagens: plano.contagens } as unknown as Prisma.InputJsonValue
      }
    });
  });

  response.json({ aplicado: true, loteId, ...resumo });
});

productBulkRouter.post("/:loteId/desfazer", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const lote = await prisma.auditLog.findFirst({ where: { id: request.params.loteId, action: ACAO_LOTE } });
  if (!lote) {
    response.status(404).json({ message: "Lote não encontrado." });
    return;
  }
  const jaDesfeito = await prisma.auditLog.findFirst({ where: { action: ACAO_DESFAZER, entityId: lote.id }, select: { id: true } });
  if (jaDesfeito) {
    response.status(409).json({ message: "Este lote já foi desfeito." });
    return;
  }

  const registrados = ((lote.previousValue as { produtos?: Array<{ id: string; antes: EstadoDoLote; depois: EstadoDoLote }> } | null)?.produtos) ?? [];
  const atuais = await prisma.product.findMany({ where: { id: { in: registrados.map((r) => r.id) } }, select: SELECT_DO_LOTE });
  const estadoAtual = new Map(atuais.map((produto) => [produto.id, estadoDe(produto as ProdutoDoLote)]));

  const restaurar = registrados.filter((r) => {
    const atual = estadoAtual.get(r.id);
    return atual !== undefined && desfazerEhSeguro(atual, r.depois);
  });
  const ignorados = registrados.length - restaurar.length;

  try {
    await prisma.$transaction(async (tx) => {
      for (const grupo of agruparPorPatch(restaurar, (r) => r.antes)) {
        await tx.product.updateMany({ where: { id: { in: grupo.ids } }, data: dadosDoPrisma(grupo.dados as EstadoDoLote) });
      }
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          action: ACAO_DESFAZER,
          entity: "Product",
          entityId: lote.id,
          ipAddress: requestIp(request),
          userAgent: String(request.headers["user-agent"] ?? ""),
          newValue: { desfeitos: restaurar.length, ignorados } as unknown as Prisma.InputJsonValue
        }
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      response.status(409).json({ message: "Não foi possível desfazer: uma categoria, subcategoria ou setor do estado anterior não existe mais." });
      return;
    }
    throw error;
  }

  response.json({ desfeitos: restaurar.length, ignorados });
});
