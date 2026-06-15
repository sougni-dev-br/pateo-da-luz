CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'GESTAO_COMPLETA', 'ESTOQUISTA', 'VISUALIZACAO');
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE_IN', 'MANUAL_OUT', 'LOSS', 'BREAKAGE', 'ADJUSTMENT', 'TRANSFER');
CREATE TYPE "StockCountFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'VISUALIZACAO',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UserSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "previousValue" JSONB,
  "newValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "InventoryStock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL UNIQUE,
  "unitMeasureId" TEXT,
  "currentQuantity" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  "averageCost" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  "costPerKg" DECIMAL(14, 4),
  "costPerBox" DECIMAL(14, 4),
  "costPerUnit" DECIMAL(14, 4),
  "minQuantity" DECIMAL(14, 4),
  "lastMovementAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryStock_unitMeasureId_fkey" FOREIGN KEY ("unitMeasureId") REFERENCES "UnitMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "InventoryMovement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "quantity" DECIMAL(14, 4) NOT NULL,
  "unit" TEXT,
  "unitMeasureId" TEXT,
  "unitCost" DECIMAL(14, 4),
  "totalCost" DECIMAL(14, 4),
  "sourcePurchaseItemId" TEXT,
  "sourceStockCountId" TEXT,
  "responsibleUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_unitMeasureId_fkey" FOREIGN KEY ("unitMeasureId") REFERENCES "UnitMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryMovement_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StockCount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "countedQuantity" DECIMAL(14, 4) NOT NULL,
  "expectedQuantity" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  "divergenceQuantity" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  "unit" TEXT,
  "unitMeasureId" TEXT,
  "responsibleUserId" TEXT,
  "notes" TEXT,
  "adjustmentGenerated" BOOLEAN NOT NULL DEFAULT false,
  "adjustmentMovementId" TEXT,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockCount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockCount_unitMeasureId_fkey" FOREIGN KEY ("unitMeasureId") REFERENCES "UnitMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StockCount_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StockCountPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "frequency" "StockCountFrequency" NOT NULL DEFAULT 'WEEKLY',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "InventoryMovement_productId_idx" ON "InventoryMovement"("productId");
CREATE INDEX IF NOT EXISTS "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");
CREATE INDEX IF NOT EXISTS "StockCount_productId_idx" ON "StockCount"("productId");
CREATE INDEX IF NOT EXISTS "StockCount_countedAt_idx" ON "StockCount"("countedAt");

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role")
VALUES (
  'local-admin',
  'Administrador Local',
  'admin@pateodaluz.local',
  'pateo-local-admin:6f92ee116825ab7fcb1318c9b97f29307abd36f9ef0b44d55bbbf6e1d515ac79f675f682a79dfcbf116036825a5c47f09019a474209e07ad22f372db019e4e93',
  'ADMIN'
)
ON CONFLICT ("email") DO NOTHING;

INSERT INTO "StockCountPolicy" ("id", "frequency", "notes")
VALUES ('default-stock-count-policy', 'WEEKLY', 'Politica inicial de contagem periodica.')
ON CONFLICT ("id") DO NOTHING;
