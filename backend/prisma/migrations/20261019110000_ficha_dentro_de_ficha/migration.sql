-- Ficha dentro de ficha: o ingrediente de uma ficha pode ser outra ficha (de producao).
-- Ex.: "Nhoque - Massa" (rende 12 porcoes) entra como 1 porcao no "Nhoque ao molho 3 queijos", em vez de
-- repetir os 4 ingredientes da massa divididos por 12 a mao. O custo da massa e calculado uma vez.
ALTER TABLE "DishItem" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "DishItem" ADD COLUMN "componentDishId" TEXT;
ALTER TABLE "DishItem" ADD CONSTRAINT "DishItem_componentDishId_fkey" FOREIGN KEY ("componentDishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Exatamente um dos dois: produto comprado OU ficha de producao.
ALTER TABLE "DishItem" ADD CONSTRAINT "DishItem_produto_ou_ficha" CHECK (("productId" IS NULL) <> ("componentDishId" IS NULL));
CREATE INDEX "DishItem_componentDishId_idx" ON "DishItem"("componentDishId");
