// Resumo do faturamento da Keeta.
//
// Fonte: `RevenueEntry` com `sourcePlatform = 'Keeta'` e `status = 'ACTIVE'`.
// Não há integração nem tabela de vendas — o faturamento é importado do portal
// (merchant.mykeeta.com) e gravado direto no razão de receita, uma linha por
// dia. O filtro por `status` não é detalhe: o import de 19/09/2026 CANCELOU as
// 59 linhas antigas de planilha em vez de apagá-las, e somá-las de volta
// dobraria abril e maio.

import { prisma } from "../../../../config/database.js";
import { montarResumo, type KeetaDia, type KeetaResumo } from "./keeta-resumo.js";

export const KEETA_SOURCE_PLATFORM = "Keeta";

async function lerDias(year: number, month: number): Promise<KeetaDia[]> {
  const rows = await prisma.$queryRaw<Array<{
    date: string; orders: number | null; gross: number | null; net: number | null;
  }>>`
    SELECT to_char("date", 'YYYY-MM-DD') AS "date",
           SUM(COALESCE(tickets, 0))::int AS "orders",
           SUM("grossAmount")::float8     AS "gross",
           SUM("netAmount")::float8       AS "net"
    FROM "RevenueEntry"
    WHERE "sourcePlatform" = ${KEETA_SOURCE_PLATFORM}
      AND status = 'ACTIVE'
      AND "competenceYear" = ${year}
      AND "competenceMonth" = ${month}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((r) => ({
    date: r.date,
    orders: r.orders ?? 0,
    grossAmount: Number(r.gross ?? 0),
    netAmount: Number(r.net ?? 0)
  }));
}

export async function getKeetaSummary(params: { year: number; month: number }): Promise<KeetaResumo> {
  const total = params.year * 12 + (params.month - 1) - 1;
  const anterior = { year: Math.floor(total / 12), month: (total % 12) + 1 };
  const [dias, diasAnteriores] = await Promise.all([
    lerDias(params.year, params.month),
    lerDias(anterior.year, anterior.month)
  ]);
  return montarResumo({ year: params.year, month: params.month, dias, diasAnteriores });
}
