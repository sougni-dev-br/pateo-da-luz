-- Analise do salao: venda a venda (inclusive cancelada) e quem lancou cada item.
-- So cria tabela/coluna/indices; nao altera dado existente.
-- AlterTable
ALTER TABLE "AgileSaleItem" ADD COLUMN     "launchedBy" TEXT;

-- CreateTable
CREATE TABLE "AgileSale" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "shift" TEXT NOT NULL,
    "saleStatus" TEXT NOT NULL,
    "saleHour" TEXT,
    "people" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgileSale_saleId_key" ON "AgileSale"("saleId");

-- CreateIndex
CREATE INDEX "agsale_movement_idx" ON "AgileSale"("movementDate");

-- CreateIndex
CREATE INDEX "agsale_competence_idx" ON "AgileSale"("competenceYear", "competenceMonth");

-- CreateIndex
CREATE INDEX "agsale_status_movement_idx" ON "AgileSale"("saleStatus", "movementDate");

-- CreateIndex
CREATE INDEX "agitem_launched_by_idx" ON "AgileSaleItem"("launchedBy");

