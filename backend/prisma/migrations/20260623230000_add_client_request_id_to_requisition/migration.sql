-- AlterTable: add clientRequestId for idempotent requisition creation
ALTER TABLE "InventoryRequisition" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

-- CreateIndex: unique constraint on clientRequestId
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryRequisition_clientRequestId_key" ON "InventoryRequisition"("clientRequestId");
