-- shopIdRemote — ID que a plataforma atribui à loja no sistema dela
-- (99 Food: shop_id, retornado no bind). Nullable porque preenchido só
-- após a loja autorizar via authorization page.
ALTER TABLE "DeliveryStore" ADD COLUMN "shopIdRemote" TEXT;

-- Auth token por loja — a 99 Food gera um authtoken único por
-- (app_id, secret, app_shop_id). Cada loja tem seu token, com validade
-- e refresh. 1:1 com DeliveryStore.
CREATE TABLE "NoventaNoveShopAuthToken" (
    "deliveryStoreId" TEXT NOT NULL,
    "authToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoventaNoveShopAuthToken_pkey" PRIMARY KEY ("deliveryStoreId")
);

CREATE INDEX "nnsat_expires_idx" ON "NoventaNoveShopAuthToken"("expiresAt");

ALTER TABLE "NoventaNoveShopAuthToken" ADD CONSTRAINT "NoventaNoveShopAuthToken_deliveryStoreId_fkey" FOREIGN KEY ("deliveryStoreId") REFERENCES "DeliveryStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
