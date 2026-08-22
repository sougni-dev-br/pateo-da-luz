-- Faxina de cadastro: ordem de contagem dos setores e formatacao dos nomes.

-- 1. Ordem em que a equipe percorre a casa na contagem. Antes todos os setores
-- estavam em countOrder 0, entao a lista saia alfabetica e nao acompanhava o
-- caminho de quem conta.
UPDATE "InventorySector" SET "countOrder" = 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'estoque';
UPDATE "InventorySector" SET "countOrder" = 2, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'camara fria';
UPDATE "InventorySector" SET "countOrder" = 3, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'freezer';
UPDATE "InventorySector" SET "countOrder" = 4, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'bar';
UPDATE "InventorySector" SET "countOrder" = 5, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'adega';
UPDATE "InventorySector" SET "countOrder" = 6, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'corredores';
UPDATE "InventorySector" SET "countOrder" = 7, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'gerencia';
-- NAO BATER EST fica por ultimo: seus produtos nao entram na contagem.
UPDATE "InventorySector" SET "countOrder" = 8, "updatedAt" = CURRENT_TIMESTAMP WHERE "normalizedName" = 'nao bater est';
-- Setor desativado vai para o fim, para nao disputar posicao se for reativado.
UPDATE "InventorySector" SET "countOrder" = 99, "updatedAt" = CURRENT_TIMESTAMP WHERE "isActive" = false AND "countOrder" = 0;

-- 2. Espaco duplo e espaco nas bordas do nome do produto.
-- "normalizedName" e "normalizedAlias" nao mudam: normalizeText() ja colapsa
-- espacos, entao a chave de busca e o casamento por apelido ficam intactos.
--
-- Classe POSIX [[:space:]] em vez de \s de proposito: '\s' depende de como a
-- barra sobrevive a quem executa o arquivo, e uma barra perdida transforma a
-- expressao em "a letra s", que apagaria o s de todo nome de produto.
UPDATE "Product"
SET "name" = btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g')), "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" <> btrim(regexp_replace("name", '[[:space:]]+', ' ', 'g'));

-- 3. Nome do produto em maiusculas, alinhando com os demais 825.
UPDATE "Product"
SET "name" = upper("name"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" <> upper("name");

-- 4. O apelido que espelha o nome acompanha, para a tela nao mostrar duas
-- grafias do mesmo produto. So o texto exibido — normalizedAlias e a chave e
-- continua igual.
UPDATE "ProductAlias" a
SET "alias" = p."name"
FROM "Product" p
WHERE p."id" = a."productId"
  AND a."normalizedAlias" = p."normalizedName"
  AND a."alias" <> p."name";
