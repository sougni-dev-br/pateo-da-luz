-- Add source column to StockCountSession to track origin (SISTEMA vs IMPORTACAO_PLANILHA)
ALTER TABLE "StockCountSession" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'SISTEMA';
