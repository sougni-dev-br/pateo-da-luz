-- CAD-04: setores duplicados que a chave unica nao pegou.
--
-- "InventorySector"."normalizedName" e @unique, mas linhas legadas gravaram o
-- valor em MAIUSCULAS enquanto normalizeText() produz minusculas. O resultado
-- foram pares convivendo ("ESTOQUE"/"estoque", "FREEZER"/"freezer",
-- "GERENCIA"/"gerencia"), com produtos ativos apontando para a linha inativa.
--
-- Ordem importa: repontuar produtos -> apagar duplicata -> normalizar o resto.
-- Normalizar antes esbarraria na propria chave unica.

-- 1. Produtos das linhas duplicadas passam para a linha canonica (minuscula).
UPDATE "Product" p
SET "inventorySectorId" = canonico."id"
FROM "InventorySector" dup
JOIN "InventorySector" canonico
  ON canonico."normalizedName" = lower(dup."normalizedName")
 AND canonico."id" <> dup."id"
WHERE p."inventorySectorId" = dup."id"
  AND dup."normalizedName" <> lower(dup."normalizedName");

-- 2. Duplicatas ja sem produto saem da base.
DELETE FROM "InventorySector" dup
WHERE dup."normalizedName" <> lower(dup."normalizedName")
  AND EXISTS (
    SELECT 1 FROM "InventorySector" c
    WHERE c."normalizedName" = lower(dup."normalizedName") AND c."id" <> dup."id"
  )
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."inventorySectorId" = dup."id");

-- 3. Sobrou linha em maiusculas sem par canonico? Normaliza no lugar.
UPDATE "InventorySector"
SET "normalizedName" = lower("normalizedName"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "normalizedName" <> lower("normalizedName");

-- 4. Lixo que entrou por serializacao errada ou placeholder, desde que sem produto.
DELETE FROM "InventorySector" s
WHERE s."normalizedName" IN ('object object', 'sem setor', 'undefined', 'null')
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."inventorySectorId" = s."id");

-- 5. Setores ja desativados e sem nenhum produto nao precisam ficar na lista.
DELETE FROM "InventorySector" s
WHERE s."isActive" = false
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."inventorySectorId" = s."id");

-- 6. ESTOQUE SECO esta ativo, tem zero produtos e nunca apareceu em contagem.
-- Fica desativado, nao apagado: pode voltar a ser usado.
UPDATE "InventorySector" s
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE s."normalizedName" = 'estoque seco'
  AND s."isActive" = true
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."inventorySectorId" = s."id");
