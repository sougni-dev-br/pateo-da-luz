import { prisma } from "../../config/database.js";

// Parcela de parcelamento em lote não se edita, cancela nem restaura como compra comum:
// o acordo é um conjunto (total, vencimentos, saldo). Alterações vão pelo próprio parcelamento
// (renegociar ou cancelar) e juros, multa ou desconto entram na baixa, no Contas a Pagar.

export type ParcelamentoDaCompra = { planId: string; description: string; numero: number | null; total: number };

export async function parcelamentoDaCompra(purchaseId: string): Promise<ParcelamentoDaCompra | null> {
  const [linha] = await prisma.$queryRaw<Array<{ planId: string; description: string; numero: number | null; total: number }>>`
    SELECT ip."id" AS "planId", ip."description" AS "description", pu."planInstallmentNumber" AS "numero",
           ip."installmentCount" AS "total"
    FROM "InstallmentPlan" ip
    JOIN "Purchase" pu ON pu."installmentPlanId" = ip."id"
    WHERE pu."id" = ${purchaseId}
    LIMIT 1
  `;
  return linha ?? null;
}

export function mensagemCompraDeParcelamento(p: ParcelamentoDaCompra, acao: "editar" | "cancelar" | "restaurar"): string {
  const parcela = p.numero ? `Parcela ${p.numero}/${p.total}` : "Parcela";
  return `${parcela} do parcelamento "${p.description}": não é possível ${acao} aqui. `
    + "Para mudar o acordo, renegocie ou cancele em Financeiro > Parcelamentos. "
    + "Juros, multa ou desconto entram na baixa, no Contas a Pagar.";
}
