ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Purchase"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
ADD COLUMN IF NOT EXISTS "cancelledByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "restoredByUserId" TEXT;

ALTER TABLE "InventoryMovement"
ADD COLUMN IF NOT EXISTS "isCancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelledByPurchaseId" TEXT,
ADD COLUMN IF NOT EXISTS "restoredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Purchase_status_idx" ON "Purchase"("status");
CREATE INDEX IF NOT EXISTS "Purchase_cancelledAt_idx" ON "Purchase"("cancelledAt");
CREATE INDEX IF NOT EXISTS "InventoryMovement_isCancelled_idx" ON "InventoryMovement"("isCancelled");
