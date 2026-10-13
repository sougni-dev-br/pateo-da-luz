-- Ficha por cardapio: o item de ficha pertence ao cardapio em que a quantidade vale (a la carte x delivery).
ALTER TABLE "DishItem" ADD COLUMN "menu" TEXT NOT NULL DEFAULT 'CARDAPIO';

-- Os itens que ja existem valem para o cardapio do prato.
UPDATE "DishItem" i SET "menu" = d."menu" FROM "Dish" d WHERE d."id" = i."dishId";

CREATE INDEX "DishItem_dishId_menu_idx" ON "DishItem"("dishId", "menu");
