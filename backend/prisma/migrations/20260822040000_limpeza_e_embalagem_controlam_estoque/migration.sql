-- Material de limpeza passa a ser contado no inventario.
--
-- 29 produtos de LIMPEZA com compra recorrente (detergente com 41 compras,
-- saco de lixo com 23, ultimas em agosto) estavam com controlsStock = false:
-- eram comprados toda semana, guardados nos corredores e nunca contados.
--
-- Ligar o controle nao mexe na classificacao do DRE — sao campos separados.
-- Muda que o item entra na contagem e que, a partir do proximo fechamento,
-- passa a ser exigido nela: cmv-real.service.ts recusa base de CMV com
-- produto controlado sem contagem.
--
-- Ficam de fora, de proposito:
--   900 LAVAGEM DE PANOS E AFINS  — e servico, nao tem quantidade para contar
--   947 EMBALAGENS DIVERSAS       — nome guarda-chuva. Contar embalagem pede
--                                   os itens reais cadastrados um a um

-- 1. LIMPEZA nos setores que ja sao contados. O setor de cada produto e
-- preservado: ele diz onde a coisa esta guardada.
UPDATE "Product" p
SET "controlsStock" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM "Category" c, "InventorySector" s
WHERE c."id" = p."categoryId"
  AND s."id" = p."inventorySectorId"
  AND c."name" = 'LIMPEZA'
  AND s."normalizedName" IN ('corredores', 'estoque', 'gerencia')
  AND p."isActive"
  AND NOT p."controlsStock";

-- 2. A luva sai de "NAO BATER EST" para CORREDORES: e produto fisico e o setor
-- anterior significa exatamente nao contar.
UPDATE "Product" p
SET "controlsStock" = true,
    "inventorySectorId" = (SELECT "id" FROM "InventorySector" WHERE "normalizedName" = 'corredores'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE p."externalCode" = '939'
  AND p."isActive"
  AND EXISTS (SELECT 1 FROM "InventorySector" WHERE "normalizedName" = 'corredores');

-- 3. Registro de estoque zerado apenas para os produtos que acabaram de passar
-- a ser controlados. Sem ele o produto aparece na contagem sem saldo de
-- referencia, e a primeira contagem estabelece a quantidade real.
--
-- Restrito a LIMPEZA e a luva de proposito: existem 256 produtos ja
-- controlados e sem registro de estoque, e criar todos aqui seria mexer em
-- muito mais coisa do que esta em questao.
INSERT INTO "InventoryStock" ("id", "productId", "unitMeasureId", "currentQuantity", "averageCost", "updatedAt")
SELECT gen_random_uuid()::text, p."id", p."unitMeasureId", 0, 0, CURRENT_TIMESTAMP
FROM "Product" p
LEFT JOIN "Category" c ON c."id" = p."categoryId"
LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
WHERE p."isActive"
  AND p."controlsStock"
  AND (
    (c."name" = 'LIMPEZA' AND s."normalizedName" IN ('corredores', 'estoque', 'gerencia'))
    OR p."externalCode" = '939'
  )
  AND NOT EXISTS (SELECT 1 FROM "InventoryStock" st WHERE st."productId" = p."id");
