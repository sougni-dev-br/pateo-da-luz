-- Parcelamento em lote: cria uma tabela nova e duas colunas nulas em Purchase. Não altera dados existentes.
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "renegotiatedFromId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstallmentPlan_supplierId_idx" ON "InstallmentPlan"("supplierId");
CREATE INDEX "InstallmentPlan_status_idx" ON "InstallmentPlan"("status");

ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_renegotiatedFromId_fkey" FOREIGN KEY ("renegotiatedFromId") REFERENCES "InstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD COLUMN "installmentPlanId" TEXT, ADD COLUMN "planInstallmentNumber" INTEGER;
CREATE INDEX "Purchase_installmentPlanId_idx" ON "Purchase"("installmentPlanId");
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
