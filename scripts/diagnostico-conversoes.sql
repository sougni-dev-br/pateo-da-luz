-- Diagnostico das conversoes de unidade (SOMENTE LEITURA).
--
-- Rodar numa copia do banco de producao antes de decidir o reprocessamento:
--   psql "$DATABASE_URL_DA_COPIA" -f scripts/diagnostico-conversoes.sql
-- Nao altera nada: so cria uma funcao temporaria (pg_temp) e termina em ROLLBACK.

BEGIN;

-- Mesma normalizacao do backend (shared/unidades/conversao.ts).
CREATE OR REPLACE FUNCTION pg_temp.canon(u text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE x
    WHEN 'UNI' THEN 'UN' WHEN 'UND' THEN 'UN' WHEN 'UNIDADE' THEN 'UN' WHEN 'UNIDADES' THEN 'UN'
    WHEN 'CAIXA' THEN 'CX' WHEN 'PCTE' THEN 'PCT' WHEN 'PACOTE' THEN 'PCT' WHEN 'FARDO' THEN 'FD'
    WHEN 'LT' THEN 'L' WHEN 'LTS' THEN 'L' WHEN 'LITRO' THEN 'L' WHEN 'LITROS' THEN 'L'
    WHEN 'GR' THEN 'G' WHEN 'GRS' THEN 'G' WHEN 'GRAMA' THEN 'G' WHEN 'GRAMAS' THEN 'G'
    WHEN 'K' THEN 'KG' WHEN 'KGS' THEN 'KG' WHEN 'QUILO' THEN 'KG' WHEN 'KILO' THEN 'KG'
    ELSE x END
  FROM (SELECT UPPER(REGEXP_REPLACE(TRIM(u), '\.+$', '')) AS x) t
$$;

\echo '== (a) Linhas de compra sem conversao (conversionMissing), compras ativas'
SELECT COUNT(*) AS linhas, COUNT(DISTINCT pi."productId") AS produtos, ROUND(SUM(pi."totalPrice"), 2) AS valor
FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchaseId"
WHERE p."status" = 'ACTIVE' AND pi."conversionMissing";

\echo '== (a2) Top 20 produtos com linhas sem conversao'
SELECT pr."externalCode", pr."name", COALESCE(pr."stockUnit", pr."unit") AS contagem,
       STRING_AGG(DISTINCT pg_temp.canon(pi."unit"), ', ') AS unidades_da_nota,
       COUNT(*) AS linhas, ROUND(SUM(pi."totalPrice"), 2) AS valor
FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchaseId" JOIN "Product" pr ON pr."id" = pi."productId"
WHERE p."status" = 'ACTIVE' AND pi."conversionMissing"
GROUP BY 1, 2, 3 ORDER BY valor DESC NULLS LAST LIMIT 20;

\echo '== (b) Linhas antigas (sem colunas de conversao) em unidade diferente da contagem'
SELECT COUNT(*) AS linhas, COUNT(DISTINCT pi."productId") AS produtos, ROUND(SUM(pi."totalPrice"), 2) AS valor
FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchaseId" JOIN "Product" pr ON pr."id" = pi."productId"
WHERE p."status" = 'ACTIVE' AND pi."convertedUnit" IS NULL AND NOT pi."conversionMissing"
  AND pi."unit" IS NOT NULL AND COALESCE(pr."stockUnit", pr."unit") IS NOT NULL
  AND pg_temp.canon(pi."unit") <> pg_temp.canon(COALESCE(pr."stockUnit", pr."unit"));

\echo '== (b2) Linhas com conversionMissing que JA teriam conversao cadastrada hoje (reprocessaveis)'
SELECT COUNT(*) AS linhas, COUNT(DISTINCT pi."productId") AS produtos
FROM "PurchaseItem" pi JOIN "Purchase" p ON p."id" = pi."purchaseId" JOIN "Product" pr ON pr."id" = pi."productId"
WHERE p."status" = 'ACTIVE' AND pi."conversionMissing"
  AND EXISTS (
    SELECT 1 FROM "ProductUnitConversion" c
    WHERE c."productId" = pi."productId" AND c."isActive"
      AND ((pg_temp.canon(c."fromUnit") = pg_temp.canon(pi."unit") AND pg_temp.canon(c."toUnit") = pg_temp.canon(COALESCE(pr."stockUnit", pr."unit")))
        OR (pg_temp.canon(c."toUnit") = pg_temp.canon(pi."unit") AND pg_temp.canon(c."fromUnit") = pg_temp.canon(COALESCE(pr."stockUnit", pr."unit"))))
  );

\echo '== (c) Produtos com "Fator de conversao"/"Peso medio" legados preenchidos e sem conversao cadastrada'
SELECT pr."externalCode", pr."name", pr."purchaseUnit", COALESCE(pr."stockUnit", pr."unit") AS contagem,
       pr."conversionFactor", pr."packageWeight"
FROM "Product" pr
WHERE (pr."conversionFactor" IS NOT NULL OR pr."packageWeight" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "ProductUnitConversion" c WHERE c."productId" = pr."id" AND c."isActive")
ORDER BY pr."name";

\echo '== (d1) Conversoes com origem = destino, ou gravadas fora da forma canonica'
SELECT pr."name", c."fromUnit", c."toUnit", c."factor",
       CASE WHEN pg_temp.canon(c."fromUnit") = pg_temp.canon(c."toUnit") THEN 'origem = destino' ELSE 'grafia nao canonica' END AS problema
FROM "ProductUnitConversion" c JOIN "Product" pr ON pr."id" = c."productId"
WHERE pg_temp.canon(c."fromUnit") = pg_temp.canon(c."toUnit")
   OR c."fromUnit" <> pg_temp.canon(c."fromUnit") OR c."toUnit" <> pg_temp.canon(c."toUnit");

\echo '== (d2) Pares inversos que se contradizem'
SELECT pr."name", a."fromUnit", a."toUnit", a."factor", b."factor" AS fator_inverso
FROM "ProductUnitConversion" a
JOIN "ProductUnitConversion" b ON b."productId" = a."productId"
  AND pg_temp.canon(b."fromUnit") = pg_temp.canon(a."toUnit") AND pg_temp.canon(b."toUnit") = pg_temp.canon(a."fromUnit")
JOIN "Product" pr ON pr."id" = a."productId"
WHERE a."id" < b."id" AND ABS(a."factor" * b."factor" - 1) > 0.01;

\echo '== (e) Custo medio do estoque (usado nas fichas tecnicas) x custo das compras convertidas desde o ultimo inventario aprovado'
WITH ultima AS (
  SELECT DISTINCT ON (i."productId") i."productId", COALESCE(o."effectiveCountDate", o."date")::date AS dia
  FROM "OperationalInventoryItem" i JOIN "OperationalInventory" o ON o."id" = i."inventoryId"
  WHERE o."status" IN ('APROVADO', 'FECHADO') AND i."countedQuantity" IS NOT NULL
  ORDER BY i."productId", COALESCE(o."effectiveCountDate", o."date") DESC
),
compras AS (
  SELECT pi."productId",
         SUM(pi."totalPrice") / NULLIF(SUM(COALESCE(pi."convertedQuantity", pi."quantity")), 0) AS custo,
         COUNT(*) AS linhas
  FROM "PurchaseItem" pi
  JOIN "Purchase" p ON p."id" = pi."purchaseId"
  JOIN "Product" pr ON pr."id" = pi."productId"
  LEFT JOIN ultima u ON u."productId" = pi."productId"
  WHERE p."status" = 'ACTIVE' AND p."workflowStatus" = 'confirmed' AND NOT pi."conversionMissing"
    AND COALESCE(p."receivedAt", p."purchaseDate")::date > COALESCE(u.dia, DATE '1900-01-01')
    AND (
      (pi."convertedUnit" IS NOT NULL AND pg_temp.canon(pi."convertedUnit") = pg_temp.canon(COALESCE(pr."stockUnit", pr."unit")))
      OR (pi."convertedUnit" IS NULL AND pg_temp.canon(pi."unit") = pg_temp.canon(COALESCE(pr."stockUnit", pr."unit")))
    )
  GROUP BY pi."productId"
),
fichas AS (
  SELECT di."productId", COUNT(DISTINCT di."dishId") AS fichas FROM "DishItem" di WHERE di."productId" IS NOT NULL GROUP BY 1
)
SELECT pr."externalCode", pr."name", COALESCE(pr."stockUnit", pr."unit") AS contagem,
       ROUND(s."averageCost", 4) AS custo_medio_estoque, ROUND(c.custo, 4) AS custo_compras_convertidas,
       ROUND(s."averageCost" / NULLIF(c.custo, 0), 1) AS razao, c.linhas, COALESCE(f.fichas, 0) AS fichas_que_usam
FROM "InventoryStock" s
JOIN "Product" pr ON pr."id" = s."productId"
JOIN compras c ON c."productId" = s."productId"
LEFT JOIN fichas f ON f."productId" = s."productId"
WHERE s."averageCost" > 0 AND c.custo > 0
  AND (s."averageCost" / c.custo > 3 OR c.custo / s."averageCost" > 3)
ORDER BY COALESCE(f.fichas, 0) DESC, GREATEST(s."averageCost" / c.custo, c.custo / s."averageCost") DESC
LIMIT 30;

ROLLBACK;
