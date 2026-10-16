// Conversao automatica em lote: monta as propostas de todos os produtos a partir
// do nome e das compras, e aplica as escolhidas (cadastra a conversao e refaz a
// quantidade convertida das compras que estavam sem ela).
//
// Nao mexe no saldo nem no custo medio do estoque (InventoryStock): isso e a
// reconstrucao do custo, feita a parte e com simulacao.

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizarUnidade, type UnitConversion } from "../../shared/unidades/conversao.js";
import { proporConversoes, type ProdutoParaConversao, type PropostaDeConversao, type UnidadeDaNota } from "../../shared/unidades/conversao-automatica.js";
import { sqlCompraNaUnidadeDeContagem, sqlUnidadeCanonica } from "../../shared/unidades/compra-na-contagem.sql.js";
import { gravarConversaoDoItemDeCompra } from "../inventory/inventory.routes.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { PeriodLockedError } from "../cmv-real/period-locked-error.js";
import { auditLog } from "../security/security-utils.js";

export type ProdutoComPropostas = {
  productId: string;
  codigo: string | null;
  nome: string;
  unidadeDeContagem: string;
  propostas: PropostaDeConversao[];
};

const canonica = (expr: Prisma.Sql) => sqlUnidadeCanonica(expr);

/** Um produto com tudo que se sabe dele para propor conversoes: nome, contagem, o que ja converte e o que as notas dizem. */
export type ProdutoCarregadoParaConversao = {
  productId: string;
  codigo: string | null;
  nome: string;
  contagem: string | null;
  entrada: ProdutoParaConversao;
};

/** Carrega, de uma vez, os produtos ativos (ou so os informados) com conversoes cadastradas e compras sem conversao. */
export async function carregarProdutosParaConversao(productIds?: string[]): Promise<ProdutoCarregadoParaConversao[]> {
  const filtro = productIds?.length ? Prisma.sql`AND pr."id" IN (${Prisma.join(productIds)})` : Prisma.empty;

  const produtos = await prisma.$queryRaw<Array<{ id: string; codigo: string | null; nome: string; contagem: string | null; compra: string | null }>>`
    SELECT pr."id", pr."externalCode" AS codigo, pr."name" AS nome,
           COALESCE(pr."stockUnit", pr."unit") AS contagem, pr."purchaseUnit" AS compra
    FROM "Product" pr
    WHERE pr."isActive" = true AND COALESCE(pr."stockUnit", pr."unit") IS NOT NULL ${filtro}
  `;
  if (!produtos.length) return [];
  const ids = produtos.map((p) => p.id);

  const [conversoes, notas, precos] = await Promise.all([
    prisma.$queryRaw<Array<{ productId: string; fromUnit: string; toUnit: string; factor: Prisma.Decimal }>>`
      SELECT "productId", "fromUnit", "toUnit", "factor" FROM "ProductUnitConversion"
      WHERE "isActive" = true AND "productId" IN (${Prisma.join(ids)})
    `,
    // Compras que ainda nao estao na unidade de contagem, por unidade da nota.
    prisma.$queryRaw<Array<{ productId: string; unidade: string; linhas: bigint; valor: Prisma.Decimal | null; quantidade: Prisma.Decimal | null }>>`
      SELECT pi."productId", ${canonica(Prisma.sql`pi."unit"`)} AS unidade,
             COUNT(*) AS linhas, SUM(pi."totalPrice") AS valor, SUM(pi."quantity") AS quantidade
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      WHERE p."status" = 'ACTIVE' AND pi."unit" IS NOT NULL AND pi."productId" IN (${Prisma.join(ids)})
        AND NOT ${sqlCompraNaUnidadeDeContagem()}
      GROUP BY 1, 2
    `,
    // Preco normal na unidade de contagem: a mediana das compras que ja estao nela.
    prisma.$queryRaw<Array<{ productId: string; preco: number | null }>>`
      SELECT pi."productId",
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pi."totalPrice" / NULLIF(COALESCE(pi."convertedQuantity", pi."quantity"), 0)) AS preco
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      WHERE p."status" = 'ACTIVE' AND pi."totalPrice" > 0 AND COALESCE(pi."convertedQuantity", pi."quantity") > 0
        AND pi."productId" IN (${Prisma.join(ids)})
        AND ${sqlCompraNaUnidadeDeContagem()}
      GROUP BY 1
    `
  ]);

  const agrupar = <T extends { productId: string }>(linhas: T[]) => {
    const mapa = new Map<string, T[]>();
    for (const linha of linhas) mapa.set(linha.productId, [...(mapa.get(linha.productId) ?? []), linha]);
    return mapa;
  };
  const conversoesPorProduto = agrupar(conversoes);
  const notasPorProduto = agrupar(notas);
  const precoPorProduto = new Map(precos.map((p) => [p.productId, p.preco == null ? null : Number(p.preco)]));

  return produtos.map((p) => {
    const unidadesDaNota: UnidadeDaNota[] = (notasPorProduto.get(p.id) ?? []).map((n) => {
      const valor = Number(n.valor ?? 0);
      const quantidade = Number(n.quantidade ?? 0);
      return { unidade: n.unidade, linhas: Number(n.linhas), valor, precoPorUnidade: quantidade > 0 ? valor / quantidade : null };
    });
    // A unidade de compra do cadastro vale mesmo sem compra: a proxima nota ja converte.
    if (p.compra && !unidadesDaNota.some((n) => normalizarUnidade(n.unidade) === normalizarUnidade(p.compra))) {
      unidadesDaNota.push({ unidade: p.compra, linhas: 0, valor: 0, precoPorUnidade: null });
    }
    const cadastradas: UnitConversion[] = (conversoesPorProduto.get(p.id) ?? []).map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }));
    return {
      productId: p.id,
      codigo: p.codigo,
      nome: p.nome,
      contagem: p.contagem,
      entrada: { nome: p.nome, unidadeDeContagem: p.contagem, cadastradas, unidadesDaNota, precoNaContagem: precoPorProduto.get(p.id) ?? null }
    };
  });
}

