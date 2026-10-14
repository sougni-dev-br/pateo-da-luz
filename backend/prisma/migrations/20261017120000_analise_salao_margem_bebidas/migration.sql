-- Vinculo entre bebida do PDV (Agile) e insumo comprado, para a margem de revenda.
CREATE TABLE "AgileProdutoInsumo" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileProdutoInsumo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgileProdutoInsumo_productCode_key" ON "AgileProdutoInsumo"("productCode");
CREATE INDEX "agprodinsumo_insumo_idx" ON "AgileProdutoInsumo"("insumoId");

ALTER TABLE "AgileProdutoInsumo" ADD CONSTRAINT "AgileProdutoInsumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
