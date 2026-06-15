-- CreateTable: InventoryRequisition
CREATE TABLE "InventoryRequisition" (
    "id"                TEXT NOT NULL,
    "code"              TEXT NOT NULL,
    "date"              TIMESTAMP(3) NOT NULL,
    "shift"             TEXT NOT NULL,
    "reason"            TEXT NOT NULL,
    "reasonNotes"       TEXT,
    "sectorId"          TEXT,
    "sectorName"        TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'CONFIRMED',
    "notes"             TEXT,
    "cancelReason"      TEXT,
    "cancelledAt"       TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryRequisitionItem
CREATE TABLE "InventoryRequisitionItem" (
    "id"            TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "productId"     TEXT,
    "productName"   TEXT NOT NULL,
    "productCode"   TEXT,
    "unit"          TEXT,
    "quantity"      DECIMAL(14,4) NOT NULL,
    "movementId"    TEXT,
    "stockBefore"   DECIMAL(14,4),
    "stockAfter"    DECIMAL(14,4),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryRequisitionItem_pkey" PRIMARY KEY ("id")
);

-- AddColumn: sourceRequisitionId em InventoryMovement
ALTER TABLE "InventoryMovement" ADD COLUMN "sourceRequisitionId" TEXT;

-- CreateIndex: InventoryRequisition
CREATE UNIQUE INDEX "InventoryRequisition_code_key" ON "InventoryRequisition"("code");
CREATE INDEX "InventoryRequisition_date_idx" ON "InventoryRequisition"("date");
CREATE INDEX "InventoryRequisition_sectorId_idx" ON "InventoryRequisition"("sectorId");
CREATE INDEX "InventoryRequisition_requestedByUserId_idx" ON "InventoryRequisition"("requestedByUserId");
CREATE INDEX "InventoryRequisition_status_idx" ON "InventoryRequisition"("status");

-- CreateIndex: InventoryRequisitionItem
CREATE INDEX "InventoryRequisitionItem_requisitionId_idx" ON "InventoryRequisitionItem"("requisitionId");
CREATE INDEX "InventoryRequisitionItem_productId_idx" ON "InventoryRequisitionItem"("productId");

-- CreateIndex: InventoryMovement sourceRequisitionId
CREATE INDEX "InventoryMovement_sourceRequisitionId_idx" ON "InventoryMovement"("sourceRequisitionId");

-- AddForeignKey: InventoryRequisitionItem -> InventoryRequisition
ALTER TABLE "InventoryRequisitionItem" ADD CONSTRAINT "InventoryRequisitionItem_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "InventoryRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