/** Propostas de todos os produtos ativos, ou so dos informados. */
export async function listarPropostasDeConversao(productIds?: string[]): Promise<ProdutoComPropostas[]> {
  const carregados = await carregarProdutosParaConversao(productIds);
  const resultado: ProdutoComPropostas[] = [];
  for (const p of carregados) {
    const propostas = proporConversoes(p.entrada);
    if (propostas.length) {
      resultado.push({ productId: p.productId, codigo: p.codigo, nome: p.nome, unidadeDeContagem: normalizarUnidade(p.contagem), propostas });
    }
  }
  return resultado.sort((a, b) => sum(b.propostas) - sum(a.propostas) || a.nome.localeCompare(b.nome));
}

function sum(propostas: PropostaDeConversao[]) {
  return propostas.reduce((s, p) => s + p.valor, 0);
}

export type EscolhaDeConversao = { productId: string; fromUnit: string };

export type ResultadoDaAplicacao = {
  conversoesCriadas: number;
  comprasConvertidas: number;
  /** Compras em mes travado ou CMV fechado: a conversao vale para as proximas, estas ficam como estao. */
  comprasEmPeriodoFechado: number;
  produtos: Array<{ productId: string; nome: string; fromUnit: string; toUnit: string; factor: number; comprasConvertidas: number; comprasEmPeriodoFechado: number }>;
};

export type ConversaoParaAplicar = {
  productId: string;
  nome: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  /** Texto gravado nas observacoes da conversao e na auditoria. */
  motivo: string;
  origem: "AUTOMATICA" | "MANUAL";
  userId: string;
};

/**
 * Cadastra UMA conversao e refaz as compras sem conversao dela (as de periodo fechado ficam como estao).
 * Conversao ja cadastrada para o par nao e substituida. Nao mexe em saldo nem em custo medio do estoque.
 */
