-- Create official operational stock count sessions without changing legacy StockCount history.
CREATE TABLE "StockCountSession" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GERAL',
  "status" TEXT NOT NULL DEFAULT 'ABERTA',
  "referenceDate" TIMESTAMP(3) NOT NULL,
  "periodMonth" INTEGER,
  "periodYear" INTEGER,
  "isMonthEnd" BOOLEAN NOT NULL DEFAULT false,
  "sectorId" TEXT,
  "sectorName" TEXT,
  "categoryId" TEXT,
  "categoryName" TEXT,
  "subcategoryId" TEXT,
  "subcategoryName" TEXT,
  "inventoryAgendaItemId" TEXT,
  "responsibleUserId" TEXT,
  "notes" TEXT,
  "concludedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "generatedInventoryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockCountSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockCountSessionItem" (
  "id" TEXT NOT NULL,
  "stockCountSessionId" TEXT NOT NULL,
  "productId" TEXT,
  "productCodeSnapshot" TEXT,
  "productNameSnapshot" TEXT NOT NULL,
  "sectorSnapshot" TEXT,
  "categorySnapshot" TEXT,
  "subcategorySnapshot" TEXT,
  "locationSnapshot" TEXT,
  "unitSnapshot" TEXT,
  "expectedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "countedQuantity" DECIMAL(14,3),
  "differenceQuantity" DECIMAL(14,3),
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "notes" TEXT,
  "countedByUserId" TEXT,
  "countedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockCountSessionItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OperationalInventory"
  ADD COLUMN IF NOT EXISTS "sourceStockCountSessionId" TEXT;

CREATE UNIQUE INDEX "StockCountSession_code_key" ON "StockCountSession"("code");
CREATE INDEX "StockCountSession_referenceDate_idx" ON "StockCountSession"("referenceDate");
CREATE INDEX "StockCountSession_periodYear_periodMonth_idx" ON "StockCountSession"("periodYear", "periodMonth");
CREATE INDEX "StockCountSession_status_idx" ON "StockCountSession"("status");
CREATE INDEX "StockCountSession_type_idx" ON "StockCountSession"("type");
CREATE INDEX "StockCountSession_isMonthEnd_idx" ON "StockCountSession"("isMonthEnd");
CREATE INDEX "StockCountSession_sectorId_idx" ON "StockCountSession"("sectorId");
CREATE INDEX "StockCountSession_categoryId_idx" ON "StockCountSession"("categoryId");
CREATE INDEX "StockCountSession_subcategoryId_idx" ON "StockCountSession"("subcategoryId");
CREATE INDEX "StockCountSession_responsibleUserId_idx" ON "StockCountSession"("responsibleUserId");
CREATE INDEX "StockCountSession_generatedInventoryId_idx" ON "StockCountSession"("generatedInventoryId");

CREATE INDEX "StockCountSessionItem_stockCountSessionId_idx" ON "StockCountSessionItem"("stockCountSessionId");
CREATE INDEX "StockCountSessionItem_productId_idx" ON "StockCountSessionItem"("productId");
CREATE INDEX "StockCountSessionItem_status_idx" ON "StockCountSessionItem"("status");
CREATE INDEX "StockCountSessionItem_sectorSnapshot_idx" ON "StockCountSessionItem"("sectorSnapshot");
CREATE INDEX "StockCountSessionItem_categorySnapshot_idx" ON "StockCountSessionItem"("categorySnapshot");
CREATE INDEX "StockCountSessionItem_subcategorySnapshot_idx" ON "StockCountSessionItem"("subcategorySnapshot");
CREATE INDEX "OperationalInventory_sourceStockCountSessionId_idx" ON "OperationalInventory"("sourceStockCountSessionId");

ALTER TABLE "StockCountSessionItem"
  ADD CONSTRAINT "StockCountSessionItem_stockCountSessionId_fkey"
  FOREIGN KEY ("stockCountSessionId") REFERENCES "StockCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockCountSessionItem"
  ADD CONSTRAINT "StockCountSessionItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
