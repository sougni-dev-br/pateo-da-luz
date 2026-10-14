-- Ficha técnica: peso de cada porção (em gramas) e validade de uso do preparo (em dias). Ambos opcionais.
ALTER TABLE "Dish" ADD COLUMN "portionWeightG" DECIMAL(10,3);
ALTER TABLE "Dish" ADD COLUMN "shelfLifeDays" INTEGER;
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_portionWeightG_positivo" CHECK ("portionWeightG" IS NULL OR "portionWeightG" > 0);
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_shelfLifeDays_positivo" CHECK ("shelfLifeDays" IS NULL OR "shelfLifeDays" > 0);
