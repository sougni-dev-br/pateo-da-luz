ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "stockUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "logisticsNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "storageLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "storageCorridor" TEXT,
  ADD COLUMN IF NOT EXISTS "storageShelf" TEXT,
  ADD COLUMN IF NOT EXISTS "storagePosition" TEXT,
  ADD COLUMN IF NOT EXISTS "storageNotes" TEXT;

CREATE INDEX IF NOT EXISTS "Product_stockUnit_idx" ON "Product"("stockUnit");
CREATE INDEX IF NOT EXISTS "Product_storageLocation_idx" ON "Product"("storageLocation");
