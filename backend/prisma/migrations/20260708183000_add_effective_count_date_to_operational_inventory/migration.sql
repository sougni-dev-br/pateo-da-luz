ALTER TABLE "OperationalInventory"
ADD COLUMN IF NOT EXISTS "effectiveCountDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "OperationalInventory_effectiveCountDate_idx"
ON "OperationalInventory" ("effectiveCountDate");

UPDATE "OperationalInventory"
SET "effectiveCountDate" = "date"
WHERE "effectiveCountDate" IS NULL;
