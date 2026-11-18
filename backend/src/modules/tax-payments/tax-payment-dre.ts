import { Prisma } from "@prisma/client";

// O DARF da Receita (DCTFWeb) é UM documento, um pagamento e um número, mas junta INSS (1082, 1099) e IRRF (0561). A guia
// tem uma categoria só, e INSS pertence ao grupo Pessoal enquanto IRRF / DARF pertence a Impostos: com a guia inteira numa
// categoria, o DRE por grupo ficava errado (jul/2026: R$ 2.109,57 de INSS contados como Impostos).
//
// Este trecho devolve as "linhas de DRE" das guias, uma subconsulta com as colunas
//   taxPaymentId, competenceDate, deletedAt, status, dreCategoryId, amount
// em que a guia cuja categoria é INSS ou IRRF / DARF e que tem linhas é distribuída por linha:
//   0561 (ou descrição de IRRF)            → IRRF / DARF
//   1082, 1099 (ou descrição previdenciária) → INSS
//   qualquer outra linha                    → a categoria da própria guia
// A diferença entre o valor da guia e o que as linhas somam (guia antiga; positiva ou negativa) fica na categoria da guia,
// então a SOMA das linhas de uma guia é sempre o valor dela: o resultado do DRE não muda, só a divisão entre os grupos. Guia sem linhas, ou de outra
// categoria (Simples, FGTS, GARE...), entra inteira como sempre entrou.
//
// Só literais: nada vindo do usuário entra aqui, então pode ser embutido em qualquer consulta crua.
const CATEGORIAS_DO_DARF = `(SELECT c.id FROM "DRECategory" c WHERE c.name IN ('INSS', 'IRRF / DARF'))`;
const CATEGORIA_INSS = `(SELECT c.id FROM "DRECategory" c WHERE c.name = 'INSS' ORDER BY c."isActive" DESC, c."sortOrder" LIMIT 1)`;
const CATEGORIA_IRRF = `(SELECT c.id FROM "DRECategory" c WHERE c.name = 'IRRF / DARF' ORDER BY c."isActive" DESC, c."sortOrder" LIMIT 1)`;

const LINHA_DE_IRRF = `ti.code = '0561' OR ti.description ~* '(\\mIRRF\\M|IMPOSTO SOBRE RENDA)'`;
const LINHA_DE_INSS = `ti.code IN ('1082', '1099') OR ti.description ~* '(CONTR PREV|CP (DESCONTADA )?SEGURADO|CONTRIB INDIVIDUAL|\\mINSS\\M|PREVID)'`;

const COLUNAS = `tp.id AS "taxPaymentId", tp."competenceDate" AS "competenceDate", tp."deletedAt" AS "deletedAt", tp.status AS status`;

export const taxPaymentDreLinhasSql = Prisma.raw(`
  SELECT ${COLUNAS}, tp."dreCategoryId" AS "dreCategoryId", tp.amount AS amount
  FROM "TaxPayment" tp
  WHERE tp."dreCategoryId" IS NULL
     OR tp."dreCategoryId" NOT IN ${CATEGORIAS_DO_DARF}
     OR NOT EXISTS (SELECT 1 FROM "TaxPaymentItem" x WHERE x."taxPaymentId" = tp.id)
  UNION ALL
  SELECT ${COLUNAS},
    COALESCE(
      CASE
        WHEN ${LINHA_DE_IRRF} THEN ${CATEGORIA_IRRF}
        WHEN ${LINHA_DE_INSS} THEN ${CATEGORIA_INSS}
        ELSE tp."dreCategoryId"
      END,
      tp."dreCategoryId") AS "dreCategoryId",
    SUM(ti.principal + ti.fine + ti.interest) AS amount
  FROM "TaxPayment" tp
  JOIN "TaxPaymentItem" ti ON ti."taxPaymentId" = tp.id
  WHERE tp."dreCategoryId" IN ${CATEGORIAS_DO_DARF}
  GROUP BY tp.id, tp."competenceDate", tp."deletedAt", tp.status, tp."dreCategoryId",
    COALESCE(
      CASE
        WHEN ${LINHA_DE_IRRF} THEN ${CATEGORIA_IRRF}
        WHEN ${LINHA_DE_INSS} THEN ${CATEGORIA_INSS}
        ELSE tp."dreCategoryId"
      END,
      tp."dreCategoryId")
  UNION ALL
  SELECT ${COLUNAS}, tp."dreCategoryId" AS "dreCategoryId", tp.amount - s.soma AS amount
  FROM "TaxPayment" tp
  JOIN (
    SELECT "taxPaymentId", SUM(principal + fine + interest) AS soma FROM "TaxPaymentItem" GROUP BY "taxPaymentId"
  ) s ON s."taxPaymentId" = tp.id
  WHERE tp."dreCategoryId" IN ${CATEGORIAS_DO_DARF}
    AND ABS(tp.amount - s.soma) > 0.005
`);
