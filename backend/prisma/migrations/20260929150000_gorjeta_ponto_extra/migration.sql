-- Função e pontos separados: a base de cada pessoa é SEMPRE a da função, mais um
-- ponto extra (positivo ou negativo) com justificativa. Substitui os "pontos
-- personalizados", que trocavam os pontos da função por outro número.

ALTER TABLE "Employee" ADD COLUMN "pontosExtra" DECIMAL(6,2);
ALTER TABLE "Employee" ADD COLUMN "pontosExtraMotivo" TEXT;
ALTER TABLE "EmployeeTipHistory" ADD COLUMN "pontosExtra" DECIMAL(6,2);
ALTER TABLE "EmployeeTipHistory" ADD COLUMN "pontosExtraMotivo" TEXT;

-- Converte: extra = personalizados − pontos da função (sem função, tudo vira extra).
UPDATE "Employee" e
SET "pontosExtra" = e."pontosPadrao" - COALESCE((SELECT f."points" FROM "TipFunction" f WHERE f."id" = e."tipFunctionId"), 0),
    "pontosExtraMotivo" = 'Convertido dos pontos personalizados ('
      || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM e."pontosPadrao"::text)) || ' pts no lugar dos da função)'
WHERE e."pontosPadrao" IS NOT NULL
  AND e."pontosPadrao" <> COALESCE((SELECT f."points" FROM "TipFunction" f WHERE f."id" = e."tipFunctionId"), 0);

ALTER TABLE "Employee" DROP COLUMN "pontosPadrao";
