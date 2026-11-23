import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { REVENUE_CHANNEL_SALON } from "../monthly/revenue-channels.js";
import { hojeEmBrasilia } from "../monthly/revenue-coverage.service.js";
import { mesclarFontes, mesesEncerradosAte, montarComparativo, type Comparativo, type MesDoSalao } from "./planejamento-comparativo.js";

type LinhaDoErp = {
  ano: number;
  mes: number;
  dias: number;
  vendasAlmoco: Prisma.Decimal | null;
  vendasJantar: Prisma.Decimal | null;
  clientesAlmoco: bigint | number | null;
  clientesJantar: bigint | number | null;
  servico: Prisma.Decimal | null;
  semPessoas: number;
};

/**
 * Venda do salão por mês e turno, direto do faturamento diário.
 *
 * O Agile PDV grava a venda do turno COM serviço (vl_total) e o serviço do turno à parte (shift1Service /
 * shift2Service). A planilha de planejamento usa Mesas SEM serviço, então o serviço do turno sai aqui.
 * Linhas vindas de importação de planilha não têm serviço por turno (zero) e já chegam sem serviço.
 */
async function mesesDoErp(anos: readonly number[]): Promise<MesDoSalao[]> {
  const linhas = await prisma.$queryRaw<LinhaDoErp[]>`
    SELECT "competenceYear" AS "ano",
           "competenceMonth" AS "mes",
           COUNT(DISTINCT "date")::int AS "dias",
           SUM("salesFirstShift" - "shift1Service") AS "vendasAlmoco",
           SUM("salesSecondShift" - "shift2Service") AS "vendasJantar",
           SUM(COALESCE("peopleFirstShift", 0)) AS "clientesAlmoco",
           SUM(COALESCE("peopleSecondShift", 0)) AS "clientesJantar",
           SUM("serviceAmount") AS "servico",
           COUNT(*) FILTER (
             WHERE ("peopleFirstShift" IS NULL AND "salesFirstShift" > 0)
                OR ("peopleSecondShift" IS NULL AND "salesSecondShift" > 0)
           )::int AS "semPessoas"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" = ${REVENUE_CHANNEL_SALON}
      AND "competenceYear" IN (${Prisma.join(anos as number[])})
    GROUP BY "competenceYear", "competenceMonth"
  `;
  return linhas.map((l) => ({
    ano: l.ano,
    mes: l.mes,
    vendasAlmoco: Number(l.vendasAlmoco ?? 0),
    vendasJantar: Number(l.vendasJantar ?? 0),
    clientesAlmoco: Number(l.clientesAlmoco ?? 0),
    clientesJantar: Number(l.clientesJantar ?? 0),
    servico: Number(l.servico ?? 0),
    fonte: "ERP" as const,
    diasComVenda: l.dias,
    clientesIncompletos: l.semPessoas > 0
  }));
}

async function mesesDoHistorico(anos: readonly number[]): Promise<MesDoSalao[]> {
  const linhas = await prisma.salaoHistoricoMensal.findMany({ where: { ano: { in: [...anos] } } });
  return linhas.map((l) => ({
    ano: l.ano,
    mes: l.mes,
    vendasAlmoco: Number(l.vendasAlmoco),
    vendasJantar: Number(l.vendasJantar),
    clientesAlmoco: l.clientesAlmoco,
    clientesJantar: l.clientesJantar,
    servico: Number(l.servico),
    fonte: "HISTORICO" as const
  }));
}

export async function carregarComparativo(anoBase: number, anoComparado: number): Promise<Comparativo & { hoje: string }> {
  const anos = [...new Set([anoBase, anoComparado])];
  const [erp, historico] = await Promise.all([mesesDoErp(anos), mesesDoHistorico(anos)]);
  const hoje = hojeEmBrasilia();
  const comparativo = montarComparativo(mesclarFontes(erp, historico), anoBase, anoComparado, mesesEncerradosAte(hoje, anos), hoje.slice(0, 7));
  return { ...comparativo, hoje };
}
