ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "normalizedName" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "contactName" TEXT,
  ADD COLUMN IF NOT EXISTS "mainCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultPaymentTermDays" INTEGER;

UPDATE "Supplier"
SET "normalizedName" = lower("name")
WHERE "normalizedName" IS NULL;

CREATE INDEX IF NOT EXISTS "Supplier_normalizedName_idx" ON "Supplier"("normalizedName");

CREATE TABLE IF NOT EXISTS "PurchaseSequence" (
  "year" INTEGER NOT NULL,
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseSequence_pkey" PRIMARY KEY ("year")
);

ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "purchaseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "workflowStatus" TEXT NOT NULL DEFAULT 'confirmed';

CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_purchaseNumber_key" ON "Purchase"("purchaseNumber");
CREATE INDEX IF NOT EXISTS "Purchase_purchaseNumber_idx" ON "Purchase"("purchaseNumber");
CREATE INDEX IF NOT EXISTS "Purchase_duplicateKey_idx" ON "Purchase"("duplicateKey");
CREATE INDEX IF NOT EXISTS "Purchase_workflowStatus_idx" ON "Purchase"("workflowStatus");

WITH ordered AS (
  SELECT
    "id",
    "competenceYear",
    row_number() OVER (PARTITION BY "competenceYear" ORDER BY "createdAt", "id") AS seq
  FROM "Purchase"
  WHERE "purchaseNumber" IS NULL
)
UPDATE "Purchase" p
SET "purchaseNumber" = 'CMP-' || ordered."competenceYear" || '-' || lpad(ordered.seq::text, 6, '0')
FROM ordered
WHERE p."id" = ordered."id";

INSERT INTO "PurchaseSequence" ("year", "currentValue", "updatedAt")
SELECT "competenceYear", COALESCE(MAX(CAST(right("purchaseNumber", 6) AS INTEGER)), 0), CURRENT_TIMESTAMP
FROM "Purchase"
WHERE "purchaseNumber" IS NOT NULL
GROUP BY "competenceYear"
ON CONFLICT ("year") DO UPDATE SET
  "currentValue" = GREATEST("PurchaseSequence"."currentValue", EXCLUDED."currentValue"),
  "updatedAt" = CURRENT_TIMESTAMP;
