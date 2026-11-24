-- Endurecimento do módulo Planejamento: índices que as consultas do realizado de caixa e do comparativo usam e
-- restrições que garantem no banco o que o zod já valida na rota (edição manual no banco não quebra a tela).

-- Parcelas por compra: o realizado de caixa junta PaymentInstallment com Purchase em todas as consultas.
CREATE INDEX IF NOT EXISTS "PaymentInstallment_purchaseId_idx" ON "PaymentInstallment"("purchaseId");

-- Comparativo e mix de vendas leem RevenueEntry por data; parcial porque cancelado nunca entra nessas contas.
-- (Índice parcial: o schema.prisma não consegue expressá-lo, como o RevenueEntry_agile_lookup_idx.)
CREATE INDEX IF NOT EXISTS "RevenueEntry_date_idx" ON "RevenueEntry"("date") WHERE "status" <> 'CANCELLED';

-- A chave única (cenarioId, nome) já atende buscas por cenarioId, como prefixo: o índice simples só custa escrita.
DROP INDEX IF EXISTS "PlanejamentoGastoLinha_cenarioId_idx";

-- PlanejamentoGastoLinha
ALTER TABLE "PlanejamentoGastoLinha"
  ADD CONSTRAINT "PlanejamentoGastoLinha_valores_12_meses_check"
    CHECK (jsonb_typeof("valores") = 'array' AND jsonb_array_length("valores") = 12),
  ADD CONSTRAINT "PlanejamentoGastoLinha_pagoNoMes_check"
    CHECK ("pagoNoMes" >= 0 AND "pagoNoMes" <= 1),
  ADD CONSTRAINT "PlanejamentoGastoLinha_modo_check"
    CHECK ("modo" IN ('FIXO', 'PERCENTUAL')),
  ADD CONSTRAINT "PlanejamentoGastoLinha_grupo_check"
    CHECK ("grupo" IN ('OCUPACAO', 'TARIFAS_PUBLICAS', 'FOLHA', 'TRIBUTOS', 'DIVIDA', 'CONTRATOS', 'SEGUROS', 'TARIFAS_BANCARIAS', 'OUTROS'));

-- PlanejamentoCenario
ALTER TABLE "PlanejamentoCenario"
  ADD CONSTRAINT "PlanejamentoCenario_premissas_12_meses_check"
    CHECK (jsonb_typeof("premissas") = 'array' AND jsonb_array_length("premissas") = 12),
  ADD CONSTRAINT "PlanejamentoCenario_caixa_objeto_check"
    CHECK ("caixa" IS NULL OR jsonb_typeof("caixa") = 'object'),
  ADD CONSTRAINT "PlanejamentoCenario_servicoPercentual_check"
    CHECK ("servicoPercentual" IS NULL OR ("servicoPercentual" >= 0 AND "servicoPercentual" <= 1)),
  ADD CONSTRAINT "PlanejamentoCenario_anoBase_anterior_check"
    CHECK ("anoBase" < "ano");

-- SalaoHistoricoMensal
ALTER TABLE "SalaoHistoricoMensal"
  ADD CONSTRAINT "SalaoHistoricoMensal_mes_check" CHECK ("mes" BETWEEN 1 AND 12);
