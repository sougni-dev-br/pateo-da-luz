CREATE TABLE IF NOT EXISTS "SupplierSequence" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierSequence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentInstallment"
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "surchargeAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "differenceReason" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "name", "id") AS rn
  FROM "Supplier"
  WHERE "externalCode" IS NULL OR TRIM("externalCode") = ''
)
UPDATE "Supplier" s
SET "externalCode" = 'FOR-' || LPAD(numbered.rn::text, 6, '0')
FROM numbered
WHERE s."id" = numbered."id";

INSERT INTO "SupplierSequence" ("id", "currentValue", "updatedAt")
VALUES (
  1,
  COALESCE((
    SELECT MAX(NULLIF(REGEXP_REPLACE("externalCode", '\\D', '', 'g'), '')::integer)
    FROM "Supplier"
    WHERE "externalCode" ~ '[0-9]'
  ), 0),
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "currentValue" = GREATEST("SupplierSequence"."currentValue", EXCLUDED."currentValue"),
  "updatedAt" = CURRENT_TIMESTAMP;
