-- Adiciona companyId à DeliveryStore (opcional na Fase A; obrigatório pra sync com efeito no DRE)
ALTER TABLE "DeliveryStore" ADD COLUMN "companyId" TEXT;
CREATE INDEX "DeliveryStore_companyId_idx" ON "DeliveryStore"("companyId");
ALTER TABLE "DeliveryStore" ADD CONSTRAINT "DeliveryStore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enums de Receivable
CREATE TYPE "ReceivableSourceType" AS ENUM ('IFOOD_SETTLEMENT', 'NOVENTA_NOVE_SETTLEMENT', 'KEETA_SETTLEMENT', 'EVENT', 'DIRECT', 'OTHER');
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'LATE', 'CANCELLED');

-- Tabela Receivable
CREATE TABLE "Receivable" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceType" "ReceivableSourceType" NOT NULL,
    "sourceRef" TEXT,
    "ifoodSettlementId" TEXT,
    "eventId" TEXT,
    "customerName" TEXT,
    "customerDocument" TEXT,
    "description" TEXT NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "fees" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2),
    "paymentMethod" TEXT,
    "bankAccountId" TEXT,
    "installmentNumber" INTEGER,
    "totalInstallments" INTEGER,
    "parentReceivableId" TEXT,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Receivable_ifoodSettlementId_key" ON "Receivable"("ifoodSettlementId");
CREATE INDEX "Receivable_status_expectedDate_idx" ON "Receivable"("status", "expectedDate");
CREATE INDEX "Receivable_sourceType_companyId_idx" ON "Receivable"("sourceType", "companyId");
CREATE INDEX "Receivable_competenceYear_competenceMonth_idx" ON "Receivable"("competenceYear", "competenceMonth");
CREATE INDEX "Receivable_companyId_expectedDate_idx" ON "Receivable"("companyId", "expectedDate");
CREATE INDEX "Receivable_parentReceivableId_idx" ON "Receivable"("parentReceivableId");

-- FKs
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_ifoodSettlementId_fkey" FOREIGN KEY ("ifoodSettlementId") REFERENCES "IfoodSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_parentReceivableId_fkey" FOREIGN KEY ("parentReceivableId") REFERENCES "Receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
