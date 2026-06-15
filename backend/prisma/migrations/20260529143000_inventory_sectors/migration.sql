CREATE TABLE IF NOT EXISTS "InventorySector" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "countOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventorySector_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventorySector_normalizedName_key" ON "InventorySector"("normalizedName");
CREATE INDEX IF NOT EXISTS "InventorySector_name_idx" ON "InventorySector"("name");
CREATE INDEX IF NOT EXISTS "InventorySector_countOrder_idx" ON "InventorySector"("countOrder");
CREATE INDEX IF NOT EXISTS "InventorySector_isActive_idx" ON "InventorySector"("isActive");

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "inventorySectorId" TEXT,
  ADD COLUMN IF NOT EXISTS "accountType" TEXT,
  ADD COLUMN IF NOT EXISTS "controlsStock" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Product_inventorySectorId_idx" ON "Product"("inventorySectorId");
CREATE INDEX IF NOT EXISTS "Product_controlsStock_idx" ON "Product"("controlsStock");
CREATE INDEX IF NOT EXISTS "Product_accountType_idx" ON "Product"("accountType");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_inventorySectorId_fkey"
  FOREIGN KEY ("inventorySectorId") REFERENCES "InventorySector"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockCount"
  ADD COLUMN IF NOT EXISTS "productCodeSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "productNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "sectorSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "categorySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "subcategorySnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "unitSnapshot" TEXT;

ALTER TABLE "InventoryAgendaRule"
  ADD COLUMN IF NOT EXISTS "sectorId" TEXT,
  ADD COLUMN IF NOT EXISTS "sectorName" TEXT;

CREATE INDEX IF NOT EXISTS "InventoryAgendaRule_sectorId_idx" ON "InventoryAgendaRule"("sectorId");

ALTER TABLE "InventoryAgendaItem"
  ADD COLUMN IF NOT EXISTS "sectorId" TEXT,
  ADD COLUMN IF NOT EXISTS "sectorName" TEXT;

UPDATE "InventoryAgendaRule"
SET "sectorName" = "categoryName"
WHERE "sectorName" IS NULL;

UPDATE "InventoryAgendaItem"
SET "sectorName" = "categoryName"
WHERE "sectorName" IS NULL;
