-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "rawSupplierCode" TEXT;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN "rawProductCode" TEXT;

-- CreateIndex
CREATE INDEX "Purchase_rawSupplierCode_idx" ON "Purchase"("rawSupplierCode");

-- CreateIndex
CREATE INDEX "PurchaseItem_rawProductCode_idx" ON "PurchaseItem"("rawProductCode");
