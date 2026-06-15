CREATE UNIQUE INDEX "Purchase_active_supplier_invoice_unique_idx"
  ON "Purchase"("supplierId", "normalizedInvoiceNumber")
  WHERE "normalizedInvoiceNumber" IS NOT NULL
    AND "normalizedInvoiceNumber" <> ''
    AND COALESCE("status", 'ACTIVE') <> 'CANCELLED';

CREATE UNIQUE INDEX "Purchase_active_supplier_order_unique_idx"
  ON "Purchase"("supplierId", "normalizedPurchaseOrderNumber")
  WHERE "normalizedPurchaseOrderNumber" IS NOT NULL
    AND "normalizedPurchaseOrderNumber" <> ''
    AND COALESCE("status", 'ACTIVE') <> 'CANCELLED';
