ALTER TABLE "StockCountSession"
  ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "canceledByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

CREATE INDEX IF NOT EXISTS "StockCountSession_canceledByUserId_idx" ON "StockCountSession"("canceledByUserId");
