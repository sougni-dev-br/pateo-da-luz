DO $$ BEGIN
  CREATE TYPE "CmvPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CmvPeriod" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "dataInicial" TIMESTAMP(3) NOT NULL,
  "dataFinal" TIMESTAMP(3) NOT NULL,
  "estoqueInicialSnapshotId" TEXT,
  "estoqueFinalSnapshotId" TEXT,
  "comprasTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "faturamentoTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "estoqueInicialTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "estoqueFinalTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cmvReal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cmvPercentual" DECIMAL(10,4),
  "margemBruta" DECIMAL(14,2),
  "status" "CmvPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "fechadoPor" TEXT,
  "fechadoEm" TIMESTAMP(3),
  "reabertoPor" TEXT,
  "reabertoEm" TIMESTAMP(3),
  "motivoReabertura" TEXT,
  "observacoes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CmvPeriod_dates_idx" ON "CmvPeriod"("dataInicial", "dataFinal");
CREATE INDEX IF NOT EXISTS "CmvPeriod_status_idx" ON "CmvPeriod"("status");
CREATE INDEX IF NOT EXISTS "CmvPeriod_fechadoPor_idx" ON "CmvPeriod"("fechadoPor");
CREATE INDEX IF NOT EXISTS "CmvPeriod_reabertoPor_idx" ON "CmvPeriod"("reabertoPor");
