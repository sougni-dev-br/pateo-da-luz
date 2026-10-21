-- Impostos e Guias: a mesma guia (mesmo número de documento) não pode estar ativa duas vezes.
-- A comparação ignora pontuação e caixa ("07.20.26290.7165263-2" = "07202629071652632") e vale só para guias
-- não excluídas e não canceladas. A coluna é nova, então nenhuma guia existente entra em conflito.
CREATE UNIQUE INDEX IF NOT EXISTS "TaxPayment_documentNumber_ativo_key"
  ON "TaxPayment" ((regexp_replace(upper("documentNumber"), '[^A-Z0-9]', '', 'g')))
  WHERE "documentNumber" IS NOT NULL AND "deletedAt" IS NULL AND "status" <> 'CANCELED';
