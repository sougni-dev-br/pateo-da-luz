ALTER TABLE "StockCount"
  ADD COLUMN IF NOT EXISTS "inventoryAgendaItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "confirmedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "StockCount_inventoryAgendaItemId_idx" ON "StockCount"("inventoryAgendaItemId");
CREATE INDEX IF NOT EXISTS "StockCount_responsibleUserId_idx" ON "StockCount"("responsibleUserId");
CREATE INDEX IF NOT EXISTS "StockCount_status_idx" ON "StockCount"("status");

CREATE TABLE IF NOT EXISTS "InventoryAgendaRule" (
  "id" TEXT NOT NULL,
  "dayOfWeek" INTEGER,
  "categoryId" TEXT,
  "categoryName" TEXT NOT NULL,
  "frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
  "defaultResponsibleUserId" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAgendaRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InventoryAgendaRule_dayOfWeek_idx" ON "InventoryAgendaRule"("dayOfWeek");
CREATE INDEX IF NOT EXISTS "InventoryAgendaRule_categoryId_idx" ON "InventoryAgendaRule"("categoryId");
CREATE INDEX IF NOT EXISTS "InventoryAgendaRule_frequency_idx" ON "InventoryAgendaRule"("frequency");
CREATE INDEX IF NOT EXISTS "InventoryAgendaRule_isActive_idx" ON "InventoryAgendaRule"("isActive");

CREATE TABLE IF NOT EXISTS "InventoryAgendaItem" (
  "id" TEXT NOT NULL,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "categoryId" TEXT,
  "categoryName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "responsibleUserId" TEXT,
  "notes" TEXT,
  "startedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "confirmedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAgendaItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryAgendaItem_scheduledDate_categoryName_key"
  ON "InventoryAgendaItem"("scheduledDate", "categoryName");
CREATE INDEX IF NOT EXISTS "InventoryAgendaItem_scheduledDate_idx" ON "InventoryAgendaItem"("scheduledDate");
CREATE INDEX IF NOT EXISTS "InventoryAgendaItem_status_idx" ON "InventoryAgendaItem"("status");
CREATE INDEX IF NOT EXISTS "InventoryAgendaItem_responsibleUserId_idx" ON "InventoryAgendaItem"("responsibleUserId");
