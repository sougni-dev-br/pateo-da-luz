CREATE TABLE "PurchaseOrderSequence" (
  "year" INTEGER NOT NULL,
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderSequence_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdByUserId" TEXT,
  "reviewedByUserId" TEXT,
  "approvedByUserId" TEXT,
  "expectedDeliveryDate" TIMESTAMP(3),
  "notes" TEXT,
  "cancelReason" TEXT,
  "sentToReviewAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productCodeSnapshot" TEXT,
  "productNameSnapshot" TEXT NOT NULL,
  "unitSnapshot" TEXT,
  "suggestedQuantity" DECIMAL(14,3),
  "requestedQuantity" DECIMAL(14,3) NOT NULL,
  "approvedQuantity" DECIMAL(14,3),
  "receivedQuantity" DECIMAL(14,3),
  "lastCountedQuantity" DECIMAL(14,3),
  "estoqueMinimoSnapshot" DECIMAL(14,3),
  "estoqueIdealSnapshot" DECIMAL(14,3),
  "alertSnapshot" TEXT,
  "suggestionTypeSnapshot" TEXT,
  "unitPriceEstimated" DECIMAL(14,4),
  "totalEstimated" DECIMAL(14,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX "PurchaseOrder_source_idx" ON "PurchaseOrder"("source");
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");
CREATE INDEX "PurchaseOrder_expectedDeliveryDate_idx" ON "PurchaseOrder"("expectedDeliveryDate");
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
