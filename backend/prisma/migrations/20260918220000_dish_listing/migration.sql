-- Onde um prato e vendido e por quanto. O preco nao cabe num campo do Dish:
-- dos 29 pratos que aparecem em mais de uma loja da 99, 23 tem preco diferente
-- entre elas.
CREATE TABLE "DishListing" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deliveryStoreId" TEXT,
    "externalItemId" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "categoryName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DishListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dishlst_channel_store_item_uniq" ON "DishListing"("channel", "deliveryStoreId", "externalItemId");

-- No Postgres NULL <> NULL, entao o indice unico acima NAO barra duplicata
-- quando "deliveryStoreId" e nulo — o caso do salao, que nao tem loja de
-- delivery. Sem este indice parcial a chave natural protegeria o delivery e
-- deixaria o salao sem protecao nenhuma, silenciosamente.
-- Prisma nao expressa indice parcial no schema, por isso ele vive so aqui.
CREATE UNIQUE INDEX "dishlst_channel_item_sem_loja_uniq"
    ON "DishListing"("channel", "externalItemId")
    WHERE "deliveryStoreId" IS NULL;
CREATE INDEX "dishlst_dish_idx" ON "DishListing"("dishId");
CREATE INDEX "dishlst_store_idx" ON "DishListing"("deliveryStoreId");
CREATE INDEX "dishlst_channel_active_idx" ON "DishListing"("channel", "isActive");

ALTER TABLE "DishListing" ADD CONSTRAINT "DishListing_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DishListing" ADD CONSTRAINT "DishListing_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
