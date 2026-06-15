DO $$
BEGIN
  CREATE TYPE "RevenueImportAction" AS ENUM ('CREATED', 'UPDATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RevenueEntry"
  ADD COLUMN IF NOT EXISTS "serviceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tickets" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ticketAverage" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "salesFirstShift" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ticketsFirstShift" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "salesSecondShift" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ticketsSecondShift" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "salesTables" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ticketsTables" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accumulatedAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "weekdayName" TEXT,
  ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "RevenueEntry_importBatchId_idx" ON "RevenueEntry"("importBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'RevenueImportBatch'
      AND table_schema = 'public'
  ) THEN
    CREATE TABLE "RevenueImportBatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "importFileId" TEXT NOT NULL UNIQUE,
      "originalFileName" TEXT,
      "sheetName" TEXT,
      "competenceYear" INTEGER NOT NULL,
      "competenceMonth" INTEGER NOT NULL,
      "defaultChannel" TEXT NOT NULL,
      "notes" TEXT,
      "totalRows" INTEGER NOT NULL,
      "importedRows" INTEGER NOT NULL DEFAULT 0,
      "ignoredRows" INTEGER NOT NULL DEFAULT 0,
      "overwrittenRows" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'RevenueImportChange'
      AND table_schema = 'public'
  ) THEN
    CREATE TABLE "RevenueImportChange" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "batchId" TEXT NOT NULL,
      "action" "RevenueImportAction" NOT NULL,
      "entryId" TEXT NOT NULL,
      "rowNumber" INTEGER,
      "previousData" JSONB,
      "newData" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RevenueImportBatch_competenceYear_competenceMonth_idx" ON "RevenueImportBatch"("competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "RevenueImportBatch_createdAt_idx" ON "RevenueImportBatch"("createdAt");
CREATE INDEX IF NOT EXISTS "RevenueImportChange_batchId_idx" ON "RevenueImportChange"("batchId");
CREATE INDEX IF NOT EXISTS "RevenueImportChange_entryId_idx" ON "RevenueImportChange"("entryId");

ALTER TABLE "RevenueImportChange"
  ADD CONSTRAINT "RevenueImportChange_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "RevenueImportBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RevenueEntry"
  ADD CONSTRAINT "RevenueEntry_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "RevenueImportBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
