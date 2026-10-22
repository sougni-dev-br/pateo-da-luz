// Consultas do histórico do fechamento. A regra de montagem vive em
// historico-do-mes.ts (pura, testada); aqui só se lê do banco.

import { prisma } from "../../config/database.js";
import {
  ACOES_DO_FECHAMENTO,
  entidadeDoMes,
  montarHistoricoDoMes,
  montarVisaoDosMeses,
  type LinhaDeAuditoria,
  type LinhaDeMes
} from "./historico-do-mes.js";

/** Teto de eventos por mês: um mês com 200 registros já pede outra tela. */
const LIMITE_DE_EVENTOS = 200;
const MESES_PADRAO = 12;
const MESES_MAXIMO = 36;

export async function getHistoricoDoMes(year: number, month: number) {
  const linhas = await prisma.$queryRaw<LinhaDeAuditoria[]>`
    SELECT a."id" AS "id", a."action" AS "action", a."createdAt" AS "createdAt",
           a."newValue" AS "newValue", u."name" AS "userName"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE a."entity" = 'MonthlyCmv'
      AND a."entityId" = ${entidadeDoMes(year, month)}
      AND a."action" = ANY(${ACOES_DO_FECHAMENTO})
    ORDER BY a."createdAt" DESC
    LIMIT ${LIMITE_DE_EVENTOS}
  `;
  return montarHistoricoDoMes(linhas);
}

export async function getVisaoDosMeses(limite = MESES_PADRAO) {
  const quantos = Math.min(MESES_MAXIMO, Math.max(1, Math.trunc(limite) || MESES_PADRAO));
  const linhas = await prisma.$queryRaw<LinhaDeMes[]>`
    SELECT m."competenceYear" AS "competenceYear",
           m."competenceMonth" AS "competenceMonth",
           m."status"::text AS "status",
           m."closedAt" AS "closedAt",
           cu."name" AS "closedByName",
           m."reopenedAt" AS "reopenedAt",
           ru."name" AS "reopenedByName",
           m."reopenReason" AS "reopenReason",
           CASE WHEN jsonb_typeof(m."justifications") = 'array'
                THEN jsonb_array_length(m."justifications") ELSE 0 END AS "justificativas",
           m."revenueGrossValue" AS "revenueGrossValue",
           m."cmvAttributedValue" AS "cmvAttributedValue"
    FROM "MonthlyCmv" m
    LEFT JOIN "User" cu ON cu."id" = m."closedByUserId"
    LEFT JOIN "User" ru ON ru."id" = m."reopenedByUserId"
    ORDER BY m."competenceYear" DESC, m."competenceMonth" DESC
    LIMIT ${quantos}
  `;
  return montarVisaoDosMeses(linhas);
}
