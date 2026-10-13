-- Desperdicio de prato pronto (sobra de buffet, prato devolvido): o lancamento passa a ter
-- insumo OU prato. Os lancamentos existentes sao todos de insumo e continuam validos.
ALTER TABLE "WasteEntry" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "WasteEntry" ADD COLUMN "dishId" TEXT;

ALTER TABLE "WasteEntry"
  ADD CONSTRAINT "WasteEntry_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WasteEntry"
  ADD CONSTRAINT "WasteEntry_product_xor_dish" CHECK (num_nonnulls("productId", "dishId") = 1);

CREATE INDEX "WasteEntry_dishId_occurredOn_idx" ON "WasteEntry"("dishId", "occurredOn");

-- Configuracao do aviso diario de desperdicio por WhatsApp (linha unica).
CREATE TABLE "WasteSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "dailyAlertValue" DECIMAL(14,2),
  "lastAlertDay" DATE,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WasteSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WasteSettings_dailyAlertValue_positive" CHECK ("dailyAlertValue" IS NULL OR "dailyAlertValue" > 0)
);

-- Foto opcional do desperdicio (uma por lancamento; some junto com ele e expira em 90 dias).
CREATE TABLE "WasteEntryPhoto" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WasteEntryPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WasteEntryPhoto_size_limit" CHECK ("size" > 0 AND "size" <= 307200),
  CONSTRAINT "WasteEntryPhoto_size_matches_content" CHECK ("size" = octet_length("content")),
  CONSTRAINT "WasteEntryPhoto_jpeg_only" CHECK ("mimeType" = 'image/jpeg')
);

CREATE UNIQUE INDEX "WasteEntryPhoto_entryId_key" ON "WasteEntryPhoto"("entryId");
CREATE INDEX "WasteEntryPhoto_createdAt_idx" ON "WasteEntryPhoto"("createdAt");

ALTER TABLE "WasteEntryPhoto"
  ADD CONSTRAINT "WasteEntryPhoto_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WasteEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
