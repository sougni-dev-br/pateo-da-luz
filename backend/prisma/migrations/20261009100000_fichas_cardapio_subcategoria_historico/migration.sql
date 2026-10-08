-- Fichas tecnicas: cardapio (salao x delivery), subcategorias e historico de versoes.
-- Aditiva: so acrescenta colunas com default, uma tabela e indices; nada e apagado.

-- 1) Cardapio do prato. Todo prato com listagem em canal de delivery (hoje, os importados da 99)
--    passa a ser DELIVERY; o resto continua CARDAPIO (salao).
ALTER TABLE "Dish" ADD COLUMN "menu" TEXT NOT NULL DEFAULT 'CARDAPIO';
UPDATE "Dish" SET "menu" = 'DELIVERY'
 WHERE EXISTS (SELECT 1 FROM "DishListing" l WHERE l."dishId" = "Dish"."id");
CREATE INDEX "Dish_menu_isActive_idx" ON "Dish"("menu", "isActive");

-- 2) Categorias em dois niveis e por cardapio.
ALTER TABLE "DishCategory" ADD COLUMN "parentId" TEXT;
ALTER TABLE "DishCategory" ADD COLUMN "menu" TEXT NOT NULL DEFAULT 'CARDAPIO';
-- A unica categoria que ja nasceu para delivery ("Prato delivery") acompanha o cardapio dela.
UPDATE "DishCategory" SET "menu" = 'DELIVERY' WHERE lower("name") LIKE '%delivery%';

-- Categoria e prato precisam ficar no mesmo cardapio (a rota recusa o contrario). Categoria usada so por
-- prato de delivery passa para o delivery; prato de delivery que ainda ficar numa categoria do salao
-- (categoria compartilhada com prato do salao) perde a categoria e volta a ser organizado pela tela.
UPDATE "DishCategory" c SET "menu" = 'DELIVERY'
 WHERE c."menu" = 'CARDAPIO'
   AND EXISTS (SELECT 1 FROM "Dish" d WHERE d."categoryId" = c."id" AND d."menu" = 'DELIVERY')
   AND NOT EXISTS (SELECT 1 FROM "Dish" d WHERE d."categoryId" = c."id" AND d."menu" = 'CARDAPIO');
UPDATE "Dish" d SET "categoryId" = NULL
 WHERE d."menu" = 'DELIVERY'
   AND d."categoryId" IN (SELECT c."id" FROM "DishCategory" c WHERE c."menu" <> 'DELIVERY');
ALTER TABLE "DishCategory" ADD CONSTRAINT "DishCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "DishCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DishCategory_parentId_idx" ON "DishCategory"("parentId");

-- O nome deixa de ser unico no sistema todo: passa a ser unico por pai e por cardapio.
-- (Indice com expressao: o Prisma nao o expressa no schema, por isso vive so aqui.)
DROP INDEX IF EXISTS "DishCategory_name_key";
CREATE UNIQUE INDEX "dishcat_menu_parent_name_uniq"
  ON "DishCategory"("menu", COALESCE("parentId", ''), "name");

-- 3) Historico de versoes da ficha.
CREATE TABLE "DishRevision" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "snapshot" JSONB NOT NULL,
    "costPerServing" DECIMAL(12,4),
    "salePrice" DECIMAL(10,2),
    "cmvPercent" DECIMAL(8,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DishRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DishRevision_dishId_createdAt_idx" ON "DishRevision"("dishId", "createdAt");
ALTER TABLE "DishRevision" ADD CONSTRAINT "DishRevision_dishId_fkey"
  FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
