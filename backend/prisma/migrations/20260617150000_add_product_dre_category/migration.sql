-- AddColumn Product.dreCategoryId
ALTER TABLE "Product" ADD COLUMN "dreCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_dreCategoryId_fkey"
  FOREIGN KEY ("dreCategoryId") REFERENCES "DRECategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Product_dreCategoryId_idx" ON "Product"("dreCategoryId");
