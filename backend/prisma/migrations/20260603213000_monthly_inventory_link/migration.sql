ALTER TABLE "InventorySnapshot"
ADD COLUMN IF NOT EXISTS "linkedFromSnapshotId" TEXT,
ADD COLUMN IF NOT EXISTS "isAutoLinkedInitial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "unlockReason" TEXT,
ADD COLUMN IF NOT EXISTS "unlockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "unlockedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "InventorySnapshot_linkedFromSnapshotId_idx"
ON "InventorySnapshot" ("linkedFromSnapshotId");

CREATE INDEX IF NOT EXISTS "InventorySnapshot_isAutoLinkedInitial_idx"
ON "InventorySnapshot" ("isAutoLinkedInitial");
