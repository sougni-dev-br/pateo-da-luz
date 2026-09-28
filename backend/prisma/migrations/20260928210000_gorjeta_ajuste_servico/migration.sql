-- Serviço arrecadado da gorjeta: faturamento + ajuste manual (com motivo), no
-- lugar de sobrescrever o total. Períodos existentes: o total vira o "faturamento".
ALTER TABLE "TipPeriod" ADD COLUMN "servicoFaturamento" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "TipPeriod" ADD COLUMN "ajusteServico" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "TipPeriod" ADD COLUMN "ajusteServicoMotivo" TEXT;
UPDATE "TipPeriod" SET "servicoFaturamento" = "grossPool";
