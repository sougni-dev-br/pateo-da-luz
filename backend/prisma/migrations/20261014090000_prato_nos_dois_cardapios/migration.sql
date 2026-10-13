-- Prato vendido nos dois cardapios (salao e delivery) com uma unica ficha: o outro cardapio e a categoria dele.
ALTER TABLE "Dish" ADD COLUMN "alsoMenu" TEXT;
ALTER TABLE "Dish" ADD COLUMN "alsoCategoryId" TEXT;

ALTER TABLE "Dish" ADD CONSTRAINT "Dish_alsoCategoryId_fkey" FOREIGN KEY ("alsoCategoryId") REFERENCES "DishCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Dish_alsoCategoryId_idx" ON "Dish"("alsoCategoryId");
