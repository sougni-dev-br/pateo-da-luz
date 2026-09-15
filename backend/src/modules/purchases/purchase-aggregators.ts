import { Prisma } from "@prisma/client";

/**
 * Agregadores de pagamento: a Purchase que nasce do fechamento de um ciclo de
 * fornecedor ou de uma fatura de cartao.
 *
 * Ela NAO e uma compra. E o veiculo que leva ao Contas a Pagar o valor das
 * compras individuais que ja foram lancadas e depois agrupadas — por isso nasce
 * sem nenhum PurchaseItem, e por isso as compras originais continuam ACTIVE e
 * seguem carregando os itens de produto.
 *
 * Consequencia: toda soma de "Purchase"."totalAmount" que nao excluir o
 * agregador conta a mesma despesa duas vezes. Medido em producao em 15/09/2026,
 * com 6 agregadores ativos: jun +R$ 19.072,70, jul +R$ 20.474,57,
 * ago +R$ 27.498,05 — R$ 67.045,32 de compra que nunca existiu.
 *
 * CMV e DRE nao sao afetados: eles somam "PurchaseItem"."totalPrice", e o
 * agregador nao tem item (ver comentario em comprasSemItem, monthly-closure).
 *
 * Contas a pagar tambem nao: o titulo e gerado SO pelo agregador, nunca pelas
 * compras originais — conferido, os 6 ciclos fechados tem 0 titulos nas notas
 * originais. Nao use este filtro em consulta de PaymentInstallment: la o
 * agregador e justamente o registro certo.
 *
 * O criterio primario e o workflowStatus, gravado no INSERT que cria o
 * agregador. O EXISTS no vinculo entra como rede de seguranca — e ela precisa
 * ser a secundaria: ha agregador em producao (CICLO-D961D02F, cancelado) cujo
 * generatedPurchaseId se perdeu, entao o vinculo sozinho deixaria passar.
 */
export const AGGREGATOR_WORKFLOW_STATUSES = ["SUPPLIER_CYCLE", "CARD_STATEMENT"] as const;

export function isAggregatorWorkflowStatus(value: string | null | undefined): boolean {
  return value === "SUPPLIER_CYCLE" || value === "CARD_STATEMENT";
}

/**
 * Fragmento SQL que mantem apenas compras de verdade.
 *
 * @param alias como a tabela "Purchase" foi nomeada na consulta — o alias de
 *   `FROM "Purchase" p` e `p`; sem alias, passe `Purchase`.
 */
export function excludeAggregatorsSql(alias = "Purchase"): Prisma.Sql {
  const table = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(
    COALESCE(${table}."workflowStatus", '') NOT IN ('SUPPLIER_CYCLE', 'CARD_STATEMENT')
    AND NOT EXISTS (
      SELECT 1 FROM "SupplierBillingCycle" agg_cy WHERE agg_cy."generatedPurchaseId" = ${table}."id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "CreditCardStatement" agg_cs WHERE agg_cs."generatedPurchaseId" = ${table}."id"
    )
  )`;
}

/** Versao Prisma Client do mesmo filtro, para `where` de findMany/count. */
export const excludeAggregatorsWhere: Prisma.PurchaseWhereInput = {
  NOT: { workflowStatus: { in: [...AGGREGATOR_WORKFLOW_STATUSES] } }
};
