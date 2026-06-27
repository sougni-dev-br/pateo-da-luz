-- Add source column to InventorySnapshot to distinguish imported vs system-created snapshots
ALTER TABLE "InventorySnapshot" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'SISTEMA';

-- Backfill: snapshots that have a real file extension in originalFileName are imported
UPDATE "InventorySnapshot"
SET "source" = 'IMPORTACAO_PLANILHA'
WHERE "originalFileName" IS NOT NULL
  AND (
    "originalFileName" ILIKE '%.xlsx'
    OR "originalFileName" ILIKE '%.xls'
    OR "originalFileName" ILIKE '%.csv'
  )
  AND "isAutoLinkedInitial" = false;

-- Backfill: auto-linked initials (cloned from a final)
UPDATE "InventorySnapshot"
SET "source" = 'AUTO_VINCULADO'
WHERE "isAutoLinkedInitial" = true;
