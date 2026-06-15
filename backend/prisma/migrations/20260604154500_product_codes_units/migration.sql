INSERT INTO "UnitMeasure" ("id", "code", "name", "type", "isActive", "updatedAt")
VALUES
  ('unit-un', 'UN', 'Unidade', 'COUNT', true, CURRENT_TIMESTAMP),
  ('unit-kg', 'KG', 'Quilograma', 'WEIGHT', true, CURRENT_TIMESTAMP),
  ('unit-g', 'G', 'Grama', 'WEIGHT', true, CURRENT_TIMESTAMP),
  ('unit-l', 'L', 'Litro', 'VOLUME', true, CURRENT_TIMESTAMP),
  ('unit-ml', 'ML', 'Mililitro', 'VOLUME', true, CURRENT_TIMESTAMP),
  ('unit-cx', 'CX', 'Caixa', 'PACKAGE', true, CURRENT_TIMESTAMP),
  ('unit-fd', 'FD', 'Fardo', 'PACKAGE', true, CURRENT_TIMESTAMP),
  ('unit-pct', 'PCT', 'Pacote', 'PACKAGE', true, CURRENT_TIMESTAMP),
  ('unit-lt', 'LT', 'Lata', 'PACKAGE', true, CURRENT_TIMESTAMP),
  ('unit-dz', 'DZ', 'Duzia', 'COUNT', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

WITH max_numeric AS (
  SELECT COALESCE(MAX("externalCode"::int), 0) AS base
  FROM "Product"
  WHERE "externalCode" ~ '^[0-9]+$'
),
numbered AS (
  SELECT
    p."id",
    max_numeric.base + ROW_NUMBER() OVER (ORDER BY p."createdAt", p."id") AS next_code
  FROM "Product" p
  CROSS JOIN max_numeric
  WHERE p."externalCode" IS NULL OR p."externalCode" = ''
)
UPDATE "Product" p
SET "externalCode" = LPAD(numbered.next_code::text, 6, '0')
FROM numbered
WHERE p."id" = numbered."id";

UPDATE "Product" p
SET
  "unitMeasureId" = u."id",
  "unit" = u."code"
FROM "UnitMeasure" u
WHERE p."unitMeasureId" IS NULL
  AND p."unit" IS NOT NULL
  AND UPPER(TRIM(p."unit")) = u."code";
