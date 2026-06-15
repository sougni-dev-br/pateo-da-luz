ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "purchaseOrderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedInvoiceNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedPurchaseOrderNumber" TEXT;

CREATE INDEX IF NOT EXISTS "Purchase_purchaseOrderNumber_idx" ON "Purchase"("purchaseOrderNumber");
CREATE INDEX IF NOT EXISTS "Purchase_normalizedInvoiceNumber_idx" ON "Purchase"("normalizedInvoiceNumber");
CREATE INDEX IF NOT EXISTS "Purchase_normalizedPurchaseOrderNumber_idx" ON "Purchase"("normalizedPurchaseOrderNumber");
CREATE INDEX IF NOT EXISTS "Purchase_supplierId_status_normalizedInvoiceNumber_idx"
  ON "Purchase"("supplierId", "status", "normalizedInvoiceNumber");
CREATE INDEX IF NOT EXISTS "Purchase_supplierId_status_normalizedPurchaseOrderNumber_idx"
  ON "Purchase"("supplierId", "status", "normalizedPurchaseOrderNumber");
