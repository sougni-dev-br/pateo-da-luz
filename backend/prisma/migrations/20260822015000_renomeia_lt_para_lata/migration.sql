-- "LT" significava Lata no cadastro, mas LT le-se litro em praticamente todo
-- sistema — ao lado de "L" (Litro) a lista mostrava dois itens que pareciam a
-- mesma unidade. Escrever LATA por extenso resolve tambem onde so a sigla
-- aparece: relatorio, planilha, etiqueta.
--
-- Zero produtos usavam LT, entao nao ha referencia para repontuar. Os UPDATEs
-- de texto ficam por seguranca, caso algo tenha sido gravado entre a
-- consolidacao e esta migration.

UPDATE "UnitMeasure" SET "code" = 'LATA', "name" = 'Lata', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'LT'
  AND NOT EXISTS (SELECT 1 FROM "UnitMeasure" o WHERE o."code" = 'LATA');

UPDATE "Product" SET "unit" = 'LATA' WHERE "unit" = 'LT';
UPDATE "Product" SET "stockUnit" = 'LATA' WHERE "stockUnit" = 'LT';
UPDATE "Product" SET "purchaseUnit" = 'LATA' WHERE "purchaseUnit" = 'LT';
UPDATE "Product" SET "baseUnit" = 'LATA' WHERE "baseUnit" = 'LT';
UPDATE "PurchaseItem" SET "unit" = 'LATA' WHERE "unit" = 'LT';
UPDATE "ProductUnitConversion" SET "fromUnit" = 'LATA' WHERE "fromUnit" = 'LT';
UPDATE "ProductUnitConversion" SET "toUnit" = 'LATA' WHERE "toUnit" = 'LT';
UPDATE "DishItem" SET "unit" = 'LATA' WHERE "unit" = 'LT';
