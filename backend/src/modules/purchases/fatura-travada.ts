import { prisma } from "../../config/database.js";

type FaturaTravada = { status: string; competenceYear: number; competenceMonth: number; cardName: string };

/**
 * Faturas fechadas ou pagas que contem parcelas da compra. Mexer na compra apaga e recria as linhas
 * dela nas faturas: numa fatura fechada o titulo do Contas a pagar nao acompanha, e como ele nao entra
 * no DRE o dinheiro sairia do caixa sem despesa. Por isso a fatura precisa ser reaberta antes.
 */
export async function faturasTravadasDaCompra(purchaseId: string): Promise<FaturaTravada[]> {
  return prisma.$queryRaw<FaturaTravada[]>`
    SELECT DISTINCT s."status"::text AS "status", s."competenceYear", s."competenceMonth", c."name" AS "cardName"
    FROM "CreditCardStatementItem" si
    JOIN "CreditCardStatement" s ON s."id" = si."statementId"
    JOIN "CreditCard" c ON c."id" = s."creditCardId"
    WHERE si."purchaseId" = ${purchaseId}
      AND s."status" IN ('CLOSED', 'PAID')
  `;
}

/** Mensagem de recusa para a acao informada ("editar" ou "cancelar"), ou null se nada trava a compra. */
export function mensagemDeFaturaTravada(faturas: FaturaTravada[], acao: "editar" | "cancelar"): string | null {
  if (faturas.length === 0) return null;
  const rotulo = (f: FaturaTravada) => `${String(f.competenceMonth).padStart(2, "0")}/${f.competenceYear} do ${f.cardName}`;
  const pagas = faturas.filter((f) => f.status === "PAID");
  if (pagas.length > 0) {
    return acao === "cancelar"
      ? `A compra esta na fatura ${pagas.map(rotulo).join(", ")}, ja paga: o dinheiro saiu e a compra nao pode ser cancelada. Se o cartao estornou o valor, o estorno entra na fatura em que aparecer.`
      : `A compra esta na fatura ${pagas.map(rotulo).join(", ")}, ja paga: o dinheiro saiu e a compra nao pode ser editada. Se o valor cobrado foi diferente, registre a diferenca como credito ou estorno na fatura em que aparecer.`;
  }
  return `A compra esta na fatura ${faturas.map(rotulo).join(", ")}, ja fechada. Reabra a fatura (com justificativa) antes de ${acao} a compra, e feche de novo depois.`;
}