export async function aplicarUmaConversao(entrada: ConversaoParaAplicar, periodoFechado = new Map<string, boolean>()) {
  const criadas = await prisma.$executeRaw`
    INSERT INTO "ProductUnitConversion" ("id", "productId", "fromUnit", "toUnit", "factor", "isActive", "notes", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${entrada.productId}, ${entrada.fromUnit}, ${entrada.toUnit}, ${entrada.factor}, true, ${entrada.motivo}, CURRENT_TIMESTAMP)
    ON CONFLICT ("productId", "fromUnit", "toUnit") DO NOTHING
  `;

  const itens = await prisma.$queryRaw<Array<{ id: string; quantity: Prisma.Decimal; unit: string | null; totalPrice: Prisma.Decimal; data: Date }>>`
    SELECT pi."id", pi."quantity", pi."unit", pi."totalPrice", COALESCE(p."receivedAt", p."purchaseDate") AS data
    FROM "PurchaseItem" pi
    JOIN "Purchase" p ON p."id" = pi."purchaseId"
    JOIN "Product" pr ON pr."id" = pi."productId"
    WHERE pi."productId" = ${entrada.productId} AND p."status" = 'ACTIVE'
      AND ${canonica(Prisma.sql`pi."unit"`)} = ${entrada.fromUnit}
      AND NOT ${sqlCompraNaUnidadeDeContagem()}
  `;

  let convertidas = 0;
  let fechadas = 0;
  for (const item of itens) {
    const dia = item.data.toISOString().slice(0, 10);
    if (!periodoFechado.has(dia)) {
      try {
        await assertPeriodWritableForDate(item.data, "Conversao de unidade");
        periodoFechado.set(dia, false);
      } catch (error) {
        if (!(error instanceof PeriodLockedError)) throw error;
        periodoFechado.set(dia, true);
      }
    }
    if (periodoFechado.get(dia)) {
      fechadas++;
      continue;
    }
    const gravado = await gravarConversaoDoItemDeCompra({
      productId: entrada.productId,
      purchaseItemId: item.id,
      quantity: Number(item.quantity),
      unit: item.unit,
      totalCost: Number(item.totalPrice)
    });
    if (gravado && !gravado.conversao.conversionMissing) convertidas++;
  }

  await auditLog({
    userId: entrada.userId,
    action: entrada.origem === "MANUAL" ? "MANUAL_PRODUCT_UNIT_CONVERSION" : "AUTO_PRODUCT_UNIT_CONVERSION",
    entity: "Product",
    entityId: entrada.productId,
    newValue: { fromUnit: entrada.fromUnit, toUnit: entrada.toUnit, factor: entrada.factor, motivo: entrada.motivo, comprasConvertidas: convertidas, comprasEmPeriodoFechado: fechadas, criada: Number(criadas) > 0 }
  });
  return { criada: Number(criadas) > 0, comprasConvertidas: convertidas, comprasEmPeriodoFechado: fechadas };
}

/**
 * Cadastra as conversoes escolhidas e refaz as compras sem conversao delas.
 * O fator sempre e recalculado aqui (nunca vem do cliente). Conversao ja
 * cadastrada para o par nao e substituida.
 */
export async function aplicarConversoes(input: { escolhas?: EscolhaDeConversao[]; todasDeAltaConfianca?: boolean; userId: string }): Promise<ResultadoDaAplicacao> {
  const ids = input.todasDeAltaConfianca ? undefined : [...new Set((input.escolhas ?? []).map((e) => e.productId))];
  if (ids && ids.length === 0) return { conversoesCriadas: 0, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, produtos: [] };

  const listados = await listarPropostasDeConversao(ids);
  const escolhidas = new Set((input.escolhas ?? []).map((e) => `${e.productId}|${normalizarUnidade(e.fromUnit)}`));
  const aAplicar = listados.flatMap((produto) =>
    produto.propostas
      .filter((p) => (input.todasDeAltaConfianca ? p.confianca === "alta" : escolhidas.has(`${produto.productId}|${p.fromUnit}`)))
      .map((proposta) => ({ produto, proposta }))
  );

  const resultado: ResultadoDaAplicacao = { conversoesCriadas: 0, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, produtos: [] };
  const periodoFechado = new Map<string, boolean>();

  for (const { produto, proposta } of aAplicar) {
    const aplicada = await aplicarUmaConversao({
      productId: produto.productId,
      nome: produto.nome,
      fromUnit: proposta.fromUnit,
      toUnit: proposta.toUnit,
      factor: proposta.factor,
      motivo: `Automática (${proposta.confianca === "alta" ? "aplicada pelo sistema" : "confirmada pelo operador"}): ${proposta.motivo}`,
      origem: "AUTOMATICA",
      userId: input.userId
    }, periodoFechado);

    resultado.conversoesCriadas += aplicada.criada ? 1 : 0;
    resultado.comprasConvertidas += aplicada.comprasConvertidas;
    resultado.comprasEmPeriodoFechado += aplicada.comprasEmPeriodoFechado;
    resultado.produtos.push({
      productId: produto.productId,
      nome: produto.nome,
      fromUnit: proposta.fromUnit,
      toUnit: proposta.toUnit,
      factor: proposta.factor,
      comprasConvertidas: aplicada.comprasConvertidas,
      comprasEmPeriodoFechado: aplicada.comprasEmPeriodoFechado
    });
  }

  return resultado;
}
