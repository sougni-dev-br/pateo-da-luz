DO $$ BEGIN
  CREATE TYPE "InventorySnapshotType" AS ENUM ('INVENTARIO_INICIAL', 'INVENTARIO_FINAL', 'CONTAGEM_PARCIAL', 'AJUSTE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MonthlyCloseStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "InventorySnapshot" (
  "id" TEXT PRIMARY KEY,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "type" "InventorySnapshotType" NOT NULL,
  "countDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "totalValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "importFileId" TEXT,
  "originalFileName" TEXT,
  "createdByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancellationReason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "InventorySnapshotItem" (
  "id" TEXT PRIMARY KEY,
  "snapshotId" TEXT NOT NULL REFERENCES "InventorySnapshot"("id") ON DELETE CASCADE,
  "productId" TEXT,
  "productCode" TEXT,
  "productName" TEXT NOT NULL,
  "sectorName" TEXT,
  "categoryName" TEXT,
  "subcategoryName" TEXT,
  "unit" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,4),
  "totalCost" DECIMAL(14,2),
  "divergenceQuantity" DECIMAL(14,3),
  "sourceRowNumber" INTEGER,
  "resolutionStatus" TEXT NOT NULL DEFAULT 'MATCHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RevenueEntry" (
  "id" TEXT PRIMARY KEY,
  "date" TIMESTAMP(3) NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "description" TEXT,
  "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "platformFees" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentMethod" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "cancelledAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancellationReason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "MonthlyCmv" (
  "id" TEXT PRIMARY KEY,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "initialInventoryValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "purchasesValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "finalInventoryValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "realCmvValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "revenueGrossValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "revenueNetValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cmvPercent" DECIMAL(10,4),
  "estimatedGrossMargin" DECIMAL(14,2),
  "status" "MonthlyCloseStatus" NOT NULL DEFAULT 'OPEN',
  "closedByUserId" TEXT,
  "closedAt" TIMESTAMP(3),
  "reopenedByUserId" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenReason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyCmv_competence_unique" UNIQUE ("competenceYear", "competenceMonth")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventorySnapshot_active_unique"
  ON "InventorySnapshot"("competenceYear", "competenceMonth", "type")
  WHERE "status" <> 'CANCELLED' AND "type" IN ('INVENTARIO_INICIAL', 'INVENTARIO_FINAL');

CREATE INDEX IF NOT EXISTS "InventorySnapshot_competence_idx" ON "InventorySnapshot"("competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_type_idx" ON "InventorySnapshot"("type");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_status_idx" ON "InventorySnapshot"("status");
CREATE INDEX IF NOT EXISTS "InventorySnapshotItem_snapshotId_idx" ON "InventorySnapshotItem"("snapshotId");
CREATE INDEX IF NOT EXISTS "InventorySnapshotItem_productId_idx" ON "InventorySnapshotItem"("productId");
CREATE INDEX IF NOT EXISTS "InventorySnapshotItem_resolutionStatus_idx" ON "InventorySnapshotItem"("resolutionStatus");
CREATE INDEX IF NOT EXISTS "RevenueEntry_competence_idx" ON "RevenueEntry"("competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "RevenueEntry_channel_idx" ON "RevenueEntry"("channel");
CREATE INDEX IF NOT EXISTS "RevenueEntry_status_idx" ON "RevenueEntry"("status");
CREATE INDEX IF NOT EXISTS "MonthlyCmv_status_idx" ON "MonthlyCmv"("status");
