-- CreateEnum
CREATE TYPE "CatalogImportType" AS ENUM ('SUPPLIERS', 'PRODUCTS', 'PAYMENT_METHODS', 'SMALL_EXPENSE_TYPES');

-- CreateEnum
CREATE TYPE "CatalogImportAction" AS ENUM ('CREATED', 'UPDATED');

-- CreateTable
CREATE TABLE "CatalogImportBatch" (
    "id" TEXT NOT NULL,
    "importFileId" TEXT NOT NULL,
    "originalFileName" TEXT,
    "sheetName" TEXT,
    "type" "CatalogImportType" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "ignoredRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportChange" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "action" "CatalogImportAction" NOT NULL,
    "entityType" "CatalogImportType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogImportChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogImportBatch_importFileId_key" ON "CatalogImportBatch"("importFileId");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_type_idx" ON "CatalogImportBatch"("type");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_createdAt_idx" ON "CatalogImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "CatalogImportChange_batchId_idx" ON "CatalogImportChange"("batchId");

-- CreateIndex
CREATE INDEX "CatalogImportChange_entityType_entityId_idx" ON "CatalogImportChange"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "CatalogImportChange" ADD CONSTRAINT "CatalogImportChange_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
