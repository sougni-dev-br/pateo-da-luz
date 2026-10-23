import { Prisma } from "@prisma/client";

/**
 * Fragmento SQL que tira do DRE e dos totais de resultado as compras de um parcelamento marcado
 * como "fora do DRE" (dívida cuja despesa já foi lançada nos meses de origem). Contas a Pagar,
 * caixa, fornecedores e o fechamento mensal NÃO usam: o título existe e precisa ser pago e conferido.
 *
 * @param alias como a tabela "Purchase" foi nomeada na consulta; sem alias, passe `Purchase`.
 */
export function semParcelamentoForaDoDreSql(alias = "Purchase"): Prisma.Sql {
  const table = Prisma.raw(`"${alias}"`);
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "InstallmentPlan" ip_dre
    WHERE ip_dre."id" = ${table}."installmentPlanId" AND ip_dre."excludeFromDre" = true
  )`;
}
