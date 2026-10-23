-- Coleta de óleo de fritura: cria uma tabela nova e a liga ao título do Contas a Receber. Não altera nada existente.
CREATE TABLE "OilCollection" (
    "id" TEXT NOT NULL,
    "collectionDate" DATE NOT NULL,
    "collectorName" TEXT NOT NULL DEFAULT 'Retióleo',
    "certificateNumber" TEXT,
    "volumeLiters" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivableId" TEXT,
    "notes" TEXT,
    "registeredByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OilCollection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OilCollection_receivableId_key" ON "OilCollection"("receivableId");
CREATE UNIQUE INDEX "OilCollection_collectorName_certificateNumber_key" ON "OilCollection"("collectorName", "certificateNumber");
CREATE INDEX "OilCollection_collectionDate_idx" ON "OilCollection"("collectionDate");

ALTER TABLE "OilCollection" ADD CONSTRAINT "OilCollection_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
