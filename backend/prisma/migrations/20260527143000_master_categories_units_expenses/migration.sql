-- AlterTable
ALTER TABLE "Category" ADD COLUMN "mainGroup" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notes" TEXT;

-- CreateTable
CREATE TABLE "UnitMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseTypeMaster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "group" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseTypeMaster_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "unitMeasureId" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "expenseTypeId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN "unitMeasureId" TEXT;

-- CreateIndex
CREATE INDEX "Category_mainGroup_idx" ON "Category"("mainGroup");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UnitMeasure_code_key" ON "UnitMeasure"("code");

-- CreateIndex
CREATE INDEX "UnitMeasure_name_idx" ON "UnitMeasure"("name");

-- CreateIndex
CREATE INDEX "UnitMeasure_type_idx" ON "UnitMeasure"("type");

-- CreateIndex
CREATE INDEX "UnitMeasure_isActive_idx" ON "UnitMeasure"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseTypeMaster_normalizedName_key" ON "ExpenseTypeMaster"("normalizedName");

-- CreateIndex
CREATE INDEX "ExpenseTypeMaster_name_idx" ON "ExpenseTypeMaster"("name");

-- CreateIndex
CREATE INDEX "ExpenseTypeMaster_group_idx" ON "ExpenseTypeMaster"("group");

-- CreateIndex
CREATE INDEX "ExpenseTypeMaster_isActive_idx" ON "ExpenseTypeMaster"("isActive");

-- CreateIndex
CREATE INDEX "Product_unitMeasureId_idx" ON "Product"("unitMeasureId");

-- CreateIndex
CREATE INDEX "Purchase_expenseTypeId_idx" ON "Purchase"("expenseTypeId");

-- CreateIndex
CREATE INDEX "PurchaseItem_unitMeasureId_idx" ON "PurchaseItem"("unitMeasureId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitMeasureId_fkey" FOREIGN KEY ("unitMeasureId") REFERENCES "UnitMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_expenseTypeId_fkey" FOREIGN KEY ("expenseTypeId") REFERENCES "ExpenseTypeMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_unitMeasureId_fkey" FOREIGN KEY ("unitMeasureId") REFERENCES "UnitMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
