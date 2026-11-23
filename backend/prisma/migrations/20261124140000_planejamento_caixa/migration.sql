-- AlterTable
ALTER TABLE "PlanejamentoCenario" ADD COLUMN "caixa" JSONB;

-- AlterTable
ALTER TABLE "PlanejamentoGastoLinha" ADD COLUMN "pagoNoMes" DECIMAL(5,4) NOT NULL DEFAULT 1;
