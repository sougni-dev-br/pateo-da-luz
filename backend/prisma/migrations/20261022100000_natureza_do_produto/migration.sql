-- Natureza do item no cadastro de produto. Coluna nula: nenhum produto existente e reclassificado aqui;
-- a classificacao dos ja cadastrados e uma etapa a parte, revisada por quem opera.
CREATE TYPE "ProductNature" AS ENUM ('INSUMO', 'EMBALAGEM', 'CONSUMO', 'DURAVEL', 'SERVICO');

ALTER TABLE "Product" ADD COLUMN "nature" "ProductNature";

CREATE INDEX "Product_nature_idx" ON "Product"("nature");
