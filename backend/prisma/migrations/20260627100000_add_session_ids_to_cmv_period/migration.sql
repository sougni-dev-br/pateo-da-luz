-- Add session traceability to CmvPeriod.
-- estoqueInicialSessionId / estoqueFinalSessionId link the period back to the
-- StockCountSession the user picked. The snapshot IDs remain as the CMV engine's
-- input (totalValue). Both columns are nullable so all existing periods are
-- unaffected.
ALTER TABLE "CmvPeriod"
  ADD COLUMN IF NOT EXISTS "estoqueInicialSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "estoqueFinalSessionId"   TEXT;

CREATE INDEX IF NOT EXISTS "CmvPeriod_estoqueInicialSessionId_idx"
  ON "CmvPeriod" ("estoqueInicialSessionId");

CREATE INDEX IF NOT EXISTS "CmvPeriod_estoqueFinalSessionId_idx"
  ON "CmvPeriod" ("estoqueFinalSessionId");
