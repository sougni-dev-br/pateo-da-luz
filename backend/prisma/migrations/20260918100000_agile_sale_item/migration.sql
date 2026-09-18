-- Venda item a item do salao (Agile PDV). O agente ja enviava payload.itens;
-- o backend so contava o tamanho do array e descartava o conteudo.
CREATE TABLE "AgileSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemSeq" TEXT NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "shift" TEXT NOT NULL,
    "saleStatus" TEXT NOT NULL,
    "productCode" TEXT,
    "productName" TEXT NOT NULL,
    "productGroup" TEXT,
    "productCategory" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileSaleItem_pkey" PRIMARY KEY ("id")
);

-- Chave natural do PDV: torna o reimport idempotente.
CREATE UNIQUE INDEX "agitem_sale_seq_uniq" ON "AgileSaleItem"("saleId", "itemSeq");
CREATE INDEX "agitem_movement_idx" ON "AgileSaleItem"("movementDate");
CREATE INDEX "agitem_competence_idx" ON "AgileSaleItem"("competenceYear", "competenceMonth");
CREATE INDEX "agitem_product_code_idx" ON "AgileSaleItem"("productCode");
CREATE INDEX "agitem_product_name_idx" ON "AgileSaleItem"("productName");
