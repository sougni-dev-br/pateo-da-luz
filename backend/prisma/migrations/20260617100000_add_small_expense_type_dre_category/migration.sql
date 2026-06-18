-- AlterTable
ALTER TABLE "SmallExpenseType" ADD COLUMN "suggestedDreCategoryId" TEXT;

-- CreateIndex
CREATE INDEX "SmallExpenseType_suggestedDreCategoryId_idx" ON "SmallExpenseType"("suggestedDreCategoryId");

-- AddForeignKey
ALTER TABLE "SmallExpenseType" ADD CONSTRAINT "SmallExpenseType_suggestedDreCategoryId_fkey" FOREIGN KEY ("suggestedDreCategoryId") REFERENCES "DRECategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
