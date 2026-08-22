-- Consolida o catalogo de unidades de medida: 20 registros para 14 unidades reais.
--
-- A lista tinha sinonimos convivendo porque o @unique de "code" so pega grafia
-- identica: BALD/BALDE/BDE eram tres baldes, PCT/PCTE/PACTE tres pacotes,
-- UN/UNI duas unidades, L/LITROS dois litros. No formulario de produto isso
-- aparecia como uma lista de 20 opcoes onde metade era a mesma coisa.
--
-- LT fica de fora da fusao de propósito: e "Lata", nao litro.
--
-- Fusoes: UNI->UN, PCTE->PCT, PACTE->PCT, BALDE->BD, BDE->BD, LITROS->L
-- BALD vira BD no lugar (mantem o id, entao nada precisa ser repontuado).

-- 1. BALD passa a ser BD antes das fusoes, para servir de destino.
UPDATE "UnitMeasure" SET "code" = 'BD', "name" = 'Balde', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'BALD';

-- 2. Repontua todas as referencias das unidades que serao absorvidas.
-- Uma linha por tabela com FK para "UnitMeasure".
WITH fusao AS (
  SELECT origem."id" AS origem_id, destino."id" AS destino_id
  FROM (VALUES ('UNI','UN'), ('PCTE','PCT'), ('PACTE','PCT'), ('BALDE','BD'), ('BDE','BD'), ('LITROS','L')) AS m(de, para)
  JOIN "UnitMeasure" origem ON origem."code" = m.de
  JOIN "UnitMeasure" destino ON destino."code" = m.para
)
UPDATE "Product" p SET "unitMeasureId" = f.destino_id
FROM fusao f WHERE p."unitMeasureId" = f.origem_id;

WITH fusao AS (
  SELECT origem."id" AS origem_id, destino."id" AS destino_id
  FROM (VALUES ('UNI','UN'), ('PCTE','PCT'), ('PACTE','PCT'), ('BALDE','BD'), ('BDE','BD'), ('LITROS','L')) AS m(de, para)
  JOIN "UnitMeasure" origem ON origem."code" = m.de
  JOIN "UnitMeasure" destino ON destino."code" = m.para
)
UPDATE "PurchaseItem" i SET "unitMeasureId" = f.destino_id
FROM fusao f WHERE i."unitMeasureId" = f.origem_id;

WITH fusao AS (
  SELECT origem."id" AS origem_id, destino."id" AS destino_id
  FROM (VALUES ('UNI','UN'), ('PCTE','PCT'), ('PACTE','PCT'), ('BALDE','BD'), ('BDE','BD'), ('LITROS','L')) AS m(de, para)
  JOIN "UnitMeasure" origem ON origem."code" = m.de
  JOIN "UnitMeasure" destino ON destino."code" = m.para
)
UPDATE "InventoryStock" s SET "unitMeasureId" = f.destino_id
FROM fusao f WHERE s."unitMeasureId" = f.origem_id;

WITH fusao AS (
  SELECT origem."id" AS origem_id, destino."id" AS destino_id
  FROM (VALUES ('UNI','UN'), ('PCTE','PCT'), ('PACTE','PCT'), ('BALDE','BD'), ('BDE','BD'), ('LITROS','L')) AS m(de, para)
  JOIN "UnitMeasure" origem ON origem."code" = m.de
  JOIN "UnitMeasure" destino ON destino."code" = m.para
)
UPDATE "InventoryMovement" mv SET "unitMeasureId" = f.destino_id
FROM fusao f WHERE mv."unitMeasureId" = f.origem_id;

WITH fusao AS (
  SELECT origem."id" AS origem_id, destino."id" AS destino_id
  FROM (VALUES ('UNI','UN'), ('PCTE','PCT'), ('PACTE','PCT'), ('BALDE','BD'), ('BDE','BD'), ('LITROS','L')) AS m(de, para)
  JOIN "UnitMeasure" origem ON origem."code" = m.de
  JOIN "UnitMeasure" destino ON destino."code" = m.para
)
UPDATE "StockCount" c SET "unitMeasureId" = f.destino_id
FROM fusao f WHERE c."unitMeasureId" = f.origem_id;

-- 3. Campos de unidade em texto. Nao e reescrever historico: UNI e UN sempre
-- foram a mesma unidade, so a grafia se padroniza. Quantidade nao muda.
UPDATE "Product" SET "unit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "unit" = m.de;
UPDATE "Product" SET "stockUnit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "stockUnit" = m.de;
UPDATE "Product" SET "purchaseUnit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "purchaseUnit" = m.de;
UPDATE "Product" SET "baseUnit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "baseUnit" = m.de;
UPDATE "PurchaseItem" SET "unit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "unit" = m.de;
UPDATE "ProductUnitConversion" SET "fromUnit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "fromUnit" = m.de;
UPDATE "ProductUnitConversion" SET "toUnit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "toUnit" = m.de;
UPDATE "DishItem" SET "unit" = m.para FROM (VALUES ('UNI','UN'),('PCTE','PCT'),('PACTE','PCT'),('BALD','BD'),('BALDE','BD'),('BDE','BD'),('LITROS','L')) AS m(de,para) WHERE "unit" = m.de;

-- 4. As unidades absorvidas saem. O DELETE so acontece se nada mais aponta
-- para elas — se sobrar referencia, a FK barra e a migration falha em vez de
-- deixar registro orfao.
DELETE FROM "UnitMeasure" WHERE "code" IN ('UNI', 'PCTE', 'PACTE', 'BALDE', 'BDE', 'LITROS');

-- 5. Nomes proprios onde o cadastro repetia a sigla ("MÇ" chamada "MÇ").
UPDATE "UnitMeasure" SET "name" = 'Unidade',   "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'UN';
UPDATE "UnitMeasure" SET "name" = 'Quilograma',"updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'KG';
UPDATE "UnitMeasure" SET "name" = 'Grama',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'G';
UPDATE "UnitMeasure" SET "name" = 'Litro',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'L';
UPDATE "UnitMeasure" SET "name" = 'Mililitro', "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ML';
UPDATE "UnitMeasure" SET "name" = 'Caixa',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'CX';
UPDATE "UnitMeasure" SET "name" = 'Pacote',    "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'PCT';
UPDATE "UnitMeasure" SET "name" = 'Fardo',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'FD';
UPDATE "UnitMeasure" SET "name" = 'Duzia',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'DZ';
UPDATE "UnitMeasure" SET "name" = 'Balde',     "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'BD';
UPDATE "UnitMeasure" SET "name" = 'Bandeja',   "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'BDJ';
UPDATE "UnitMeasure" SET "name" = 'Maco',      "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'MÇ';
UPDATE "UnitMeasure" SET "name" = 'Pote',      "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'POTE';
UPDATE "UnitMeasure" SET "name" = 'Lata',      "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'LT';

-- 6. Tudo que sobrou fica ativo: a lista curta e a lista inteira.
UPDATE "UnitMeasure" SET "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "isActive" = false;
