-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "importFileId" TEXT NOT NULL,
    "originalFileName" TEXT,
    "totalRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "ignoredRows" INTEGER NOT NULL DEFAULT 0,
    "spreadsheetTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "differenceTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "importBatchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_importFileId_key" ON "ImportBatch"("importFileId");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "Purchase_importBatchId_idx" ON "Purchase"("importBatchId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
