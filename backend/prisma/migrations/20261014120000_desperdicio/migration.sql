-- Desperdicio de insumo: decomposicao do CMV, sem efeito em estoque, DRE ou periodo financeiro.
CREATE TYPE "WasteReason" AS ENUM (
  'EXPIRED', 'SPOILED', 'BREAKAGE', 'PREPARATION_ERROR',
  'PRODUCTION_LEFTOVER', 'CUSTOMER_RETURN', 'CONTAMINATION', 'OTHER'
);

CREATE TABLE "WasteEntry" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "unit" TEXT,
  "reason" "WasteReason" NOT NULL,
  "occurredOn" DATE NOT NULL,
  "sectorId" TEXT,
  "unitCost" DECIMAL(14,4),
  "totalCost" DECIMAL(14,2),
  "costSource" TEXT,
  "notes" TEXT,
  "registeredById" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WasteEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WasteEntry_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "WasteEntry_occurredOn_idx" ON "WasteEntry"("occurredOn");
CREATE INDEX "WasteEntry_productId_occurredOn_idx" ON "WasteEntry"("productId", "occurredOn");

ALTER TABLE "WasteEntry"
  ADD CONSTRAINT "WasteEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quem lanca (ESTOQUISTA) ve e cria; cancelar um lancamento pede "excluir" (gestao).
-- O admin ajusta por usuario na tela de Permissoes.
INSERT INTO "RoleMenuPermission"
  ("id", "role", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'ADMIN',           'inventory-waste', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'inventory-waste', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'inventory-waste', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'inventory-waste', 'FULL', true,  true,  false, false, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "menuId") DO NOTHING;
