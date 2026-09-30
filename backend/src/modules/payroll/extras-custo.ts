// Custo de extras por dia — fonte única do DRE, do detalhamento e da tela.
// Regra (decisão do Eli, 30/09/2026): o custo é o valor de cada diária
// REALIZADA, na data do trabalho; e, quando o título foi baixado por valor
// diferente (pagou R$ 120 num título de R$ 100, com justificativa), a
// diferença também é custo, na data da última diária daquele título.
import { Prisma } from "@prisma/client";

// Linhas: valor, dia, se é diária (ou diferença de pagamento), id e código.
export const custoExtrasSql = Prisma.sql`
  SELECT s."totalAmount" AS valor, s."date" AS dia, true AS diaria, s.id AS ref, NULL::text AS codigo
  FROM "ExtraShift" s
  WHERE s."deletedAt" IS NULL AND s.status = 'REALIZADA'
  UNION ALL
  SELECT ep."paidAmount" - ep."amount" AS valor,
         (SELECT MAX(s2."date") FROM "ExtraShift" s2 WHERE s2."paymentId" = ep.id AND s2."deletedAt" IS NULL) AS dia,
         false AS diaria, ep.id AS ref, ep."code" AS codigo
  FROM "ExtraPayment" ep
  WHERE ep.status = 'PAID' AND ep."paidAmount" IS NOT NULL AND ep."paidAmount" <> ep."amount"
`;
