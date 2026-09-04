-- IfoodFinancialEvent
CREATE TABLE "IfoodFinancialEvent" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "referenceOrderId" TEXT,
    "status" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodFinancialEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ifev_store_external_uniq" ON "IfoodFinancialEvent"("deliveryStoreId", "externalId");
CREATE INDEX "ifev_store_competence_idx" ON "IfoodFinancialEvent"("deliveryStoreId", "competenceYear", "competenceMonth");
CREATE INDEX "ifev_store_date_idx" ON "IfoodFinancialEvent"("deliveryStoreId", "eventDate");
ALTER TABLE "IfoodFinancialEvent" ADD CONSTRAINT "IfoodFinancialEvent_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IfoodReconciliationItem
CREATE TABLE "IfoodReconciliationItem" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "itemType" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "settlementRef" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodReconciliationItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ifrec_store_external_uniq" ON "IfoodReconciliationItem"("deliveryStoreId", "externalId");
CREATE INDEX "ifrec_store_competence_idx" ON "IfoodReconciliationItem"("deliveryStoreId", "competenceYear", "competenceMonth");
CREATE INDEX "ifrec_store_date_idx" ON "IfoodReconciliationItem"("deliveryStoreId", "referenceDate");
ALTER TABLE "IfoodReconciliationItem" ADD CONSTRAINT "IfoodReconciliationItem_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IfoodAnticipation
CREATE TABLE "IfoodAnticipation" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "feeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodAnticipation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ifant_store_external_uniq" ON "IfoodAnticipation"("deliveryStoreId", "externalId");
CREATE INDEX "ifant_store_competence_idx" ON "IfoodAnticipation"("deliveryStoreId", "competenceYear", "competenceMonth");
CREATE INDEX "ifant_store_date_idx" ON "IfoodAnticipation"("deliveryStoreId", "requestedAt");
ALTER TABLE "IfoodAnticipation" ADD CONSTRAINT "IfoodAnticipation_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
