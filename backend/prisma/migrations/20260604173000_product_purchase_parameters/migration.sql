ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "estoqueMinimo" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "estoqueIdeal" DECIMAL(14,3),
  ADD COLUMN IF NOT EXISTS "leadTimeCompraDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "fornecedorPrincipalId" TEXT;

CREATE INDEX IF NOT EXISTS "Product_fornecedorPrincipalId_idx" ON "Product"("fornecedorPrincipalId");

UPDATE "Product" p
SET "estoqueMinimo" = s."minQuantity"
FROM "InventoryStock" s
WHERE s."productId" = p."id"
  AND p."estoqueMinimo" IS NULL
  AND s."minQuantity" IS NOT NULL;
