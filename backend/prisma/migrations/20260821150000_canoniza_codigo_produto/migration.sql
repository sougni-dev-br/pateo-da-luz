-- PROD-02: codigo de produto duplicado por diferenca de padding.
--
-- "externalCode" e texto e o @unique compara texto, entao "001185" e "1185"
-- conviviam como registros distintos sendo o mesmo numero para o operador — e
-- o mesmo numero para o MAX("externalCode"::int) que gerava o proximo codigo.
--
-- Forma canonica escolhida: sem zeros a esquerda. E o formato de 802 dos 831
-- codigos, e a importacao de catalogo casa codigo por igualdade exata de
-- string — repadronizar com padding invalidaria toda planilha antiga.
--
-- Ordem importa: renumerar os que colidem -> tirar o padding do resto ->
-- criar a sequencia ja no topo. Tirar o padding antes esbarraria no @unique.

-- 1. Nos 3 pares, o lado com padding cede o numero e recebe codigo novo no fim
-- da faixa. Compras e contagens apontam para "productId", nao para o codigo,
-- entao renumerar nao mexe em historico.
UPDATE "Product" SET "externalCode" = '1231', "updatedAt" = CURRENT_TIMESTAMP
WHERE "externalCode" = '001185'
  AND EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1185')
  AND NOT EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1231');

UPDATE "Product" SET "externalCode" = '1232', "updatedAt" = CURRENT_TIMESTAMP
WHERE "externalCode" = '001196'
  AND EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1196')
  AND NOT EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1232');

UPDATE "Product" SET "externalCode" = '1233', "updatedAt" = CURRENT_TIMESTAMP
WHERE "externalCode" = '001197'
  AND EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1197')
  AND NOT EXISTS (SELECT 1 FROM "Product" o WHERE o."externalCode" = '1233');

-- 2. Resto dos codigos com padding perde os zeros a esquerda. O NOT EXISTS
-- protege contra qualquer colisao que tenha escapado do passo 1.
UPDATE "Product" p
SET "externalCode" = ltrim(p."externalCode", '0'), "updatedAt" = CURRENT_TIMESTAMP
WHERE p."externalCode" ~ '^0+[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "Product" o
    WHERE o."externalCode" = ltrim(p."externalCode", '0') AND o."id" <> p."id"
  );

-- 3. Sequencia atomica, no lugar do MAX+1 que fazia dois cadastros simultaneos
-- calcularem o mesmo numero. Mesmo padrao de "SupplierSequence".
CREATE TABLE IF NOT EXISTS "ProductSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductSequence_pkey" PRIMARY KEY ("id")
);

-- Comeca no maior codigo numerico ja existente, para nunca reemitir um codigo
-- em uso. Idempotente: reexecutar nao anda com a sequencia para tras.
INSERT INTO "ProductSequence" ("id", "currentValue", "createdAt", "updatedAt")
SELECT 1, COALESCE(MAX("externalCode"::int), 0), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product"
WHERE "externalCode" ~ '^[0-9]+$'
ON CONFLICT ("id") DO UPDATE
SET "currentValue" = GREATEST("ProductSequence"."currentValue", EXCLUDED."currentValue"),
    "updatedAt" = CURRENT_TIMESTAMP;
