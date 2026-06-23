-- CreateEnum
CREATE TYPE "TaxPaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELED', 'WITHOUT_RECEIPT');

-- CreateEnum
CREATE TYPE "TaxPaymentSource" AS ENUM ('MANUAL', 'IMPORT_XLSX');

-- CreateTable
CREATE TABLE "TaxPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "cnpj" TEXT,
    "legalName" TEXT,
    "tradeName" TEXT,
    "documentType" TEXT NOT NULL,
    "description" TEXT,
    "competenceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "status" "TaxPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "source" "TaxPaymentSource" NOT NULL DEFAULT 'MANUAL',
    "importBatchId" TEXT,
    "dreCategoryId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPaymentAttachment" (
    "id" TEXT NOT NULL,
    "taxPaymentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "sha256" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPaymentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxPayment_dueDate_idx" ON "TaxPayment"("dueDate");

-- CreateIndex
CREATE INDEX "TaxPayment_competenceDate_idx" ON "TaxPayment"("competenceDate");

-- CreateIndex
CREATE INDEX "TaxPayment_paymentDate_idx" ON "TaxPayment"("paymentDate");

-- CreateIndex
CREATE INDEX "TaxPayment_status_idx" ON "TaxPayment"("status");

-- CreateIndex
CREATE INDEX "TaxPayment_companyId_idx" ON "TaxPayment"("companyId");

-- CreateIndex
CREATE INDEX "TaxPayment_documentType_idx" ON "TaxPayment"("documentType");

-- CreateIndex
CREATE INDEX "TaxPayment_dreCategoryId_idx" ON "TaxPayment"("dreCategoryId");

-- CreateIndex
CREATE INDEX "TaxPayment_deletedAt_idx" ON "TaxPayment"("deletedAt");

-- CreateIndex
CREATE INDEX "TaxPayment_importBatchId_idx" ON "TaxPayment"("importBatchId");

-- CreateIndex
CREATE INDEX "TaxPayment_createdAt_idx" ON "TaxPayment"("createdAt");

-- CreateIndex
CREATE INDEX "TaxPaymentAttachment_taxPaymentId_idx" ON "TaxPaymentAttachment"("taxPaymentId");

-- AddForeignKey
ALTER TABLE "TaxPayment" ADD CONSTRAINT "TaxPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPayment" ADD CONSTRAINT "TaxPayment_dreCategoryId_fkey" FOREIGN KEY ("dreCategoryId") REFERENCES "DRECategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPaymentAttachment" ADD CONSTRAINT "TaxPaymentAttachment_taxPaymentId_fkey" FOREIGN KEY ("taxPaymentId") REFERENCES "TaxPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
