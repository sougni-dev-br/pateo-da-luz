import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  SETOR_PRATO_PRONTO,
  chaveDoPrato,
  resumirDesperdicio,
  somarDias,
  type LinhaDeDesperdicio,
  type ResumoDeDesperdicio,
} from "./waste.js";

/** O que a leitura precisa do item de cada lançamento: insumo ou prato pronto. Sem foto: resumo e aviso não a usam. */
export const INCLUDE_DO_ITEM = {
  product: { select: { name: true, externalCode: true } },
  dish: { select: { name: true, code: true } },
} satisfies Prisma.WasteEntryInclude;

/** A lista também diz se o lançamento tem foto (só o id; o conteúdo nunca é lido aqui). */
export const INCLUDE_DA_LISTA = { ...INCLUDE_DO_ITEM, photo: { select: { id: true } } } satisfies Prisma.WasteEntryInclude;

export type EntradaComItem = Prisma.WasteEntryGetPayload<{ include: typeof INCLUDE_DO_ITEM }>;
export type EntradaDaLista = Prisma.WasteEntryGetPayload<{ include: typeof INCLUDE_DA_LISTA }>;

export async function nomesDosSetores(ids: Array<string | null>) {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unicos.length) return new Map<string, string>();
  const setores = await prisma.inventorySector.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(setores.map((s) => [s.id, s.name]));
}

export const nomeDoItem = (e: Pick<EntradaComItem, "product" | "dish">) => e.product?.name ?? e.dish?.name ?? "Item removido";

/** Uma linha do resumo. Sem permissão de custo o valor sai nulo, para o resumo não revelar ordem por R$. */
export function linhaDoResumo(e: EntradaComItem, setores: Map<string, string>, comCusto: boolean): LinhaDeDesperdicio {
  return {
    itemId: e.productId ?? (e.dishId ? chaveDoPrato(e.dishId) : e.id),
    itemName: nomeDoItem(e),
    sector: e.sectorId ? setores.get(e.sectorId) ?? null : e.dishId ? SETOR_PRATO_PRONTO : null,
    reason: e.reason,
    totalCost: comCusto && e.totalCost != null ? Number(e.totalCost) : null,
    cancelled: false,
  };
}

/**
 * Desperdício registrado num ciclo de CMV. O ciclo vai da contagem inicial (exclusive) à final
 * (inclusive) — a mesma janela das compras e do faturamento no CMV Real —, então `inicioDoCiclo`
 * é o dia da contagem inicial e entra de fora.
 *
 * É leitura: o desperdício já está dentro do CMV (estoque inicial + compras − final), por isso
 * nada aqui é somado ou subtraído dele.
 */
export async function resumoDeDesperdicioDoCiclo(inicioDoCiclo: string, fimDoCiclo: string): Promise<ResumoDeDesperdicio> {
  const entradas = await prisma.wasteEntry.findMany({
    where: {
      cancelledAt: null,
      occurredOn: { gte: new Date(`${somarDias(inicioDoCiclo, 1)}T00:00:00.000Z`), lte: new Date(`${fimDoCiclo}T00:00:00.000Z`) },
    },
    include: INCLUDE_DO_ITEM,
  });
  const setores = await nomesDosSetores(entradas.map((e) => e.sectorId));
  return resumirDesperdicio(entradas.map((e) => linhaDoResumo(e, setores, true)));
}
