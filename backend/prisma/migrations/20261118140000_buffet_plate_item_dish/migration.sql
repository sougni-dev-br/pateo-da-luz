-- Cada prato das plaquinhas pode apontar para a ficha técnica que dá o custo dele na pesagem do buffet.
ALTER TABLE "BuffetPlateItem" ADD COLUMN "dishId" TEXT;

CREATE INDEX "BuffetPlateItem_dishId_idx" ON "BuffetPlateItem"("dishId");

ALTER TABLE "BuffetPlateItem" ADD CONSTRAINT "BuffetPlateItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE SET NULL ON UPDATE CASCADE;
