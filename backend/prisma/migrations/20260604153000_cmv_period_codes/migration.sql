ALTER TABLE "CmvPeriod"
  ADD COLUMN IF NOT EXISTS "code" TEXT;

WITH numbered AS (
  SELECT
    "id",
    EXTRACT(YEAR FROM "dataInicial")::int AS "year",
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM "dataInicial")::int
      ORDER BY "dataInicial", "createdAt", "id"
    ) AS "sequence"
  FROM "CmvPeriod"
  WHERE "code" IS NULL OR "code" = ''
)
UPDATE "CmvPeriod" p
SET "code" = 'CMV-' || numbered."year" || '-' || LPAD(numbered."sequence"::text, 4, '0')
FROM numbered
WHERE p."id" = numbered."id";

CREATE UNIQUE INDEX IF NOT EXISTS "CmvPeriod_code_key" ON "CmvPeriod"("code");
CREATE INDEX IF NOT EXISTS "CmvPeriod_code_idx" ON "CmvPeriod"("code");
