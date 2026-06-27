-- Add linkedSnapshotId to StockCountSession to link sessions created from spreadsheet imports.
-- Uses a UNIQUE partial index (WHERE IS NOT NULL) so:
--   - Multiple rows with NULL are allowed (regular non-import sessions)
--   - Two sessions pointing to the same snapshot are rejected at DB level
ALTER TABLE "StockCountSession" ADD COLUMN IF NOT EXISTS "linkedSnapshotId" TEXT;

-- Drop plain index in case it was created by a previous version of this migration
DROP INDEX IF EXISTS "StockCountSession_linkedSnapshotId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "StockCountSession_linkedSnapshotId_unique_idx"
  ON "StockCountSession" ("linkedSnapshotId")
  WHERE "linkedSnapshotId" IS NOT NULL;
