CREATE TABLE IF NOT EXISTS "OperationalInventory" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GERAL',
  "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
  "sectorId" TEXT,
  "sectorName" TEXT,
  "responsibleUserId" TEXT,
  "reviewedByUserId" TEXT,
  "approvedByUserId" TEXT,
  "closedByUserId" TEXT,
  "canceledByUserId" TEXT,
  "sentToReviewAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "notes" TEXT,
  "rejectionReason" TEXT,
  "cancelReason" TEXT,
  "inventorySnapshotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalInventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperationalInventory_code_key" ON "OperationalInventory"("code");
CREATE INDEX IF NOT EXISTS "OperationalInventory_date_idx" ON "OperationalInventory"("date");
CREATE INDEX IF NOT EXISTS "OperationalInventory_type_idx" ON "OperationalInventory"("type");
CREATE INDEX IF NOT EXISTS "OperationalInventory_status_idx" ON "OperationalInventory"("status");
CREATE INDEX IF NOT EXISTS "OperationalInventory_sectorId_idx" ON "OperationalInventory"("sectorId");
CREATE INDEX IF NOT EXISTS "OperationalInventory_responsibleUserId_idx" ON "OperationalInventory"("responsibleUserId");
CREATE INDEX IF NOT EXISTS "OperationalInventory_inventorySnapshotId_idx" ON "OperationalInventory"("inventorySnapshotId");

CREATE TABLE IF NOT EXISTS "OperationalInventoryItem" (
  "id" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "productId" TEXT,
  "productCode" TEXT,
  "productName" TEXT NOT NULL,
  "sectorName" TEXT,
  "categoryName" TEXT,
  "subcategoryName" TEXT,
  "location" TEXT,
  "unit" TEXT,
  "expectedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "countedQuantity" DECIMAL(14,3),
  "differenceQuantity" DECIMAL(14,3),
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "notes" TEXT,
  "countedByUserId" TEXT,
  "countedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalInventoryItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OperationalInventoryItem"
  ADD CONSTRAINT "OperationalInventoryItem_inventoryId_fkey"
  FOREIGN KEY ("inventoryId") REFERENCES "OperationalInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperationalInventoryItem"
  ADD CONSTRAINT "OperationalInventoryItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OperationalInventoryItem_inventoryId_idx" ON "OperationalInventoryItem"("inventoryId");
CREATE INDEX IF NOT EXISTS "OperationalInventoryItem_productId_idx" ON "OperationalInventoryItem"("productId");
CREATE INDEX IF NOT EXISTS "OperationalInventoryItem_status_idx" ON "OperationalInventoryItem"("status");
CREATE INDEX IF NOT EXISTS "OperationalInventoryItem_sectorName_idx" ON "OperationalInventoryItem"("sectorName");
