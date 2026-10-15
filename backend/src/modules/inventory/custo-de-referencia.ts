// Custo de referencia do produto para as fichas tecnicas: o que as compras e a
// base oficial dizem hoje, no lugar do custo medio do saldo (InventoryStock.averageCost).
//
// O saldo nunca baixa, entao a media mistura todas as compras desde sempre e
// herda erro de unidade (caixa de 60 guardanapos contada como 1 UN a R$ 490,72).
// A regra de escolha e a mesma da conferencia do inventario (custo-inventario.ts).
// Nada aqui escreve no banco.

import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { sqlCompraNaUnidadeDeContagem, sqlUnidadeCanonica } from "../../shared/unidades/compra-na-contagem.sql.js";
import { escolherCusto, type CandidatosDoCusto, type FonteDoCusto } from "./custo-inventario.js";

export type FonteDoCustoDeReferencia = FonteDoCusto | "ESTOQUE";

export type CustoDeReferencia = {
  valor: number;
  fonte: FonteDoCustoDeReferencia;
  detalhe: string | null;
  /** Motivo de nao confiar no resultado; a simulacao lista esses produtos. */
  revisar: string | null;
};

/** Base oficial que difere do custo do estoque mais que isso nao e confiavel (custo de barril gravado como litro). */
export const BASE_DIVERGENTE = { min: 1 / 3, max: 3 };

const positivo = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function decidirCustoDeReferencia(input: {
  controlsStock: boolean;
  averageCost: number | null;
  candidatos: CandidatosDoCusto;
}): CustoDeReferencia | null {
  const doEstoque = (revisar: string | null): CustoDeReferencia | null =>
    positivo(input.averageCost) ? { valor: input.averageCost, fonte: "ESTOQUE", detalhe: null, revisar } : null;

  // Despesa (aluguel, manutencao, farmacia): nao e ingrediente, o custo medio continua valendo.
  if (!input.controlsStock) return doEstoque(null);

  const escolhido = escolherCusto({ ...input.candidatos, informado: null });
  if (!escolhido) return doEstoque(null);

  if (escolhido.fonte === "BASE_ANTERIOR" && positivo(input.averageCost)) {
    const razao = escolhido.valor / input.averageCost;
    if (razao > BASE_DIVERGENTE.max || razao < BASE_DIVERGENTE.min) {
      return doEstoque(`A base oficial (${escolhido.valor.toFixed(2)}) difere do custo do estoque (${input.averageCost.toFixed(2)}): confira a unidade da base.`);
    }
  }
  return { valor: escolhido.valor, fonte: escolhido.fonte, detalhe: escolhido.detalhe, revisar: null };
}

/** Chave de ligacao: "referencia" troca o custo das fichas; qualquer outro valor mantem o do estoque. */
export function custoDaFichaPelaReferencia(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CUSTO_FICHA_FONTE === "referencia";
}

type Linha = {
  productId: string;
  controlsStock: boolean;
  averageCost: Prisma.Decimal | null;
  periodo: Prisma.Decimal | null;
  ultimaCompra: Prisma.Decimal | null;
  ultimaCompraData: Date | null;
  base: Prisma.Decimal | null;
  baseAno: number | null;
  baseMes: number | null;
};

const numero = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));

/** Custo de referencia de cada produto informado, em tres consultas em lote (somente leitura). */
export async function carregarCustosDeReferencia(productIds: readonly string[]): Promise<Map<string, CustoDeReferencia>> {
  const ids = [...new Set(productIds)];
  const resultado = new Map<string, CustoDeReferencia>();
  if (!ids.length) return resultado;

  const linhas = await prisma.$queryRaw<Linha[]>`
    WITH anterior AS (
      SELECT DISTINCT ON (i."productId") i."productId", COALESCE(o."effectiveCountDate", o."date")::date AS dia
      FROM "OperationalInventoryItem" i
      JOIN "OperationalInventory" o ON o."id" = i."inventoryId"
      WHERE o."status" IN ('APROVADO', 'FECHADO') AND i."countedQuantity" IS NOT NULL
        AND i."productId" IN (${Prisma.join(ids)})
      ORDER BY i."productId", COALESCE(o."effectiveCountDate", o."date")::date DESC, o."approvedAt" DESC NULLS LAST
    ),
    periodo AS (
      SELECT pi."productId",
             SUM(pi."totalPrice") / NULLIF(SUM(COALESCE(pi."convertedQuantity", pi."quantity")), 0) AS custo
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr ON pr."id" = pi."productId"
      JOIN anterior a ON a."productId" = pi."productId"
      WHERE p."status" = 'ACTIVE' AND p."workflowStatus" = 'confirmed'
        AND pi."totalPrice" > 0 AND COALESCE(pi."convertedQuantity", pi."quantity") > 0
        AND COALESCE(p."receivedAt", p."purchaseDate")::date > a.dia
        AND ${sqlCompraNaUnidadeDeContagem()}
      GROUP BY pi."productId"
    )
    SELECT pr."id" AS "productId", pr."controlsStock", s."averageCost", periodo.custo AS periodo,
           ultima.custo AS "ultimaCompra", ultima.dia AS "ultimaCompraData",
           base."unitCost" AS base, base.ano AS "baseAno", base.mes AS "baseMes"
    FROM "Product" pr
    LEFT JOIN "InventoryStock" s ON s."productId" = pr."id"
    LEFT JOIN periodo ON periodo."productId" = pr."id"
    LEFT JOIN LATERAL (
      SELECT pi."totalPrice" / NULLIF(COALESCE(pi."convertedQuantity", pi."quantity"), 0) AS custo,
             COALESCE(p."receivedAt", p."purchaseDate") AS dia
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      JOIN "Product" pr2 ON pr2."id" = pi."productId"
      WHERE pi."productId" = pr."id"
        AND p."status" = 'ACTIVE' AND p."workflowStatus" = 'confirmed'
        AND pi."totalPrice" > 0 AND COALESCE(pi."convertedQuantity", pi."quantity") > 0
        AND ${sqlCompraNaUnidadeDeContagem("pi", "pr2")}
      ORDER BY COALESCE(p."receivedAt", p."purchaseDate") DESC, p."createdAt" DESC
      LIMIT 1
    ) ultima ON true
    LEFT JOIN LATERAL (
      SELECT si."unitCost", s2."competenceYear" AS ano, s2."competenceMonth" AS mes
      FROM "InventorySnapshotItem" si
      JOIN "InventorySnapshot" s2 ON s2."id" = si."snapshotId"
      WHERE si."productId" = pr."id" AND si."unitCost" > 0
        AND s2."status" <> 'CANCELLED'
        AND ${sqlUnidadeCanonica(Prisma.sql`si."unit"`)} = ${sqlUnidadeCanonica(Prisma.sql`COALESCE(pr."stockUnit", pr."unit")`)}
      ORDER BY s2."countDate" DESC, si."unitCost" DESC
      LIMIT 1
    ) base ON true
    WHERE pr."id" IN (${Prisma.join(ids)})
  `;

  for (const l of linhas) {
    const custo = decidirCustoDeReferencia({
      controlsStock: l.controlsStock,
      averageCost: numero(l.averageCost),
      candidatos: {
        periodo: numero(l.periodo),
        ultimaCompra: { valor: numero(l.ultimaCompra), data: l.ultimaCompraData },
        base: { valor: numero(l.base), ano: l.baseAno == null ? null : Number(l.baseAno), mes: l.baseMes == null ? null : Number(l.baseMes) },
        informado: null
      }
    });
    if (custo) resultado.set(l.productId, custo);
  }
  return resultado;
}
