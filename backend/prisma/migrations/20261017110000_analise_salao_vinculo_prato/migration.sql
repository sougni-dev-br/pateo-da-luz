-- Vinculo entre produto do PDV (Agile) e prato da ficha tecnica do salao.
CREATE TABLE "AgileProdutoPrato" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileProdutoPrato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgileProdutoPrato_productCode_key" ON "AgileProdutoPrato"("productCode");
CREATE INDEX "agprodprato_dish_idx" ON "AgileProdutoPrato"("dishId");

ALTER TABLE "AgileProdutoPrato" ADD CONSTRAINT "AgileProdutoPrato_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
