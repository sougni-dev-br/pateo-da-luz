ALTER TABLE "Product" ADD COLUMN "purchaseUnit" TEXT;
ALTER TABLE "Product" ADD COLUMN "baseUnit" TEXT;
ALTER TABLE "Product" ADD COLUMN "conversionFactor" DECIMAL(12, 6);
ALTER TABLE "Product" ADD COLUMN "packageWeight" DECIMAL(12, 3);
ALTER TABLE "Product" ADD COLUMN "conversionNotes" TEXT;

CREATE TABLE "ProductUnitConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromUnit" TEXT NOT NULL,
    "toUnit" TEXT NOT NULL,
    "factor" DECIMAL(12, 6) NOT NULL,
    "averagePackageWeight" DECIMAL(12, 3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUnitConversion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PurchaseItem" ADD COLUMN "convertedUnit" TEXT;
ALTER TABLE "PurchaseItem" ADD COLUMN "convertedQuantity" DECIMAL(12, 3);
ALTER TABLE "PurchaseItem" ADD COLUMN "convertedUnitPrice" DECIMAL(12, 4);
ALTER TABLE "PurchaseItem" ADD COLUMN "conversionFactorUsed" DECIMAL(12, 6);
ALTER TABLE "PurchaseItem" ADD COLUMN "conversionMissing" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_purchaseUnit_idx" ON "Product"("purchaseUnit");
CREATE INDEX "Product_baseUnit_idx" ON "Product"("baseUnit");
CREATE INDEX "ProductUnitConversion_productId_idx" ON "ProductUnitConversion"("productId");
CREATE UNIQUE INDEX "ProductUnitConversion_productId_fromUnit_toUnit_key" ON "ProductUnitConversion"("productId", "fromUnit", "toUnit");
CREATE INDEX "PurchaseItem_convertedUnit_idx" ON "PurchaseItem"("convertedUnit");
CREATE INDEX "PurchaseItem_conversionMissing_idx" ON "PurchaseItem"("conversionMissing");

ALTER TABLE "ProductUnitConversion" ADD CONSTRAINT "ProductUnitConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
