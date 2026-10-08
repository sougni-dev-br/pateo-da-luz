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
 * O CMV e a Parte B do DRE nao sao afetados: somam "PurchaseItem"."totalPrice",
 * e o agregador nao tem item (ver comentario em comprasSemItem, monthly-closure).
 * A Parte A do DRE era: ela soma PaymentInstallment de compra sem itens, e o
 * titulo do agregador entrava ali (jun–set/2026, R$ 69.375,96 a mais). O DRE
 * aplica este filtro nas consultas de titulo.
 *
 * Contas a pagar e caixa NAO usam: o titulo e gerado SO pelo agregador, nunca
 * pelas compras originais — conferido, os ciclos fechados tem 0 titulos nas
 * notas originais. La o agregador e justamente o registro certo.
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

/**
 * Como o titulo do agregador fica fora do DRE, a despesa so chega ao resultado
 * pelos itens das compras agrupadas. Compra sem item, cancelada ou ausente nao
 * leva nada: fechar ciclo ou fatura com ela tiraria o gasto do DRE e o deixaria
 * so no caixa. Os fechamentos recusam enquanto houver uma assim.
 */
export function compraLevaDespesaAoDre(compra: { status: string; itens: number } | null): boolean {
  return compra !== null && compra.status === "ACTIVE" && compra.itens > 0;
}

/** Versao Prisma Client do mesmo filtro, para `where` de findMany/count. */
export const excludeAggregatorsWhere: Prisma.PurchaseWhereInput = {
  NOT: { workflowStatus: { in: [...AGGREGATOR_WORKFLOW_STATUSES] } }
};
