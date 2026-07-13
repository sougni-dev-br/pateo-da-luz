-- CreateEnum
CREATE TYPE "DeliveryPlatform" AS ENUM ('IFOOD', 'NOVENTA_NOVE', 'KEETA');

-- CreateTable
CREATE TABLE "DeliveryStore" (
    "id" TEXT NOT NULL,
    "platform" "DeliveryPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryStore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryStore_platform_externalId_key" ON "DeliveryStore"("platform", "externalId");
CREATE INDEX "DeliveryStore_platform_active_idx" ON "DeliveryStore"("platform", "active");

-- CreateTable
CREATE TABLE "IfoodCredential" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastTokenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IfoodCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IfoodSale" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "ifoodFeeAmount" DECIMAL(14,2) NOT NULL,
    "promotionAmount" DECIMAL(14,2) NOT NULL,
    "deliveryFeeAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT,
    "channel" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodSale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IfoodSale_deliveryStoreId_externalOrderId_key" ON "IfoodSale"("deliveryStoreId", "externalOrderId");
CREATE INDEX "IfoodSale_deliveryStoreId_competenceYear_competenceMonth_idx" ON "IfoodSale"("deliveryStoreId", "competenceYear", "competenceMonth");
CREATE INDEX "IfoodSale_deliveryStoreId_orderDate_idx" ON "IfoodSale"("deliveryStoreId", "orderDate");

-- CreateTable
CREATE TABLE "IfoodSettlement" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "totalFees" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IfoodSettlement_deliveryStoreId_externalId_key" ON "IfoodSettlement"("deliveryStoreId", "externalId");
CREATE INDEX "IfoodSettlement_deliveryStoreId_periodStart_idx" ON "IfoodSettlement"("deliveryStoreId", "periodStart");

-- CreateTable
CREATE TABLE "IfoodFee" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "feeType" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IfoodFee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IfoodFee_deliveryStoreId_competenceYear_competenceMonth_idx" ON "IfoodFee"("deliveryStoreId", "competenceYear", "competenceMonth");
CREATE INDEX "IfoodFee_deliveryStoreId_feeType_idx" ON "IfoodFee"("deliveryStoreId", "feeType");

-- CreateTable
CREATE TABLE "IfoodSyncLog" (
    "id" TEXT NOT NULL,
    "deliveryStoreId" TEXT,
    "syncType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "triggeredByUserId" TEXT,

    CONSTRAINT "IfoodSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IfoodSyncLog_deliveryStoreId_startedAt_idx" ON "IfoodSyncLog"("deliveryStoreId", "startedAt");

-- AddForeignKey
ALTER TABLE "IfoodSale" ADD CONSTRAINT "IfoodSale_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IfoodSettlement" ADD CONSTRAINT "IfoodSettlement_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IfoodFee" ADD CONSTRAINT "IfoodFee_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IfoodSyncLog" ADD CONSTRAINT "IfoodSyncLog_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
